import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuditLogList } from '../components/AuditLogList';
import { EditLegForm } from '../components/forms/EditLegForm';
import { ReprintButton } from '../components/forms/ReprintButton';
import { StatusBadge } from '../components/tickets/StatusBadge';
import { formatDateTime, formatWeight } from '../lib/datetime';

export function TicketDetailPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: () => api.getTicket(ticketId),
    enabled: Number.isFinite(ticketId),
  });

  // Re-weigh links (master plan §5/§11) show the other ticket's
  // human-facing ticketNumber, not its raw id, so each is fetched once
  // the main ticket reveals which ids to look up.
  const maybeTicket = data?.ticket;
  const originalTicketQuery = useQuery({
    queryKey: ['tickets', maybeTicket?.reweighOfTicketId],
    queryFn: () => api.getTicket(maybeTicket!.reweighOfTicketId!),
    enabled: maybeTicket?.reweighOfTicketId != null,
  });
  const reweighTicketQuery = useQuery({
    queryKey: ['tickets', maybeTicket?.reweighedByTicketId],
    queryFn: () => api.getTicket(maybeTicket!.reweighedByTicketId!),
    enabled: maybeTicket?.reweighedByTicketId != null,
  });

  if (isLoading) return <p className="text-sm text-slate-500">{t('ticketDetail.loading')}</p>;
  if (isError || !data) return <p className="text-sm text-red-600">{t('ticketDetail.notFound')}</p>;

  const { ticket, auditLog } = data;

  // Plate-misread deduction close (master plan §5/§11,
  // docs/plans/2026-11-18-plate-misread-deduction-plan.md): derived from
  // the audit log rather than a ticket field, since the full log is
  // already fetched for this page.
  const deductionEntry = auditLog.find((entry) => entry.action === 'closed_by_plate_deduction');
  const misreadPlate = (deductionEntry?.payload as { misreadPlate?: string } | null)?.misreadPlate ?? '';

  // Plate-misread deduction for internal trucks (master plan §5/§11,
  // docs/plans/2026-11-23-internal-truck-plate-deduction-plan.md): same
  // idea as the deduction banner above, but for the entry or exit leg
  // being resolved via an internal truck's tare instead of an exact plate
  // match.
  const tareDeductionEntry = auditLog.find(
    (entry) =>
      entry.action === 'internal_truck_entry_via_tare_by_deduction' ||
      entry.action === 'internal_truck_exit_via_tare_by_deduction',
  );
  const tareMisreadPlate = (tareDeductionEntry?.payload as { misreadPlate?: string } | null)?.misreadPlate ?? '';

  return (
    <div>
      <Link
        to={user?.role === 'operator' ? '/operation' : '/'}
        className="text-sm text-slate-500 hover:underline"
      >
        {user?.role === 'operator' ? t('common.backToOperation') : t('common.backToDashboard')}
      </Link>

      <div className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {t('ticketDetail.ticketHeading', { number: ticket.ticketNumber })}{' '}
            <span className="font-mono">{ticket.plate}</span>
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge ticket={ticket} />
          </div>
          {ticket.reweighOfTicketId != null && (
            <p className="mt-1 text-sm text-amber-700">
              {t('ticketDetail.reweighOf', {
                number: originalTicketQuery.data?.ticket.ticketNumber ?? ticket.reweighOfTicketId,
              })}
              {' — '}
              <Link to={`/tickets/${ticket.reweighOfTicketId}`} className="underline">
                {t('common.view')}
              </Link>
            </p>
          )}
          {ticket.reweighedByTicketId != null && (
            <p className="mt-1 text-sm text-amber-700">
              {t('ticketDetail.reweighedBy', {
                number: reweighTicketQuery.data?.ticket.ticketNumber ?? ticket.reweighedByTicketId,
              })}
              {' — '}
              <Link to={`/tickets/${ticket.reweighedByTicketId}`} className="underline">
                {t('common.view')}
              </Link>
            </p>
          )}
          {deductionEntry && (
            <p className="mt-1 text-sm text-amber-700">
              {t('ticketDetail.closedByDeduction', { misreadPlate })}
            </p>
          )}
          {tareDeductionEntry && (
            <p className="mt-1 text-sm text-amber-700">
              {t('ticketDetail.closedViaTareByDeduction', { misreadPlate: tareMisreadPlate })}
            </p>
          )}
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
