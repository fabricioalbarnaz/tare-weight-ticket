import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useTicketEvents } from '../lib/useTicketEvents';
import { TicketFilters, type TicketFiltersValue } from '../components/tickets/TicketFilters';
import { TicketTable } from '../components/tickets/TicketTable';
import { LiveWeighingPanel } from '../components/operation/LiveWeighingPanel';

function startOfTodayIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * Ticket listing reachable by both profiles. Unlike the dashboard it has no
 * "new ticket" action, but an operator can open a ticket's detail page from
 * here to edit its entry/exit leg or reprint it (2026-11-14).
 */
export function OperationPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<TicketFiltersValue>({ status: 'ALL', search: '' });

  useTicketEvents();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', 'operation', filters],
    queryFn: () =>
      api.listTickets({
        status: filters.status === 'ALL' ? undefined : filters.status,
        search: filters.search || undefined,
        from: startOfTodayIso(),
        pageSize: 100,
      }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{t('operation.title')}</h1>
      </div>

      <LiveWeighingPanel />

      <TicketFilters value={filters} onChange={setFilters} />

      {isLoading && <p className="text-sm text-slate-500">{t('operation.loadingTickets')}</p>}
      {isError && <p className="text-sm text-red-600">{t('operation.loadError')}</p>}
      {data && <TicketTable tickets={data.items} />}
    </div>
  );
}
