import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/**
 * Business-error codes the backend sends as the response body for the
 * user/auth routes (`USER_ERRORS` in `core-service/src/admin/routes.ts`).
 */
const KNOWN_USER_ERRORS = [
  'wrong_current_password',
  'same_password',
  'username_taken',
  'cannot_change_own_role',
  'cannot_reset_own_password',
  'cannot_deactivate_self',
  'last_active_admin',
] as const;

/** A translated message for a failed user/auth mutation, falling back to `fallbackKey` for anything unrecognized. */
export function userErrorMessage(t: TFunction, error: unknown, fallbackKey: string): string {
  if (
    error instanceof ApiError &&
    (KNOWN_USER_ERRORS as readonly string[]).includes(error.message)
  ) {
    return t(`users.errors.${error.message}`);
  }
  return t(fallbackKey);
}
