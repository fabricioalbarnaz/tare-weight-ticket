import http from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { digestAuthFetch } from './isapi-digest-auth.js';

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

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

/**
 * A real HTTP server that performs genuine RFC 7616-style digest
 * challenge/response (reimplemented independently here, not by importing
 * anything from the module under test) so the test exercises actual MD5
 * digest math on both ends, not a mocked handshake.
 */
function startDigestServer(options: {
  realm: string;
  nonce: string;
  qop?: string;
  username: string;
  password: string;
}): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        const challenge = options.qop
          ? `Digest realm="${options.realm}", nonce="${options.nonce}", qop="${options.qop}", algorithm=MD5`
          : `Digest realm="${options.realm}", nonce="${options.nonce}", algorithm=MD5`;
        res.writeHead(401, { 'WWW-Authenticate': challenge }).end();
        return;
      }

      const params = parseAuthorizationHeader(authHeader);
      const ha1 = md5(`${options.username}:${options.realm}:${options.password}`);
      const ha2 = md5(`${req.method}:${req.url}`);
      const expectedResponse = params.qop
        ? md5(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`)
        : md5(`${ha1}:${params.nonce}:${ha2}`);

      if (params.username === options.username && params.response === expectedResponse) {
        res.writeHead(200).end('ok');
      } else {
        res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${options.realm}", nonce="${options.nonce}"` }).end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function startPlainServer(): Promise<string> {
  server = http.createServer((_req, res) => res.writeHead(200).end('ok'));
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('digestAuthFetch', () => {
  it('authenticates against a qop="auth" challenge', async () => {
    const baseUrl = await startDigestServer({
      realm: 'testrealm',
      nonce: 'abc123',
      qop: 'auth',
      username: 'admin',
      password: 'admin12345',
    });

    const response = await digestAuthFetch(
      `${baseUrl}/ISAPI/System/IO/outputs/1/trigger`,
      { method: 'PUT' },
      { username: 'admin', password: 'admin12345' },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('authenticates against a challenge without qop', async () => {
    const baseUrl = await startDigestServer({
      realm: 'testrealm',
      nonce: 'xyz789',
      username: 'admin',
      password: 'admin12345',
    });

    const response = await digestAuthFetch(
      `${baseUrl}/ISAPI/System/IO/outputs/1/trigger`,
      { method: 'PUT' },
      { username: 'admin', password: 'admin12345' },
    );

    expect(response.status).toBe(200);
  });

  it('returns the final 401 when credentials are wrong, without retrying more than once', async () => {
    const baseUrl = await startDigestServer({
      realm: 'testrealm',
      nonce: 'abc123',
      qop: 'auth',
      username: 'admin',
      password: 'admin12345',
    });

    const response = await digestAuthFetch(
      `${baseUrl}/ISAPI/System/IO/outputs/1/trigger`,
      { method: 'PUT' },
      { username: 'admin', password: 'wrong-password' },
    );

    expect(response.status).toBe(401);
  });

  it('returns the initial response unmodified when no auth challenge is issued', async () => {
    const baseUrl = await startPlainServer();

    const response = await digestAuthFetch(baseUrl, { method: 'GET' }, { username: 'admin', password: 'x' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});
