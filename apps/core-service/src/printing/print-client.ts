import type { PrintTicketRequest, PrintTicketResponse } from '@tare/shared';

export interface PrintClient {
  /** Never rejects — a print bridge/printer failure must not break ticket processing (Admin UI handles manual reprint). */
  printTicket(ticket: PrintTicketRequest): Promise<PrintTicketResponse>;
  /** Pings the print bridge's own `/health` route, for the Admin UI's hardware status panel. Never rejects. */
  checkHealth(): Promise<{ reachable: boolean }>;
}

export interface HttpPrintClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export function createHttpPrintClient(options: HttpPrintClientOptions): PrintClient {
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async printTicket(ticket) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(new URL('/print', options.baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(ticket),
          signal: controller.signal,
        });

        const body = (await response.json()) as PrintTicketResponse;
        if (!response.ok) {
          return { success: false, error: body.error ?? `Print bridge responded with HTTP ${response.status}` };
        }
        return body;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timer);
      }
    },

    async checkHealth() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(new URL('/health', options.baseUrl), { signal: controller.signal });
        return { reachable: response.ok };
      } catch {
        return { reachable: false };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
