import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { CreateTicketPage } from './pages/CreateTicketPage';
import { DashboardPage } from './pages/DashboardPage';
import { HardwareStatusPage } from './pages/HardwareStatusPage';
import { HistoryPage } from './pages/HistoryPage';
import { InternalTrucksPage } from './pages/InternalTrucksPage';
import { LoginPage } from './pages/LoginPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TruckDetailPage } from './pages/TruckDetailPage';
import { UnresolvedEventsPage } from './pages/UnresolvedEventsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/unresolved-events" element={<UnresolvedEventsPage />} />
          <Route path="/status" element={<HardwareStatusPage />} />
          <Route path="/internal-trucks" element={<InternalTrucksPage />} />
          <Route path="/internal-trucks/:id" element={<TruckDetailPage />} />
          <Route path="/tickets/new" element={<CreateTicketPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
