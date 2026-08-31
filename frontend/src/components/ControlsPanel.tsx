import { Controller, useForm } from 'react-hook-form';
import { useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { AggregationMode, AnalysisId, AnalysesRunRequest, CacheMode } from '../types/analyses';

export type DashboardFormValues = {
  lat: number;
  lon: number;
  radiusKm: number;
  dateStart: string;
  dateEnd: string;
  aggregationMode: AggregationMode;
  analysesAll: boolean;
  analyses: Record<AnalysisId, boolean>;
  dataFormattedForPlots: boolean;
  savePlotsWebp: boolean;
  includeWarnings: boolean;
  cacheMode: CacheMode;
  cacheTtlSeconds?: number;
};

const ALL_ANALYSES: AnalysisId[] = [
  'basic_contamination',
  'trophic_transfer',
  'eco_risk',
  'plastic_origin',
];

function defaultValues(): DashboardFormValues {
  return {
    lat: 41.4342,
    lon: 2.2433,
    radiusKm: 25,
    dateStart: '2025-01-01',
    dateEnd: '2025-12-31',
    aggregationMode: 'raw',
    analysesAll: true,
    analyses: {
      basic_contamination: true,
      trophic_transfer: true,
      eco_risk: true,
      plastic_origin: true,
    },
    dataFormattedForPlots: true,
    savePlotsWebp: true,
    includeWarnings: true,
    cacheMode: 'bypass',
    cacheTtlSeconds: undefined,
  };
}

export function valuesToRequest(v: DashboardFormValues): AnalysesRunRequest {
  const analyses = v.analysesAll ? (['all'] as const) : (ALL_ANALYSES.filter((a) => v.analyses[a]) as string[]);

  return {
    location: { lat: v.lat, lon: v.lon },
    area: { type: 'radius_km', value: v.radiusKm },
    analyses: analyses as any,
    dateRange: { start: v.dateStart, end: v.dateEnd },
    aggregation: { mode: v.aggregationMode },
    options: {
      dataFormattedForPlots: v.dataFormattedForPlots,
      savePlotsWebp: v.savePlotsWebp,
      includeWarnings: v.includeWarnings,
      cache: {
        mode: v.cacheMode,
        ttlSeconds: v.cacheTtlSeconds,
      },
    },
  };
}

export function ControlsPanel(props: {
  onRun: (req: AnalysesRunRequest) => void;
  onLocationChange?: (loc: { lat: number; lon: number }) => void;
  onParamsChange?: (p: { location: { lat: number; lon: number }; radiusKm: number }) => void;
  externalLocation?: { lat: number; lon: number };
  isRunning?: boolean;
}) {
  const { control, handleSubmit, setValue, watch } = useForm<DashboardFormValues>({
    defaultValues: defaultValues(),
    mode: 'onChange',
  });

  const w = watch();

  useEffect(() => {
    if (!props.externalLocation) return;
    setValue('lat', props.externalLocation.lat, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setValue('lon', props.externalLocation.lon, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    props.onLocationChange?.(props.externalLocation);
  }, [props.externalLocation?.lat, props.externalLocation?.lon]);

  useEffect(() => {
    const sub = watch((values) => {
      props.onParamsChange?.({
        location: { lat: values.lat ?? 0, lon: values.lon ?? 0 },
        radiusKm: values.radiusKm ?? 0,
      });
    });
    return () => sub.unsubscribe();
  }, [watch]);

  const onSubmit = handleSubmit((values) => {
    props.onRun(valuesToRequest(values));
  });

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)' }}>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" sx={{ opacity: 0.8 }}>
              ONDAs DataSpace
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 720, letterSpacing: -0.2 }}>
              Scientific Dashboard (v1)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Build request → run analyses → inspect plots and payload.
            </Typography>
          </Box>

          <Divider />

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Location (WGS84)
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Controller
                control={control}
                name="lat"
                rules={{ required: true, min: -90, max: 90 }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Latitude"
                    type="number"
                    inputProps={{ step: '0.0001' }}
                    onChange={(e) => {
                      const lat = Number(e.target.value);
                      field.onChange(lat);
                      props.onLocationChange?.({ lat, lon: w.lon });
                    }}
                  />
                )}
              />
              <Controller
                control={control}
                name="lon"
                rules={{ required: true, min: -180, max: 180 }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    label="Longitude"
                    type="number"
                    inputProps={{ step: '0.0001' }}
                    onChange={(e) => {
                      const lon = Number(e.target.value);
                      field.onChange(lon);
                      props.onLocationChange?.({ lat: w.lat, lon });
                    }}
                  />
                )}
              />
            </Stack>

            <Controller
              control={control}
              name="radiusKm"
              rules={{ required: true, min: 1, max: 500 }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Area radius"
                  type="number"
                  inputProps={{ step: '1', min: 1 }}
                  InputProps={{
                    endAdornment: <InputAdornment position="end">km</InputAdornment>,
                  }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = raw === '' ? NaN : Number(raw);
                    field.onChange(Number.isFinite(n) ? n : undefined);
                  }}
                />
              )}
            />
          </Stack>

          <Divider />

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Time range
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Controller
                control={control}
                name="dateStart"
                rules={{ required: true }}
                render={({ field }) => (
                  <TextField {...field} fullWidth label="Start" type="date" InputLabelProps={{ shrink: true }} />
                )}
              />
              <Controller
                control={control}
                name="dateEnd"
                rules={{ required: true }}
                render={({ field }) => (
                  <TextField {...field} fullWidth label="End" type="date" InputLabelProps={{ shrink: true }} />
                )}
              />
            </Stack>

            <FormControl fullWidth>
              <FormLabel sx={{ mb: 0.5 }}>Aggregation</FormLabel>
              <Controller
                control={control}
                name="aggregationMode"
                render={({ field }) => (
                  <Select {...field} size="small">
                    <MenuItem value="raw">raw</MenuItem>
                    <MenuItem value="monthly">monthly</MenuItem>
                  </Select>
                )}
              />
            </FormControl>
          </Stack>

          <Divider />

          <Stack spacing={1.25}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Indices / analyses
              </Typography>
              <Controller
                control={control}
                name="analysesAll"
                render={({ field }) => (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={field.value}
                        onChange={(_, checked) => {
                          field.onChange(checked);
                          if (checked) {
                            for (const a of ALL_ANALYSES) setValue(`analyses.${a}`, true);
                          }
                        }}
                      />
                    }
                    label="all"
                  />
                )}
              />
            </Stack>

            <FormGroup>
              {ALL_ANALYSES.map((a) => (
                <Controller
                  key={a}
                  control={control}
                  name={`analyses.${a}`}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Switch
                          checked={field.value}
                          onChange={(_, checked) => {
                            field.onChange(checked);
                            if (!checked) setValue('analysesAll', false);
                          }}
                        />
                      }
                      label={a}
                    />
                  )}
                />
              ))}
            </FormGroup>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {(w.analysesAll ? ALL_ANALYSES : ALL_ANALYSES.filter((a) => w.analyses[a])).map((id) => (
                <Chip key={id} size="small" label={id} sx={{ mb: 0.5 }} />
              ))}
            </Stack>
          </Stack>

          <Divider />

          <Stack spacing={1.25}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Options
            </Typography>

            <Controller
              control={control}
              name="dataFormattedForPlots"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(_, v) => field.onChange(v)} />}
                  label="dataFormattedForPlots (plot payload)"
                />
              )}
            />
            <Controller
              control={control}
              name="savePlotsWebp"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(_, v) => field.onChange(v)} />}
                  label="savePlotsWebp (render images + PDF)"
                />
              )}
            />
            <Controller
              control={control}
              name="includeWarnings"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(_, v) => field.onChange(v)} />}
                  label="includeWarnings"
                />
              )}
            />

            <FormControl fullWidth>
              <FormLabel sx={{ mb: 0.5 }}>Cache mode</FormLabel>
              <Controller
                control={control}
                name="cacheMode"
                render={({ field }) => (
                  <Select {...field} size="small">
                    <MenuItem value="reuse">reuse</MenuItem>
                    <MenuItem value="recompute">recompute</MenuItem>
                    <MenuItem value="bypass">bypass</MenuItem>
                  </Select>
                )}
              />
            </FormControl>

            <Controller
              control={control}
              name="cacheTtlSeconds"
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Cache TTL (optional)"
                  type="number"
                  inputProps={{ step: '60', min: 0 }}
                  helperText="Seconds. Only meaningful for reuse/recompute."
                />
              )}
            />
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Button
              variant="contained"
              size="large"
              onClick={onSubmit}
              disabled={props.isRunning}
              sx={{ borderRadius: 2, fontWeight: 750 }}
            >
              {props.isRunning ? 'Running…' : 'Run analysis'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Endpoint: <code>POST /v1/analyses/run</code>
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

