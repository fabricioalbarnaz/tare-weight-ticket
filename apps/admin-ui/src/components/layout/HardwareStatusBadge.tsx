import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

export function HardwareStatusBadge() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 15_000,
  });

  if (!data) return null;

  const components = Object.values(data);
  const downCount = components.filter((c) => !c.reachable).length;
  const ok = downCount === 0;

  return (
    <Link
      to="/status"
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
      title={t('hardwareStatus.badge.title')}
    >
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-600' : 'bg-red-600'}`} />
      {ok ? t('hardwareStatus.badge.allOk') : t('hardwareStatus.badge.someDown', { count: downCount })}
    </Link>
  );
}
