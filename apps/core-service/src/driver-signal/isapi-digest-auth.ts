import { createHash, randomBytes } from 'node:crypto';

export interface DigestCredentials {
  username: string;
  password: string;
}

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function parseDigestChallenge(header: string | null): DigestChallenge | undefined {
  if (!header || !/^digest\s/i.test(header)) return undefined;

  const params: Record<string, string> = {};
  const paramPattern = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let match: RegExpExecArray | null;
  while ((match = paramPattern.exec(header)) !== null) {
    const [, key, quoted, unquoted] = match;
    if (!key) continue;
    params[key] = quoted ?? unquoted ?? '';
  }

  if (!params.realm || !params.nonce) return undefined;
  return { realm: params.realm, nonce: params.nonce, qop: params.qop, opaque: params.opaque, algorithm: params.algorithm };
}

function buildAuthorizationHeader(
  challenge: DigestChallenge,
  credentials: DigestCredentials,
  method: string,
  uri: string,
): string {
  const ha1 = md5(`${credentials.username}:${challenge.realm}:${credentials.password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');

  const response = challenge.qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${credentials.username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (challenge.qop) {
    parts.push(`qop=${challenge.qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);

  return `Digest ${parts.join(', ')}`;
}

/**
 * Fetch wrapper for Hikvision ISAPI's HTTP Digest auth (RFC 7616-style,
 * MD5 — ISAPI devices use MD5 digest). Issues the request once; if the
 * device challenges with a 401 + `WWW-Authenticate: Digest ...`, computes
 * the digest response and retries exactly once with an `Authorization`
 * header. Any other response (including a second 401, e.g. wrong
 * credentials) is returned as-is — callers decide what counts as success.
 */
export async function digestAuthFetch(
  url: string,
  init: RequestInit,
  credentials: DigestCredentials,
): Promise<Response> {
  const initial = await fetch(url, init);
  if (initial.status !== 401) return initial;

  const challenge = parseDigestChallenge(initial.headers.get('www-authenticate'));
  if (!challenge) return initial;

  const { pathname, search } = new URL(url);
  const uri = `${pathname}${search}`;
  const authorization = buildAuthorizationHeader(challenge, credentials, init.method ?? 'GET', uri);

  return fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: authorization },
  });
}
