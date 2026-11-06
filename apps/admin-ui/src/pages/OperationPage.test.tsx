import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { loginAsAdmin } from '../test-helpers';
import { store } from '../api/mocks/fixtures';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners: Record<string, Array<() => void>> = {};

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  close() {}

  emit(type: string) {
    for (const listener of this.listeners[type] ?? []) listener();
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
}

describe('OperationPage', () => {
  it('lists tickets read-only, with no link to the detail/edit page', async () => {
    await goToOperationPage();

    await waitFor(() => {
      expect(screen.getByText('ABC1234')).toBeInTheDocument();
      expect(screen.getByText('XYZ9876')).toBeInTheDocument();
    });

    expect(screen.queryByText('#1001')?.closest('a')).toBeNull();
    expect(screen.queryByRole('button', { name: /new ticket/i })).not.toBeInTheDocument();
  });

  // Full behavior (plate received → reading → result, closing/tare/alert
  // rendering, auto-clear) is covered in LiveWeighingPanel.test.tsx — just
  // a smoke check here that it's actually mounted on this page.
  it('renders the live weighing panel', async () => {
    await goToOperationPage();

    expect(await screen.findByText(/waiting for the next weighing/i)).toBeInTheDocument();
  });

  it('refetches the listing when the server pushes a ticket-changed event', async () => {
    await goToOperationPage();

    await waitFor(() => {
      expect(screen.getByText('ABC1234')).toBeInTheDocument();
    });

    // Both `useTicketEvents` (this page) and the live weighing panel's own
    // hook open a connection to the same URL — broadcast to every one of
    // them rather than assuming there's only one.
    const streams = FakeEventSource.instances.filter((instance) => instance.url.includes('/tickets/stream'));
    expect(streams.length).toBeGreaterThan(0);

    store.tickets.push({
      id: 999,
      ticketNumber: 9999,
      plate: 'NEW0001',
      status: 'OPEN',
      entryAt: new Date().toISOString(),
      entryWeightKg: 15000,
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
    });
    for (const stream of streams) stream.emit('ticket-changed');

    await waitFor(() => {
      expect(screen.getByText('NEW0001')).toBeInTheDocument();
    });
  });
});
