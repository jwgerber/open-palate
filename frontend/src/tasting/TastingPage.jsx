/**
 * Tasting — Log · Coffees · My palate.
 *
 * ModuleTabs in route mode over nested routes. Two extra routes live outside
 * the tab row: `/f/:flightId` (a shared flight link — lands on the Log tab with
 * the invite card) and `/coffees/:coffeeId` (a coffee's page, under the Coffees
 * tab).
 *
 * My palate exists only for a signed-in person; a shared device gets no tab and
 * the route redirects to Log.
 *
 * Print sheets (`/print/sheets/:flightId`) opens in its own browser tab and
 * renders without the tab bar or column.
 */
import { lazy, Suspense } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Routes, Route, Navigate, useMatch } from 'react-router-dom';
import ModuleTabs from '../common/ModuleTabs';
import { useTastingIdentity } from './useTastingIdentity';

const LogTab = lazy(() => import('./log/LogTab'));
const CoffeesTab = lazy(() => import('./coffees/CoffeesTab'));
const CoffeePage = lazy(() => import('./coffees/CoffeePage'));
const PalateTab = lazy(() => import('./palate/PalateTab'));
const PrintSheetsPage = lazy(() => import('./print/PrintSheetsPage'));

export const BASE_PATH = '';

const Loading = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
    <CircularProgress />
  </Box>
);

const TastingPage = () => {
  const { isPerson } = useTastingIdentity();
  const onSheetsPage = useMatch('/print/sheets/:flightId');
  const tabs = [
    { value: 'log', label: 'Log', path: 'log' },
    { value: 'coffees', label: 'Coffees', path: 'coffees' },
    ...(isPerson ? [{ value: 'palate', label: 'My palate', path: 'palate' }] : []),
  ];

  if (onSheetsPage) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes><Route path="print/sheets/:flightId" element={<PrintSheetsPage />} /></Routes>
      </Suspense>
    );
  }

  return (
    <Box data-testid="tasting-column" sx={{ width: '100%', maxWidth: 640, mx: 'auto' }}>
      <ModuleTabs basePath={BASE_PATH} tabs={tabs} ariaLabel="Tasting tabs" />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Navigate to="/log" replace />} />
          <Route path="log" element={<LogTab />} />
          <Route path="f/:flightId" element={<LogTab />} />
          <Route path="coffees" element={<CoffeesTab />} />
          <Route path="coffees/:coffeeId" element={<CoffeePage />} />
          <Route
            path="palate"
            element={isPerson ? <PalateTab /> : <Navigate to="/log" replace />}
          />
          {/* Absolute, not relative: a relative `to` loops inside a splat route. */}
          <Route path="*" element={<Navigate to="/log" replace />} />
        </Routes>
      </Suspense>
    </Box>
  );
};

export default TastingPage;
