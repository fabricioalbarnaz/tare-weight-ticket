import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { EditUserForm } from '../components/forms/EditUserForm';
import { ResetUserPasswordForm } from '../components/forms/ResetUserPasswordForm';
import { userErrorMessage } from '../lib/userErrors';

export function UserDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  // There's no GET /users/:id — the whole list is small (a handful of logins
  // per balance), and sharing the ['users'] query keeps both pages in sync.
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.listUsers(),
  });
  const user = data?.find((u) => u.id === Number(id));
  const isSelf = user?.id === currentUser?.id;

  const activeMutation = useMutation({
    mutationFn: (active: boolean) => api.setUserActive(Number(id), active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  if (isLoading) return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  if (!user) return <p className="text-sm text-red-600">{t('userDetail.notFound')}</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link to="/users" className="text-sm text-slate-500 hover:underline">
          {t('userDetail.backToList')}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{user.name}</h1>
        <p className="text-sm text-slate-500">
          {t('userDetail.summary', {
            username: user.username,
            role: t(`users.roles.${user.role}`),
            status: user.active ? t('users.status.active') : t('users.status.inactive'),
          })}
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">{t('userDetail.editHeading')}</h2>
        <EditUserForm user={user} isSelf={isSelf} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          {t('userDetail.resetPasswordHeading')}
        </h2>
        {isSelf ? (
          <p className="text-sm text-slate-500">
            {t('userDetail.ownPasswordNote')}{' '}
            <Link to="/account/password" className="underline">
              {t('nav.changePassword')}
            </Link>
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-500">
              {t('userDetail.resetPasswordDescription')}
            </p>
            <ResetUserPasswordForm user={user} />
          </>
        )}
      </section>

      {!isSelf && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            {t('userDetail.accessHeading')}
          </h2>
          <p className="mb-2 text-sm text-slate-500">
            {user.active
              ? t('userDetail.deactivateDescription')
              : t('userDetail.activateDescription')}
          </p>
          <button
            type="button"
            disabled={activeMutation.isPending}
            onClick={() => activeMutation.mutate(!user.active)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              user.active ? 'bg-red-700' : 'bg-slate-900'
            }`}
          >
            {user.active ? t('userDetail.deactivate') : t('userDetail.activate')}
          </button>
          {activeMutation.isError && (
            <p className="mt-2 text-xs text-red-600">
              {userErrorMessage(t, activeMutation.error, 'forms.user.saveError')}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
