import { useTranslation } from 'react-i18next';
import type { TicketStatus } from '../../api/types';

const STATUS_OPTIONS: Array<{ labelKey: string; value: TicketStatus | 'ALL' }> = [
  { labelKey: 'tickets.status.ALL', value: 'ALL' },
  { labelKey: 'tickets.status.OPEN', value: 'OPEN' },
  { labelKey: 'tickets.status.CLOSED', value: 'CLOSED' },
  { labelKey: 'tickets.status.ANOMALY', value: 'ANOMALY' },
];

export interface TicketFiltersValue {
  status: TicketStatus | 'ALL';
  search: string;
}

export function TicketFilters({
  value,
  onChange,
  searchPlaceholder,
}: {
  value: TicketFiltersValue;
  onChange: (value: TicketFiltersValue) => void;
  searchPlaceholder?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex gap-1">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange({ ...value, status: option.value })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              value.status === option.value
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
            }`}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        placeholder={searchPlaceholder ?? t('tickets.filters.searchPlaceholder')}
        className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}
