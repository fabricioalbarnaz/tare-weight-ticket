import { Route, Routes } from 'react-router-dom';
import { RequireAdmin } from './auth/RequireAdmin';
import { CHANGE_PASSWORD_REQUIRED_PATH, RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { CreateTicketPage } from './pages/CreateTicketPage';
import { DashboardPage } from './pages/DashboardPage';
import { HardwareStatusPage } from './pages/HardwareStatusPage';
import { HistoryPage } from './pages/HistoryPage';
import { InternalTrucksPage } from './pages/InternalTrucksPage';
import { LoginPage } from './pages/LoginPage';
import { OperationPage } from './pages/OperationPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TruckDetailPage } from './pages/TruckDetailPage';
import { UnresolvedEventsPage } from './pages/UnresolvedEventsPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { UsersPage } from './pages/UsersPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path={CHANGE_PASSWORD_REQUIRED_PATH} element={<ChangePasswordPage forced />} />
        <Route element={<AppShell />}>
          {/* Open to every profile. */}
          <Route path="/operation" element={<OperationPage />} />
          <Route path="/account/password" element={<ChangePasswordPage />} />

          <Route element={<RequireAdmin />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/unresolved-events" element={<UnresolvedEventsPage />} />
            <Route path="/status" element={<HardwareStatusPage />} />
            <Route path="/internal-trucks" element={<InternalTrucksPage />} />
            <Route path="/internal-trucks/:id" element={<TruckDetailPage />} />
            <Route path="/tickets/new" element={<CreateTicketPage />} />
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
