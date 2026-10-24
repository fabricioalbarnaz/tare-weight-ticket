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

function setUnderline(on: boolean): Buffer {
  return Buffer.from([ESC, 0x2d, on ? 1 : 0]);
}

/** GS ! n: bits 0-2 height magnification, bits 4-6 width magnification
 * (0 = x1, 1 = x2, ...). Magnifying height without width (confirmed
 * on-site 2026-10-24) stretches characters into a squished-looking
 * proportion, so only the short title uses magnification (both
 * dimensions, keeping its proportions normal) — the body stays at normal
 * character size and uses bold/underline instead for emphasis, since
 * magnifying it risks wrapping the longer lines (e.g. timestamps) on this
 * printer's fixed line width. */
const CHAR_SIZE_NORMAL = 0x00;
const CHAR_SIZE_DOUBLE = 0x11;

function setCharSize(size: number): Buffer {
  return Buffer.from([GS, 0x21, size]);
}

function textLine(text: string): Buffer {
  return Buffer.concat([Buffer.from(text, 'ascii'), Buffer.from('\n')]);
}

function cutPaper(): Buffer {
  return Buffer.from([GS, 0x56, 0x00]);
}

/** Lines fed before cutting, so the cutter blade clears the last printed
 * line instead of slicing through it — confirmed needed on-site
 * (2026-10-24) against the installed POS80 network printer; 2 blank
 * lines were not enough and the cutter sliced through printed text. */
const FEED_LINES_BEFORE_CUT = 5;

/** No accented characters (á, ã, ç, ...): this hand-rolled builder sends
 * plain ASCII, and the installed printer's codepage for accented
 * Portuguese characters hasn't been confirmed on-site — misguessing it
 * would print garbled bytes instead of the intended letter. */
function formatTimestamp(iso: string | null): string {
  if (!iso) return 'N/D';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatWeight(weightKg: number | null): string {
  return weightKg === null ? 'N/D' : `${weightKg} kg`;
}

/**
 * Renders the ticket fields from master plan §2 ("Plate, entry date/time,
 * exit date/time, entry weight, exit weight, net weight difference —
 * nothing else") into raw ESC/POS bytes. Hand-rolled rather than a
 * thermal-printer library, matching this project's existing
 * dependency-light hardware integrations (scale TCP client, camera
 * payload normalization). Labels are in Portuguese (pt-BR) per the
 * operator-facing ticket; the Admin UI's own pt-BR/en i18n is unrelated —
 * the printed ticket has one fixed language.
 */
export function buildTicketEscPos(ticket: PrintTicketRequest): Buffer {
  return Buffer.concat([
    initialize(),
    setAlign('center'),
    setCharSize(CHAR_SIZE_DOUBLE),
    setBold(true),
    textLine('TICKET DE PESAGEM'),
    setBold(false),
    setCharSize(CHAR_SIZE_NORMAL),
    textLine('================================'),
    setAlign('left'),
    setBold(true),
    textLine(`Ticket: ${ticket.ticketNumber}`),
    textLine(`Placa:  ${ticket.plate}`),
    textLine('--------------------------------'),
    textLine(`Entrada: ${formatTimestamp(ticket.entryAt)}`),
    textLine(`Saida:   ${formatTimestamp(ticket.exitAt)}`),
    textLine('--------------------------------'),
    textLine(`Peso entrada: ${formatWeight(ticket.entryWeightKg)}`),
    textLine(`Peso saida:   ${formatWeight(ticket.exitWeightKg)}`),
    setUnderline(true),
    textLine(`Peso liquido: ${formatWeight(ticket.netWeightKg)}`),
    setUnderline(false),
    setBold(false),
    setAlign('center'),
    textLine('================================'),
    ...Array.from({ length: FEED_LINES_BEFORE_CUT }, () => textLine('')),
    cutPaper(),
  ]);
}
