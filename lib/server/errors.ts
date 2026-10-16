export type AppErrorCode =
  | "AUTH_MISSING"
  | "AUTH_REJECTED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "PROCESS_FAILED"
  | "CONNECTION_FAILED"
  | "INTERNAL_ERROR"

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "AppError"
  }
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((safe, secret) => safe.split(secret).join("[REDACTED]"), value)
}

export function toSafeError(error: unknown, secrets: readonly string[] = []) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Error interno",
          error instanceof Error ? { cause: error } : undefined,
        )

  return {
    code: appError.code,
    message: redactSecrets(appError.message, secrets),
  }
}
