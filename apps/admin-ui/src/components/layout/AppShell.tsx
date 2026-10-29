import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { HardwareStatusBadge } from './HardwareStatusBadge';

const NAV_LINKS = [
  { to: '/', labelKey: 'nav.dashboard' },
  { to: '/history', labelKey: 'nav.history' },
  { to: '/unresolved-events', labelKey: 'nav.unresolvedEvents' },
  { to: '/internal-trucks', labelKey: 'nav.internalTrucks' },
  { to: '/status', labelKey: 'nav.hardwareStatus' },
] as const;

function linkClass(isActive: boolean) {
  return `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold text-slate-900">{t('nav.appName')}</span>
            <nav className="flex gap-1">
              {NAV_LINKS.map((link) => (
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
            <HardwareStatusBadge />
            <span className="text-sm text-slate-500">{user?.username}</span>
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
