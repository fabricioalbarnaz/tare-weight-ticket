/**
 * Wire contract between core-service and the print bridge (master plan
 * §3.2, §9 Phase 5). Timestamps cross an HTTP/JSON boundary, so they're
 * ISO 8601 strings here, not `Date`.
 */
export interface PrintTicketRequest {
  ticketId: number;
  ticketNumber: number;
  plate: string;
  entryAt: string | null;
  exitAt: string | null;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  netWeightKg: number | null;
}

export interface PrintTicketResponse {
  success: boolean;
  error?: string;
}
