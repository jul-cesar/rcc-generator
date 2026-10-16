import type { RccRequest } from "../rcc/types"
import { AppError, type AppErrorCode, toSafeError } from "./errors"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError("INVALID_INPUT", "Identificador inválido")
  }
  return value
}

function assertTag(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    /[\x00-\x20\x7f~^:?*\\[]/.test(value) ||
    value.includes("..") ||
    value.includes("@{") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".")
  ) {
    throw new AppError("INVALID_INPUT", "Nombre de tag inválido")
  }
  return value
}

export function parseRccRequest(value: unknown): RccRequest {
  if (!value || typeof value !== "object") {
    throw new AppError("INVALID_INPUT", "Solicitud RCC inválida")
  }
  const body = value as Record<string, unknown>
  const toTag = assertTag(body.toTag)

  if (body.mode === "initial") {
    if ("fromTag" in body) {
      throw new AppError("INVALID_INPUT", "El RCC inicial no acepta fromTag")
    }
    return { mode: "initial", toTag }
  }
  if (body.mode === "incremental") {
    return {
      mode: "incremental",
      fromTag: assertTag(body.fromTag),
      toTag,
    }
  }
  throw new AppError("INVALID_INPUT", "Modo RCC inválido")
}

export function assertLocalOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  if (!origin) {
    throw new AppError("FORBIDDEN", "Origen requerido")
  }

  let originUrl: URL
  let requestUrl: URL
  try {
    originUrl = new URL(origin)
    requestUrl = new URL(request.url)
  } catch {
    throw new AppError("FORBIDDEN", "Origen inválido")
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

  if (
    !loopbackHosts.has(originUrl.hostname) ||
    originUrl.origin !== requestUrl.origin
  ) {
    throw new AppError("FORBIDDEN", "Origen no permitido")
  }
}

const ERROR_STATUS: Record<AppErrorCode, number> = {
  INVALID_INPUT: 400,
  AUTH_MISSING: 401,
  AUTH_REJECTED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PROCESS_FAILED: 502,
  CONNECTION_FAILED: 502,
  INTERNAL_ERROR: 500,
}

export function errorResponse(error: unknown): Response {
  const safe = toSafeError(error)
  return Response.json(
    { error: safe },
    { status: ERROR_STATUS[safe.code] ?? 500 }
  )
}
