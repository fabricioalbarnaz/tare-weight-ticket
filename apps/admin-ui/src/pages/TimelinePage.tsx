import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { RawEventSource, TimelineEntry } from '../api/types';
import { formatDateTime, fromDateTimeInputValue } from '../lib/datetime';

const PAGE_SIZE = 50;

function EntryBadge({ entry, t }: { entry: TimelineEntry; t: ReturnType<typeof useTranslation>['t'] }) {
  if (entry.kind === 'audit_log') {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
        {t(`auditLog.actions.${entry.action}`, { defaultValue: entry.action })}
      </span>
    );
  }

  if (entry.discarded) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        {t(`timeline.discarded.${entry.discarded}`, { defaultValue: entry.discarded })}
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
      {t(`unresolvedEvents.sources.${entry.source as RawEventSource}`)}
    </span>
  );
}

export function TimelinePage() {
  const { t, i18n } = useTranslation();
  const [plate, setPlate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['timeline', plate, from, to, page],
    queryFn: () =>
      api.listTimeline({
        plate: plate || undefined,
        from: from ? fromDateTimeInputValue(from) : undefined,
        to: to ? fromDateTimeInputValue(to) : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const noFilterAtAll = !plate && !from && !to;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">{t('timeline.title')}</h1>
      <p className="mb-4 text-sm text-slate-500">{t('timeline.description')}</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="timeline-plate">
            {t('timeline.filters.plate')}
          </label>
          <input
            id="timeline-plate"
            type="search"
            value={plate}
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
              setPage(1);
            }}
            placeholder={t('timeline.filters.platePlaceholder')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="timeline-from">
            {t('timeline.filters.from')}
          </label>
          <input
            id="timeline-from"
            type="datetime-local"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="timeline-to">
            {t('timeline.filters.to')}
          </label>
          <input
            id="timeline-to"
            type="datetime-local"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        {noFilterAtAll && <p className="text-xs text-slate-400">{t('timeline.filters.todayNote')}</p>}
      </div>

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-red-600">{t('timeline.loadError')}</p>}

      {data && data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">{t('timeline.empty')}</p>
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="space-y-2" data-testid="timeline-list">
            {data.items.map((entry) => (
              <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">{formatDateTime(entry.timestamp, i18n.language)}</span>
                  <EntryBadge entry={entry} t={t} />
                  {entry.plate && <span className="font-mono text-sm text-slate-900">{entry.plate}</span>}
                  <span className="ml-auto">
                    {entry.ticketId !== null ? (
                      <Link to={`/tickets/${entry.ticketId}`} className="text-xs text-slate-500 underline">
                        {t('timeline.ticketLink', { ticketId: entry.ticketId })}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">{t('timeline.noTicket')}</span>
                    )}
                  </span>
                </div>
                {entry.kind === 'audit_log' && (
                  <div className="mt-1 text-xs text-slate-500">{t('auditLog.by', { actor: entry.actor })}</div>
                )}
                {entry.payload !== null && entry.payload !== undefined && (
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{t('timeline.pageOf', { page, totalPages, total: data.total })}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md px-3 py-1.5 ring-1 ring-slate-200 disabled:opacity-40"
              >
                {t('timeline.previous')}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md px-3 py-1.5 ring-1 ring-slate-200 disabled:opacity-40"
              >
                {t('timeline.next')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
