import http from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHikvisionIsapiDriverSignalAdapter } from './hikvision-isapi-adapter.js';

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

const USERNAME = 'admin';
const PASSWORD = 'admin12345';
const REALM = 'testrealm';
const NONCE = 'abc123';

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function parseAuthorizationHeader(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pattern = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header)) !== null) {
    const [, key, quoted, unquoted] = match;
    if (!key) continue;
    params[key] = quoted ?? unquoted ?? '';
  }
  return params;
}

/** Real digest verification (independent of the module under test), matching isapi-digest-auth.test.ts's approach. */
function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header) return false;

  const params = parseAuthorizationHeader(header);
  const ha1 = md5(`${USERNAME}:${REALM}:${PASSWORD}`);
  const ha2 = md5(`${req.method}:${req.url}`);
  const expected = md5(`${ha1}:${NONCE}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`);
  return params.username === USERNAME && params.response === expected;
}

function challenge(res: http.ServerResponse): void {
  res
    .writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", nonce="${NONCE}", qop="auth", algorithm=MD5` })
    .end();
}

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

describe('createHikvisionIsapiDriverSignalAdapter', () => {
  it('sends ctrlMode=open to the entrance camera barrierGate endpoint, authenticated', async () => {
    const requests: Array<{ url: string; ctrlMode: string }> = [];
    const baseUrl = await startServer((req, res) => {
      if (!isAuthorized(req)) {
        challenge(res);
        return;
      }
      readBody(req).then((raw) => {
        const ctrlMode = /<ctrlMode>(\w+)<\/ctrlMode>/.exec(raw)?.[1] ?? '';
        requests.push({ url: req.url ?? '', ctrlMode });
        res.writeHead(200).end();
      });
    });

    const adapter = createHikvisionIsapiDriverSignalAdapter({
      entrance: { baseUrl, channelId: '1', ctrlMode: 'open', username: USERNAME, password: PASSWORD },
    });

    await adapter.signalDriver('in');

    expect(requests).toEqual([{ url: '/ISAPI/Parking/channels/1/barrierGate', ctrlMode: 'open' }]);
    expect(adapter.getStatus().lastSuccessAt).toBeInstanceOf(Date);
  });

  it('targets the exit camera channel/ctrlMode for direction "out"', async () => {
    const requests: Array<{ url: string }> = [];
    const baseUrl = await startServer((req, res) => {
      if (!isAuthorized(req)) {
        challenge(res);
        return;
      }
      requests.push({ url: req.url ?? '' });
      res.writeHead(200).end();
    });

    const adapter = createHikvisionIsapiDriverSignalAdapter({
      exit: { baseUrl, channelId: '1', ctrlMode: 'close', username: USERNAME, password: PASSWORD },
    });

    await adapter.signalDriver('out');

    expect(requests).toEqual([{ url: '/ISAPI/Parking/channels/1/barrierGate' }]);
  });

  it('does nothing when the direction has no configured camera', async () => {
    let called = false;
    const baseUrl = await startServer((_req, res) => {
      called = true;
      res.writeHead(200).end();
    });

    const adapter = createHikvisionIsapiDriverSignalAdapter({
      exit: { baseUrl, channelId: '1', ctrlMode: 'open', username: USERNAME, password: PASSWORD },
    });

    await adapter.signalDriver('in');

    expect(called).toBe(false);
  });

  it('resolves and reports via onError when the camera responds with a non-2xx status', async () => {
    const baseUrl = await startServer((req, res) => {
      if (!isAuthorized(req)) {
        challenge(res);
        return;
      }
      res.writeHead(500).end();
    });

    const errors: Array<{ message: string; direction: string }> = [];
    const adapter = createHikvisionIsapiDriverSignalAdapter({
      entrance: { baseUrl, channelId: '1', ctrlMode: 'open', username: USERNAME, password: PASSWORD },
      onError: (err, direction) => errors.push({ message: err.message, direction }),
    });

    await expect(adapter.signalDriver('in')).resolves.toBeUndefined();
    expect(errors).toEqual([
      { message: 'Camera responded with HTTP 500 setting ctrlMode=open', direction: 'in' },
    ]);
    expect(adapter.getStatus().lastFailureAt).toBeInstanceOf(Date);
  });

  it('resolves and reports via onError when the camera does not respond within the timeout', async () => {
    const baseUrl = await startServer(() => {
      // Never responds.
    });

    const errors: Error[] = [];
    const adapter = createHikvisionIsapiDriverSignalAdapter({
      entrance: { baseUrl, channelId: '1', ctrlMode: 'open', username: USERNAME, password: PASSWORD },
      timeoutMs: 50,
      onError: (err) => errors.push(err),
    });

    await expect(adapter.signalDriver('in')).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(adapter.getStatus().lastFailureAt).toBeInstanceOf(Date);
  });

  describe('getStatus', () => {
    it('reports no attempts yet before any signal', () => {
      const adapter = createHikvisionIsapiDriverSignalAdapter({});
      expect(adapter.getStatus()).toEqual({ lastSuccessAt: null, lastFailureAt: null });
    });

    it('does not record an attempt when the direction has no configured camera', async () => {
      const adapter = createHikvisionIsapiDriverSignalAdapter({});

      await adapter.signalDriver('in');

      expect(adapter.getStatus()).toEqual({ lastSuccessAt: null, lastFailureAt: null });
    });
  });
});
