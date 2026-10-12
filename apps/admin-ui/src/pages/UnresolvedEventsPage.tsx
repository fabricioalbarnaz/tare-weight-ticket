import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { RawEventSource } from '../api/types';
import { formatDateTime } from '../lib/datetime';

function guessPlate(rawPayload: unknown): string {
  if (rawPayload && typeof rawPayload === 'object' && 'rawPlate' in rawPayload) {
    const value = (rawPayload as { rawPlate?: unknown }).rawPlate;
    if (typeof value === 'string') return value;
  }
  return '';
}

function guessCameraId(rawPayload: unknown): string {
  if (rawPayload && typeof rawPayload === 'object' && 'cameraId' in rawPayload) {
    const value = (rawPayload as { cameraId?: unknown }).cameraId;
    if (typeof value === 'string') return value;
  }
  return '—';
}

export function UnresolvedEventsPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['unresolved-events'],
    queryFn: () => api.listUnresolvedEvents({ pageSize: 50 }),
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">{t('unresolvedEvents.title')}</h1>
      <p className="mb-4 text-sm text-slate-500">{t('unresolvedEvents.description')}</p>

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-red-600">{t('unresolvedEvents.loadError')}</p>}

      {data && data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">{t('unresolvedEvents.empty')}</p>
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-2">
          {data.items.map((event) => (
            <li
              key={event.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm"
            >
              <div>
                <span className="font-medium text-slate-900">
                  {t(`unresolvedEvents.sources.${event.source as RawEventSource}`)}
                </span>
                <span className="ml-2 text-slate-500">
                  {formatDateTime(event.receivedAt, i18n.language)}
                </span>
                <div className="text-xs text-slate-500">
                  {t('unresolvedEvents.camera', { cameraId: guessCameraId(event.rawPayload) })}
                  {guessPlate(event.rawPayload) &&
                    t('unresolvedEvents.rawPlate', { plate: guessPlate(event.rawPayload) })}
                </div>
              </div>
              <Link
                to={`/tickets/new?plate=${encodeURIComponent(guessPlate(event.rawPayload).toUpperCase())}`}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
              >
                {t('unresolvedEvents.createTicket')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
