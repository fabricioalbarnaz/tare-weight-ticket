import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { HardwareComponentStatus } from '../api/types';
import { formatDateTime } from '../lib/datetime';

const LABELS: Record<string, string> = {
  cameraEntrance: 'Entrance camera',
  cameraExit: 'Exit camera',
  scale: 'Scale (Digi-Tron Isis New)',
  printBridge: 'Print bridge',
  relay: 'Driver signal relay',
};

function StatusRow({ name, status }: { name: string; status: HardwareComponentStatus }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium text-slate-900">{LABELS[name] ?? name}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">Last seen: {formatDateTime(status.lastSeenAt)}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status.reachable ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {status.reachable ? 'Reachable' : 'Unreachable'}
        </span>
      </div>
    </li>
  );
}

export function HardwareStatusPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 15_000,
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Hardware status</h1>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load hardware status.</p>}

      {data && (
        <ul className="space-y-2">
          {Object.entries(data).map(([name, status]) => (
            <StatusRow key={name} name={name} status={status} />
          ))}
        </ul>
      )}
    </div>
  );
}
