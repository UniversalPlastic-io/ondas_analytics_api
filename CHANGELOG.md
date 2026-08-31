# Notas de versión

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [SemVer](https://semver.org/lang/es/).

---

## [Sin publicar]

Veinticuatro commits desde `v1.1.0`. El cambio de fondo es que **la fuente de datos
pasa a ser el espacio de datos** y no un bucket de objetos, y con él llegan las
tres consecuencias que ocupan el resto de esta sección: cómo se eligen los
datasets que responden una consulta, de dónde sale el esquema con que se validan,
y que el API deja de ser sólo consumidor. Y por debajo de las tres, la condición
que les faltaba: la transferencia del espacio, que se daba por inservible, sí
resuelve — había que reintentar la negociación, no arreglar el activo.

### Cambios que rompen

- **La ingesta lee del espacio de datos, no del bucket.** El activo ya no se
  direcciona por una ruta que codifica qué es (`public/{mar}/{proveedor}/{fichero}`)
  sino por un UUID opaco cuyo acceso concede un contrato. Todo lo derivable de la
  ruta —el mar, el publicador, el tipo de dataset— pasa a una tabla explícita,
  `ASSET_MAP`, regenerable con `npm run assets:refresh`. Requiere credenciales de
  conector (`DSPACER_*`) y **reconstruir el modelo de lectura**:
  `npm run backfill -- --force`.
- **`POST /v1/analyses/run` responde 400 fuera de las costas cubiertas.** Un punto
  a más de 100 km de la costa mediterránea, atlántica (golfo de Cádiz y Canarias)
  o cantábrica no pertenece a ninguna, y antes recibía cifras del mar menos
  lejano. Los ejemplos de la especificación usaban Madrid, que ahora se rechaza:
  todos pasan a Gijón, igual que el punto de partida del SPA.
- **La selección de datasets es por costa, no por distancia.** Sólo los datasets
  de la costa asignada pueden responder una consulta; dentro de ella gana el más
  cercano. Una consulta en Gijón cuya categoría no tenía dataset cantábrico tomaba
  antes el de Badalona, a 695 km y en otro mar, sin decirlo. Ahora esa categoría
  cae a la serie de calibración.

### Añadido

- **Nivel de referencia.** Las series de calibración se ingieren por el mismo
  pipeline que cualquier activo y se marcan `tier: 'reference'` en el modelo de
  lectura. El mapa, los KPIs y los informes las excluyen; sólo
  `POST /v1/analyses/run` recurre a ellas, y sólo cuando una costa no tiene
  ningún dataset observado de esa categoría. El nivel se decide una vez, al
  ingerir, y se almacena: deducirlo en cada lectura era lo que acoplaba el modelo
  a la forma de la clave de origen.
- **Publicación de los análisis en el espacio de datos.** Cada análisis generado
  se publica como activo propio de UP, ofrecido a todos los participantes, con
  nombre `report_{lat}_{lon}_{fecha}` y la identidad exacta en la descripción.
  Ocurre tras responder y no puede alcanzar a quien preguntó. **Apagado salvo que
  `DSPACER_PUBLISH_ENABLED` lo encienda**, porque escribe en el catálogo
  compartido de producción. Diseño, riesgos y límites en
  [`docs/report-publishing.md`](docs/report-publishing.md).
- **Validación contra el esquema DCAT que publica el proveedor.** Los documentos
  de esquema del espacio se leen, no sólo se saltan, y son la primera fuente con
  la que se comprueban las columnas de un dataset; las copias de `metadata/DCAT/`
  quedan como respaldo. Cierra un hueco real: `atmosfera_previa_evento` y
  `oceanografia_previa_evento` no tienen copia local, así que sus columnas no se
  comparaban con nada. Qué esquema respondió se anota en el activo
  (`dcatSchemaSource`, `dcatSchemaId`).
- **Métricas de publicación.** `ondas_reports_published_total{status}` e
  histograma de duración. `status` es la única etiqueta: el punto o la clave
  crearían una serie temporal por informe.
- **`npm run fixtures:refresh`**, que recaptura los catálogos reales sobre los que
  corren las pruebas de `dataspace/source`, sustituyendo BPN y anfitriones por
  marcadores.
- **El informe de `assets:refresh` señala renombrados y reclasificados.** Contar
  ids nuevos e ids retirados pierde el caso intermedio: un activo que conserva su
  id y cambia de nombre no aparecía en ninguna de las dos cuentas, y la tabla se
  reescribía sin decir nada. Ahora son dos bloques distintos, porque no son la
  misma gravedad: el bloque `~ renamed` informa, y el bloque `! reclassified` —el
  id se queda y el significado se mueve— termina con código distinto de cero,
  igual que ya hacía un activo que no sabe colocar. Que la heurística lea del
  nombre un tipo de dataset o un emplazamiento distintos de los que la tabla
  registra significa que ese activo dejó de ser lo que decíamos que era, y
  escribirlo sin mirar es cómo un indicador acaba contaminado en silencio.

### Corregido

- **La negociación que se queda sin referencia de datos se reintenta.** La
  transferencia se daba por inservible, y con ella la carga del modelo de
  lectura. La medición del 01/09/2026 separa los dos desenlaces sin solaparse:
  todo éxito llega en 5-6 s y todo fallo en 18-20 s. Ese fallo es el conector
  dejando de esperar la *endpoint data reference* tras una negociación correcta
  —no el proveedor negándose ni el activo estando vacío— y no es propiedad del
  activo: el mismo activo falla y minutos después funciona. De siete fallos así,
  seis se recuperaron reintentando. `DspacerSource.get()` hace ahora cuatro
  intentos, y sólo sobre ese fallo: un 403 por contrato y un 404 del backend del
  proveedor son deterministas, y reintentarlos cargaría el conector de un socio
  para llegar a la misma respuesta. Comprobado contra el espacio real: los ocho
  esquemas DCAT se descargan. El mensaje de error afirmaba lo contrario —«the
  provider never opened a transfer»— y esa frase es parte de por qué el fallo se
  leyó como permanente; ahora dice que es transitorio, con la medición dentro.
- **Las tablas de activos apuntaban a cinco identificadores que ya no existen.**
  Las cinco series de calibración se republicaron con sufijo `_v1.1` e id nuevo,
  así que `REFERENCE_ASSETS` quedó huérfana entera. El efecto habría sido
  silencioso: el siguiente escaneo las marca `missing`, el nivel de referencia se
  vacía, y una categoría sin dataset en su costa deja de tener a qué caer. Las
  tablas se rehacen sobre el catálogo actual, 43 activos: los 30 datasets
  observados sin moverse, las 5 series recuperadas y los 8 esquemas DCAT, que
  entran en la tabla por primera vez y son lo que hace utilizable la validación
  contra el esquema del proveedor.
- **Un activo sustituido por una versión posterior se ignora.** Tras la
  republicación `_v1.1` quedaron pares del mismo dataset en las mismas
  coordenadas, y el más antiguo —vaciado por el incidente— ganaba la mitad de las
  veces, de modo que una categoría encontraba un activo sin observaciones, caía a
  la calibración y publicaba una cifra sustituida con un activo bueno al lado.
- **La cuenca bajo la que se archiva una salida la decide el punto**, no el activo
  observado que casualmente estuviera más cerca.
- **La consulta de campañas iba contra un campo que ya no existe.**
- **`assets:refresh` no veía dos cambios que sí importan.** La detección de una
  serie de calibración se hacía sobre el nombre crudo y anclada al final, así que
  el sufijo `_v1.1` desconectó las cinco a la vez y salieron como «no sé
  colocarlo»; se hace ahora sobre el nombre plegado, que es lo que quita el
  sufijo de versión. Y las bajas sólo se comprobaban contra `ASSET_MAP`, de modo
  que el informe decía «0 ids ya no ofrecidos» mientras el nivel de referencia
  entero se quedaba sin activos.
- **La rejilla del informe de precisión queda fijada contra la línea de costa.**
  Desde que la costa decide qué datasets responden una consulta, un punto fuera
  de las costas cubiertas recibe un 400 y el informe falla entero — y esos seis
  puntos son la evidencia que E4.1 aporta para R4.1. «Mediterráneo abierto» queda
  a 98,7 km de la costa mediterránea, 1,3 km por dentro de la tolerancia de
  100 km: `MAX_OFFSHORE_KM` no se puede estrechar sin mover el punto, y un
  vértice retocado lo dejaría fuera sin que nadie lo notara. Una prueba lo afirma
  ahora.

### Documentación

- **El README abre por el marco del proyecto.** ONDAs es el *Ocean Notarised
  Digital Asset space*, expediente TSI-100121-2024-99, y este repositorio cubre
  tres actividades: A2.2 API-ficación de servicios y conjuntos de datos, A4.2
  análisis de valor añadido de los datos y A4.3 explotación y compartición
  efectiva de datos. La tabla dice qué aporta el repositorio a cada una en lugar
  de repetir el nombre de la actividad, que es lo que un evaluador necesita
  comprobar; A4.3 es la que cambia de sentido con el trabajo reciente, porque ya
  no es sólo consumir del espacio los activos con contrato, sino devolverle cada
  análisis generado como activo propio.
- Retirada la documentación que describía la lectura del bucket y los diseños
  previos al espacio de datos: describía un sistema que ya no es este.

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
