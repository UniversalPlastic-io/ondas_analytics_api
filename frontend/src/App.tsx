import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AppBar,
  Avatar,
  Box,
  // AUTH DISABLED: Button only used by logout control
  // Button,
  Container,
  CssBaseline,
  Divider,
  LinearProgress,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material';
import { runAnalyses } from './api/analyses';
import type { AnalysesRunRequest, AnalysesRunResponse } from './types/analyses';
import { ControlsPanel } from './components/ControlsPanel';
import { MapPicker } from './components/MapPicker';
// AUTH DISABLED: login dialog
// import { PortalLoginDialog } from './components/PortalLoginDialog';
import { ResultsView } from './components/ResultsView';
// AUTH DISABLED: portal session helpers
// import { clearPortalSession, readPortalSession } from './portalUsers';

export default function App() {
  const baseUrl = import.meta.env.BASE_URL;
  // AUTH DISABLED: portal user state + session hydration
  // const [portalUser, setPortalUser] = useState<string | null>(null);

  // useEffect(() => {
  //   setPortalUser(readPortalSession()?.username ?? null);
  // }, []);
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: 'dark',
          background: { default: '#070b16', paper: 'rgba(255,255,255,0.04)' },
          primary: { main: '#8fb8ff' },
          secondary: { main: '#34d399' },
          divider: 'rgba(255,255,255,0.10)',
        },
        shape: { borderRadius: 12 },
        typography: {
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
        },
        components: {
          MuiPaper: {
            styleOverrides: { root: { backdropFilter: 'blur(10px)' } },
          },
        },
      }),
    [],
  );

  const [location, setLocation] = useState<{ lat: number; lon: number }>({
    lat: 43.5721,
    lon: -5.7212,
  });
  const [radiusKm, setRadiusKm] = useState<number>(25);

  const [response, setResponse] = useState<AnalysesRunResponse | null>(null);

  const run = useMutation({
    mutationFn: (req: AnalysesRunRequest) => runAnalyses(req),
    onSuccess: (data) => setResponse(data),
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      {/* AUTH DISABLED: login dialog
      <PortalLoginDialog open={!portalUser} onSuccess={(u) => setPortalUser(u)} />
      */}

      {/* AUTH DISABLED: render app unconditionally (was `{portalUser ? (...) : null}`) */}
      {(
        <>
          <AppBar
            position="sticky"
            elevation={0}
            sx={{
              bgcolor: 'rgba(10, 15, 30, 0.66)',
              borderBottom: '1px solid rgba(255,255,255,0.10)',
            }}
          >
            <Toolbar>
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Avatar
                  variant="rounded"
                  src={`${baseUrl}logo-ondas.svg`}
                  alt="ONDAs"
                  sx={{
                    width: 34,
                    height: 34,
                    bgcolor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.10)',
                  }}
                  imgProps={{ style: { objectFit: 'contain', padding: 4 } }}
                />
                <Stack spacing={0.25}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 760, letterSpacing: -0.2 }}>
                    Analítica ONDAs — Universal Plastic
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.75 }}>
                    Leaflet · indices toggles · plot payload + downloads
                  </Typography>
                </Stack>
              </Stack>
              <Box sx={{ flexGrow: 1 }} />
              {/* AUTH DISABLED: username display + logout button
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                  {portalUser}
                </Typography>
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  sx={{ borderRadius: 2, borderColor: 'rgba(255,255,255,0.22)' }}
                  onClick={() => {
                    clearPortalSession();
                    setPortalUser(null);
                  }}
                >
                  Salir
                </Button>
              </Stack>
              */}
            </Toolbar>
            {run.isPending ? <LinearProgress /> : null}
          </AppBar>

          <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '420px 1fr' },
            gap: 2,
            alignItems: 'start',
          }}
        >
          <Stack spacing={2}>
            <ControlsPanel
              isRunning={run.isPending}
              externalLocation={location}
              onLocationChange={(loc) => setLocation(loc)}
              onParamsChange={(p) => {
                if (Number.isFinite(p.location.lat) && Number.isFinite(p.location.lon)) {
                  setLocation(p.location);
                }
                // While the user edits the input, MUI can transiently produce empty/NaN.
                // Keep the last valid radius so the map overlay doesn't flicker/disappear.
                if (Number.isFinite(p.radiusKm) && p.radiusKm > 0) {
                  setRadiusKm(p.radiusKm);
                }
              }}
              onRun={(req) => {
                setLocation(req.location);
                setRadiusKm(req.area.value);
                run.mutate(req);
              }}
            />
          </Stack>

          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 750, mb: 1 }}>
                Location picker
              </Typography>
              <MapPicker
                center={location}
                onPick={(loc) => {
                  setLocation(loc);
                }}
                radiusKm={radiusKm}
                height={240}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                Click the map to move the marker (updates the form). The blue circle is the selected radius.
              </Typography>
            </Box>

            <Divider />

            {run.isError ? (
              <Box
                sx={{
                  border: '1px solid rgba(255,120,120,0.35)',
                  bgcolor: 'rgba(255,120,120,0.08)',
                  borderRadius: 3,
                  p: 1.5,
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                  Request failed
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {String(run.error?.message ?? run.error)}
                </Typography>
              </Box>
            ) : null}

            {response ? (
              <ResultsView response={response} />
            ) : (
              <Box
                sx={{
                  border: '1px dashed rgba(255,255,255,0.18)',
                  bgcolor: 'rgba(255,255,255,0.03)',
                  borderRadius: 3,
                  p: 2,
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 750 }}>
                  No run yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Configure parameters on the left and click <strong>Run analysis</strong>.
                </Typography>
              </Box>
            )}
          </Stack>
        </Box>
      </Container>
        </>
      )}
    </ThemeProvider>
  );
}
