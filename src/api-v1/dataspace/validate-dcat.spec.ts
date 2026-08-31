import { __clearDcatCache, validateAgainstDcat } from './validate-dcat';

/**
 * Runs against the schemas committed in metadata/DCAT, so a schema edited out of
 * step with the live column names fails here rather than in an ingest warning.
 */
beforeEach(() => __clearDcatCache());

const validate = (
  datasetType: Parameters<typeof validateAgainstDcat>[0]['datasetType'],
  record: Record<string, unknown>,
) =>
  validateAgainstDcat({
    datasetType,
    dataset: { format: 'rows', records: [record] },
    metadata: {},
  });

describe('validateAgainstDcat — recogidas_playa spellings', () => {
  const columns = {
    bare: 'Polypropylene',
    suffixed: 'Polypropylene (%)',
    trailingSpace: 'Polypropylene ',
  };

  it.each(Object.entries(columns))(
    'accepts the %s spelling',
    async (_label, column) => {
      const res = await validate('recogidas_playa', {
        Date: '2025-01-01',
        [column]: 1,
      });
      expect(res.checked).toBe(true);
      expect(res.unknownColumns).toEqual([]);
    },
  );

  it('accepts the singular "Other" gijón uses', async () => {
    const res = await validate('recogidas_playa', {
      Date: '2025-01-01',
      Other: 0,
    });
    expect(res.unknownColumns).toEqual([]);
  });

  it('still reports a column the schema really does not declare', async () => {
    const res = await validate('recogidas_playa', {
      Date: '2025-01-01',
      Unobtainium: 1,
    });
    expect(res.unknownColumns).toEqual(['Unobtainium']);
  });
});

describe('validateAgainstDcat — boya_biomasa_slx+ depth spellings', () => {
  it.each(['Biomass depth -5_-8 m', 'Biomass depth -5.00_-8 m'])(
    'accepts %s',
    async (column) => {
      const res = await validate('boya_biomasa_slx+', {
        Date: '2025-01-01',
        [column]: 1,
      });
      expect(res.checked).toBe(true);
      expect(res.unknownColumns).toEqual([]);
    },
  );

  it('declares the deep layers that only the gijón buoy reports', async () => {
    const res = await validate('boya_biomasa_slx+', {
      Date: '2025-01-01',
      'Biomass depth -11.00_-16 m': 1,
      'Biomass depth -16.00_-21 m': 1,
      'Biomass depth -21.00_-29 m': 1,
    });
    expect(res.unknownColumns).toEqual([]);
  });
});

describe('validateAgainstDcat — schemas describe the published assets', () => {
  it('declares the met-ocean columns as the published files name them', async () => {
    const res = await validate('environmental_boya', {
      Date: '2025-01-01',
      Time: '00:00:00',
      wind_speed: 3.1,
      sea_surface_temperature: 15,
      ocean_current_speed: 0.3,
    });
    expect(res.unknownColumns).toEqual([]);
  });

  it('declares the per-particle columns of the microplastics buoy', async () => {
    const res = await validate('boya_microplasticos_seabot', {
      Date: '18-02-2026',
      Particle_ID: 1,
      Size: 'Mesoplastics',
      Form: 'Line',
      Type_of_Polymer: 'Polyethylene',
      Colour: 'Red',
    });
    expect(res.unknownColumns).toEqual([]);
    expect(res.missingColumns).toEqual([]);
  });

  it('declares the water sample polymer columns', async () => {
    const res = await validate('muestras_de_agua_py_gcms', {
      Date: '2025-01-06',
      Polyethylene: 0.62,
      'Poly(methyl methacrylate)': 0.05,
    });
    expect(res.unknownColumns).toEqual([]);
  });
});

describe('validateAgainstDcat — where the schema comes from', () => {
  /**
   * The bundled copies are a snapshot of what the providers published and can
   * drift from it; for two of the eight types there is no copy at all. So the
   * published document wins, and the copy is what answers when it cannot be
   * read — never the other way round, and never nothing.
   */

  const publishedSchema = {
    'schema:variableMeasured': [
      { 'schema:name': 'Date', 'schema:description': 'unit=ISO-8601' },
      { 'schema:name': 'columna_solo_en_el_espacio', 'schema:description': '' },
    ],
  };

  const withSpace = (
    datasetType: Parameters<typeof validateAgainstDcat>[0]['datasetType'],
    record: Record<string, unknown>,
    space: Parameters<typeof validateAgainstDcat>[0]['space'],
  ) =>
    validateAgainstDcat({
      datasetType,
      dataset: { format: 'rows', records: [record] },
      metadata: {},
      space,
    });

  it('prefers the schema the provider published', async () => {
    const res = await withSpace(
      'recogidas_playa',
      { Date: '2025-01-01', columna_solo_en_el_espacio: 1 },
      async () => ({
        id: 'esquema_datos_recogidas_playa',
        raw: publishedSchema,
      }),
    );
    expect(res.schemaSource).toBe('dataspace');
    expect(res.schemaId).toBe('esquema_datos_recogidas_playa');
    // The column is unknown to the bundled copy and declared by the published
    // one, which is what proves which of the two answered.
    expect(res.unknownColumns).toEqual([]);
  });

  it('falls back to the bundled copy when the space has nothing to give', async () => {
    const res = await withSpace(
      'recogidas_playa',
      { Date: '2025-01-01' },
      async () => null,
    );
    expect(res.schemaSource).toBe('local');
    expect(res.checked).toBe(true);
  });

  it('falls back when reading the published schema throws', async () => {
    // A refused contract or a connector timeout must cost a fresher schema, not
    // the column check itself.
    const res = await withSpace(
      'recogidas_playa',
      { Date: '2025-01-01' },
      async () => {
        throw new Error('transfer failed');
      },
    );
    expect(res.schemaSource).toBe('local');
    expect(res.checked).toBe(true);
  });

  it('falls back when the published document declares no variables', async () => {
    const res = await withSpace(
      'recogidas_playa',
      { Date: '2025-01-01' },
      async () => ({ id: 'vacío', raw: { '@context': {} } }),
    );
    expect(res.schemaSource).toBe('local');
  });

  it('checks a type that has no bundled copy at all', async () => {
    // atmosfera_previa_evento and oceanografia_previa_evento have never been
    // validated against anything. The published schema is the only one there is.
    const none = await validateAgainstDcat({
      datasetType: 'atmosfera_previa_evento',
      dataset: { format: 'rows', records: [{ event_date: '2025-01-01' }] },
      metadata: {},
    });
    expect(none.checked).toBe(false);

    const res = await withSpace(
      'atmosfera_previa_evento',
      { event_date: '2025-01-01', temperatura: 12 },
      async () => ({
        id: 'esquema_datos_atmosfera_previa_evento',
        raw: {
          'schema:variableMeasured': [
            { 'schema:name': 'temperatura', 'schema:description': 'unit=°C' },
          ],
        },
      }),
    );
    expect(res.checked).toBe(true);
    expect(res.schemaSource).toBe('dataspace');
    expect(res.unknownColumns).toEqual([]);
  });

  it('does not memoize what the space said', async () => {
    // The bundled files do not change while the process runs; what the space
    // offers does. Caching the first answer would make a process that synced
    // once while the connector was refusing use the bundled copy for ever.
    const space = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'published-later', raw: publishedSchema });

    const first = await withSpace(
      'recogidas_playa',
      { Date: '2025-01-01' },
      space,
    );
    expect(first.schemaSource).toBe('local');

    const second = await withSpace(
      'recogidas_playa',
      { Date: '2025-01-01' },
      space,
    );
    expect(second.schemaSource).toBe('dataspace');
    expect(space).toHaveBeenCalledTimes(2);
  });
});
