import type { AuditLogEntry } from '../api/types';
import { formatDateTime } from '../lib/datetime';

const ACTION_LABELS: Record<string, string> = {
  entry_captured: 'Entry captured',
  entry_capture_failed: 'Entry capture failed',
  entry_overwritten: 'Entry overwritten (re-trigger)',
  exit_captured: 'Exit captured',
  exit_capture_failed: 'Exit capture failed',
  anomaly_flagged: 'Flagged as anomaly',
  manual_edit: 'Manually edited',
  manual_create: 'Manually created',
  reprint: 'Reprinted',
};

export function AuditLogList({ entries }: { entries: AuditLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No audit log entries yet.</p>;
  }

  return (
    <ul className="space-y-3" data-testid="audit-log">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-900">
              {ACTION_LABELS[entry.action] ?? entry.action}
            </span>
            <span className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">by {entry.actor}</div>
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
