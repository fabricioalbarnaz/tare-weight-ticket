import { useTranslation } from 'react-i18next';
import type { AuditLogEntry } from '../api/types';
import { formatDateTime } from '../lib/datetime';

export function AuditLogList({ entries }: { entries: AuditLogEntry[] }) {
  const { t, i18n } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">{t('auditLog.empty')}</p>;
  }

  return (
    <ul className="space-y-3" data-testid="audit-log">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-900">
              {t(`auditLog.actions.${entry.action}`, { defaultValue: entry.action })}
            </span>
            <span className="text-xs text-slate-500">
              {formatDateTime(entry.createdAt, i18n.language)}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t('auditLog.by', { actor: entry.actor })}
          </div>
          {entry.payload !== null && entry.payload !== undefined && (
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
