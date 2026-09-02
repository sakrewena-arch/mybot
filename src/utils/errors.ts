/**
 * Base application error with a stable machine-readable code.
 */
export class AppError extends Error {
  readonly code: string;

  constructor(message: string, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const anyError = error as { code?: string };
  return anyError.code === 'P2002';
}