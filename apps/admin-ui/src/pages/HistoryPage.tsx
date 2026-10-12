import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { TicketFilters, type TicketFiltersValue } from '../components/tickets/TicketFilters';
import { TicketTable } from '../components/tickets/TicketTable';

export function HistoryPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<TicketFiltersValue>({ status: 'ALL', search: '' });
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', 'history', filters, page],
    queryFn: () =>
      api.listTickets({
        status: filters.status === 'ALL' ? undefined : filters.status,
        search: filters.search || undefined,
        page,
        pageSize,
      }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t('history.title')}</h1>

      <TicketFilters
        value={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        searchPlaceholder={t('history.searchPlaceholder')}
      />

      {isLoading && <p className="text-sm text-slate-500">{t('dashboard.loadingTickets')}</p>}
      {isError && <p className="text-sm text-red-600">{t('dashboard.loadError')}</p>}
      {data && (
        <>
          <TicketTable tickets={data.items} />
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{t('history.pageOf', { page, totalPages, total: data.total })}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md px-3 py-1.5 ring-1 ring-slate-200 disabled:opacity-40"
              >
                {t('history.previous')}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md px-3 py-1.5 ring-1 ring-slate-200 disabled:opacity-40"
              >
                {t('history.next')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
