import type { TicketStatus } from '../../api/types';

const STATUS_OPTIONS: Array<{ label: string; value: TicketStatus | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Open', value: 'OPEN' },
  { label: 'Closed', value: 'CLOSED' },
  { label: 'Anomaly', value: 'ANOMALY' },
];

export interface TicketFiltersValue {
  status: TicketStatus | 'ALL';
  search: string;
}

export function TicketFilters({
  value,
  onChange,
  searchPlaceholder = 'Search by plate…',
}: {
  value: TicketFiltersValue;
  onChange: (value: TicketFiltersValue) => void;
  searchPlaceholder?: string;
}) {
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
            {option.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        placeholder={searchPlaceholder}
        className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}
