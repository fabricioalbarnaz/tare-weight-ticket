import { XMLParser } from 'fast-xml-parser';

/**
 * Fields this system can use from the real Hikvision ISAPI `anpr.xml`
 * event payload (see docs/plans master plan §7 item 3 for the full real
 * capture this is based on). Deliberately not modeling the AI-cabin/
 * driver-feature fields (`pilotsafebelt`, `smoking`, ...) or the picture
 * bounding-box fields (`plateRect`, `vehicelRect`) present in the real
 * payload — none of them are relevant here.
 */
export interface AnprXmlEvent {
  deviceId: string;
  dateTime: string;
  licensePlate: string;
  confidenceLevel: number;
  plateCharBelieve: number[];
  direction: string;
  country: string;
}

// `parseTagValue` (fast-xml-parser's default) turns numeric-looking tag
// text into JS numbers, e.g. a `<deviceID>88</deviceID>` becomes `88` not
// `"88"` — handled below by accepting number for the numeric-looking
// fields and coercing back to the type this system actually wants.
const parser = new XMLParser();

/**
 * Throws only when the XML doesn't parse or is missing `deviceID`/
 * `dateTime` — the camera-level fields every event (readable or not) is
 * expected to carry. The caller (routes.ts) turns that into an HTTP 400,
 * same as a malformed JSON body did before the real payload shape was
 * confirmed. A missing/empty `licensePlate` or `confidenceLevel` is
 * **not** treated as malformed — a camera event with no usable plate read
 * is an expected business outcome (`plate_unreadable`, handled downstream
 * in normalize.ts), not a bad request.
 */
export function parseAnprXml(xml: string): AnprXmlEvent {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const alert = parsed['EventNotificationAlert'] as Record<string, unknown> | undefined;
  const anpr = alert?.['ANPR'] as Record<string, unknown> | undefined;

  const deviceId = alert?.['deviceID'];
  const dateTime = alert?.['dateTime'];
  const licensePlate = anpr?.['licensePlate'];
  const confidenceLevel = anpr?.['confidenceLevel'];
  const direction = anpr?.['direction'];
  const country = anpr?.['country'];

  const isStringOrNumber = (value: unknown): value is string | number =>
    typeof value === 'string' || typeof value === 'number';

  if (!isStringOrNumber(deviceId) || typeof dateTime !== 'string') {
    throw new Error('anpr.xml is missing required fields (deviceID/dateTime)');
  }

  const plateCharBelieve = String(anpr?.['plateCharBelieve'] ?? '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value));

  return {
    deviceId: String(deviceId),
    dateTime,
    licensePlate: typeof licensePlate === 'string' ? licensePlate : '',
    confidenceLevel: isStringOrNumber(confidenceLevel) ? Number(confidenceLevel) : 0,
    plateCharBelieve,
    direction: typeof direction === 'string' ? direction : '',
    country: isStringOrNumber(country) ? String(country) : '',
  };
}
