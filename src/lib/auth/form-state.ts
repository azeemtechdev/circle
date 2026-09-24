/**
 * Shared shape for the auth form actions.
 *
 * Separate from `actions.ts` because a `'use server'` file may only export
 * async functions — exporting a plain object from one fails the build with
 * "A 'use server' file can only export async functions, found object". Types
 * are erased and would be fine; the constant is not.
 */
export interface AuthFormState {
  error: string | null;
  /** Set when signup succeeds but the account still needs email confirmation. */
  notice?: string;
}

export const EMPTY_AUTH_STATE: AuthFormState = { error: null };
