import { normalizePlate } from '../domain/plate.js';
import type { ScaleReadFailureReason } from '../scale/types.js';
import type { CameraReadQuality } from '../camera/normalize.js';
import type { ActiveTare, TruckRepository } from '../trucks/repository.js';
import type { TicketConfig } from './config.js';
import { findPlateDeductionMatch, type PlateDeductionCandidate } from './plate-deduction.js';
import type { Ticket, TicketRepository } from './repository.js';

/**
 * Pairs every item with a synthetic all-100 `ownCharConfidence` — used for
 * sources that should be treated as ground truth (a registered truck
 * plate is never itself "misread", only the camera reading can be) — see
 * docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md.
 */
function withGroundTruthConfidence<T extends { plate: string }>(items: T[]): (T & PlateDeductionCandidate)[] {
  return items.map((item) => ({ ...item, ownCharConfidence: Array(item.plate.length).fill(100) }));
}

/**
 * Pairs every OPEN ticket with its stored entrance confidence (parsed),
 * or `undefined` when it has none — a ticket created before this feature,
 * or by an admin with no camera reading at all. `undefined` triggers the
 * single-sided fallback inside `findPlateDeductionMatch`.
 */
function withStoredEntryConfidence(tickets: Ticket[]): (Ticket & PlateDeductionCandidate)[] {
  return tickets.map((ticket) => ({
    ...ticket,
    ownCharConfidence: ticket.entryPlateCharBelieve
      ? (JSON.parse(ticket.entryPlateCharBelieve) as number[])
      : undefined,
  }));
}

export const TICKET_AUDIT_ACTIONS = {
  ENTRY_CAPTURED: 'entry_captured',
  ENTRY_CAPTURE_FAILED: 'entry_capture_failed',
  EXIT_CAPTURED: 'exit_captured',
  EXIT_CAPTURE_FAILED: 'exit_capture_failed',
  ANOMALY_FLAGGED: 'anomaly_flagged',
  /** The entry leg was filled from a registered internal truck's active conjunto tare, not a real camera/scale event — see master plan §11. */
  ENTRY_VIA_TARE: 'internal_truck_entry_via_tare',
  /** The exit leg was filled from a registered internal truck's active conjunto tare — see master plan §11. */
  EXIT_VIA_TARE: 'internal_truck_exit_via_tare',
  /** Same as ENTRY_VIA_TARE, but the truck was found by plate-misread deduction, not an exact plate match — see master plan §5/§11 "Plate-misread deduction for internal trucks". */
  ENTRY_VIA_TARE_BY_DEDUCTION: 'internal_truck_entry_via_tare_by_deduction',
  /** Same as EXIT_VIA_TARE, but the truck was found by plate-misread deduction, not an exact plate match. */
  EXIT_VIA_TARE_BY_DEDUCTION: 'internal_truck_exit_via_tare_by_deduction',
  /** A new ticket created to correct a prior exit weight, reusing a CLOSED ticket's entry — see master plan §5/§11 "Exit re-weigh". */
  REWEIGH_CREATED: 'reweigh_ticket_created',
  /** The original ticket superseded by a REWEIGH_CREATED ticket — the inverse side of that action. */
  REWEIGHED: 'ticket_reweighed',
  /** An OPEN ticket closed by the plate-misread deduction match instead of filing an ANOMALY — see master plan §5/§11 "Plate-misread deduction close". */
  CLOSED_BY_PLATE_DEDUCTION: 'closed_by_plate_deduction',
} as const;

export interface EntranceReadingInput {
  rawPlate: string;
  cameraId: string;
  /** Camera-reported event time — forensic only, see `weighingFinishedAt`. */
  timestamp: Date;
  /** Camera's own read confidence — stored in the camera raw event for analysis only. */
  readQuality?: CameraReadQuality;
  /**
   * Server clock time right after the scale read settled (or gave up) —
   * i.e. when the weighing itself finished, not when the truck crossed
   * the camera. This is the authoritative source for `entryAt` — the
   * camera's own `timestamp` is not trusted for it, since the camera's
   * clock can drift or be misconfigured independently of the server.
   */
  weighingFinishedAt: Date;
  /** The stable weight read from the scale, or null if the read timed out. */
  weightKg: number | null;
  /** True when the scale never reported a stable weight within the timeout. */
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true — see ScaleReadResult. */
  failureReason?: ScaleReadFailureReason;
  waitedMs?: number;
  /** Which scale-read attempt this resolved on (or exhausted on) — see ScaleReadResult. */
  attemptsUsed?: number;
}

export type EntranceResult =
  | { kind: 'ticket_opened'; ticket: Ticket }
  /** Internal truck (master plan §11): the entrance leg was the real weighing, the exit leg came from the active conjunto's tare — ticket closes immediately. */
  | { kind: 'ticket_closed_via_tare'; ticket: Ticket }
  /** Same as `ticket_closed_via_tare`, but the truck was found by plate-misread deduction — no exact-plate active tare, but a single-character-different one's confidence confirmed the misread (master plan §5/§11 "Plate-misread deduction for internal trucks"). */
  | { kind: 'ticket_closed_via_tare_by_deduction'; ticket: Ticket; misreadPlate: string }
  | { kind: 'plate_unreadable' };

export interface ExitReadingInput {
  rawPlate: string;
  cameraId: string;
  /** Camera-reported event time — forensic only, see `weighingFinishedAt`. */
  timestamp: Date;
  /** Camera's own read confidence — stored in the camera raw event for analysis only. */
  readQuality?: CameraReadQuality;
  /**
   * Server clock time right after the scale read settled (or gave up) —
   * i.e. when the weighing itself finished, not when the truck crossed
   * the camera. This is the authoritative source for `exitAt` — see the
   * matching note on `EntranceReadingInput.weighingFinishedAt`.
   */
  weighingFinishedAt: Date;
  weightKg: number | null;
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true — see ScaleReadResult. */
  failureReason?: ScaleReadFailureReason;
  waitedMs?: number;
  /** Which scale-read attempt this resolved on (or exhausted on) — see ScaleReadResult. */
  attemptsUsed?: number;
}

export type ExitResult =
  | { kind: 'ticket_closed'; ticket: Ticket }
  | { kind: 'exit_capture_pending'; ticket: Ticket }
  | { kind: 'anomaly_flagged'; ticket: Ticket }
  /** Re-weigh correction (master plan §5/§11): no OPEN ticket for the plate, but a recently CLOSED one existed — a new ticket was created reusing its entry and closed with this new exit weight. */
  | { kind: 'ticket_reweighed'; ticket: Ticket; originalTicketId: number }
  /** Plate-misread deduction close (master plan §5/§11): no exact-plate OPEN ticket, but a single-character-different OPEN ticket's per-character ANPR confidence confirmed the misread — that ticket was closed with this exit weight instead of filing an ANOMALY. */
  | { kind: 'ticket_closed_by_deduction'; ticket: Ticket; misreadPlate: string }
  /** Same idea as `ticket_closed_via_tare` on the entrance side, but for exit: no exact-plate active tare, but a single-character-different one's confidence confirmed the misread (master plan §5/§11 "Plate-misread deduction for internal trucks"). Gets its own kind here (unlike the exact-match tare-exit case, which reuses `ticket_closed`) so it's just as traceable as the entrance side. */
  | { kind: 'ticket_closed_via_tare_by_deduction'; ticket: Ticket; misreadPlate: string }
  | { kind: 'plate_unreadable' };

export interface SessionService {
  handleEntranceReading(input: EntranceReadingInput): EntranceResult;
  handleExitReading(input: ExitReadingInput): ExitResult;
  /**
   * Read-only check for whether an exit reading for `rawPlate` could
   * resolve to *any* ticket action right now: an exact `OPEN` match, an
   * active internal-truck tare, a re-weigh candidate (recently `CLOSED`,
   * within the re-weigh window), or a plate-misread deduction candidate
   * (an `OPEN` ticket within the deduction window whose plate this is a
   * confirmed single-character misread of). Mirrors the same decision
   * tree `handleExitReading` uses below, but without requiring a captured
   * weight — none of those four checks need one. Used by
   * `camera/routes.ts` to decide, *before* starting a scale capture,
   * whether an exit reading is worth weighing at all — see master plan
   * §5/§11 "Exit reading discarded when no ticket can be resolved" and
   * docs/plans/2026-11-23-exit-no-ticket-discard-plan.md. An
   * unreliable/unreadable plate (normalizes to `''`) always returns
   * `true` — not this check's concern, left to the existing
   * `plate_unreadable` path.
   */
  hasResolvableExitCandidate(
    rawPlate: string,
    readQuality: CameraReadQuality | undefined,
    now: Date,
  ): boolean;
}

/**
 * The `camera_entrance`/`camera_exit` raw-event payload for a reading:
 * the plate/camera/timestamp plus the camera's read-quality fields
 * (`readPlate`, `confidenceLevel`, `plateCharBelieve`), flat so they're
 * queryable with `json_extract` — see
 * docs/plans/2026-11-10-store-anpr-confidence-plan.md. `plate` is omitted
 * for an unreadable read.
 */
function cameraRawPayload(
  input: EntranceReadingInput | ExitReadingInput,
  plate?: string,
): Record<string, unknown> {
  return {
    rawPlate: input.rawPlate,
    ...(plate !== undefined ? { plate } : {}),
    cameraId: input.cameraId,
    timestamp: input.timestamp,
    ...input.readQuality,
  };
}

/** `resolveActiveTare`'s result when the match came from plate-misread deduction, not an exact lookup. */
interface ActiveTareDeduction {
  misreadPlate: string;
  diffIndex: number;
  matchedBy: 'format' | 'confidence' | 'fallback';
  entryCharConfidence: number | null;
  exitCharConfidence: number;
}

interface ResolvedActiveTare {
  tare: ActiveTare;
  /** The truck's real registered plate — use this for the ticket, never the (possibly misread) reading. */
  plate: string;
  /** Set only when `tare` was found by deduction rather than an exact plate match. */
  deduction?: ActiveTareDeduction;
}

export function createSessionService(
  repo: TicketRepository,
  truckRepo: TruckRepository,
  ticketConfig: TicketConfig,
): SessionService {
  /**
   * Resolves `plate` to an internal truck's active tare, by exact match
   * first and, failing that, by the same plate-misread deduction rule as
   * `CLOSED_BY_PLATE_DEDUCTION` — checked against every truck currently
   * holding an active tare (no time window: a tare is either active now or
   * not, there's no "age" to bound) — see master plan §5/§11
   * "Plate-misread deduction for internal trucks" and
   * docs/plans/2026-11-23-internal-truck-plate-deduction-plan.md. An
   * ambiguous deduction match (more than one equally-plausible truck) is
   * `undefined`, same as no match at all — callers already have a
   * well-defined "not an internal truck" fallback.
   */
  function resolveActiveTare(
    plate: string,
    readQuality: CameraReadQuality | undefined,
  ): ResolvedActiveTare | undefined {
    const exact = truckRepo.findActiveTareByPlate(plate);
    if (exact) return { tare: exact, plate };

    const match = findPlateDeductionMatch(withGroundTruthConfidence(truckRepo.listActiveTares()), plate, readQuality);
    if (!match) return undefined;

    // The registered plate is ground truth regardless of `match.winner` —
    // truck master data is never auto-corrected by this match (see
    // docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md, Scope).
    return {
      tare: match.candidate,
      plate: match.candidate.plate,
      deduction: {
        misreadPlate: plate,
        diffIndex: match.diffIndex,
        matchedBy: match.matchedBy,
        entryCharConfidence: match.entryCharConfidence,
        exitCharConfidence: match.exitCharConfidence,
      },
    };
  }

  return {
    hasResolvableExitCandidate(rawPlate, readQuality, now) {
      const plate = normalizePlate(rawPlate);
      if (plate === '') return true;

      // Mirrors handleExitReading's cascade below: exact tare, exact
      // ticket, re-weigh, then both deductions (tare, then ticket).
      if (truckRepo.findActiveTareByPlate(plate)) return true;
      if (repo.findOpenByPlate(plate)) return true;

      const reweighCandidate = repo.findMostRecentClosedTicketByPlate(plate);
      if (
        reweighCandidate?.exitAt != null &&
        now.getTime() - reweighCandidate.exitAt.getTime() <= ticketConfig.reweighWindowMs
      ) {
        return true;
      }

      const tareDeductionMatch = findPlateDeductionMatch(
        withGroundTruthConfidence(truckRepo.listActiveTares()),
        plate,
        readQuality,
      );
      if (tareDeductionMatch) return true;

      const deductionMatch = findPlateDeductionMatch(
        withStoredEntryConfidence(
          repo.findOpenTicketsEnteredAfter(new Date(now.getTime() - ticketConfig.plateDeductionWindowMs)),
        ),
        plate,
        readQuality,
      );
      return deductionMatch !== undefined;
    },

    handleEntranceReading(input) {
      const plate = normalizePlate(input.rawPlate);

      if (plate === '') {
        repo.recordRawEvent('camera_entrance', cameraRawPayload(input));
        return { kind: 'plate_unreadable' };
      }

      const resolvedTare = resolveActiveTare(plate, input.readQuality);
      if (resolvedTare) {
        return repo.transaction((): EntranceResult => {
          const opened = repo.create({
            plate: resolvedTare.plate,
            entryAt: input.weighingFinishedAt,
            entryWeightKg: input.weightKg,
            entryCameraId: input.cameraId,
            entryCaptureFailed: input.weightCaptureFailed,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: resolvedTare.tare.tareWeightKg,
            exitCameraId: null,
            exitCaptureFailed: false,
          });

          repo.appendAuditLog(
            ticket.id,
            'system',
            input.weightCaptureFailed
              ? TICKET_AUDIT_ACTIONS.ENTRY_CAPTURE_FAILED
              : TICKET_AUDIT_ACTIONS.ENTRY_CAPTURED,
            { weightKg: input.weightKg, cameraId: input.cameraId, attemptsUsed: input.attemptsUsed },
          );
          repo.appendAuditLog(
            ticket.id,
            'system',
            resolvedTare.deduction ? TICKET_AUDIT_ACTIONS.EXIT_VIA_TARE_BY_DEDUCTION : TICKET_AUDIT_ACTIONS.EXIT_VIA_TARE,
            {
              truckConjuntoId: resolvedTare.tare.truckConjuntoId,
              tareWeightKg: resolvedTare.tare.tareWeightKg,
              ...resolvedTare.deduction,
            },
          );
          repo.recordRawEvent(
            'camera_entrance',
            cameraRawPayload(input, plate),
            ticket.id,
          );
          repo.recordRawEvent(
            'scale',
            {
              direction: 'entrance',
              weightKg: input.weightKg,
              weightCaptureFailed: input.weightCaptureFailed,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return resolvedTare.deduction
            ? { kind: 'ticket_closed_via_tare_by_deduction', ticket, misreadPlate: resolvedTare.deduction.misreadPlate }
            : { kind: 'ticket_closed_via_tare', ticket };
        });
      }

      return repo.transaction((): EntranceResult => {
        const action = input.weightCaptureFailed
          ? TICKET_AUDIT_ACTIONS.ENTRY_CAPTURE_FAILED
          : TICKET_AUDIT_ACTIONS.ENTRY_CAPTURED;

        const ticket = repo.create({
          plate,
          entryAt: input.weighingFinishedAt,
          entryWeightKg: input.weightKg,
          entryCameraId: input.cameraId,
          entryCaptureFailed: input.weightCaptureFailed,
          entryConfidenceLevel: input.readQuality?.confidenceLevel ?? null,
          entryPlateCharBelieve: input.readQuality?.plateCharBelieve ?? null,
        });

        repo.appendAuditLog(ticket.id, 'system', action, {
          weightKg: input.weightKg,
          cameraId: input.cameraId,
          attemptsUsed: input.attemptsUsed,
        });
        repo.recordRawEvent(
          'camera_entrance',
          cameraRawPayload(input, plate),
          ticket.id,
        );
        repo.recordRawEvent(
          'scale',
          {
            direction: 'entrance',
            weightKg: input.weightKg,
            weightCaptureFailed: input.weightCaptureFailed,
            failureReason: input.failureReason,
            waitedMs: input.waitedMs,
          },
          ticket.id,
        );

        return { kind: 'ticket_opened', ticket };
      });
    },

    handleExitReading(input) {
      const plate = normalizePlate(input.rawPlate);

      if (plate === '') {
        repo.recordRawEvent('camera_exit', cameraRawPayload(input));
        return { kind: 'plate_unreadable' };
      }

      // Exact tare match takes priority over everything else — resolved
      // outside the main transaction below, same as today. Resolution
      // order (changed 2026-11-24, see
      // docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md):
      // exact tare, exact OPEN ticket, re-weigh, tare-deduction,
      // OPEN-ticket-deduction, ANOMALY. Both exact checks must fail
      // before either deduction (now far more permissive — a registered
      // plate is treated as 100% confidence) is attempted, so a loose
      // tare-deduction match can never steal a reading that has an exact,
      // certain match elsewhere.
      const exactTare = truckRepo.findActiveTareByPlate(plate);
      if (exactTare) {
        return repo.transaction((): ExitResult => {
          const opened = repo.create({
            plate,
            entryAt: input.weighingFinishedAt,
            entryWeightKg: exactTare.tareWeightKg,
            entryCameraId: null,
            entryCaptureFailed: false,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: input.weightCaptureFailed,
          });

          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.ENTRY_VIA_TARE, {
            truckConjuntoId: exactTare.truckConjuntoId,
            tareWeightKg: exactTare.tareWeightKg,
          });
          repo.appendAuditLog(
            ticket.id,
            'system',
            input.weightCaptureFailed
              ? TICKET_AUDIT_ACTIONS.EXIT_CAPTURE_FAILED
              : TICKET_AUDIT_ACTIONS.EXIT_CAPTURED,
            { weightKg: input.weightKg, cameraId: input.cameraId, attemptsUsed: input.attemptsUsed },
          );
          repo.recordRawEvent(
            'camera_exit',
            cameraRawPayload(input, plate),
            ticket.id,
          );
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: input.weightCaptureFailed,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_closed', ticket };
        });
      }

      return repo.transaction((): ExitResult => {
        const existing = repo.findOpenByPlate(plate);

        if (existing) {
          // A failed capture never closes the ticket — there's no way to
          // re-weigh a truck once it has left the scale, so the ticket
          // stays OPEN, waiting for either a later successful exit read
          // (camera re-trigger) or a manual admin correction (which already
          // closes an OPEN ticket via PATCH /tickets/:id/exit, unchanged).
          if (input.weightCaptureFailed) {
            repo.appendAuditLog(existing.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_CAPTURE_FAILED, {
              weightKg: input.weightKg,
              cameraId: input.cameraId,
              attemptsUsed: input.attemptsUsed,
            });
            repo.recordRawEvent(
              'camera_exit',
              cameraRawPayload(input, plate),
              existing.id,
            );
            repo.recordRawEvent(
              'scale',
              {
                direction: 'exit',
                weightKg: input.weightKg,
                weightCaptureFailed: input.weightCaptureFailed,
                failureReason: input.failureReason,
                waitedMs: input.waitedMs,
              },
              existing.id,
            );
            return { kind: 'exit_capture_pending', ticket: existing };
          }

          const ticket = repo.close(existing.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
          });
          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_CAPTURED, {
            weightKg: input.weightKg,
            cameraId: input.cameraId,
            attemptsUsed: input.attemptsUsed,
          });
          repo.recordRawEvent('camera_exit', cameraRawPayload(input, plate), ticket.id);
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: false,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );
          return { kind: 'ticket_closed', ticket };
        }

        // Re-weigh correction (master plan §5/§11): the truck re-entered
        // through another gate (no new entrance weighing, so no OPEN
        // ticket exists) and only needs its exit corrected. A failed
        // capture never qualifies — there's no new weight to reuse, so it
        // falls through to the ANOMALY path below like any other
        // unmatched exit.
        const reweighCandidate = input.weightCaptureFailed
          ? undefined
          : repo.findMostRecentClosedTicketByPlate(plate);
        const withinReweighWindow =
          reweighCandidate?.exitAt != null &&
          input.weighingFinishedAt.getTime() - reweighCandidate.exitAt.getTime() <= ticketConfig.reweighWindowMs;

        if (reweighCandidate && withinReweighWindow) {
          const opened = repo.create({
            plate,
            entryAt: reweighCandidate.entryAt ?? input.weighingFinishedAt,
            entryWeightKg: reweighCandidate.entryWeightKg,
            entryCameraId: reweighCandidate.entryCameraId,
            entryCaptureFailed: reweighCandidate.entryCaptureFailed,
            reweighOfTicketId: reweighCandidate.id,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
          });
          repo.linkReweigh(reweighCandidate.id, ticket.id);

          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.REWEIGH_CREATED, {
            originalTicketId: reweighCandidate.id,
            weightKg: input.weightKg,
            cameraId: input.cameraId,
            attemptsUsed: input.attemptsUsed,
          });
          repo.appendAuditLog(reweighCandidate.id, 'system', TICKET_AUDIT_ACTIONS.REWEIGHED, {
            newTicketId: ticket.id,
          });
          repo.recordRawEvent('camera_exit', cameraRawPayload(input, plate), ticket.id);
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: false,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_reweighed', ticket, originalTicketId: reweighCandidate.id };
        }

        // Tare-plate-deduction (master plan §5/§11, moved here 2026-11-24
        // so both exact checks and re-weigh always take priority — see
        // docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md):
        // still no exact match for anything. A failed capture never
        // qualifies, same precedent as every branch below. The registered
        // plate is ground truth (`withGroundTruthConfidence`), so the
        // match's `winner`/`correctedPlate` are ignored — `tare.plate` is
        // always what's used, never auto-corrected.
        const tareDeductionMatch = input.weightCaptureFailed
          ? undefined
          : findPlateDeductionMatch(withGroundTruthConfidence(truckRepo.listActiveTares()), plate, input.readQuality);

        if (tareDeductionMatch) {
          const tare = tareDeductionMatch.candidate;
          const opened = repo.create({
            plate: tare.plate,
            entryAt: input.weighingFinishedAt,
            entryWeightKg: tare.tareWeightKg,
            entryCameraId: null,
            entryCaptureFailed: false,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
          });

          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.ENTRY_VIA_TARE_BY_DEDUCTION, {
            truckConjuntoId: tare.truckConjuntoId,
            tareWeightKg: tare.tareWeightKg,
            misreadPlate: plate,
            diffIndex: tareDeductionMatch.diffIndex,
            matchedBy: tareDeductionMatch.matchedBy,
            entryCharConfidence: tareDeductionMatch.entryCharConfidence,
            exitCharConfidence: tareDeductionMatch.exitCharConfidence,
          });
          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_CAPTURED, {
            weightKg: input.weightKg,
            cameraId: input.cameraId,
            attemptsUsed: input.attemptsUsed,
          });
          repo.recordRawEvent('camera_exit', cameraRawPayload(input, plate), ticket.id);
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: false,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_closed_via_tare_by_deduction', ticket, misreadPlate: plate };
        }

        // OPEN-ticket plate-misread deduction close (master plan §5/§11):
        // still no match for anything above. A failed capture never
        // qualifies (nothing new to attribute), same precedent as the
        // branches above. Otherwise, check OPEN tickets opened within the
        // configured window for a single-character-different plate —
        // either side's own confidence (or plate format) can be the
        // misread one now, see
        // docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md
        // (supersedes the original single-sided
        // docs/plans/2026-11-18-plate-misread-deduction-plan.md rule).
        const deductionMatch = input.weightCaptureFailed
          ? undefined
          : findPlateDeductionMatch(
              withStoredEntryConfidence(
                repo.findOpenTicketsEnteredAfter(
                  new Date(input.weighingFinishedAt.getTime() - ticketConfig.plateDeductionWindowMs),
                ),
              ),
              plate,
              input.readQuality,
            );

        if (deductionMatch) {
          const ticket = repo.close(deductionMatch.candidate.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
            plate: deductionMatch.correctedPlate ?? undefined,
          });

          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.CLOSED_BY_PLATE_DEDUCTION, {
            misreadPlate: plate,
            diffIndex: deductionMatch.diffIndex,
            matchedBy: deductionMatch.matchedBy,
            entryCharConfidence: deductionMatch.entryCharConfidence,
            exitCharConfidence: deductionMatch.exitCharConfidence,
            weightKg: input.weightKg,
            cameraId: input.cameraId,
            attemptsUsed: input.attemptsUsed,
            ...(deductionMatch.winner === 'exit'
              ? { correctedFromPlate: deductionMatch.candidate.plate, correctedToPlate: deductionMatch.correctedPlate }
              : {}),
          });
          repo.recordRawEvent('camera_exit', cameraRawPayload(input, plate), ticket.id);
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: false,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_closed_by_deduction', ticket, misreadPlate: plate };
        }

        const ticket = repo.flagAnomaly({
          plate,
          exitAt: input.weighingFinishedAt,
          exitWeightKg: input.weightKg,
          exitCameraId: input.cameraId,
          exitCaptureFailed: input.weightCaptureFailed,
        });
        repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.ANOMALY_FLAGGED, {
          weightKg: input.weightKg,
          cameraId: input.cameraId,
          attemptsUsed: input.attemptsUsed,
        });
        repo.recordRawEvent(
          'camera_exit',
          cameraRawPayload(input, plate),
          ticket.id,
        );
        repo.recordRawEvent(
          'scale',
          {
            direction: 'exit',
            weightKg: input.weightKg,
            weightCaptureFailed: input.weightCaptureFailed,
            failureReason: input.failureReason,
            waitedMs: input.waitedMs,
          },
          ticket.id,
        );
        return { kind: 'anomaly_flagged', ticket };
      });
    },
  };
}
