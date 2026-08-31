# Publicación de análisis en el espacio de datos

Implementado, **apagado por defecto**. `DSPACER_PUBLISH_ENABLED` lo enciende, y
mientras esté apagado nada de lo que sigue escribe en el catálogo.

Hasta ahora el API sólo **consumía** el espacio de datos. Ahora es
también **proveedor**: cada análisis que genera se publica como activo propio de
Universal Plastic en su catálogo, ofrecido a todos los participantes.

Los ficheros —PDF de gráficas, WebP, informes— siguen subiéndose a S3. Lo que se
publica en el espacio es el **JSON del análisis**, que es el que contiene las
referencias a esos ficheros. El JSON es el índice; S3 es el almacén.

---

## 1. Lo que ya existe en el conector

El *middleware* de D-Spacer publica su propia especificación en
`{DSPACER_BASE_URL}/openapi.json`. La ruta de escritura está completa:

| Operación | Para qué |
|---|---|
| `POST /data/upload` | Sube un JSON y genera su activo. Devuelve el activo |
| `POST /policies/create/{policy_id}/no_restriction` | Política que cualquiera satisface |
| `POST /contracts/create` | Contrato que liga política y activo |
| `POST /data/all` | Lista los activos de este conector, sin negociar |
| `GET /data/{asset_id}` | Un activo concreto |
| `DELETE /data/{asset_id}` | Retira un activo |

Publicar son **tres llamadas, en este orden**: el activo primero, porque el
contrato necesita su identificador.

```
1. POST /data/upload
   { "request": { …el JSON del análisis… },
     "asset_data": { "asset_name": "report_43.5721_-5.7212_2026-08-31",
                     "asset_description": "ONDAs analytics report · …" } }
   → { "@id": "<uuid>", "properties": { "name", "description", "id" }, "dataAddress": … }

2. POST /policies/create/{policy_id}/no_restriction
   → la política, sin cuerpo de petición

3. POST /contracts/create
   { "contract_id": "<uuid>", "policy_id": "<uuid>", "asset_id": "<uuid del paso 1>" }
```

`policy_id` y `contract_id` los elegimos nosotros, y se generan como UUID v4 para
que no colisionen con los de otra publicación.

---

## 2. Identidad de un análisis publicado

El nombre es legible y buscable; la identidad exacta va en la descripción.

```
asset_name         report_{lat}_{lon}_{YYYY-MM-DD}
asset_description  ONDAs analytics report · {costa} · radio {r} km
                   · {inicio}→{fin} · {agregación} · {análisis}
                   · key={huella}
```

Un ejemplo real:

```
report_43.5721_-5.7212_2026-08-31
ONDAs analytics report · catambrico · radio 25 km · 2025-01-01→2025-01-30
· raw · basic_contamination+eco_risk · key=3f9a1c7d2e4b8a05
```

`lat` y `lon` con **cuatro decimales de ancho fijo**, la misma redondez que ya
aplica `computeCacheKey` —incluido cómo rompe un empate—, para que el nombre y la
identidad coincidan en el punto. Ancho fijo, y no la representación más corta,
porque un listado donde unos nombres llevan un decimal y otros cuatro no se lee
ni se filtra por prefijo.

`key=` no es la clave de caché sino una **huella** suya: SHA-256 truncado a 16
hex. La clave es el request normalizado entero, unos cientos de caracteres de
JSON, que no es algo que quepa en una descripción; y la clave completa viaja
dentro del propio documento publicado, en `meta.cache.cacheKey`.

`fecha` es **el día en que se generó** el análisis, en UTC, no el rango analizado.
Es lo que hace citable un análisis: «lo que dijimos ese día». El rango analizado
va en la descripción y dentro del JSON.

**Por qué la clave no está en el nombre.** El nombre que se pidió,
`report_lat_lon_fecha`, no distingue radio, rango ni qué análisis se ejecutaron, y
la clave de caché sí: dos consultas del mismo punto el mismo día con radio 25 y
50 km son análisis distintos con el mismo nombre. Meter todo en el nombre lo
volvería ilegible; dejar sólo el nombre haría que una consulta borrase la otra.
Con la clave en la descripción los dos activos conviven, se distinguen y el nombre
sigue siendo el que se pidió.

---

## 3. Qué contiene el activo

El `AnalysesRunResponse` completo, tal como lo devuelve el endpoint. Ya lleva las
referencias a S3: `plotPdfUrl`, `plotWebpPaths` y `archive.s3Prefix`.

**Restricción que hay que respetar.** `plotPdfUrl` puede ser una URL prefirmada,
que caduca. Un análisis publicado cuyos enlaces caducan es un artefacto roto: el
activo sigue en el catálogo y sus referencias ya no resuelven. Publicar un enlace
que caduca es peor que no publicar.

La comprobación se hace **sobre la URL, no sobre la configuración**: se buscan los
parámetros que AWS añade al prefirmar (`X-Amz-Signature`, `X-Amz-Credential`) en
`plotPdfUrl`, `plotPdfPath`, `plotWebpPaths` y `analysisArchive`. La
configuración (`S3_PUBLIC_BASE_URL` sin definir) es la causa; la firma es el
síntoma, y el síntoma es lo que de verdad es cierto del documento que se va a
publicar. Un análisis sin ninguna referencia externa no tiene nada que caduque y
se publica igual.

Cuando hay firmas, no se publica, se registra el motivo y el aviso nombra la
variable que hay que definir.

**Lo que esta comprobación no cubre.** Si S3 no está configurado, `plotPdfPath`
es una ruta absoluta del servidor, que no caduca pero tampoco resuelve para
nadie más, y se publicaría. No se bloquea porque no es una exposición nueva: el
mismo JSON ya se sube hoy a un prefijo `public/` del *bucket* en
`uploadAnalysisResultToS3`.

---

## 4. Cuándo se publica, y qué pasa si falla

Después de responder, sin bloquear. El análisis es el producto; publicarlo es
distribución, y una consulta no debe fallar ni tardar más porque el conector esté
lento o caído.

Consecuencia aceptada: la respuesta no puede llevar un aviso de que la publicación
falló, porque ya se envió. El resultado se registra en tres sitios:

- El log, con el motivo.
- Una métrica `ondas_reports_published_total{status}`, con **status como única
  etiqueta**: ni coordenadas ni clave, que harían explotar la cardinalidad. El
  histograma sólo se observa cuando se llamó al conector; un análisis omitido no
  tardó nada, y contarlo como una publicación rápida haría que el histograma
  describiese otra cosa.
- Un registro en `sync_runs` con `kind: 'publish'`, para que
  `GET /v1/sync/runs` lo muestre junto a los escaneos y quede auditable sin
  añadir una colección nueva. Con `organizationId: null`: publicar lo hace el
  sistema, y el mismo análisis se publica lo pida quien lo pida.

No todo se registra en `sync_runs`. Sí las publicaciones, los fallos y la
omisión por URL que caduca —esa tiene algo que arreglar—. No las omisiones por
interruptor apagado ni por duplicado: una fila por análisis en un despliegue con
la publicación apagada enterraría las filas que significan algo. La métrica sí
las cuenta todas, que para eso es un contador y no una fila.

Una omisión no es un fallo: la fila dice `ok`, publica cero y lleva el motivo
como aviso. Sólo un error del conector es `failed`.

Y si se pierde la fila de auditoría, la publicación ya ocurrió: perder el
registro no convierte un éxito en un fallo.

**Un límite que queda abierto.** Si el proceso muere con una publicación en
vuelo, se pierde sin dejar fila. Cerrarlo sería esperar a las pendientes en
`onApplicationShutdown`, pero el API no tiene los *shutdown hooks* de Nest
activados, así que ese gancho no se ejecutaría: activarlos cambia el apagado de
toda la aplicación y no entra aquí. `PublishService.whenSettled()` existe y es lo
que haría falta el día que se activen.

**Y una cosa que este script sí tuvo que arreglar.** `scripts/validate-precision.ts`
ejecuta el servicio real de analíticas: sin tocarlo, una validación publicaría
decenas de análisis de prueba en el catálogo. Fuerza `DSPACER_PUBLISH_ENABLED` a
`false` en su primera línea, que funciona precisamente porque el interruptor se
lee en cada llamada.

---

## 5. Idempotencia

Publicar dos veces la misma identidad —caché saltada, o proceso reiniciado— crea
dos activos con el mismo nombre y la misma clave. Con la retención elegida
(conservar todo) se acepta.

Lo que sí se evita es el duplicado inmediato: el proceso recuerda las claves que
ya publicó y no repite. Es una comprobación en memoria, sin llamada al conector.
Tras un reinicio puede volver a publicar una clave ya publicada; queda documentado
como límite, no como error.

Dos detalles que decide la implementación:

- El conjunto está **acotado a 1000 claves** y expulsa la más antigua. El
  catálogo crece un activo por análisis no cacheado, así que un conjunto sin
  tope guardaría todas las claves que el proceso haya visto. Expulsar significa
  que una clave muy antigua puede volver a publicarse, que es justo el duplicado
  que este apartado ya acepta; el crecimiento silencioso de memoria no.
- La clave se **reserva antes** de subir, para que dos peticiones idénticas
  simultáneas no publiquen las dos, y se **libera si falla**: una clave que
  siguiera reservada tras un intento fallido no se publicaría nunca.

---

## 6. Retención

No se borra nada. Un análisis publicado es un resultado público y citable, y
retirarlo rompe a quien lo referencie.

El coste es crecimiento del catálogo: un activo por consulta no cacheada. Un
cuadro de mando con veinte usuarios y diez consultas al día son unos 200 activos
al día. Dos consecuencias de diseño:

- `POST /data/all` pagina con `offset`/`limit`, así que cualquier búsqueda debe
  filtrar **en el servidor** con `filterExpression`, nunca traerse la lista y
  filtrar aquí.
- Nadie ha probado este catálogo con miles de activos. Es el riesgo abierto que
  hay que medir antes de encenderlo en producción.

---

## 7. Configuración

| Variable | Por defecto | Qué hace |
|---|---|---|
| `DSPACER_PUBLISH_ENABLED` | `false` | Interruptor. Sólo `true` o `1` lo encienden |
| `DSPACER_*` | — | Las mismas credenciales del conector que ya usa la sincronización |
| `S3_PUBLIC_BASE_URL` | — | Sin ella las URL de gráficas se prefirman y la publicación se omite (§3) |

Ambos interruptores se leen del entorno **en cada llamada**, no al importar el
módulo: si se publica o no es una decisión de operación, y así una prueba y un
operador obtienen la misma respuesta.

Con el interruptor encendido pero `DSPACER_*` incompleto no se publica y se avisa
una vez por análisis: es una configuración a medias, no un modo de trabajo.

**Por defecto apagado, deliberadamente.** Sin ese interruptor, una máquina de
desarrollo ejecutando las pruebas publicaría en el catálogo de producción.

---

## 8. Lo que este diseño no hace

**La caché sigue en memoria.** La petición original era usar el JSON del espacio
como caché; la decisión fue mantener la caché en memoria y publicar aparte, tras
ver el coste: leer la caché por el camino del espacio de datos es una negociación
de contrato por consulta —segundos, no milisegundos.

Lo que eso deja fuera, y conviene tener presente:

- La caché no sobrevive a un reinicio.
- Dos instancias del API no la comparten.

El paso siguiente natural, si se quiere cerrar eso sin pagar la negociación:
cuando la caché en memoria falla, buscar en `POST /data/all` antes de recalcular.
Son dos llamadas a nuestro propio conector, sin negociación, porque el conector es
nuestro. No entra en este diseño.

---

## 9. Riesgos abiertos

| # | Qué | Por qué bloquea |
|---|---|---|
| 1 | ~~Un análisis publicado podría no recuperarse~~ | **Menos grave de lo que parecía.** El 31/08/2026 se midió que la transferencia sí resuelve: el fallo era el conector dejando de esperar la *endpoint data reference*, y un reintento lo recupera. Queda por comprobar con **una** publicación real si un activo que subamos se descarga igual |
| 2 | La especificación del *middleware* declara las respuestas de las tres operaciones de escritura como `schema: {}` | Los nombres de campo de la respuesta no están documentados. La forma del activo se conoce por `POST /data/all`, que devuelve `@id` y `properties`. `parseUploadedAsset` acepta varias grafías del identificador en vez de apostar por una, y falla explícitamente si no encuentra ninguna: sin id no hay contrato que crear, así que no es un éxito |
| 3 | Semántica real de `no_restriction` | ¿Cualquier BPN del espacio, o público de verdad? Decide si «compartido con todo el mundo» es exacto. A confirmar con SQS |
| 4 | Crecimiento del catálogo | Ver §6 |

El riesgo 1 se ha reducido, no cerrado. Lo que se creía una dirección de datos
compartida e inservible resultó ser un temporizador: con reintento, los ocho
esquemas DCAT y la mayoría de los datasets se descargan
—ver [dspacer-integration.md](dspacer-integration.md#la-transferencia-sí-resuelve-era-un-temporizador-no-un-activo-roto)—.
Lo que falta es comprobar que un activo **subido por nosotros** se comporta igual,
y eso necesita **una** publicación real. Como es una escritura en el catálogo de
producción, no se hace sin pedirlo, y hasta entonces el interruptor sigue
apagado.

Lo que sí hace la implementación es dejar de esconderlo: `uploadData` devuelve
`dataAddressBaseUrl` y `PublishOutcome` lo lleva, así que la primera publicación
real dice en el log si el activo heredó la dirección compartida. La alternativa
—no leer ese campo— convertía un problema comprobable en el primer minuto en una
queja de un consumidor meses después.

---

## 10. Ficheros

| Fichero | Qué |
|---|---|
| [src/api-v1/dataspace/report-identity.ts](../src/api-v1/dataspace/report-identity.ts) | Nombre, descripción y huella. Puro: sin reloj, sin configuración, sin conector |
| [src/api-v1/dataspace/publish.service.ts](../src/api-v1/dataspace/publish.service.ts) | Las tres llamadas, los cuatro filtros previos, la métrica y el registro |
| [src/api-v1/dataspace/source/dspacer.client.ts](../src/api-v1/dataspace/source/dspacer.client.ts) | `uploadData`, `createNoRestrictionPolicy`, `createContract`, `listOwnAssets`, y el token `DSPACER_CLIENT` |
| [src/api-v1/dataspace/source/dspacer-catalog.ts](../src/api-v1/dataspace/source/dspacer-catalog.ts) | `parseUploadedAsset`: lee el id y la dirección de una respuesta sin esquema |
| [src/api-v1/dataspace/dataspace.module.ts](../src/api-v1/dataspace/dataspace.module.ts) | Un solo cliente, compartido por el catálogo y la publicación |
| [src/api-v1/dataspace/dataspace.constants.ts](../src/api-v1/dataspace/dataspace.constants.ts) | `dspacerPublishEnabled()` |
| [src/api-v1/dataspace/schemas/sync-run.schema.ts](../src/api-v1/dataspace/schemas/sync-run.schema.ts) | `kind` admite `publish` |
| [src/api-v1/analyses/analyses.service.ts](../src/api-v1/analyses/analyses.service.ts) | Una línea: publicar tras calcular, sin esperar |
| [src/metrics/metrics.service.ts](../src/metrics/metrics.service.ts) | Contador e histograma de publicación |

Un solo cliente y no dos porque el cliente cachea el token de acceso: una segunda
instancia significa un segundo login por vida de token y dos calendarios de
renovación cruzándose.

---

## 11. Qué se prueba

48 pruebas, ninguna toca la red.

| Fichero | Qué fija |
|---|---|
| [report-identity.spec.ts](../src/api-v1/dataspace/report-identity.spec.ts) | El nombre, incluido cómo redondea, cómo rompe un empate igual que la clave de caché y que nunca escribe `-0.0000`; que la huella no es la clave |
| [publish.service.spec.ts](../src/api-v1/dataspace/publish.service.spec.ts) | Que apagado no llama al conector; el orden de las tres llamadas; que el contrato apunta al activo subido; que una URL prefirmada bloquea; que no publica dos veces; que un fallo libera la clave; que el conjunto expulsa; que nunca lanza; que la métrica sólo se etiqueta por `status` |
| [dspacer.client.spec.ts](../src/api-v1/dataspace/source/dspacer.client.spec.ts) | La forma exacta de las tres peticiones, que la política va con POST y sin cuerpo, y que una respuesta sin id es un fallo |
| [dspacer-catalog.spec.ts](../src/api-v1/dataspace/source/dspacer-catalog.spec.ts) | Que `parseUploadedAsset` tolera las grafías vistas y devuelve `null` en lugar de inventar un id |

La prueba que **no** existe, y por qué: ninguna comprueba que un análisis
publicado se pueda recuperar. Eso es el riesgo 1, y no se puede fingir con un
doble — depende de qué dirección asigne el conector.
