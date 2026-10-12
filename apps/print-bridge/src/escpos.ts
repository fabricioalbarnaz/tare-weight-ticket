import type { PrintTicketRequest } from '@tare/shared';

const ESC = 0x1b;
const GS = 0x1d;

function initialize(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

function setBold(on: boolean): Buffer {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

function setAlign(align: 'left' | 'center'): Buffer {
  return Buffer.from([ESC, 0x61, align === 'center' ? 1 : 0]);
}

function textLine(text: string): Buffer {
  return Buffer.concat([Buffer.from(text, 'ascii'), Buffer.from('\n')]);
}

function cutPaper(): Buffer {
  return Buffer.from([GS, 0x56, 0x00]);
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatWeight(weightKg: number | null): string {
  return weightKg === null ? 'N/A' : `${weightKg} kg`;
}

/**
 * Renders the ticket fields from master plan §2 ("Plate, entry date/time,
 * exit date/time, entry weight, exit weight, net weight difference —
 * nothing else") into raw ESC/POS bytes. Hand-rolled rather than a
 * thermal-printer library, matching this project's existing
 * dependency-light hardware integrations (scale TCP client, camera
 * payload normalization).
 */
export function buildTicketEscPos(ticket: PrintTicketRequest): Buffer {
  return Buffer.concat([
    initialize(),
    setAlign('center'),
    setBold(true),
    textLine('WEIGHT TICKET'),
    setBold(false),
    textLine('--------------------------------'),
    setAlign('left'),
    textLine(`Ticket #: ${ticket.ticketNumber}`),
    textLine(`Plate: ${ticket.plate}`),
    textLine(`Entry: ${formatTimestamp(ticket.entryAt)}`),
    textLine(`Exit:  ${formatTimestamp(ticket.exitAt)}`),
    textLine(`Entry weight: ${formatWeight(ticket.entryWeightKg)}`),
    textLine(`Exit weight:  ${formatWeight(ticket.exitWeightKg)}`),
    textLine(`Net weight:   ${formatWeight(ticket.netWeightKg)}`),
    textLine('--------------------------------'),
    textLine(''),
    textLine(''),
    cutPaper(),
  ]);
}
