import type { DriverSignalAdapter } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';
import type { ScaleClient } from '../scale/types.js';
import type { TicketRepository } from '../tickets/repository.js';

export interface HardwareComponentStatus {
  reachable: boolean;
  lastSeenAt: string | null;
}

export interface HardwareStatus {
  cameraEntrance: HardwareComponentStatus;
  cameraExit: HardwareComponentStatus;
  scale: HardwareComponentStatus;
  printBridge: HardwareComponentStatus;
  relay: HardwareComponentStatus;
}

export interface HardwareStatusDeps {
  repo: TicketRepository;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printClient: PrintClient;
  /** How recent a camera's last raw event must be to count as reachable. Defaults to 24h. */
  cameraStalenessMs?: number;
}

const DEFAULT_CAMERA_STALENESS_MS = 24 * 60 * 60 * 1000;

function cameraStatus(lastSeenAt: Date | null, stalenessMs: number): HardwareComponentStatus {
  const reachable = lastSeenAt !== null && Date.now() - lastSeenAt.getTime() <= stalenessMs;
  return { reachable, lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null };
}

export async function getHardwareStatus(deps: HardwareStatusDeps): Promise<HardwareStatus> {
  const stalenessMs = deps.cameraStalenessMs ?? DEFAULT_CAMERA_STALENESS_MS;

  const scaleStatus = deps.scaleClient.getStatus();
  const relayStatus = deps.driverSignalAdapter.getStatus();
  const printBridgeStatus = await deps.printClient.checkHealth();

  return {
    cameraEntrance: cameraStatus(deps.repo.findLastEventTimestamp('camera_entrance'), stalenessMs),
    cameraExit: cameraStatus(deps.repo.findLastEventTimestamp('camera_exit'), stalenessMs),
    scale: { reachable: scaleStatus.connected, lastSeenAt: scaleStatus.lastSeenAt?.toISOString() ?? null },
    printBridge: { reachable: printBridgeStatus.reachable, lastSeenAt: null },
    relay: {
      // Reachable if the most recent signal attempt succeeded (no attempt yet counts as unreachable).
      reachable:
        relayStatus.lastSuccessAt !== null &&
        (relayStatus.lastFailureAt === null || relayStatus.lastSuccessAt > relayStatus.lastFailureAt),
      lastSeenAt: relayStatus.lastSuccessAt?.toISOString() ?? null,
    },
  };
}
