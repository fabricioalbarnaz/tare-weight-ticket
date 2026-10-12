import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { TicketFilters, type TicketFiltersValue } from '../components/tickets/TicketFilters';
import { TicketTable } from '../components/tickets/TicketTable';

function startOfTodayIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<TicketFiltersValue>({ status: 'ALL', search: '' });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', 'today', filters],
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
        <h1 className="text-xl font-semibold text-slate-900">{t('dashboard.title')}</h1>
        <Link
          to="/tickets/new"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {t('dashboard.newTicket')}
        </Link>
      </div>

      <TicketFilters value={filters} onChange={setFilters} />

      {isLoading && <p className="text-sm text-slate-500">{t('dashboard.loadingTickets')}</p>}
      {isError && <p className="text-sm text-red-600">{t('dashboard.loadError')}</p>}
      {data && <TicketTable tickets={data.items} />}
    </div>
  );
}
