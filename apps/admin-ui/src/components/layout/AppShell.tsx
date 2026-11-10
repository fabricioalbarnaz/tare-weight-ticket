import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { HardwareStatusBadge } from './HardwareStatusBadge';

/** `adminOnly` links are hidden for the operator profile — the routes themselves are guarded by `RequireAdmin`. */
const NAV_LINKS = [
  { to: '/', labelKey: 'nav.dashboard', adminOnly: true },
  { to: '/operation', labelKey: 'nav.operation', adminOnly: false },
  { to: '/history', labelKey: 'nav.history', adminOnly: true },
  { to: '/unresolved-events', labelKey: 'nav.unresolvedEvents', adminOnly: true },
  { to: '/internal-trucks', labelKey: 'nav.internalTrucks', adminOnly: true },
  { to: '/status', labelKey: 'nav.hardwareStatus', adminOnly: true },
  { to: '/users', labelKey: 'nav.users', adminOnly: true },
] as const;

function linkClass(isActive: boolean) {
  return `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-slate-900">{t('nav.appName')}</span>
            <nav className="flex gap-1">
              {NAV_LINKS.filter((link) => isAdmin || !link.adminOnly).map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  {t(link.labelKey)}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            {/* `GET /status` is admin-only. */}
            {isAdmin && <HardwareStatusBadge />}
            <Link
              to="/account/password"
              title={t('nav.changePassword')}
              className="text-sm text-slate-500 hover:underline"
            >
              {user?.name}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
