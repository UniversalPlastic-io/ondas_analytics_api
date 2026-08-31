# Ejemplo de despliegue 3 — Monitorización con Prometheus y Grafana

El API publica sus métricas en formato Prometheus en **`GET /metrics`**. Este
documento explica qué se mide, cómo levantar el stack de observabilidad y cómo
exponerlo sin abrir un agujero.

Ficheros implicados: [monitoring/](../../monitoring/),
[docker-compose.yml](../../docker-compose.yml) (perfil `monitoring`) y
[src/metrics/](../../src/metrics/).

---

## 1. Arranque

```bash
docker compose --profile monitoring up -d
```

Levanta, además del API y MongoDB:

| Servicio | Puerto | Para qué |
|---|---|---|
| `prometheus` | interno | Recoge `/metrics` del API cada 15 s y guarda 15 días |
| `grafana` | `3001` | Cuadros de mando, con datasource y dashboard ya provisionados |

Abrir `http://localhost:3001` (usuario y contraseña `admin` por defecto;
`GRAFANA_USER` y `GRAFANA_PASSWORD` los cambian). El dashboard **ONDAs Analytics
API** aparece ya cargado en la carpeta *ONDAs*.

El perfil es opcional: `docker compose up -d` a secas sigue levantando solo el
API y Mongo.

Sin Docker, cualquier Prometheus existente puede recoger el endpoint:

```yaml
scrape_configs:
  - job_name: ondas-analytics-api
    metrics_path: /metrics
    static_configs:
      - targets: ['<host>:3000']
```

## 2. Qué se mide

### Servicio

| Métrica | Tipo | Etiquetas |
|---|---|---|
| `http_request_duration_seconds` | histograma | `method`, `route`, `status` |

Cubre **todas** las peticiones, incluidas las que rechaza una guarda. Se mide
sobre el evento `finish` de la respuesta y no con un interceptor de Nest, porque
las guardas se ejecutan **antes** que los interceptores: un interceptor no vería
ningún 401 ni 403, que son justo los códigos que interesa vigilar.

La etiqueta `route` es la **plantilla de ruta** (`/v1/sync/runs/:id`), nunca la
URL solicitada. Etiquetar por la URL real crearía una serie temporal por cada
identificador de ejecución y de activo consultados, y acabaría tumbando
Prometheus. Lo
que no casa con ninguna ruta se agrupa en una única serie `unmatched`.

### Espacio de datos

| Métrica | Tipo | Qué cuenta |
|---|---|---|
| `ondas_sync_runs_total` | contador | Ingestas, por `kind` (`asset` \| `scan`) y `status` (`ok` \| `partial` \| `failed`) |
| `ondas_sync_observations_total` | contador | Observaciones escritas en el modelo de lectura |
| `ondas_sync_warnings_total` | contador | Avisos de validación acumulados |
| `ondas_analyses_runs_total` | contador | Analíticas ejecutadas, **una por análisis**: `["all"]` suma cuatro |
| `ondas_assets_active` | *gauge* | Activos vigentes, leído de Mongo en cada recogida |

Los contadores se publican desde cero, de modo que `rate()` tiene línea base
desde la primera recogida en lugar de aparecer solo cuando llega tráfico.

`ondas_assets_active` se consulta a Mongo en cada recogida. Si la base de datos
no responde, la recogida **no falla**: se sirve el valor anterior y el resto de
métricas se publican igual. La monitorización no debe apagarse justo cuando se
cae aquello que vigila.

### Proceso

Métricas estándar de Node bajo el prefijo `ondas_`: memoria residente, CPU,
retraso del *event loop*, descriptores de fichero y recolección de basura.

## 3. Exponerlo sin abrir un agujero

> ⚠️ **`/metrics` no debe ser accesible desde internet.** No requiere
> autenticación y revela rutas internas, volúmenes de datos, tasas de error y
> características del proceso. Es reconocimiento gratuito para un atacante.

Con el [despliegue de Nginx](02-nginx-pm2.md), denegarlo en el bloque público:

```nginx
  # /metrics queda solo para la red interna: Prometheus lo recoge por el puerto
  # local, no a través del proxy público.
  location = /api/metrics {
    deny all;
    return 404;
  }
```

Y que Prometheus lo recoja directamente contra `127.0.0.1:3000`, sin pasar por
el proxy. Si Prometheus vive en otra máquina, el camino correcto es una red
privada o un túnel, no abrir el endpoint.

Grafana en el puerto `3001` tiene el mismo problema: en cualquier despliegue
alcanzable desde fuera hay que cambiar las credenciales por defecto y ponerle
TLS delante.

## 4. Consultas útiles

```promql
# Peticiones por segundo, por ruta
sum by (route) (rate(http_request_duration_seconds_count[5m]))

# Latencia p95 por ruta
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# Proporción de respuestas 5xx
sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m]))
  / clamp_min(sum(rate(http_request_duration_seconds_count[5m])), 1e-9)

# Intentos rechazados por autenticación o rol
sum by (route, status) (rate(http_request_duration_seconds_count{status=~"401|403"}[5m]))

# Ingestas fallidas en la última hora
increase(ondas_sync_runs_total{status="failed"}[1h])

# Avisos de validación por hora — un salto indica un fichero publicado con desviaciones
increase(ondas_sync_warnings_total[1h])
```

## 5. Alertas recomendadas

No se versionan reglas de alerta porque los umbrales dependen del despliegue.
Los cuatro síntomas que conviene vigilar:

| Síntoma | Expresión | Por qué importa |
|---|---|---|
| Servicio caído | `up{job="ondas-analytics-api"} == 0` | La recogida falla antes que cualquier otra señal |
| Errores del servidor | tasa de `5xx` > 1 % durante 5 min | Fallo real, no de cliente |
| Ingesta fallida | `increase(ondas_sync_runs_total{status="failed"}[1h]) > 0` | El modelo de lectura se queda atrás sin que nadie lo note |
| Modelo de lectura vacío | `ondas_assets_active == 0` | Base equivocada, o `backfill` sin ejecutar |

## 6. Editar el dashboard

El JSON está versionado en
[monitoring/grafana/dashboards/](../../monitoring/grafana/dashboards/) y se
provisiona con `allowUiUpdates: false`: los cambios hechos en la interfaz se
pierden al reiniciar, a propósito, para que el repositorio siga siendo la fuente
de verdad. Para cambiarlo, exportar el JSON desde Grafana
(*Dashboard settings → JSON Model*), guardarlo en ese fichero y reiniciar:

```bash
docker compose --profile monitoring restart grafana
```
