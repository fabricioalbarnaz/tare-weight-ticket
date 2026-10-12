import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { HardwareComponentStatus, HardwareStatus } from '../api/types';
import { formatDateTime } from '../lib/datetime';

function StatusRow({
  name,
  status,
}: {
  name: keyof HardwareStatus;
  status: HardwareComponentStatus;
}) {
  const { t, i18n } = useTranslation();

  return (
    <li className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium text-slate-900">{t(`hardwareStatus.components.${name}`)}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">
          {t('hardwareStatus.lastSeen', { value: formatDateTime(status.lastSeenAt, i18n.language) })}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status.reachable ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {status.reachable ? t('hardwareStatus.reachable') : t('hardwareStatus.unreachable')}
        </span>
      </div>
    </li>
  );
}

export function HardwareStatusPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 15_000,
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t('hardwareStatus.title')}</h1>

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-red-600">{t('hardwareStatus.loadError')}</p>}

      {data && (
        <ul className="space-y-2">
          {(Object.entries(data) as Array<[keyof HardwareStatus, HardwareComponentStatus]>).map(
            ([name, status]) => (
              <StatusRow key={name} name={name} status={status} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
