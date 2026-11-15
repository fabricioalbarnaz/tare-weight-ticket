import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { CreateTicketForm } from '../components/forms/CreateTicketForm';

export function CreateTicketPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const defaultPlate = searchParams.get('plate') ?? '';

  return (
    <div className="max-w-md">
      <Link
        to={user?.role === 'operator' ? '/operation' : '/'}
        className="text-sm text-slate-500 hover:underline"
      >
        {user?.role === 'operator' ? t('common.backToOperation') : t('common.backToDashboard')}
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold text-slate-900">
        {t('createTicket.heading')}
      </h1>
      <p className="mb-4 text-sm text-slate-500">{t('createTicket.description')}</p>
      <CreateTicketForm defaultPlate={defaultPlate} />
    </div>
  );
}
