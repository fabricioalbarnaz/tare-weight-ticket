import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
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

const SOURCE_LABELS: Record<string, string> = {
  camera_entrance: 'Entrance camera',
  camera_exit: 'Exit camera',
  scale: 'Scale',
};

export function UnresolvedEventsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['unresolved-events'],
    queryFn: () => api.listUnresolvedEvents({ pageSize: 50 }),
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Unresolved camera events</h1>
      <p className="mb-4 text-sm text-slate-500">
        Camera events the automatic flow could not turn into a ticket (unreadable plate). Create
        the matching ticket by hand once you know which truck it was.
      </p>

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load unresolved events.</p>}

      {data && data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">No unresolved events. 🎉</p>
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
                  {SOURCE_LABELS[event.source] ?? event.source}
                </span>
                <span className="ml-2 text-slate-500">{formatDateTime(event.receivedAt)}</span>
                <div className="text-xs text-slate-500">
                  Camera: {guessCameraId(event.rawPayload)}
                  {guessPlate(event.rawPayload) && ` · raw plate: "${guessPlate(event.rawPayload)}"`}
                </div>
              </div>
              <Link
                to={`/tickets/new?plate=${encodeURIComponent(guessPlate(event.rawPayload).toUpperCase())}`}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
              >
                Create ticket
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
