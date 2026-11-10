import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Where a non-admin lands — the only screen the operator profile can use for now. */
export const OPERATOR_HOME_PATH = '/operation';

/**
 * Wraps every admin-only route. Must sit inside `RequireAuth`, so `user` is
 * always set here. Operators are sent to the Operação screen instead of an
 * error page (that includes `/`, which is where login redirects by default).
 */
export function RequireAdmin() {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return <Navigate to={OPERATOR_HOME_PATH} replace />;
  }

  return <Outlet />;
}
