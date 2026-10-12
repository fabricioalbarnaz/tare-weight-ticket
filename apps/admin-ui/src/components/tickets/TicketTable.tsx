import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Ticket } from '../../api/types';
import { formatDateTime, formatWeight } from '../../lib/datetime';
import { StatusBadge } from './StatusBadge';

export function TicketTable({ tickets }: { tickets: Ticket[] }) {
  const { t, i18n } = useTranslation();

  if (tickets.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">{t('tickets.table.empty')}</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
        <tr>
          <th className="py-2 pr-4">{t('tickets.table.ticketNumber')}</th>
          <th className="py-2 pr-4">{t('tickets.table.plate')}</th>
          <th className="py-2 pr-4">{t('tickets.table.status')}</th>
          <th className="py-2 pr-4">{t('tickets.table.entry')}</th>
          <th className="py-2 pr-4">{t('tickets.table.exit')}</th>
          <th className="py-2 pr-4">{t('tickets.table.netWeight')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {tickets.map((ticket) => (
          <tr key={ticket.id} className="hover:bg-slate-50">
            <td className="py-2 pr-4">
              <Link to={`/tickets/${ticket.id}`} className="font-medium text-slate-900 hover:underline">
                #{ticket.ticketNumber}
              </Link>
            </td>
            <td className="py-2 pr-4 font-mono">{ticket.plate}</td>
            <td className="py-2 pr-4">
              <StatusBadge ticket={ticket} />
            </td>
            <td className="py-2 pr-4 text-slate-600">
              {formatDateTime(ticket.entryAt, i18n.language)}
              <div className="text-xs text-slate-400">
                {formatWeight(ticket.entryWeightKg, i18n.language)}
              </div>
            </td>
            <td className="py-2 pr-4 text-slate-600">
              {formatDateTime(ticket.exitAt, i18n.language)}
              <div className="text-xs text-slate-400">
                {formatWeight(ticket.exitWeightKg, i18n.language)}
              </div>
            </td>
            <td className="py-2 pr-4 font-medium">
              {formatWeight(ticket.netWeightKg, i18n.language)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
