# Ejemplo de despliegue 1 — Docker Compose

Levanta el API y su MongoDB en contenedores, de cero a servicio funcionando con
un comando. Es el camino recomendado para **evaluación, demostración y
preproducción**, porque no requiere preparar ningún servidor ni instalar Node ni
Mongo en la máquina anfitriona.

Ficheros implicados: [Dockerfile](../../Dockerfile),
[docker-compose.yml](../../docker-compose.yml), [.dockerignore](../../.dockerignore).

---

## 1. Requisitos

| Requisito | Versión | Comprobación |
|---|---|---|
| Docker Engine | ≥ 24 | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |
| Puerto libre | 3000 por defecto | `lsof -i :3000` |

Recursos: ~1,5 GB de disco para las imágenes y ~1 GB de RAM.
No hace falta credencial de AWS para arrancar; sólo para la carga de datos del
paso 4.

## 2. Configuración

```bash
git clone https://github.com/UniversalPlastic-io/ondas_analytics_api.git
cd ondas_analytics_api
cp .env.example .env
```

Edita `.env` y fija como mínimo:

```dotenv
PORTAL_JWT_SECRET=<cadena aleatoria larga>
```

Genera el secreto con:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`MONGODB_URI` puede quedarse **sin definir**: Compose usa entonces el contenedor
`mongo` del propio stack (`mongodb://mongo:27017`). Si defines una URI de Atlas,
se respeta ese valor y el contenedor de Mongo queda sin usar.

Comprueba la configuración efectiva antes de arrancar — este comando no arranca
nada y resuelve todas las variables:

```bash
docker compose config
```

## 3. Arranque

```bash
docker compose up -d --build
```

La primera construcción tarda 2-4 minutos (tres etapas: dependencias,
compilación de TypeScript, imagen final sólo con dependencias de producción).

Estado de los servicios:

```bash
docker compose ps
```

`api` debe aparecer como `healthy` (su *healthcheck* consulta `/docs` cada 30 s)
y `mongo` como `healthy`.

## 4. Datos iniciales

Los dos comandos son de un solo uso y usan la etapa `build` de la imagen,
porque `seed` y `backfill` se ejecutan con `ts-node`:

```bash
# Organizaciones y usuarios. Imprime la contraseña del administrador UNA vez.
docker compose run --rm seed

# Carga del read model desde el catálogo del espacio de datos.
docker compose run --rm backfill
```

> **Anota la contraseña que imprime `seed`.** No se vuelve a mostrar. Si se
> pierde, restablécela con `docker compose run --rm seed npm run users:reset`.

`backfill` ejecuta el mismo escaneo que expone `POST /v1/sync/scan`, como actor
administrador, así que necesita las cuatro variables `DSPACER_*`: sin ellas no
hay catálogo que leer y el comando falla en el arranque. Cada activo se obtiene
negociando su contrato con el conector de su proveedor, de modo que el tiempo del
comando lo marca el número de activos ofrecidos, no el tamaño de los ficheros.
Los proveedores que fallen se aíslan y se reportan en los avisos de la ejecución.

## 5. Verificación

```bash
# Documentación interactiva
open http://localhost:3000/docs

# Endpoint abierto
curl -s http://localhost:3000/v1/map/points | head -c 400

# Login y llamada autenticada
TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@universalplastic.io","password":"<la del seed>"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).access_token))")

curl -s 'http://localhost:3000/v1/overview?period=year' -H "Authorization: Bearer $TOKEN"
```

Criterio de aceptación: `/docs` carga el catálogo OpenAPI completo,
`/v1/map/points` devuelve puntos y `/v1/overview` devuelve KPIs distintos de
cero después de `backfill`.

## 6. Operación

| Acción | Comando |
|---|---|
| Logs en vivo | `docker compose logs -f api` |
| Reiniciar sólo el API | `docker compose restart api` |
| Aplicar cambios de código | `docker compose up -d --build api` |
| Consola de Mongo | `docker compose exec mongo mongosh ondas_dataspace` |
| Parar (conservando datos) | `docker compose down` |
| Parar y **borrar** datos y gráficas | `docker compose down -v` |

Las gráficas que genera `POST /v1/analyses/run` se guardan en el volumen `plots`
y los datos de Mongo en `mongo-data`; ambos sobreviven a `docker compose down`,
y sólo `-v` los elimina.

## 7. Incidencias frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `define PORTAL_JWT_SECRET en .env` al arrancar | Falta el secreto | Fíjalo en `.env` (paso 2) |
| `api` reinicia en bucle y los logs muestran errores de Mongoose | `MONGODB_URI` apunta a un Atlas inaccesible desde el contenedor | Comenta `MONGODB_URI` en `.env` para usar el Mongo del stack, o añade la IP de salida a la lista de acceso de Atlas |
| `/v1/overview` responde con KPIs a cero | No se ha ejecutado `backfill` | Paso 4 |
| `Bind for 0.0.0.0:3000 failed: port is already allocated` | Puerto ocupado | `PORT=3001 docker compose up -d` |
| 401 en `/v1/analyses/run` | Token ausente, caducado (8 h) o secreto cambiado | Repetir el login del paso 5 |

## 8. Notas para producción

Este ejemplo expone el API en claro en el puerto 3000. Para un entorno público:

- Poner un proxy inverso con TLS por delante y fijar `PUBLIC_API_BASE_PATH` y
  `PUBLIC_API_DISPLAY_URL` para que los enlaces de Swagger apunten a la URL real.
- No exponer el puerto de Mongo, o usar un servicio gestionado.
- Fijar `DISABLE_LEGACY_CONNECTOR_LOGIN=true` una vez migradas todas las cuentas
  del portal antiguo, para desactivar el respaldo de login por fichero.
- Rotar `PORTAL_JWT_SECRET` invalida todos los tokens emitidos: es el
  procedimiento de revocación.

El despliegue en el servidor de producción está descrito en el
[ejemplo 2](02-nginx-pm2.md), y la monitorización con Prometheus y Grafana
—perfil `monitoring` de este mismo `docker-compose.yml`— en el
[ejemplo 3](03-monitoring.md).
