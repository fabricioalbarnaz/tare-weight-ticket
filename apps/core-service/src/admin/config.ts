import { parseRequiredSecret } from '../config/env.js';

const MIN_SESSION_SECRET_LENGTH = 32;

export interface AdminConfig {
  sessionSecret: string;
}

export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  return {
    sessionSecret: parseRequiredSecret(
      'ADMIN_SESSION_SECRET',
      env.ADMIN_SESSION_SECRET,
      MIN_SESSION_SECRET_LENGTH,
    ),
  };
}
