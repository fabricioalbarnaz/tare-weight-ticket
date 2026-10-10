import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AuditLogList } from '../components/AuditLogList';
import { EditLegForm } from '../components/forms/EditLegForm';
import { ReprintButton } from '../components/forms/ReprintButton';
import { StatusBadge } from '../components/tickets/StatusBadge';
import { formatDateTime, formatWeight } from '../lib/datetime';

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: () => api.getTicket(ticketId),
    enabled: Number.isFinite(ticketId),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading ticket…</p>;
  if (isError || !data) return <p className="text-sm text-red-600">Ticket not found.</p>;

  const { ticket, auditLog } = data;

  return (
    <div>
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← Back to dashboard
      </Link>

      <div className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Ticket #{ticket.ticketNumber} — <span className="font-mono">{ticket.plate}</span>
          </h1>
          <div className="mt-1">
            <StatusBadge ticket={ticket} />
          </div>
        </div>
        <ReprintButton ticket={ticket} />
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Entry</dt>
          <dd>{formatDateTime(ticket.entryAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Entry weight</dt>
          <dd>{formatWeight(ticket.entryWeightKg)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Exit</dt>
          <dd>{formatDateTime(ticket.exitAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Exit weight</dt>
          <dd>{formatWeight(ticket.exitWeightKg)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Net weight</dt>
          <dd className="font-medium">{formatWeight(ticket.netWeightKg)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Printed at</dt>
          <dd>{formatDateTime(ticket.printedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Created by admin</dt>
          <dd>{ticket.createdByAdmin ? 'Yes' : 'No'}</dd>
        </div>
      </dl>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EditLegForm ticket={ticket} leg="entry" />
        <EditLegForm ticket={ticket} leg="exit" />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Audit trail</h2>
      <AuditLogList entries={auditLog} />
    </div>
  );
}
