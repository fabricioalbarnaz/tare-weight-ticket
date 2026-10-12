import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AuditLogList } from '../components/AuditLogList';
import { EditLegForm } from '../components/forms/EditLegForm';
import { ReprintButton } from '../components/forms/ReprintButton';
import { StatusBadge } from '../components/tickets/StatusBadge';
import { formatDateTime, formatWeight } from '../lib/datetime';

export function TicketDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: () => api.getTicket(ticketId),
    enabled: Number.isFinite(ticketId),
  });

  if (isLoading) return <p className="text-sm text-slate-500">{t('ticketDetail.loading')}</p>;
  if (isError || !data) return <p className="text-sm text-red-600">{t('ticketDetail.notFound')}</p>;

  const { ticket, auditLog } = data;

  return (
    <div>
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        {t('common.backToDashboard')}
      </Link>

      <div className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {t('ticketDetail.ticketHeading', { number: ticket.ticketNumber })}{' '}
            <span className="font-mono">{ticket.plate}</span>
          </h1>
          <div className="mt-1">
            <StatusBadge ticket={ticket} />
          </div>
        </div>
        <ReprintButton ticket={ticket} />
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.entry')}</dt>
          <dd>{formatDateTime(ticket.entryAt, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.entryWeight')}</dt>
          <dd>{formatWeight(ticket.entryWeightKg, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.exit')}</dt>
          <dd>{formatDateTime(ticket.exitAt, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.exitWeight')}</dt>
          <dd>{formatWeight(ticket.exitWeightKg, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.netWeight')}</dt>
          <dd className="font-medium">{formatWeight(ticket.netWeightKg, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.printedAt')}</dt>
          <dd>{formatDateTime(ticket.printedAt, i18n.language)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{t('ticketDetail.createdByAdmin')}</dt>
          <dd>{ticket.createdByAdmin ? t('common.yes') : t('common.no')}</dd>
        </div>
      </dl>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EditLegForm ticket={ticket} leg="entry" />
        <EditLegForm ticket={ticket} leg="exit" />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('ticketDetail.auditTrail')}</h2>
      <AuditLogList entries={auditLog} />
    </div>
  );
}
