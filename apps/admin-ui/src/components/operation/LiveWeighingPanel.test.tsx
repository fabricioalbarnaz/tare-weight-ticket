import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test-utils';
import { loginAsAdmin } from '../../test-helpers';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners: Record<string, Array<(event: MessageEvent) => void>> = {};

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  close() {}

  emit(type: string, data?: unknown) {
    const event = { data: data === undefined ? '' : JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

/** Both `useTicketEvents` and `useWeighingEvents` open their own connection to the same URL — broadcast to every one of them. */
function emitToStreams(type: string, data?: unknown) {
  for (const instance of FakeEventSource.instances) {
    if (instance.url.includes('/tickets/stream')) instance.emit(type, data);
  }
}

let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  originalEventSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource as typeof EventSource;
});

async function goToOperationPage() {
  renderApp({ route: '/login' });
  const user = await loginAsAdmin();
  await user.click(await screen.findByRole('link', { name: /operation/i }));
  // Wait for the stream connection(s) to attach before emitting.
  await waitFor(() => {
    expect(FakeEventSource.instances.some((instance) => instance.url.includes('/tickets/stream'))).toBe(true);
  });
}

function plateField(): HTMLInputElement {
  return screen.getByLabelText(/weighing plate/i) as HTMLInputElement;
}

function weightField(): HTMLInputElement {
  return screen.getByLabelText(/^weight$/i) as HTMLInputElement;
}

describe('LiveWeighingPanel', () => {
  it('shows the idle message before any reading arrives', async () => {
    await goToOperationPage();

    expect(await screen.findByText(/waiting for the next weighing/i)).toBeInTheDocument();
  });

  it('shows the plate while reading (weight still empty, spinner visible), then the weight once captured', async () => {
    await goToOperationPage();

    emitToStreams('weighing-plate-received', { direction: 'entrance', rawPlate: 'ABC1234' });
    await waitFor(() => expect(plateField().value).toBe('ABC1234'));
    expect(weightField().value).toBe('—');
    expect(screen.getByText(/reading weight/i)).toBeInTheDocument();

    emitToStreams('weighing-result', {
      direction: 'entrance',
      rawPlate: 'ABC1234',
      weightKg: 18500,
      weightCaptureFailed: false,
      outcome: 'ticket_opened',
      ticket: {
        id: 1,
        ticketNumber: 1,
        plate: 'ABC1234',
        status: 'OPEN',
        entryAt: new Date().toISOString(),
        entryWeightKg: 18500,
        entryCameraId: 'cam-entrance-1',
        entryCaptureFailed: false,
        exitAt: null,
        exitWeightKg: null,
        exitCameraId: null,
        exitCaptureFailed: false,
        netWeightKg: null,
        printedAt: null,
        createdByAdmin: false,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    await waitFor(() => expect(weightField().value).toMatch(/18,500|18500/));
    expect(plateField().value).toBe('ABC1234');
    expect(screen.getByText(/reading complete/i)).toBeInTheDocument();
  });

  it('shows the ticket (as it appears in the listing) when the reading closes it via an internal truck tare', async () => {
    await goToOperationPage();

    emitToStreams('weighing-result', {
      direction: 'entrance',
      rawPlate: 'INT0001',
      weightKg: 21000,
      weightCaptureFailed: false,
      outcome: 'ticket_closed_via_tare',
      ticket: {
        id: 2,
        ticketNumber: 9999,
        plate: 'INT0001',
        status: 'CLOSED',
        entryAt: new Date().toISOString(),
        entryWeightKg: 21000,
        entryCameraId: 'cam-entrance-1',
        entryCaptureFailed: false,
        exitAt: new Date().toISOString(),
        exitWeightKg: 9000,
        exitCameraId: null,
        exitCaptureFailed: false,
        netWeightKg: 12000,
        printedAt: null,
        createdByAdmin: false,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    await waitFor(() => expect(plateField().value).toBe('INT0001'));
    expect(weightField().value).toMatch(/21,000|21000/);

    // The closing case additionally shows the ticket the same way the
    // listing below does, via the same `TicketTable` component.
    expect(screen.getByText('#9999')).toBeInTheDocument();
    expect(screen.getAllByText(/INT0001/).length).toBeGreaterThan(0);
    expect(screen.getByText(/9,000|9000/)).toBeInTheDocument();
    expect(screen.getByText(/12,000|12000/)).toBeInTheDocument();
  });

  it('shows an alert when the plate cannot be read', async () => {
    await goToOperationPage();

    emitToStreams('weighing-result', {
      direction: 'exit',
      rawPlate: '',
      weightKg: 15000,
      weightCaptureFailed: false,
      outcome: 'plate_unreadable',
    });

    expect(await screen.findByText(/plate not recognized/i)).toBeInTheDocument();
  });

  it('clears back to idle a few seconds after showing the result', async () => {
    await goToOperationPage();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      emitToStreams('weighing-result', {
        direction: 'exit',
        rawPlate: 'GHOST01',
        weightKg: 15000,
        weightCaptureFailed: false,
        outcome: 'anomaly_flagged',
        ticket: {
          id: 3,
          ticketNumber: 3,
          plate: 'GHOST01',
          status: 'ANOMALY',
          entryAt: null,
          entryWeightKg: null,
          entryCameraId: null,
          entryCaptureFailed: false,
          exitAt: new Date().toISOString(),
          exitWeightKg: 15000,
          exitCameraId: 'cam-exit-1',
          exitCaptureFailed: false,
          netWeightKg: null,
          printedAt: null,
          createdByAdmin: false,
          notes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      expect(await screen.findByText(/flagged as an anomaly/i)).toBeInTheDocument();

      vi.advanceTimersByTime(7000);

      await waitFor(() => {
        expect(screen.getByText(/waiting for the next weighing/i)).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
