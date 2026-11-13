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
}

export function loadTicketConfig(env: NodeJS.ProcessEnv = process.env): TicketConfig {
  return {
    reweighWindowMs: parsePositiveInt('EXIT_REWEIGH_WINDOW_MS', env.EXIT_REWEIGH_WINDOW_MS, 2 * 60 * 60 * 1000),
  };
}
