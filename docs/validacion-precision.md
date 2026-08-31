# Informe de validación — ONDAs Analytics API

**Cubre:** el criterio *"precisión de resultados > 95 %"* del requisito **R4.1** del entregable E4.1.
**Versión del API:** 1.1.0 · **Fecha de ejecución:** 29/08/2026
**Reproducible con:** `npm run validate:precision`

---

## 1. Qué se puede medir, y qué no

El criterio de R4.1 exige una **precisión de resultados superior al 95 %**. Antes de dar una cifra hay que precisar respecto a qué.

Los trece indicadores que calcula el API —medias, desviaciones, coeficientes de variación, matrices de correlación, índice de Jaccard, correlación de Pearson e índices compuestos de presión y origen costero— son **transformaciones deterministas de los datos que los participantes publican** en el espacio de datos. **No existe una verdad de campo** de contaminación plástica en un punto arbitrario del Mediterráneo, del Atlántico o del Cantábrico contra la que contrastarlos: si existiera, no haría falta el sistema.

Por tanto, **una cifra de "95 % de precisión frente a la realidad física" no sería verificable**, y este informe no la ofrece. Lo que sí es medible, auditable y reproducible es otra cosa, que se detalla a continuación.

> **Nota para el evaluador.** La interpretación del criterio que adopta este informe se propone formalmente en la nota de reinterpretación que acompaña al entregable. Este documento la aplica; su aprobación es una decisión del proyecto.

### Las cinco magnitudes que sí se miden

| # | Magnitud | Qué acredita | Qué **no** acredita |
|---|----------|--------------|---------------------|
| 1 | **Fidelidad de ingesta** | Que todo registro publicado llega íntegro al modelo de lectura | Que el dato publicado sea correcto |
| 2 | **Exactitud de agregación** | Que los estadísticos que el API reporta corresponden a la serie de la que dice derivarlos | Que la selección de datasets sea la adecuada |
| 3 | **Reproducibilidad** | Que la misma petición produce la misma respuesta | Nada sobre el valor de esa respuesta |
| 4 | **Cobertura de consulta** | Que las zonas analizadas se responden con dato observado | La densidad de ese dato |
| 5 | **Concordancia entre fuentes** | El grado de acuerdo entre dos técnicas analíticas independientes | Cuál de las dos es correcta |

La 1 cubre el camino del fichero publicado al modelo de lectura; la 2 cubre la capa estadística. Juntas recorren la cadena completa desde el dato del participante hasta el indicador publicado.

---

## 2. Resultados

Ejecución sobre los **22 activos observados** del espacio de datos (excluidas las series de calibración) y una rejilla de **6 puntos de consulta** con radio de 25 km y rango anual 2025.

### 2.1 Fidelidad de ingesta — 100 %

| Métrica | Valor |
|---------|-------|
| Activos comparados | 22 de 22 |
| Íntegros | **22 (100,00 %)** |
| Registros descartados por la ingesta, con aviso registrado | 1 |

Todos los activos publicados producen exactamente las observaciones esperadas.

**Un único registro descartado**, en `recogidas_playas_gijon.json`, y el sistema lo hace constar:

```
1 records skipped for lacking a usable date (e.g. "2025-17-08")
```

El valor `2025-17-08` tiene **mes 17**: es un error de captura en el fichero del participante, con el día y el mes intercambiados (debería ser `2025-08-17`). La ingesta lo rechaza y **deja constancia nombrando el valor concreto**, en lugar de descartarlo en silencio. El comportamiento es el correcto; la corrección corresponde al proveedor del dato.

> Este es el motivo por el que la métrica mide **pérdida inexplicada** y no pérdida bruta. Un registro que el sistema rechaza y documenta no es un fallo del sistema.

El cálculo tiene además en cuenta que los datasets de ventana previa a evento (`atmosfera_previa_evento`, `oceanografia_previa_evento`) anidan una ventana de varios días dentro de cada evento, y la ingesta escribe un documento por día. Contar registros de primer nivel reportaría una pérdida del 87 % que no existe.

### 2.2 Exactitud de agregación y reproducibilidad — 30 de 30

| Comprobación | Resultado |
|--------------|-----------|
| Media de mp/L frente a recálculo independiente | 6 / 6 |
| Desviación típica de mp/L | 6 / 6 |
| Coeficiente de variación | 6 / 6 |
| Índice de Jaccard boya/agua | 6 / 6 |
| Reproducibilidad entre ejecuciones | 6 / 6 |
| **Total** | **30 / 30 (100 %)** |

Cada estadístico que el API publica se recalcula en el script a partir de la **misma serie que el propio API expone** en el gráfico de evolución temporal, con aritmética elemental y una implementación independiente, y se compara con la precisión que el API declara (tres decimales para media y desviación, cuatro para el coeficiente de variación). El índice de Jaccard se recalcula como operación de conjuntos sobre las dos listas de polímeros publicadas.

La reproducibilidad se comprueba ejecutando dos veces la misma petición con la caché desactivada y comparando el resultado completo.

### 2.3 Cobertura de consulta — 100 %

Los **6 puntos** de la rejilla se responden con **dato observado**; ninguno recurre a las series de calibración.

| Punto | Muestras de agua | Boya de biomasa | Recogidas | Ambiental |
|-------|------------------|-----------------|-----------|-----------|
| Badalona | 52 | 147 | 1 | 162 |
| Barcelona | 52 | 147 | 1 | 162 |
| Tenerife | 52 | 63 | 7 | 65 |
| Gijón | 52 | 82 | 7 | 145 |
| Mediterráneo abierto | 52 | 147 | 1 | 162 |
| Costa Brava | 52 | 147 | 1 | 162 |

La columna de muestras de peces está a cero en toda la rejilla: no hay dataset de peces con cobertura en las áreas consultadas.

### 2.4 Concordancia entre fuentes independientes

Es la única comparación de este informe entre **mediciones obtenidas por vías distintas**, y merece leerse con cuidado.

| Comparación | Valor | Lectura |
|-------------|-------|---------|
| Polímeros detectados por la boya (µFTIR) frente a los detectados en muestras de agua (Py-GC/MS) | **25 % de solape (Jaccard)** | Bajo |
| Composición polimérica en agua frente a la hallada en peces | **r de Pearson entre 0,92 y 1,00** | Muy alto |

**El 25 % de solape no es un fallo del sistema, y tampoco conviene presentarlo como una validación exitosa.** Se explica por la naturaleza de las dos técnicas:

- La **µFTIR** de la boya identifica partículas una a una y detecta bien polímeros con firma infrarroja marcada, pero tiene un límite inferior de tamaño.
- La **Py-GC/MS** de las muestras de agua identifica polímeros por pirólisis sobre la masa total, alcanza fracciones más finas y detecta familias que la µFTIR no resuelve.

Que dos técnicas con sensibilidades distintas coincidan solo en una cuarta parte de las etiquetas es un resultado **esperable y descrito en la literatura**, no una contradicción entre fuentes. Lo que el dato indica es que **ambas técnicas son complementarias y ninguna sustituye a la otra**, que es precisamente el argumento para mantener las dos en el espacio de datos.

La correlación entre agua y peces, en cambio, es muy alta porque ambas proceden del **mismo flujo analítico Py-GC/MS**: mide consistencia interna del método, no acuerdo entre métodos independientes. Se reporta por completitud, y sería un error presentarla como validación cruzada.

---

## 3. Un defecto encontrado por esta validación

La comprobación de reproducibilidad **falló en la primera ejecución** en dos de los seis puntos: dos peticiones idénticas devolvían la lista de polímeros de la boya en orden distinto.

La causa era una agregación de MongoDB ordenada por `{ count: -1 }`, sin criterio de desempate: los polímeros con igual número de detecciones salían en orden arbitrario. El índice de Jaccard no se veía afectado, por ser una operación de conjuntos —de ahí que el 25 % fuera estable—, pero **la respuesta publicada no era determinista**.

Corregido añadiendo el valor como desempate, `{ count: -1, _id: 1 }`, con una prueba de regresión que fija la invariante. La reproducibilidad pasa ahora en los seis puntos.

Que la validación encontrara un defecto real en su primera ejecución es el argumento más sólido a favor de mantenerla como comprobación reproducible y no como una cifra afirmada en un documento.

---

## 4. Conclusión

| Magnitud | Resultado | Umbral de R4.1 |
|----------|-----------|----------------|
| Fidelidad de ingesta | **100,00 %** | > 95 % ✅ |
| Exactitud de agregación | **100 %** (30/30) | > 95 % ✅ |
| Reproducibilidad | **100 %** (6/6) | > 95 % ✅ |
| Cobertura de consulta | **100 %** (6/6) | > 95 % ✅ |
| Concordancia entre técnicas independientes | 25 % (µFTIR vs Py-GC/MS) | Se reporta como contexto, **no como criterio de aprobación** |

Las cuatro magnitudes verificables superan el umbral del 95 %. La quinta se publica con su interpretación, porque omitirla daría una imagen más favorable de la que sostienen los datos.

---

## 5. Cómo reproducirlo

```bash
npm run validate:precision                       # informe por consola
npm run validate:precision -- --json informe.json
```

El script ([`scripts/validate-precision.ts`](../scripts/validate-precision.ts)) necesita acceso al modelo de lectura en MongoDB y credenciales del conector del espacio de datos, porque relee cada activo desde su catálogo para contrastarlo. Termina con código de salida distinto de cero si alguna comprobación falla o si aparece pérdida de datos inexplicada, de modo que puede ejecutarse como comprobación automatizada.

**Limitaciones declaradas:**

- La exactitud de agregación valida la **capa estadística**, no la selección de datasets; esa la cubre la fidelidad de ingesta.
- La rejilla de 6 puntos cubre las zonas donde hoy hay datos publicados. Al incorporarse nuevos participantes debe ampliarse.
- El informe refleja el estado del espacio de datos en la fecha de ejecución. Reejecutarlo tras cada incorporación es lo que mantiene válida la acreditación.
