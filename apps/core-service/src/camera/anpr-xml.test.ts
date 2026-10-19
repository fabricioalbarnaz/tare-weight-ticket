import { describe, expect, it } from 'vitest';
import { parseAnprXml } from './anpr-xml.js';

// Based on the two real captures in
// C:\Users\fabri\Documents\Sites\truck-load-queue\docs\anpr-event-payload-findings.md
// §2–3 (same camera hardware), trimmed to the fields this system reads —
// the full real payload also carries AI-cabin/driver-feature and
// bounding-box fields this system intentionally ignores.
const CAPTURE_1 = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <ipAddress>192.168.2.62</ipAddress>
  <dateTime>2026-10-15T09:52:10.000-02:00</dateTime>
  <eventType>ANPR</eventType>
  <eventState>active</eventState>
  <deviceID>88</deviceID>
  <ANPR>
    <country>220</country>
    <licensePlate>HAA9972</licensePlate>
    <direction>reverse</direction>
    <confidenceLevel>98</confidenceLevel>
    <plateCharBelieve>99,99,99,99,99,99,99</plateCharBelieve>
  </ANPR>
  <UUID>e54a25f6-1dd1-11b2-a136-862b9afb19ae</UUID>
</EventNotificationAlert>`;

const CAPTURE_2 = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <ipAddress>192.168.2.62</ipAddress>
  <dateTime>2026-10-15T10:05:05.415-02:00</dateTime>
  <eventType>ANPR</eventType>
  <eventState>active</eventState>
  <deviceID>88</deviceID>
  <ANPR>
    <country>156</country>
    <licensePlate>V0694</licensePlate>
    <direction>reverse</direction>
    <confidenceLevel>96</confidenceLevel>
    <plateCharBelieve>99,99,99,99,95</plateCharBelieve>
  </ANPR>
  <UUID>e54a25f6-1dd1-11b2-a136-862b9afb19af</UUID>
</EventNotificationAlert>`;

describe('parseAnprXml', () => {
  it('parses the first real capture', () => {
    expect(parseAnprXml(CAPTURE_1)).toEqual({
      deviceId: '88',
      dateTime: '2026-10-15T09:52:10.000-02:00',
      licensePlate: 'HAA9972',
      confidenceLevel: 98,
      plateCharBelieve: [99, 99, 99, 99, 99, 99, 99],
      direction: 'reverse',
      country: '220',
    });
  });

  it('parses the second real capture (shorter plateCharBelieve/plate)', () => {
    expect(parseAnprXml(CAPTURE_2)).toEqual({
      deviceId: '88',
      dateTime: '2026-10-15T10:05:05.415-02:00',
      licensePlate: 'V0694',
      confidenceLevel: 96,
      plateCharBelieve: [99, 99, 99, 99, 95],
      direction: 'reverse',
      country: '156',
    });
  });

  it('defaults licensePlate/confidenceLevel instead of throwing when there is no ANPR element', () => {
    // An event with no usable plate read is an expected business outcome
    // (handled downstream as plate_unreadable), not a malformed request.
    const result = parseAnprXml(
      '<EventNotificationAlert><deviceID>88</deviceID><dateTime>2026-01-01T00:00:00Z</dateTime></EventNotificationAlert>',
    );

    expect(result.licensePlate).toBe('');
    expect(result.confidenceLevel).toBe(0);
  });

  it('throws on XML missing deviceID', () => {
    const xml = `<EventNotificationAlert>
      <dateTime>2026-01-01T00:00:00Z</dateTime>
      <ANPR><licensePlate>ABC1234</licensePlate><confidenceLevel>90</confidenceLevel></ANPR>
    </EventNotificationAlert>`;
    expect(() => parseAnprXml(xml)).toThrow();
  });
});
