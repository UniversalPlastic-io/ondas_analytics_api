import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AnalysesService } from './analyses.service';
import { AnalysesRunRequest, AnalysesRunResponse } from './analyses.types';
import {
  AnalysesRunRequestDto,
  AnalysesRunResponseDto,
} from './analyses.swagger.dto';
import { UserJwtAuthGuard } from '../identity/auth.guards';

function publicBaseUrlFromReq(req: Request): string {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

@ApiTags('Analyses')
@Controller('/v1')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Get('analyses/indices')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Documentación HTML de índices/indicadores' })
  indicesHtml(): string {
    // Static HTML (kept lightweight on purpose).
    // Note: this page is intentionally standalone (no JS/CSS frameworks).
    const basePath = (process.env.PUBLIC_API_BASE_PATH ?? '')
      .trim()
      .replace(/\/+$/g, '');
    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="${basePath}/Recurso%201.svg" />
    <title>ONDAs DataSpace — API analítica</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #0b1020; color: #e8eefc; }
      header { padding: 28px 20px; background: #111a33; border-bottom: 1px solid rgba(255,255,255,.08); }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 8px 0; line-height: 1.55; color: rgba(232,238,252,.82); }
      main { max-width: 980px; margin: 0 auto; padding: 20px; }
      .card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; margin: 14px 0; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
      .stat { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 12px; }
      .stat .v { font-size: 14px; font-weight: 750; margin-bottom: 4px; }
      .stat .l { color: rgba(232,238,252,.7); font-size: 12px; }
      h2 { margin: 18px 0 10px; font-size: 16px; }
      h3 { margin: 14px 0 6px; font-size: 14px; }
      code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 6px; }
      ul { margin: 8px 0 0 18px; }
      li { margin: 6px 0; color: rgba(232,238,252,.82); }
      .example { margin-top: 12px; display: grid; grid-template-columns: 240px 1fr; gap: 12px; align-items: start; }
      .mini { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px; }
      .mini svg { width: 100%; height: auto; display: block; }
      pre { margin: 0; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 10px; overflow: auto; }
      pre code { background: transparent; padding: 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; color: rgba(232,238,252,.82); }
      th { color: rgba(232,238,252,.9); font-weight: 650; font-size: 12px; }
      footer { padding: 18px 20px; color: rgba(232,238,252,.55); }
      @media (max-width: 860px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 860px) { .example { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <div style="display:flex; align-items:center; gap:12px;">
        <img src="${basePath}/logo-ondas.svg" alt="ONDAs" style="height:28px; width:auto;" />
        <h1 style="margin:0;">ONDAs DataSpace: API analítica</h1>
      </div>
      <p>Muestras de microplásticos y posterior transferencia a la cadena trófica</p>
      <p>Documento de referencia. Describe el contexto, las fuentes de datos y los indicadores. Los nombres de campos/keys se mantienen en inglés.</p>
    </header>
    <main>
      <div class="grid" aria-label="Resumen">
        <div class="stat"><div class="v">Integración</div><div class="l">Multi-fuente</div></div>
        <div class="stat"><div class="v">Contaminación</div><div class="l">Agua &amp; costa</div></div>
        <div class="stat"><div class="v">Transferencia</div><div class="l">Agua → biota</div></div>
        <div class="stat"><div class="v">Riesgo</div><div class="l">Indicadores operativos</div></div>
      </div>

      <div class="card">
        <h2>Contexto</h2>
        <p>La contaminación por plásticos en los ecosistemas marinos representa uno de los mayores retos ambientales de la actualidad. Los residuos plásticos, al degradarse, generan microplásticos (fragmentos menores de 5 mm) que pueden ser ingeridos por organismos marinos de distintos niveles tróficos, desde el plancton hasta peces y otros depredadores superiores. Esta acumulación puede propagarse a lo largo de la cadena alimentaria, llegando finalmente al consumo humano y generando potenciales riesgos para la salud, los ecosistemas y las economías dependientes del mar.</p>
        <p>Uno de los principales problemas para abordar esta crisis es la escasez de datos integrados y estandarizados que permitan comprender cómo se distribuyen los microplásticos en el medio marino y cómo se transfieren entre los distintos niveles de la cadena trófica. En este contexto, ONDAs propone la creación de un espacio de datos orientado a la monitorización y análisis de la contaminación plástica en ecosistemas marinos, integrando información procedente de diferentes agentes y fuentes de observación.</p>
      </div>

      <div class="card">
        <h2>Objetivo</h2>
        <p>Diseñar e implementar una API capaz de integrar y procesar datos ambientales y biológicos procedentes de distintas fuentes, con el fin de analizar la contaminación plástica marina y su transferencia a lo largo de la cadena trófica, facilitando así la toma de decisiones basada en evidencia.</p>
        <ul>
          <li>Centralizar e integrar datos heterogéneos provenientes de sensores oceanográficos, muestreos científicos y actividades de monitorización.</li>
          <li>Relacionar variables ambientales, biológicas y antrópicas para identificar patrones de acumulación y transferencia.</li>
          <li>Facilitar el acceso a datos estructurados a investigadores, instituciones públicas y empresas interesadas.</li>
          <li>Desarrollar capacidades analíticas y predictivas para comprender cómo factores ambientales y actividades humanas influyen.</li>
          <li>Generar conocimiento científico aplicable para seguridad alimentaria, estrategias de limpieza y políticas públicas.</li>
        </ul>
      </div>

      <div class="card">
        <h2>Procedencia de los datos y su importancia</h2>

        <h3>Boyas de microplásticos</h3>
        <p>Sistema de filtración pasiva: la corriente impulsa el paso de agua por un filtro que retiene partículas en la columna de agua. El filtro se recupera y procesa en laboratorio (estereomicroscopía; clasificación morfológica; µFTIR para composición polimérica parcial). Resultados en ítems/L.</p>
        <ul>
          <li>Caracterización de la contaminación (tipos y cuantificación).</li>
          <li>Análisis de dispersión y transporte (serie temporal).</li>
          <li>Correlación ambiental con meteorología/oceanografía/biología.</li>
          <li>Base para evaluación de transferencia trófica.</li>
        </ul>

        <h3>Boyas de biomasa</h3>
        <p>Boyas SatLink: estimación en tiempo real de biomasa de peces (toneladas) por rangos de profundidad y total integrado, con resolución hasta horaria y agregable (diaria/mensual).</p>
        <ul>
          <li>Distribución vertical (contexto de exposición).</li>
          <li>Interfaz contaminación–cadena trófica.</li>
          <li>Correlación espacio-temporal con otras variables del sistema.</li>
        </ul>

        <h3>Variables meteorológicas y oceanográficas</h3>
        <p>Condicionan distribución, transporte, acumulación y degradación de plásticos. Fuentes: Copernicus y estación. Variables típicas: corrientes (uo, vo), viento (eastward_wind, northward_wind), oleaje (VHM0, VMDR, VTM02), precipitación, temperatura (thetao), radiación/UV, salinidad (so), etc.</p>

        <h3>Muestras de tejido de pez (Py-GC/MS)</h3>
        <p>Tejido muscular dorsal (lomo) analizado por Py-GC/MS: cuantificación por polímero (µg/g) y contribución porcentual al total.</p>
        <ul>
          <li>Evidencia directa de transferencia trófica y relevancia para consumo humano.</li>
          <li>Comparación por especie/posición trófica.</li>
          <li>Correlación con el medio acuático por proximidad geográfica.</li>
          <li>Datos aplicables a evaluación de exposición humana.</li>
        </ul>

        <h3>Muestras de agua (Py-GC/MS)</h3>
        <p>Py-GC/MS en agua (µg/L) por polímero y porcentajes. Complementa a la boya (conteo morfológico) con cuantificación másica completa, incluyendo partículas por debajo del límite visual.</p>
        <ul>
          <li>Medida de exposición ambiental de referencia para transferencia trófica.</li>
          <li>Validación cruzada entre fuentes.</li>
        </ul>

        <h3>Recogidas de residuos plástico en la costa</h3>
        <p>Universal Plastic v7.0.0: dataset georreferenciado de limpiezas costeras (kg, composición polimérica por IA, distancia/duración/participantes) con protocolo dMRV.</p>
        <ul>
          <li>Cuantificación y distribución de contaminación costera.</li>
          <li>Comparación con perfiles poliméricos de agua/biota.</li>
          <li>Indicador de presión desde costa (macro → potencial micro).</li>
        </ul>
      </div>

      <div class="card">
        <h2>Procesado y generación de indicadores</h2>
        <p>Los detalles operativos de cada indicador se documentan en la sección “Índices (cómo interpretarlos y cómo relacionarlos)”, con un bloque por indicador.</p>
      </div>

      <h2>Índices (cómo interpretarlos y cómo relacionarlos)</h2>

      <div class="card">
        <h3>Microplásticos en agua (<code>mp_per_L</code>)</h3>
        <p>Concentración de microplásticos en el agua en la ubicación objetivo.</p>
        <p><strong>Cómo interpretarlo:</strong> valores más altos indican mayor presencia de microplásticos en la columna de agua. Para comparar periodos, fíjate en tendencia y picos; para comparar ubicaciones, usa el mismo rango temporal y la misma definición de área.</p>
        <p><strong>Cómo relacionarlo:</strong> úsalo como driver principal aguas arriba de <code>BCF</code>, <code>Exposure_Index</code> y <code>CSI</code>. Cruza con <code>IPC</code>/<code>Plastic_Pressure_Index</code> para contextualizar presión costera vs columna de agua.</p>
        <p><strong>Modelo:</strong> interpolación espacial por <em>Inverse Distance Weighting (IDW)</em> + señal temporal estacional (armónica) y agregación por ventana temporal.</p>
        <p><strong>Datos usados:</strong> <code>request.location</code>, <code>request.area</code>, <code>request.dateRange</code>.</p>
        <div class="example" aria-label="Ejemplo mp_per_L">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Serie temporal de mp_per_L (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <path d="M0,95 L20,92 L40,88 L60,82 L80,78 L100,70 L120,64 L140,55 L160,58 L180,52 L200,45 L220,42 L240,38" fill="none" stroke="#93c5fd" stroke-width="3" />
              <path d="M0,95 L20,92 L40,88 L60,82 L80,78 L100,70 L120,64 L140,55 L160,58 L180,52 L200,45 L220,42 L240,38 L240,120 L0,120 Z" fill="rgba(147,197,253,0.15)" />
            </svg>
          </div>
          <pre><code>{
  "results": {
    "basic_contamination": {
      "byLocationAndDate": [
        { "date": "2025-01-01", "mp_per_L": 0.42 },
        { "date": "2025-01-02", "mp_per_L": 0.45 }
      ]
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Agua vs pez (microplásticos) (<code>mp_per_L</code> vs <code>mp_per_kg_fish</code>)</h3>
        <p>Comparación directa entre microplásticos en agua y microplásticos en tejido de pez.</p>
        <p><strong>Cómo interpretarlo:</strong> si para un rango de <code>mp_per_L</code> se observan valores altos de <code>mp_per_kg_fish</code>, sugiere mayor transferencia/acumulación (dependiendo del modelo y normalización).</p>
        <p><strong>Cómo relacionarlo:</strong> úsalo junto con <code>BCF</code> (que es una forma de normalizar esta relación) y con la similitud polimérica (firma agua vs biota).</p>
        <p><strong>Modelo:</strong> diagrama de dispersión agua vs biota (transferencia trófica).</p>
        <p><strong>Datos usados:</strong> <code>mpPerL_water[]</code>, <code>mpPerKg_fish[]</code>.</p>
        <div class="example" aria-label="Ejemplo agua vs pez">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Agua vs pez (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <circle cx="60" cy="78" r="5" fill="rgba(13,148,136,0.65)"/>
              <circle cx="95" cy="66" r="5" fill="rgba(13,148,136,0.65)"/>
              <circle cx="140" cy="55" r="5" fill="rgba(13,148,136,0.65)"/>
              <circle cx="185" cy="45" r="5" fill="rgba(13,148,136,0.65)"/>
            </svg>
          </div>
          <pre><code>{
  "dataFormattedForPlots": {
    "plots": {
      "4_waterVsFishMicroplastics": {
        "mpPerL_water": [0.42, 0.55],
        "mpPerKg_fish": [54.2, 70.5]
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>BCF — Bioconcentration Factor (<code>BCF</code>)</h3>
        <p>Acumulación relativa de microplásticos en peces respecto al agua.</p>
        <p><strong>Cómo interpretarlo:</strong> BCF alto sugiere mayor acumulación relativa en biota para una misma concentración en agua; BCF bajo sugiere menor acumulación relativa. Interprétalo junto a la magnitud de <code>mp_per_L</code>.</p>
        <p><strong>Guía de interpretación:</strong> BCF &lt; 100 (baja), 100–1000 (moderada), &gt; 1000 (alta bioacumulación).</p>
        <p><strong>Cómo relacionarlo:</strong> contrástalo con <code>Exposure_Index</code> (exposición) y con composición (<code>polymer_correlation</code>) para ver si cambios de mezcla coinciden con cambios en acumulación.</p>
        <p><strong>Modelo:</strong> factor de bioconcentración (BCF) (cociente concentración en biota / concentración en agua, con homogeneización de unidades).</p>
        <p><strong>Datos usados:</strong> serie <code>mp_per_L</code> + concentración en tejido (cuando aplique).</p>
        <div class="example" aria-label="Ejemplo BCF">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Distribución BCF (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <rect x="20" y="70" width="18" height="40" fill="rgba(147,197,253,0.6)"/>
              <rect x="50" y="55" width="18" height="55" fill="rgba(147,197,253,0.6)"/>
              <rect x="80" y="40" width="18" height="70" fill="rgba(147,197,253,0.6)"/>
              <rect x="110" y="30" width="18" height="80" fill="rgba(147,197,253,0.6)"/>
              <rect x="140" y="45" width="18" height="65" fill="rgba(147,197,253,0.6)"/>
              <rect x="170" y="60" width="18" height="50" fill="rgba(147,197,253,0.6)"/>
              <rect x="200" y="78" width="18" height="32" fill="rgba(147,197,253,0.6)"/>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "trophic_transfer": {
      "BCF": {
        "byLocationAndDate": [
          { "date": "2025-01-01", "BCF": 320 }
        ]
      }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "3_bcfDistribution": { "bcfValues": [120, 180, 260, 320, 410] }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Correlación de polímeros (matriz) (<code>polymer_correlation</code>)</h3>
        <p>Matriz de correlación (Pearson) entre series por tipo de polímero.</p>
        <p><strong>Cómo interpretarlo:</strong> valores cercanos a 1 indican co-variación positiva; cercanos a -1 variación opuesta; cercanos a 0 independencia. La diagonal suele ser 1.</p>
        <p><strong>Cómo relacionarlo:</strong> úsalo como contexto de “mezcla”. Si <code>mp_per_L</code> cambia pero la matriz permanece estable, cambia la magnitud más que la composición.</p>
        <p><strong>Modelo:</strong> matriz de correlación de Pearson entre series por polímero (coeficiente r en [-1, 1]).</p>
        <p><strong>Datos usados:</strong> series por polímero agregadas en el área y ventana temporal.</p>
        <div class="example" aria-label="Ejemplo polymer_correlation">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Matriz de correlación (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <rect x="40" y="20" width="30" height="30" fill="rgba(147,197,253,0.65)"/>
              <rect x="75" y="20" width="30" height="30" fill="rgba(147,197,253,0.35)"/>
              <rect x="110" y="20" width="30" height="30" fill="rgba(147,197,253,0.15)"/>
              <rect x="145" y="20" width="30" height="30" fill="rgba(147,197,253,0.05)"/>
              <rect x="40" y="55" width="30" height="30" fill="rgba(147,197,253,0.35)"/>
              <rect x="75" y="55" width="30" height="30" fill="rgba(147,197,253,0.65)"/>
              <rect x="110" y="55" width="30" height="30" fill="rgba(147,197,253,0.25)"/>
              <rect x="145" y="55" width="30" height="30" fill="rgba(147,197,253,0.10)"/>
              <rect x="40" y="90" width="30" height="30" fill="rgba(147,197,253,0.15)"/>
              <rect x="75" y="90" width="30" height="30" fill="rgba(147,197,253,0.25)"/>
              <rect x="110" y="90" width="30" height="30" fill="rgba(147,197,253,0.65)"/>
              <rect x="145" y="90" width="30" height="30" fill="rgba(147,197,253,0.30)"/>
            </svg>
          </div>
          <pre><code>{
  "dataFormattedForPlots": {
    "plots": {
      "5_polymerCorrelation": {
        "polymerLabels": ["PE", "PP", "PET", "PS"],
        "correlationMatrix": [
          [1, 0.62, 0.21, -0.05],
          [0.62, 1, 0.44, 0.12],
          [0.21, 0.44, 1, 0.58],
          [-0.05, 0.12, 0.58, 1]
        ]
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Exposure Index (<code>Exposure_Index</code>)</h3>
        <p>Índice compuesto que combina microplásticos en agua, biomasa y probabilidad de ingestión.</p>
        <p><strong>Cómo interpretarlo:</strong> valores altos indican combinación de alta contaminación (agua) y alto receptor biológico bajo la probabilidad de ingestión asumida.</p>
        <p><strong>IEO (Índice de exposición de organismos):</strong> en esta documentación, se usa como nombre conceptual del indicador de exposición; en el API corresponde a <code>Exposure_Index</code>.</p>
        <p><strong>Cómo relacionarlo:</strong> descompón en <code>mp_per_L</code> vs <code>biomass</code>. Si además <code>BCF</code> es alto, refuerza potencial de acumulación.</p>
        <p><strong>Modelo:</strong> índice compuesto de exposición (<em>index-based risk model</em>) que combina concentración ambiental, receptor biológico (biomasa) y probabilidad de ingestión.</p>
        <p><strong>Datos usados:</strong> <code>mp_per_L</code>, <code>biomass</code>, <code>probIngestion</code>.</p>
        <div class="example" aria-label="Ejemplo Exposure_Index">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Burbujas exposición (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <circle cx="60" cy="78" r="10" fill="rgba(147,197,253,0.55)"/>
              <circle cx="95" cy="62" r="14" fill="rgba(147,197,253,0.55)"/>
              <circle cx="140" cy="45" r="18" fill="rgba(147,197,253,0.55)"/>
              <circle cx="185" cy="38" r="12" fill="rgba(147,197,253,0.55)"/>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "eco_risk": {
      "Exposure_Index": {
        "byLocationAndDate": [
          { "date": "2025-01-01", "Exposure_Index": 0.31 }
        ]
      }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "6_exposureIndex": {
        "mpPerL": [0.42, 0.55],
        "biomass": [120, 135],
        "exposureIndex": [0.31, 0.44],
        "probIngestion": 0.12
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Plastic Pressure Index (<code>Plastic_Pressure_Index</code>)</h3>
        <p>Índice que mezcla contribución del agua y presión costera.</p>
        <p><strong>Cómo interpretarlo:</strong> ayuda a ver si la presión está más dominada por la señal en agua o por la carga costera.</p>
        <p><strong>Guía de interpretación:</strong> &lt; 100 (presión baja), 100–500 (presión moderada), &gt; 500 (hotspot potencial).</p>
        <p><strong>Cómo relacionarlo:</strong> reconcílialo con <code>IPC</code> y <code>mp_per_L</code>: IPC alto con mp moderado sugiere dominancia costera; mp alto con IPC bajo sugiere señal de columna de agua.</p>
        <p><strong>Modelo:</strong> índice compuesto tipo “load index” que integra señal en agua y carga costera (normalizada por área / longitud, según definición operativa).</p>
        <p><strong>Datos usados:</strong> <code>mp_per_L</code>, <code>kg_total</code>, <code>coastLengthKm</code>.</p>
        <div class="example" aria-label="Ejemplo Plastic_Pressure_Index">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Composición presión (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <rect x="40" y="30" width="60" height="60" fill="rgba(147,197,253,0.55)"/>
              <rect x="120" y="45" width="60" height="45" fill="rgba(147,197,253,0.25)"/>
              <text x="70" y="105" fill="rgba(232,238,252,.7)" font-size="10" text-anchor="middle">water</text>
              <text x="150" y="105" fill="rgba(232,238,252,.7)" font-size="10" text-anchor="middle">coast</text>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "eco_risk": {
      "Plastic_Pressure_Index": { "byLocationAndDate": [{ "date": "2025-01-01", "Plastic_Pressure_Index": 210 }] }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "7_plasticPressureComposition": {
        "waterMpPerL": 0.42,
        "coastKgPerKm": 18.3,
        "location": "lat=41.4342,lon=2.2433"
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>IPC — Coastal Pressure Index (<code>IPC</code>)</h3>
        <p>Índice de presión costera en el tiempo.</p>
        <p><strong>Cómo interpretarlo:</strong> compara la serie diaria con la media móvil 7 días para distinguir eventos puntuales vs tendencia.</p>
        <p><strong>Condiciones que incrementan IPC:</strong> viento persistente hacia costa (onshore), corrientes paralelas débiles y oleaje intenso.</p>
        <p><strong>Condiciones que reducen IPC:</strong> viento mar adentro (offshore), corrientes paralelas fuertes y oleaje débil.</p>
        <p><strong>Cómo relacionarlo:</strong> compáralo con <code>Plastic_Pressure_Index</code> (incluye agua) y con <code>CSI</code> (razón) para ver si cambia la atribución cuando cambia la presión costera.</p>
        <p><strong>Modelo:</strong> índice de presión costera con modulación ambiental (condiciones meteo/oceanográficas) y media móvil 7 días (suavizado/visualización).</p>
        <p><strong>Datos usados:</strong> <code>kg_total</code>, <code>coastLengthKm</code>, <code>envFactor</code> y variables meteo/oceanográficas.</p>
        <div class="example" aria-label="Ejemplo IPC">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="IPC diario y media móvil (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <path d="M0,85 L30,78 L60,92 L90,70 L120,66 L150,74 L180,58 L210,62 L240,50" fill="none" stroke="rgba(147,197,253,0.6)" stroke-width="3" />
              <path d="M0,85 L30,82 L60,80 L90,76 L120,72 L150,68 L180,64 L210,60 L240,56" fill="none" stroke="rgba(232,238,252,0.65)" stroke-width="2" stroke-dasharray="4 3" />
            </svg>
          </div>
          <pre><code>{
  "results": {
    "plastic_origin": {
      "IPC": { "byLocationAndDate": [{ "date": "2025-01-01", "IPC": 142 }] }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "8_coastalPressureIndex": {
        "dates": ["2025-01-01", "2025-01-02"],
        "ipcDaily": [142, 155],
        "ipc7DayAverage": [null, null]
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>CSI — Coastal Source Index (<code>CSI</code>)</h3>
        <p>Relaciona microplásticos en agua con masa costera recolectada para discriminar origen.</p>
        <p><strong>Cómo interpretarlo:</strong> CSI alto puede indicar relativamente más microplástico en agua por unidad de residuo costero; CSI bajo lo contrario. Interpretar junto con <code>mp_per_L</code> y <code>kg_total</code>.</p>
        <p><strong>Lectura operativa:</strong> CSI alto (mucho microplástico en el agua pero pocos residuos en costa) sugiere origen probablemente marino/atmosférico; CSI bajo (pocos microplásticos en agua pero muchos residuos en costa) sugiere fuente terrestre/costera; CSI intermedio sugiere contribución mixta.</p>
        <p><strong>Cómo relacionarlo:</strong> contrástalo con <code>IPC</code> (presión costera) y <code>Plastic_Pressure_Index</code> para entender si la señal viene más de costa o de la columna de agua.</p>
        <p><strong>Modelo:</strong> índice de razón (<em>ratio index</em>) entre señal en agua y presión/carga costera (según definición operativa del estudio).</p>
        <p><strong>Datos usados:</strong> <code>mp_per_L</code>, <code>kg_total</code>.</p>
        <div class="example" aria-label="Ejemplo CSI">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Relación kg_total vs mp_per_L (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <circle cx="55" cy="78" r="6" fill="rgba(147,197,253,0.55)"/>
              <circle cx="95" cy="66" r="7" fill="rgba(147,197,253,0.55)"/>
              <circle cx="140" cy="55" r="8" fill="rgba(147,197,253,0.55)"/>
              <circle cx="190" cy="48" r="6" fill="rgba(147,197,253,0.55)"/>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "plastic_origin": {
      "CSI": { "byLocationAndDate": [{ "date": "2025-01-01", "CSI": 0.023 }] }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "9_coastalSourceIndex": {
        "kgTotal": [120, 150],
        "mpPerL": [0.42, 0.55],
        "csi": [0.023, 0.018]
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Impacto espacial (distribución) (<code>impactValues</code>)</h3>
        <p>Visualización espacial de la intensidad de impacto/concentración agregada sobre coordenadas (lon/lat).</p>
        <p><strong>Cómo interpretarlo:</strong> valores más altos en <code>impactValues</code> señalan zonas/puntos con mayor intensidad del indicador (según la definición del estudio).</p>
        <p><strong>Cómo relacionarlo:</strong> úsalo para contextualizar picos en series temporales (por ejemplo <code>mp_per_L</code>) y para comparar áreas/ubicaciones con la misma ventana temporal.</p>
        <p><strong>Modelo:</strong> agregación espacial y representación tipo “heatmap/geo scatter”.</p>
        <p><strong>Datos usados:</strong> <code>lon[]</code>, <code>lat[]</code>, <code>impactValues[]</code>.</p>
        <div class="example" aria-label="Ejemplo impacto espacial">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Impacto espacial (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <circle cx="120" cy="60" r="18" fill="rgba(234,88,12,0.55)"/>
              <circle cx="80" cy="80" r="10" fill="rgba(234,88,12,0.35)"/>
              <circle cx="160" cy="45" r="8" fill="rgba(234,88,12,0.30)"/>
            </svg>
          </div>
          <pre><code>{
  "dataFormattedForPlots": {
    "plots": {
      "10_spatialDistributionOfImpact": {
        "lon": [2.2433],
        "lat": [41.4342],
        "impactValues": [0.47]
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Indicadores básicos de contaminación (concentración y variabilidad)</h3>
        <p><strong>Concentración media de microplásticos:</strong> promedio por punto/zona/periodo. En Py-GC/MS, la carga total se obtiene sumando concentraciones por polímero.</p>
        <p><strong>Índice de variabilidad temporal (media mensual):</strong> desviación estándar o coeficiente de variación a lo largo del tiempo (requiere series suficientes).</p>
        <p><strong>Modelo:</strong> estadística descriptiva y agregación temporal (media, desviación estándar, coeficiente de variación).</p>
        <p><strong>Cómo relacionarlo:</strong> úsalo como contexto de estabilidad vs episodios para interpretar picos en <code>mp_per_L</code>, y como base de comparación entre ventanas temporales equivalentes.</p>
        <div class="example" aria-label="Ejemplo indicadores básicos">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Resumen (mean/std/cv) (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <rect x="35" y="40" width="35" height="70" fill="rgba(147,197,253,0.6)"/>
              <rect x="95" y="70" width="35" height="40" fill="rgba(147,197,253,0.35)"/>
              <rect x="155" y="88" width="35" height="22" fill="rgba(147,197,253,0.2)"/>
              <text x="52" y="115" fill="rgba(232,238,252,.7)" font-size="10" text-anchor="middle">mean</text>
              <text x="112" y="115" fill="rgba(232,238,252,.7)" font-size="10" text-anchor="middle">std</text>
              <text x="172" y="115" fill="rgba(232,238,252,.7)" font-size="10" text-anchor="middle">cv</text>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "basic_contamination": {
      "summary": {
        "mean_mp_per_L": 0.47,
        "std_mp_per_L": 0.06,
        "cv_mp_per_L": 0.1277
      }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "11_basicContaminationSummary": {
        "meanMpPerL": 0.47,
        "stdMpPerL": 0.06,
        "cvMpPerL": 0.1277
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Concordancia boya vs muestra de agua (cualitativa por polímeros)</h3>
        <p><strong>Qué es:</strong> porcentaje de polímeros coincidentes entre µFTIR (boya) y Py-GC/MS (muestras de agua) en una misma zona.</p>
        <p><strong>Cómo interpretarlo:</strong> concordancia alta sugiere coherencia cualitativa de composición; concordancia baja puede indicar diferencias metodológicas, sesgos de detección o variabilidad espacial/temporal.</p>
        <p><strong>Modelo:</strong> métrica de solape cualitativo (porcentaje de coincidencia de categorías/polímeros).</p>
        <p><strong>Cómo relacionarlo:</strong> úsalo como control de calidad/consistencia al interpretar <code>polymer_correlation</code> y cambios de mezcla en el tiempo.</p>
        <div class="example" aria-label="Ejemplo concordancia">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Concordancia (%) (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <rect x="30" y="52" width="180" height="18" fill="rgba(255,255,255,0.08)"/>
              <rect x="30" y="52" width="135" height="18" fill="rgba(34,197,94,0.65)"/>
              <text x="120" y="48" fill="rgba(232,238,252,.7)" font-size="11" text-anchor="middle">overlap 75.0%</text>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "basic_contamination": {
      "concordance_buoy_vs_water": {
        "byLocationAndDateRange": [
          {
            "buoyPolymers": ["PE", "PP", "PET"],
            "waterPolymers": ["PE", "PP", "PET", "PS"],
            "overlapPercent": 75.0
          }
        ]
      }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "12_buoyVsWaterConcordance": {
        "buoyPolymers": ["PE", "PP", "PET"],
        "waterPolymers": ["PE", "PP", "PET", "PS"],
        "overlapPercent": 75.0
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h3>Similitud polimérica (agua vs peces)</h3>
        <p><strong>Qué es:</strong> correlación de Pearson entre el porcentaje de cada polímero en agua y su porcentaje en tejido.</p>
        <p><strong>Modelo:</strong> correlación de Pearson entre composiciones (vector de porcentajes por polímero).</p>
        <p><strong>Guía de interpretación:</strong> r ≥ 0.8 (transferencia directa), 0.5–0.8 (parcial), r &lt; 0.5 (selección por polímero o degradación diferencial).</p>
        <p><strong>Cómo relacionarlo:</strong> combínalo con <code>BCF</code>: una similitud alta con BCF alto sugiere acumulación sin cambio fuerte de “firma”; similitud baja con BCF alto sugiere posible selectividad por polímero (según el modelo/estudio).</p>
        <div class="example" aria-label="Ejemplo similitud agua vs peces">
          <div class="mini" aria-label="Gráfica de ejemplo">
            <svg viewBox="0 0 240 120" role="img" aria-label="Agua vs pez por polímero (ejemplo)">
              <rect x="0" y="0" width="240" height="120" fill="rgba(255,255,255,0.02)"/>
              <line x1="30" y1="95" x2="210" y2="25" stroke="rgba(232,238,252,0.45)" stroke-width="2" stroke-dasharray="4 3"/>
              <circle cx="70" cy="70" r="6" fill="rgba(167,139,250,0.7)"/><text x="82" y="74" fill="rgba(232,238,252,.7)" font-size="10">PE</text>
              <circle cx="110" cy="60" r="6" fill="rgba(167,139,250,0.7)"/><text x="122" y="64" fill="rgba(232,238,252,.7)" font-size="10">PP</text>
              <circle cx="150" cy="45" r="6" fill="rgba(167,139,250,0.7)"/><text x="162" y="49" fill="rgba(232,238,252,.7)" font-size="10">PET</text>
              <circle cx="175" cy="52" r="6" fill="rgba(167,139,250,0.7)"/><text x="187" y="56" fill="rgba(232,238,252,.7)" font-size="10">PS</text>
            </svg>
          </div>
          <pre><code>{
  "results": {
    "trophic_transfer": {
      "polymer_similarity_water_vs_fish": {
        "byLocationAndDateRange": [
          {
            "polymerLabels": ["PE", "PP", "PET", "PS"],
            "waterPercent": [28.4, 24.1, 21.7, 25.8],
            "fishPercent": [26.9, 25.3, 22.4, 25.4],
            "pearson_r": 0.92,
            "p_value": 0.080
          }
        ]
      }
    }
  },
  "dataFormattedForPlots": {
    "plots": {
      "13_waterVsFishPolymerSimilarity": {
        "polymerLabels": ["PE", "PP", "PET", "PS"],
        "waterPercent": [28.4, 24.1, 21.7, 25.8],
        "fishPercent": [26.9, 25.3, 22.4, 25.4],
        "pearson_r": 0.92,
        "p_value": 0.080
      }
    }
  }
}</code></pre>
        </div>
      </div>

      <div class="card">
        <h2>Mapa rápido: plots → campos usados</h2>
        <p>Los plots se construyen desde <code>dataFormattedForPlots.plots</code>. Cada clave corresponde a una figura.</p>
        <table>
          <thead>
            <tr><th>Plot key</th><th>Qué muestra</th><th>Campos principales</th></tr>
          </thead>
          <tbody>
            <tr><td><code>1_meanMicroplasticsConcentration</code></td><td>Media de mp/L</td><td><code>locations[]</code>, <code>valuesMpPerL[]</code></td></tr>
            <tr><td><code>2_microplasticsOverTime</code></td><td>mp/L vs fecha</td><td><code>dates[]</code>, <code>mpPerL[]</code></td></tr>
            <tr><td><code>3_bcfDistribution</code></td><td>Distribución BCF</td><td><code>bcfValues[]</code></td></tr>
            <tr><td><code>4_waterVsFishMicroplastics</code></td><td>Agua vs pez</td><td><code>mpPerL_water[]</code>, <code>mpPerKg_fish[]</code></td></tr>
            <tr><td><code>5_polymerCorrelation</code></td><td>Matriz de correlación</td><td><code>polymerLabels[]</code>, <code>correlationMatrix[][]</code></td></tr>
            <tr><td><code>6_exposureIndex</code></td><td>Exposición (burbujas)</td><td><code>mpPerL[]</code>, <code>biomass[]</code>, <code>exposureIndex[]</code>, <code>probIngestion</code></td></tr>
            <tr><td><code>7_plasticPressureComposition</code></td><td>Composición presión</td><td><code>waterMpPerL</code>, <code>coastKgPerKm</code>, <code>location</code></td></tr>
            <tr><td><code>8_coastalPressureIndex</code></td><td>IPC diario y 7d</td><td><code>dates[]</code>, <code>ipcDaily[]</code>, <code>ipc7DayAverage[]</code></td></tr>
            <tr><td><code>9_coastalSourceIndex</code></td><td>CSI</td><td><code>kgTotal[]</code>, <code>mpPerL[]</code>, <code>csi[]</code></td></tr>
            <tr><td><code>10_spatialDistributionOfImpact</code></td><td>Impacto espacial</td><td><code>lon[]</code>, <code>lat[]</code>, <code>impactValues[]</code></td></tr>
            <tr><td><code>11_basicContaminationSummary</code></td><td>Resumen (mean/std/cv)</td><td><code>meanMpPerL</code>, <code>stdMpPerL</code>, <code>cvMpPerL</code></td></tr>
            <tr><td><code>12_buoyVsWaterConcordance</code></td><td>Concordancia polímeros</td><td><code>buoyPolymers[]</code>, <code>waterPolymers[]</code>, <code>overlapPercent</code></td></tr>
            <tr><td><code>13_waterVsFishPolymerSimilarity</code></td><td>Similitud agua vs pez</td><td><code>polymerLabels[]</code>, <code>waterPercent[]</code>, <code>fishPercent[]</code>, <code>pearson_r</code></td></tr>
          </tbody>
        </table>
      </div>
    </main>
    <footer>
      <p>Ruta: <code>GET /v1/analyses/indices</code></p>
    </footer>
  </body>
</html>`;
  }

  @Post('analyses/run')
  @UseGuards(UserJwtAuthGuard)
  @ApiBearerAuth('portal-jwt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ejecutar analíticas y (opcionalmente) generar plots',
  })
  @ApiBadRequestResponse({
    description:
      'La coordenada no está a menos de 100 km de ninguna costa cubierta ' +
      '(mediterránea, atlántica —golfo de Cádiz y Canarias— o cantábrica). ' +
      'Sólo los datasets de la costa a la que pertenece un punto pueden ' +
      'responder por él, así que un punto sin costa no tiene ninguno, y la ' +
      'petición se rechaza en vez de responderse con cifras de otro mar.',
  })
  @ApiBody({
    type: AnalysesRunRequestDto,
    examples: {
      fullYearWithPlots: {
        summary: 'Demo anual (genera plots WebP + PDF)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['all'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
          aggregation: { mode: 'raw' },
          options: {
            dataFormattedForPlots: true,
            savePlotsWebp: true,
            includeWarnings: true,
            cache: { mode: 'bypass' },
          },
        },
      },
      fullYearJsonPlotsOnly: {
        summary: 'Anual (solo JSON con datos para plots, sin ficheros)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['all'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
          aggregation: { mode: 'raw' },
          options: {
            dataFormattedForPlots: true,
            savePlotsWebp: false,
            includeWarnings: false,
            cache: { mode: 'reuse' },
          },
        },
      },
      defaultDateRangeNoOptions: {
        summary: 'Solo defaults (omite dateRange/aggregation/options)',
        description:
          'Usa valores por defecto del API: dateRangeApplied se rellena con un rango predefinido, aggregation por defecto es raw, sin datos para plots y sin ficheros.',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['all'],
        },
      },
      monthlyAggregation: {
        summary: 'Agregación mensual (serie más corta, útil para overview)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 50 },
          analyses: ['basic_contamination', 'eco_risk'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
          aggregation: { mode: 'monthly' },
          options: {
            dataFormattedForPlots: true,
            savePlotsWebp: false,
            includeWarnings: true,
            cache: { mode: 'reuse', ttlSeconds: 604800 },
          },
        },
      },
      specificAnalysesOnly: {
        summary: 'Solo análisis concretos (sin datos de plots)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['trophic_transfer', 'plastic_origin'],
          dateRange: { start: '2025-06-01', end: '2025-06-30' },
          options: {
            includeWarnings: true,
            cache: { mode: 'recompute' },
          },
        },
      },
      plotsDataOnlyShortRange: {
        summary: 'Solo JSON para plots (rango corto, sin ficheros)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 15 },
          analyses: ['all'],
          dateRange: { start: '2025-03-01', end: '2025-03-31' },
          options: {
            dataFormattedForPlots: true,
            savePlotsWebp: false,
            includeWarnings: true,
            cache: { mode: 'reuse' },
          },
        },
      },
      filesOnlyNoPlotPayload: {
        summary: 'Generar ficheros (WebP + PDF) omitiendo el payload de plots',
        description:
          'Nota: savePlotsWebp implica datos para plots internamente. Aunque se omita dataFormattedForPlots, la respuesta puede incluirlo porque es necesario para generar ficheros.',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['all'],
          dateRange: { start: '2025-01-01', end: '2025-01-31' },
          options: {
            savePlotsWebp: true,
            includeWarnings: false,
            cache: { mode: 'bypass' },
          },
        },
      },
      forceFreshExport: {
        summary: 'Forzar export fresh (sin caché) + generar ficheros',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 10 },
          analyses: ['all'],
          dateRange: { start: '2025-03-01', end: '2025-03-31' },
          aggregation: { mode: 'raw' },
          options: {
            dataFormattedForPlots: true,
            savePlotsWebp: true,
            includeWarnings: true,
            cache: { mode: 'bypass' },
          },
        },
      },
      cacheHitSecondCall: {
        summary:
          'Cache hit (ejecuta esto DESPUÉS de ejecutar la misma request una vez)',
        description:
          'Ejecuta esta request dos veces. La segunda debería devolver meta.cache.hit=true (mismos location/area/analyses/dateRange/aggregation/options).',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['all'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
          aggregation: { mode: 'raw' },
          options: {
            dataFormattedForPlots: true,
            savePlotsWebp: false,
            includeWarnings: true,
            cache: { mode: 'reuse', ttlSeconds: 2592000 },
          },
        },
      },
      cacheBypassAlwaysRecompute: {
        summary:
          'Bypass caché (recalcula siempre, pero devuelve meta de caché)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['all'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
          options: {
            includeWarnings: true,
            cache: { mode: 'bypass' },
          },
        },
      },
      cacheRecomputeAndStore: {
        summary: 'Recompute y guardar (cache.mode=recompute)',
        description:
          'Fuerza un recálculo y guarda el resultado en caché para reutilización futura (salvo si savePlotsWebp=true, que salta la caché).',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['eco_risk'],
          dateRange: { start: '2025-01-01', end: '2025-12-31' },
          options: {
            includeWarnings: true,
            cache: { mode: 'recompute', ttlSeconds: 86400 },
          },
        },
      },
      warningsOff: {
        summary: 'Warnings desactivados (includeWarnings=false)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['basic_contamination'],
          dateRange: { start: '2025-01-01', end: '2025-01-30' },
          options: {
            includeWarnings: false,
            cache: { mode: 'reuse' },
          },
        },
      },
      quickRunNoFiles: {
        summary: 'Ejecución rápida (solo JSON, sin ficheros)',
        value: {
          location: { lat: 41.4342, lon: 2.2433 },
          area: { type: 'radius_km', value: 25 },
          analyses: ['basic_contamination'],
          options: { includeWarnings: true },
        },
      },
    },
  })
  @ApiOkResponse({ type: AnalysesRunResponseDto })
  run(
    @Body() body: AnalysesRunRequest,
    @Req() req: Request,
  ): Promise<AnalysesRunResponse> {
    return this.analyses.run(body, {
      publicBaseUrl: publicBaseUrlFromReq(req),
    });
  }
}
