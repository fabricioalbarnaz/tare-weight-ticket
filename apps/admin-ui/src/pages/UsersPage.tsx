import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { CreateUserForm } from '../components/forms/CreateUserForm';

export function UsersPage() {
  const { t } = useTranslation();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.listUsers(),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('users.title')}</h1>
          <p className="text-sm text-slate-500">{t('users.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((shown) => !shown)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {t('users.newUser')}
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-4 max-w-md">
          <CreateUserForm onCreated={() => setShowCreateForm(false)} />
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-red-600">{t('users.loadError')}</p>}

      {data && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2">{t('users.table.name')}</th>
              <th className="py-2">{t('users.table.username')}</th>
              <th className="py-2">{t('users.table.role')}</th>
              <th className="py-2">{t('users.table.status')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.map((user) => (
              <tr
                key={user.id}
                className={`border-b border-slate-100 ${user.active ? '' : 'text-slate-400'}`}
              >
                <td className="py-2 font-medium">{user.name}</td>
                <td className="py-2">{user.username}</td>
                <td className="py-2">{t(`users.roles.${user.role}`)}</td>
                <td className="py-2">
                  {user.active ? t('users.status.active') : t('users.status.inactive')}
                  {user.active && user.mustChangePassword && (
                    <span className="ml-2 text-xs text-amber-700">
                      {t('users.status.pendingPasswordChange')}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">
                  <Link to={`/users/${user.id}`} className="text-sm text-slate-600 hover:underline">
                    {t('users.table.manage')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
