import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useWeighingEvents,
  type PlateReceivedEvent,
  type WeighingDirection,
  type WeighingResultEvent,
} from '../../lib/useWeighingEvents';
import { needsAttention } from '../tickets/StatusBadge';
import { TicketTable } from '../tickets/TicketTable';
import { formatWeight } from '../../lib/datetime';

/** How long the result stays on screen before the panel clears itself for the next reading. */
const AUTO_CLEAR_MS = 7000;

const CLOSING_OUTCOMES = new Set<WeighingResultEvent['outcome']>(['ticket_closed', 'ticket_closed_via_tare']);

type PanelState =
  | { phase: 'idle' }
  | { phase: 'reading'; direction: WeighingDirection; rawPlate: string }
  | { phase: 'result'; event: WeighingResultEvent };

/**
 * Whether the result deserves the alert (red) styling instead of the
 * success (green) one — anything that leaves the truck held, the ticket
 * stuck OPEN, or an anomaly, plus the existing `needsAttention` rule
 * (CLOSED with no net weight) already used by `StatusBadge` elsewhere.
 */
function isAlert(event: WeighingResultEvent): boolean {
  if (event.outcome === 'plate_unreadable') return true;
  if (event.outcome === 'anomaly_flagged') return true;
  if (event.outcome === 'exit_capture_pending') return true;
  if (event.ticket && needsAttention(event.ticket)) return true;
  if (!event.ticket && event.weightCaptureFailed) return true;
  return false;
}

/** The one translated sentence explaining a non-closing alert outcome, or null when there's nothing to say. */
function alertMessage(event: WeighingResultEvent, t: (key: string, opts?: Record<string, unknown>) => string, plate: string): string | null {
  if (event.outcome === 'plate_unreadable') {
    return t('operation.panel.alerts.plateUnreadable', { direction: t(`operation.panel.direction.${event.direction}`) });
  }
  if (event.outcome === 'anomaly_flagged') return t('operation.panel.alerts.anomaly', { plate });
  if (event.outcome === 'exit_capture_pending') return t('operation.panel.alerts.exitCaptureFailed', { plate });
  if (!CLOSING_OUTCOMES.has(event.outcome) && event.weightCaptureFailed) {
    return t('operation.panel.alerts.entryCaptureFailed', { plate });
  }
  return null;
}

/**
 * Live, self-clearing narration of each camera/scale reading for the
 * Operação screen — see docs/plans/2026-11-05-operator-live-weighing-panel.md.
 * Deliberately minimal (per user feedback 2026-11-05): just the plate and
 * the weight while reading, a done/alert indicator once resolved, and —
 * only when the reading closes a ticket — the same row `TicketTable`
 * already renders in the listing below, reused as-is instead of a custom
 * summary.
 */
export function LiveWeighingPanel() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<PanelState>({ phase: 'idle' });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useWeighingEvents(
    (event: PlateReceivedEvent) => {
      clearTimeout(clearTimer.current);
      setState({ phase: 'reading', direction: event.direction, rawPlate: event.rawPlate });
    },
    (event: WeighingResultEvent) => {
      clearTimeout(clearTimer.current);
      setState({ phase: 'result', event });
      clearTimer.current = setTimeout(() => setState({ phase: 'idle' }), AUTO_CLEAR_MS);
    },
  );

  if (state.phase === 'idle') {
    return (
      <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-500">{t('operation.panel.idle')}</p>
      </div>
    );
  }

  const alert = state.phase === 'result' && isAlert(state.event);
  const tone =
    state.phase === 'result' ? (alert ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50') : 'border-blue-200 bg-blue-50';

  const direction = state.phase === 'reading' ? state.direction : state.event.direction;
  const plateValue =
    state.phase === 'reading' ? state.rawPlate : state.event.ticket?.plate || state.event.rawPlate;
  const weightValue =
    state.phase === 'result' && state.event.weightKg !== null ? formatWeight(state.event.weightKg, i18n.language) : '';

  const closing = state.phase === 'result' && CLOSING_OUTCOMES.has(state.event.outcome);
  const message = state.phase === 'result' ? alertMessage(state.event, t, plateValue || '—') : null;

  return (
    <div role="status" aria-live="polite" className={`mb-4 rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col text-xs font-medium text-slate-500">
          {t('operation.panel.directionLabel')}
          <div className="mt-1">
            <DirectionBadge direction={direction} />
          </div>
        </div>
        <ReadonlyField label={t('operation.panel.plateLabel')} value={plateValue || '—'} mono />
        <ReadonlyField label={t('operation.panel.weightLabel')} value={weightValue || '—'} />

        {state.phase === 'reading' && (
          <span className="flex items-center gap-2 pb-1.5">
            <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            <span className="sr-only">{t('operation.panel.readingSr')}</span>
          </span>
        )}

        {state.phase === 'result' &&
          (alert ? (
            <span className="flex items-center gap-2 pb-1.5 text-red-600">
              <span aria-hidden className="text-lg leading-none">
                ⚠
              </span>
              <span className="sr-only">{t('operation.panel.alertSr')}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 pb-1.5 text-green-600">
              <span aria-hidden className="text-lg leading-none">
                ✓
              </span>
              <span className="sr-only">{t('operation.panel.doneSr')}</span>
            </span>
          ))}
      </div>

      {message && <p className="mt-2 text-xs font-medium text-red-800">{message}</p>}

      {closing && state.phase === 'result' && state.event.ticket && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <TicketTable tickets={[state.event.ticket]} readOnly />
          {alert && <p className="mt-2 text-xs font-medium text-red-800">{t('operation.panel.alerts.closedNeedsAttention')}</p>}
        </div>
      )}
    </div>
  );
}

function DirectionBadge({ direction }: { direction: WeighingDirection }) {
  const { t } = useTranslation();
  const style = direction === 'entrance' ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {t(`operation.panel.direction.${direction}`)}
    </span>
  );
}

function ReadonlyField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <label className="flex flex-col text-xs font-medium text-slate-500">
      {label}
      <input
        readOnly
        value={value}
        className={`mt-1 w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}
