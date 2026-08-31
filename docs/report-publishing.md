# Publicación de análisis en el espacio de datos

Diseño. **No implementado**: esta ficha describe lo que se va a construir y las
decisiones que lo fijan, para revisarla antes de escribir código.

Hasta ahora el API sólo **consume** el espacio de datos. Este cambio lo convierte
también en **proveedor**: cada análisis que genera se publica como activo propio
de Universal Plastic en su catálogo, ofrecido a todos los participantes.

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
asset_description  ONDAs analytics report · {lugar o costa} · radio {r} km
                   · {inicio}→{fin} · {agregación} · {análisis}
                   · key={claveDeCaché}
```

`lat` y `lon` con **cuatro decimales**, la misma redondez que ya aplica
`computeCacheKey`, para que el nombre y la identidad coincidan en el punto.

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
activo sigue en el catálogo y sus referencias ya no resuelven. Así que sólo se
publica cuando las URL son **públicas** (`S3_PUBLIC_BASE_URL` configurado). Si no
lo está, no se publica y se registra el motivo. Publicar un enlace que caduca es
peor que no publicar.

---

## 4. Cuándo se publica, y qué pasa si falla

Después de responder, sin bloquear. El análisis es el producto; publicarlo es
distribución, y una consulta no debe fallar ni tardar más porque el conector esté
lento o caído.

Consecuencia aceptada: la respuesta no puede llevar un aviso de que la publicación
falló, porque ya se envió. El resultado se registra en tres sitios:

- El log, con el motivo.
- Una métrica `ondas_reports_published_total{status}`, con **status como única
  etiqueta**: ni coordenadas ni clave, que harían explotar la cardinalidad.
- Un registro en `sync_runs` con `kind: 'publish'`, para que
  `GET /v1/sync/runs` lo muestre junto a los escaneos y quede auditable sin
  añadir una colección nueva.

---

## 5. Idempotencia

Publicar dos veces la misma identidad —caché saltada, o proceso reiniciado— crea
dos activos con el mismo nombre y la misma clave. Con la retención elegida
(conservar todo) se acepta.

Lo que sí se evita es el duplicado inmediato: el proceso recuerda las claves que
ya publicó y no repite. Es una comprobación en memoria, sin llamada al conector.
Tras un reinicio puede volver a publicar una clave ya publicada; queda documentado
como límite, no como error.

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
| `DSPACER_PUBLISH_ENABLED` | `false` | Interruptor. Con `false` no se publica nada |
| `DSPACER_*` | — | Las mismas credenciales del conector que ya usa la sincronización |

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
| 1 | **Todos los activos del conector comparten un mismo `dataAddress.baseUrl`** | Es la causa de que `POST /transfer/request` no resuelva. Si el conector asigna ese mismo `baseUrl` a lo que subimos, un análisis publicado tampoco se podrá recuperar, y el activo sería un catálogo sin dato. Hay que comprobarlo con una publicación de prueba antes de construir el resto |
| 2 | La especificación del *middleware* declara las respuestas de las tres operaciones de escritura como `schema: {}` | Los nombres de campo de la respuesta no están documentados. La forma del activo se conoce por `POST /data/all`, que devuelve `@id` y `properties`; se asume que `/data/upload` devuelve lo mismo, y hay que confirmarlo |
| 3 | Semántica real de `no_restriction` | ¿Cualquier BPN del espacio, o público de verdad? Decide si «compartido con todo el mundo» es exacto. A confirmar con SQS |
| 4 | Crecimiento del catálogo | Ver §6 |

El riesgo 1 se resuelve con **una** publicación de prueba: subir un JSON mínimo,
darle política y contrato, y comprobar si su `dataAddress` es propio o el
compartido. Es una escritura en el catálogo de producción, así que no se hace sin
pedirlo.

---

## 10. Ficheros que toca

| Fichero | Qué |
|---|---|
| `src/api-v1/dataspace/source/dspacer.client.ts` | `uploadData`, `createNoRestrictionPolicy`, `createContract`, `listOwnAssets` |
| `src/api-v1/dataspace/publish.service.ts` *(nuevo)* | Orquesta las tres llamadas, el nombre, la descripción y el registro |
| `src/api-v1/dataspace/report-identity.ts` *(nuevo)* | Nombre y descripción a partir de la petición y la clave. Puro, testable sin conector |
| `src/api-v1/analyses/analyses.service.ts` | Llama a publicar tras responder |
| `src/api-v1/dataspace/schemas/sync-run.schema.ts` | `kind` admite `'publish'` |
| `src/metrics/metrics.service.ts` | Contador e histograma de publicación |
| `src/api-v1/dataspace/dataspace.constants.ts` | `DSPACER_PUBLISH_ENABLED` |
| `.env.example`, `README.md` | La variable y la sección |
