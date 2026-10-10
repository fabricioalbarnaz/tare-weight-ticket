import { Link } from 'react-router-dom';
import type { Ticket } from '../../api/types';
import { formatDateTime, formatWeight } from '../../lib/datetime';
import { StatusBadge } from './StatusBadge';

export function TicketTable({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No tickets found.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
        <tr>
          <th className="py-2 pr-4">Ticket #</th>
          <th className="py-2 pr-4">Plate</th>
          <th className="py-2 pr-4">Status</th>
          <th className="py-2 pr-4">Entry</th>
          <th className="py-2 pr-4">Exit</th>
          <th className="py-2 pr-4">Net weight</th>
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
              {formatDateTime(ticket.entryAt)}
              <div className="text-xs text-slate-400">{formatWeight(ticket.entryWeightKg)}</div>
            </td>
            <td className="py-2 pr-4 text-slate-600">
              {formatDateTime(ticket.exitAt)}
              <div className="text-xs text-slate-400">{formatWeight(ticket.exitWeightKg)}</div>
            </td>
            <td className="py-2 pr-4 font-medium">{formatWeight(ticket.netWeightKg)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
