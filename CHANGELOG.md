# Notas de versión

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [SemVer](https://semver.org/lang/es/).

---

## [1.1.0] — 2026-08-29

### Añadido

- **Monitorización.** Métricas Prometheus en `GET /metrics`: latencia y códigos
  por plantilla de ruta, ingestas por desenlace, observaciones escritas, avisos
  de validación, analíticas ejecutadas por tipo y activos vigentes en el modelo
  de lectura. Prometheus y Grafana en el perfil `monitoring` de
  `docker-compose.yml`, con el cuadro de mando versionado y provisionado, y guía
  en [`docs/deployment/03-monitoring.md`](docs/deployment/03-monitoring.md).
  Se mide sobre el evento `finish` de la respuesta y no con un interceptor,
  porque las guardas se ejecutan antes que los interceptores: así las peticiones
  rechazadas por autenticación o rol también quedan contadas.
- **Informe de validación.** `npm run validate:precision` mide fidelidad de
  ingesta, exactitud de agregación, reproducibilidad, cobertura de consulta y
  concordancia entre fuentes independientes, y falla con código distinto de cero
  ante cualquier regresión. Resultados en
  [`docs/validacion-precision.md`](docs/validacion-precision.md).

### Corregido

- **La lista de polímeros de la boya no era determinista.** La agregación que la
  produce ordenaba por número de detecciones sin criterio de desempate, así que
  dos peticiones idénticas devolvían los polímeros de igual frecuencia en orden
  distinto. El índice de Jaccard no se veía afectado, por ser una operación de
  conjuntos, pero la respuesta publicada cambiaba entre ejecuciones. Lo detectó
  la comprobación de reproducibilidad del informe de validación en su primera
  ejecución.

---

## [1.0.0] — 2026-08-29

Primera versión pública del **ONDAs Analytics API**, el componente desarrollado
en la actividad A2.2 (API-ficación) del proyecto del espacio de datos ONDAs.
Expone como API HTTP versionada, autenticada y documentada los indicadores de
residuos marinos que antes se calculaban en cuadernos de análisis.

### Arquitectura

- **Modelo de lectura en MongoDB.** Ningún endpoint analítico consulta S3 en
  tiempo de petición. Un proceso de sincronización explícito lee los activos
  publicados en el bucket, los valida, los normaliza y los materializa en Mongo,
  de modo que la latencia de consulta es independiente del volumen del bucket.
- **Publicación por generaciones.** Cada ingesta escribe una generación completa
  de observaciones y después conmuta el puntero del activo en una sola operación
  atómica. Un lector nunca ve un dataset a medio reemplazar, y una ingesta
  interrumpida no deja datos visibles a medias.
- **Vocabulario canónico.** Los nombres de columna crudos no salen del
  normalizador: repositorios, agregaciones y endpoints hablan un único conjunto
  de campos canónicos, con la unidad incorporada al nombre cuando no es obvia.

### API v1

- `POST /v1/auth/login`, `GET /v1/auth/me` — autenticación por JWT.
- `GET /v1/overview` — KPIs, serie de kilogramos, composición de plástico y
  principales localizaciones.
- `GET /v1/map/points` — marcadores por dataset, con filtros por océano, tipo y
  proveedor, y salida GeoJSON opcional.
- `GET /v1/analyses/indices`, `POST /v1/analyses/run` — cálculo de indicadores
  sobre un punto, un radio y un rango de fechas, con generación opcional de
  gráficas WebP y de un informe PDF.
- `POST /v1/reports/request` — informes periódicos en PDF.
- `POST /v1/sync/assets`, `POST /v1/sync/scan`, `GET /v1/sync/runs[/:id]` —
  ingesta y trazabilidad de cada ejecución.
- `GET|POST|PUT /v1/admin/organizations`, `/v1/admin/users` — alta de
  participantes y usuarios.
- `GET /v1/campaigns`, `/v1/cleanups`, `/v1/organizations` — passthrough de
  marketplace.
- Documentación OpenAPI 3 navegable en `/docs` y descargable en `/docs-json`.
- La especificación se entrega además versionada en
  [`docs/openapi.json`](docs/openapi.json) —17 rutas, 20 operaciones y 38
  esquemas—, junto con una colección Postman generada de ella,
  [`docs/ONDAs_Analytics_API.postman_collection.json`](docs/ONDAs_Analytics_API.postman_collection.json).
  Su petición de login guarda el token en una variable de colección, de modo que
  el resto se ejecutan sin configurar nada más.

### Identidad y control de acceso

- Organizaciones, usuarios y roles `admin` / `provider` / `viewer`, con guardas
  por rol sobre la sincronización y la administración.
- Los endpoints públicos de lectura aceptan token opcional: sin él responden el
  agregado de todo el espacio de datos; con él, el ámbito por defecto es la
  organización del solicitante, ampliable con `scope=all`.
- Contraseñas con `bcrypt` y revocación por rotación del secreto de firma.

### Ingesta del espacio de datos

- Validación en tres fases: estructura del contenedor (bloqueante), contraste
  contra el esquema DCAT del tipo y lectura de la semántica declarada. Solo la
  primera rechaza un activo; el resto queda registrado como avisos sobre el
  activo, de forma que un fichero con desviaciones se sigue sirviendo y su
  problema queda documentado.
- Normalizadores por tipo de dataset: recogidas de playa, boya de biomasa, boya
  de microplásticos, boya meteo-oceanográfica, ventanas previas a evento
  (anidadas) y muestras de agua y de peces.
- Resolución de la posición de un activo por prioridad —corrección explícita,
  coordenadas del propio fichero cuando son verosímiles para su estación, punto
  de referencia de la estación— dejando constancia de cada desviación.
- Escaneo del bucket con repliegue a un inventario incluido cuando el entorno de
  ejecución no dispone del permiso de listado.

### Datasets de referencia

- Series de calibración generadas de forma determinista y publicadas en el
  espacio de datos bajo `public/{océano}/ondas_reference/`, con su procedencia
  declarada en `dct:provenance` y las columnas que publican en `fieldsIncluded`.
- Se ingieren por el mismo canal que cualquier otro activo y **el motor
  analítico solo recurre a ellas cuando una categoría no tiene ningún dataset
  observado con datos en el área consultada**. El mapa, los KPIs del cuadro de
  mando y los informes las excluyen explícitamente: describen mediciones de un
  emplazamiento, y una serie de calibración no lo es.
- `npm run reference:generate` las regenera; el mismo rango produce ficheros
  byte a byte idénticos, de modo que regenerar nunca introduce diferencias
  espurias.

### Esquemas DCAT

- Los esquemas de `metadata/DCAT` describen ahora las **columnas de los activos
  publicados**, no las de los ficheros de laboratorio de origen de los que se
  derivaron. Afecta a la boya de biomasa, a la boya meteo-oceanográfica y a la
  boya de microplásticos, cuyo esquema además declaraba por error las variables
  del dataset de muestras de agua.
- El esquema de la boya de biomasa incorpora las capas de profundidad que solo
  publica una de las boyas.
- El contraste tolera las variantes de grafía que el normalizador ya trata como
  una sola columna, en lugar de declarar la misma variable varias veces en un
  contrato público.
- `generate_dcat.py` vuelve a mantener sincronizados los esquemas versionados
  con los metadatos de origen.

### Corregido

- Los porcentajes de composición de polímero de las recogidas de playa se
  perdían silenciosamente en los ficheros que no usaban el sufijo `(%)` en el
  nombre de columna. Conviven tres grafías en el espacio de datos y solo una se
  reconocía, por lo que 9 de 18 eventos de recogida se ingerían sin
  composición. La búsqueda de columna es ahora insensible a esas variantes.
- La documentación de `POST /v1/analyses/run` anunciaba en `plotPdfUrl` una ruta
  de descarga `/v1/analyses/plots/…` que el servicio no sirve: el PDF se publica
  en S3. El ejemplo describe ahora la URL real, y se documenta `analysisArchive`,
  que la respuesta devolvía sin declararlo en el esquema.

### Frontend

- SPA de demostración en React, Vite y Leaflet para seleccionar punto, radio y
  rango de fechas, lanzar una analítica y explorar los resultados.

### Despliegue

- `Dockerfile` multietapa y `docker-compose.yml` para levantar API y MongoDB con
  un comando.
- Despliegue en servidor Linux con Nginx y PM2, con el SPA y el API bajo un
  mismo origen.
- **Monitorización**: métricas Prometheus en `GET /metrics` —latencia y códigos
  por ruta, ingestas, observaciones, avisos, analíticas ejecutadas y activos
  vigentes—, con Prometheus y Grafana en el perfil `monitoring` de Compose y un
  cuadro de mando versionado. Se mide sobre el evento `finish` de la respuesta,
  de modo que las peticiones rechazadas por una guarda también quedan contadas.
- Tres guías reproducibles en [`docs/deployment/`](docs/deployment/).

### Calidad

- 179 pruebas automatizadas sobre normalización, validación, agregaciones,
  generación de informes y selección de datasets.
- ESLint y Prettier, compilación estricta de TypeScript.

### Licencia

- Publicado bajo **Apache License 2.0** (`LICENSE`, `NOTICE`).

[1.1.0]: https://github.com/UniversalPlastic-io/ondas_analytics_api/releases/tag/v1.1.0
[1.0.0]: https://github.com/UniversalPlastic-io/ondas_analytics_api/releases/tag/v1.0.0
