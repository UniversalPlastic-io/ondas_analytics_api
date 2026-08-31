# Integración con el espacio de datos

Cómo el API obtiene los datos que analiza: autenticación, descubrimiento de
participantes, catálogo y transferencia. Es la referencia del módulo
[`src/api-v1/dataspace/`](../src/api-v1/dataspace/).

El camino contrario —el API publicando en el espacio los análisis que genera— está
en [report-publishing.md](report-publishing.md). Comparte la autenticación de §2 y
nada más: son tres operaciones de escritura distintas.

> **Estado.** Los apartados 2 a 7 están contrastados contra el despliegue real del
> espacio de datos (ejecución del 31/08/2026), salvo lo que el §8 declara pendiente.
> La implementación del cliente se desarrolla en la rama `feat/dspacer-source` y
> este documento es su especificación.

El espacio de datos ONDAs se opera sobre **D-Spacer de SQS**, un conector **EDC**
(*Eclipse Dataspace Components*) con extensiones de Tractus-X, envuelto en un
middleware propio con validación en Keycloak. Cada participante tiene su conector;
el API usa el de Universal Plastic.

---

## 1. Lo que cambia respecto a leer ficheros

Un espacio de datos no es un almacén de objetos con permisos. **No se lee un
activo: se negocia su contrato y se recibe una transferencia.** Cuatro diferencias
que condicionan el diseño del módulo:

| | Almacén de objetos | Espacio de datos |
|---|---|---|
| Identidad del activo | Ruta estable | **UUID** asignado por el conector del proveedor |
| Autorización | Permiso sobre la ruta | **Contrato** entre proveedor y consumidor |
| Listar | Una operación sobre un prefijo | **Un catálogo por proveedor** |
| Saber si cambió | `ETag` / `Last-Modified` | **No hay metadato de versión** |

La última es la más consecuente y se trata en el §5.

---

## 2. Identidad y credenciales

| Elemento | Valor |
|---|---|
| IAM | Keycloak, realm `connector-realm` |
| Emisor del token | `{dominio}/{entidad}/realms/connector-realm` |
| Login | `POST {dominio}/app/{entidad}/login-service/auth/login` |
| Middleware | `{dominio}/app/{entidad}/middleware` |
| Esquema de autorización | `Authorization: Bearer <access_token>` en todas las operaciones |
| Identificador del participante | **BPN** — *Business Partner Number* |

**Vigencia de los tokens, medida:** el de acceso vive **300 s** y el de refresco
**1800 s**. El primero es más corto que un escaneo completo, así que el cliente
renueva de forma proactiva, con margen, antes de cada operación que pueda cruzar
el límite. No es una optimización: sin ello un escaneo falla a mitad de proceso.

Las credenciales se configuran por entorno (`DSPACER_BASE_URL`, `DSPACER_USER`,
`DSPACER_PASSWORD`) y **nunca se versionan**. Ver [.env.example](../.env.example).

---

## 3. El flujo de consumo, en tres operaciones

### 3.1 Descubrir participantes — `GET /bpn/all`

```json
{
  "participants": [
    {
      "bpn": "BPNL…",
      "name": "Innoceana",
      "direction": "http://…-edc-controlplane:8084/api/v1/dsp",
      "type": "Dataprovider"
    }
  ]
}
```

`direction` es la dirección del *control plane* del conector del proveedor, y es
exactamente lo que el paso siguiente necesita como `counterPartyAddress`. Son
direcciones internas del despliegue: **las resuelve el middleware, no el API**, que
solo las pasa tal cual. Por eso el módulo no lleva ninguna tabla de proveedores
codificada — el registro de participantes es la fuente.

### 3.2 Pedir el catálogo de un proveedor — `POST /catalog/request`

```json
{
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "CatalogRequest",
  "counterPartyAddress": "<direction del paso 3.1>",
  "counterPartyId": "<bpn del paso 3.1>",
  "protocol": "dataspace-protocol-http",
  "querySpec": { "offset": 0, "limit": 100 }
}
```

Devuelve un `dcat:Catalog`. Cada entrada de `dcat:dataset` trae **siete campos**:

```json
{
  "@id": "ddadf21b-0c4d-40c8-97d7-e5cf902a5024",
  "@type": "dcat:Dataset",
  "id": "ddadf21b-0c4d-40c8-97d7-e5cf902a5024",
  "name": "Recogidas playas Tenerife",
  "description": "…",
  "odrl:hasPolicy": { "@id": "…", "@type": "odrl:Offer", "odrl:permission": { … } },
  "dcat:distribution": [ { "dct:format": { "@id": "HttpData-PULL" }, … } ]
}
```

Formatos de distribución ofrecidos: `HttpData-PULL`, `HttpData-PUSH`,
`AmazonS3-PUSH`, `AzureStorage-PUSH`. El API usa **`HttpData-PULL`**.

El catálogo es **por proveedor**: hay una petición por participante, y un escaneo
completo son tantas como proveedores tenga el espacio.

### 3.3 Transferir el dato — `POST /transfer/request`

El cuerpo es un `ContractRequest` que **devuelve la oferta obtenida en 3.2**: su
`@id`, el `target` (el asset id) y el `assigner` (el BPN del proveedor). Es
negociación de contrato y transferencia en una sola llamada síncrona.

> **Estado:** en verificación con SQS. El resto de este documento está contrastado
> contra el despliegue real; la forma exacta de la respuesta de esta operación es
> lo único que queda por confirmar.

---

## 4. Autorización: quién decide qué se ve

Las políticas observadas restringen por BPN:

```json
"odrl:constraint": {
  "odrl:or": {
    "odrl:leftOperand": { "@id": "BusinessPartnerNumber" },
    "odrl:operator": { "@id": "odrl:eq" },
    "odrl:rightOperand": "<BPN de Universal Plastic>"
  }
}
```

Cada proveedor ha creado un contrato a favor del BPN de UP para los activos que
decide compartir. **Un activo sin contrato no aparece en el catálogo y el API no
puede verlo.** La consecuencia importante:

> La autorización es del espacio de datos, no del API. El API no puede ampliar su
> propio acceso, y su *scoping* por organización (§4 de
> [dataspace-sync.md](dataspace-sync.md)) opera **dentro** de lo que el espacio de
> datos ya le concedió, nunca por encima.

Corolario operativo: para que UP **provea** datos a los demás participantes no
basta con tener los activos cargados en su conector; hacen falta política y
contrato por activo. Son operaciones de proveedor (`/policies/create`,
`/contracts/create`), no de este API.

---

## 5. Detección de cambios

La entrada de catálogo **no lleva fecha, ni versión, ni tamaño, ni suma de
comprobación**. No es una omisión de esta documentación: son los siete campos que
existen. De ahí se sigue que **no hay forma de saber si un activo cambió sin
traerlo**.

El sync lo asume explícitamente:

1. Se relee el catálogo del proveedor.
2. Se transfiere el activo.
3. Se calcula el **SHA-256** del contenido y se compara con el `checksum` guardado.
4. Si coincide, el resultado es `unchanged` y **no se reescriben** ni el activo ni
   sus observaciones.

Es decir, se ahorra la escritura y el reproceso, no la transferencia. El coste de
un escaneo es proporcional al número de activos contratados, siempre.

**La oferta tampoco se puede cachear entre ejecuciones.** Su `@id` codifica el
nombre del activo junto a los identificadores, así que cambia si el proveedor lo
renombra o recrea la política. El catálogo se relee antes de cada transferencia; un
`@id` guardado de una ejecución anterior puede haber caducado en silencio.

---

## 6. Clasificación de un activo

El pipeline necesita saber, de cada activo, su `datasetType`, su categoría, su
océano y su emplazamiento. Cuando la fuente era un almacén de objetos, todo eso se
derivaba de la ruta. **Un activo del espacio de datos solo tiene un UUID, un nombre
y una descripción**, y el nombre lo elige el proveedor.

Por eso la clasificación es una **tabla explícita** `asset id → {datasetType,
ocean, place}`, versionada y con pruebas, y no un análisis del nombre:

- El UUID es estable; el nombre no, y cambiarlo no está bajo nuestro control.
- Un error de clasificación es silencioso y contamina los indicadores. Una tabla
  hace el fallo visible y revisable.
- Un activo nuevo que no esté en la tabla se registra como **advertencia** en la
  ejecución de sync, con su id y su nombre, en lugar de clasificarse a ciegas.

Los tipos de dataset, sus esquemas y sus unidades están en
[dataset-mapping.md](dataset-mapping.md) y son independientes de la fuente.

---

## 7. Notas de operación

| Aspecto | Medido / decidido |
|---|---|
| Latencia de `/catalog/request` | 0,9 – 3,6 s por proveedor |
| Latencia de `/health` | ~1 s |
| Renovación de token | Proactiva, con margen sobre los 300 s |
| Concurrencia del escaneo | Calibrar por separado: el límite lo pone la negociación EDC, no las transacciones de Mongo |
| Fallo de un proveedor | Aísla al proveedor; el resto del escaneo continúa y el fallo se registra en la ejecución |
| Métricas | Negociaciones e histograma de latencia de transferencia en `GET /metrics` — ver [deployment/03-monitoring.md](deployment/03-monitoring.md) |

`GET /health` del middleware sirve como comprobación de disponibilidad del conector
antes de iniciar un escaneo.

---

## 8. Lo que no está resuelto

| # | Asunto | Impacto |
|---|---|---|
| 1 | Forma de la respuesta de `POST /transfer/request` | Bloquea el normalizador de entrada |
| 2 | Especificación del `login-service` | El login se implementa contra el comportamiento observado |
| 3 | Las operaciones del middleware declaran `schema: {}` | Las formas de respuesta se derivan de la observación, no del contrato |
| 4 | Qué motor aplica las obligaciones y prohibiciones ODRL | No afecta al consumo; sí a las condiciones de uso |
| 5 | Límites de uso y tamaño máximo de activo | Necesario para dimensionar la concurrencia |
| 6 | Todos los activos del conector resuelven a un mismo `dataAddress.baseUrl` | Es la causa del punto 1. Un análisis que publiquemos puede heredarlo y quedar en el catálogo sin dato recuperable — ver [report-publishing.md §9](report-publishing.md#9-riesgos-abiertos) |
| 7 | Semántica real de `no_restriction` | Decide si «compartido con todos» describe a cualquier BPN del espacio o a algo más amplio |

Los puntos 1 a 3 y el 6 se cierran con SQS. Hasta entonces, este documento
distingue de forma explícita lo contrastado de lo pendiente.

Consecuencia práctica del punto 6 para la validación: mientras `transfer/request`
no resuelva, el esquema DCAT publicado por el proveedor tampoco se puede traer, y
la comprobación de columnas cae a las copias de `metadata/DCAT/`. El mecanismo
está listo y anota en cada activo cuál respondió.

---

## 9. Seguridad

- Las credenciales del conector viven en el entorno. **Nunca** en el repositorio,
  en un fichero de configuración versionado ni en la salida de un comando.
- El token de acceso es un *bearer* de 300 s: no se registra en logs, no se incluye
  en trazas de error y no se persiste.
- El API usa **un solo conector**, el de UP. No custodia credenciales de otros
  participantes: el acceso a sus datos lo concede su contrato, que es lo que el
  espacio de datos existe para hacer.
- `GET /metrics` no expone identificadores de activo ni de participante; solo
  agregados por operación y resultado.
