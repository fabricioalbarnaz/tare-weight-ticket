import { describe, expect, it } from 'vitest';
import { loadAdminConfig } from './config.js';

describe('loadAdminConfig', () => {
  it('loads the session secret from the environment', () => {
    const config = loadAdminConfig({ ADMIN_SESSION_SECRET: 'a'.repeat(32) } as NodeJS.ProcessEnv);
    expect(config.sessionSecret).toBe('a'.repeat(32));
  });

  it('throws when the session secret is missing', () => {
    expect(() => loadAdminConfig({} as NodeJS.ProcessEnv)).toThrow(/ADMIN_SESSION_SECRET/);
  });

  it('throws when the session secret is too short', () => {
    expect(() => loadAdminConfig({ ADMIN_SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /ADMIN_SESSION_SECRET/,
    );
  });
});
