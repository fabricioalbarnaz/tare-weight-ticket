import { useTranslation } from 'react-i18next';
import type { Ticket } from '../../api/types';

const STYLES: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-green-800',
  ANOMALY: 'bg-red-100 text-red-800',
  NEEDS_ATTENTION: 'bg-amber-100 text-amber-800',
};

export function needsAttention(ticket: Ticket): boolean {
  return ticket.status === 'CLOSED' && ticket.netWeightKg === null;
}

export function StatusBadge({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const key = needsAttention(ticket) ? 'NEEDS_ATTENTION' : ticket.status;

  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[key]}`}>
      {t(`tickets.status.${key}`)}
    </span>
  );
}
