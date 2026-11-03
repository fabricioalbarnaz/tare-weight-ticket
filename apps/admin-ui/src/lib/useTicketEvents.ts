import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Subscribes to the core-service SSE ticket stream and invalidates the
 * `['tickets']` query cache whenever a ticket is created or updated, so
 * listings refetch live instead of requiring a manual reload. The browser's
 * `EventSource` handles reconnection on its own.
 */
export function useTicketEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/admin/tickets/stream');

    const handleChanged = () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    };
    source.addEventListener('ticket-changed', handleChanged);

    return () => {
      source.removeEventListener('ticket-changed', handleChanged);
      source.close();
    };
  }, [queryClient]);
}
