import { parsePositiveInt } from '../config/env.js';

export interface TicketConfig {
  /**
   * How long after a ticket's exit is recorded that a *later* exit reading
   * with no OPEN ticket for the same plate may still be treated as a
   * re-weigh correction (reusing that ticket's entry weight/time) instead
   * of being flagged ANOMALY outright — see
   * docs/plans/2026-11-12-exit-reweigh-plan.md and master plan §5/§11.
   */
  reweighWindowMs: number;
  /**
   * How old (by `entryAt`) an `OPEN` ticket may be and still qualify for
   * the plate-misread deduction close: an exit reading with no exact-plate
   * `OPEN` ticket, but a single-character-different `OPEN` ticket whose
   * per-character ANPR confidence confirms the mismatch, closes that ticket
   * automatically instead of filing an `ANOMALY` — see
   * docs/plans/2026-11-18-plate-misread-deduction-plan.md and master plan
   * §5/§11.
   */
  plateDeductionWindowMs: number;
}

export function loadTicketConfig(env: NodeJS.ProcessEnv = process.env): TicketConfig {
  return {
    reweighWindowMs: parsePositiveInt('EXIT_REWEIGH_WINDOW_MS', env.EXIT_REWEIGH_WINDOW_MS, 2 * 60 * 60 * 1000),
    plateDeductionWindowMs: parsePositiveInt(
      'PLATE_DEDUCTION_WINDOW_MS',
      env.PLATE_DEDUCTION_WINDOW_MS,
      24 * 60 * 60 * 1000,
    ),
  };
}
