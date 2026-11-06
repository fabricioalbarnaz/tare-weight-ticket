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
 * Read-only ticket listing for the future "operador" profile (master plan —
 * no such role exists yet, so this is reachable by the current admin login
 * too). No create/edit/detail actions, unlike the dashboard — view only.
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
      {data && <TicketTable tickets={data.items} readOnly />}
    </div>
  );
}
