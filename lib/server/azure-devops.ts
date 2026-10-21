import { createHash } from "node:crypto"

import type {
  AuthorizedRepository,
  ProjectSummary,
  RepositorySummary,
} from "../rcc/types"
import { getServerConfig, type ServerConfig } from "./config"
import { AppError } from "./errors"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const API_VERSION = "7.1"
export const REQUEST_TIMEOUT_MS = 10_000

// The organization is a build-time constant (lib/server/config.ts:3,
// AZURE_DEVOPS_ORGANIZATION), never user input. It is still re-validated
// here against an explicit host allowlist before every request, mirroring
// the loopback allowlist used by assertLocalOrigin
// (lib/server/http.ts:68-75), so a future config refactor cannot silently
// point the PAT at an arbitrary host.
const AZURE_DEVOPS_HOSTS = new Set(["dev.azure.com"])

const CONNECTION_FAILED_MESSAGE = "No fue posible conectar con Azure DevOps"
const PROCESS_FAILED_MESSAGE = "Azure DevOps no respondió correctamente"
const INVALID_RESPONSE_MESSAGE =
  "Azure DevOps devolvió una respuesta inválida"
const NOT_FOUND_MESSAGE = "Repositorio no disponible para este usuario"
const ORGANIZATION_NOT_ALLOWED_MESSAGE =
  "Organización de Azure DevOps no permitida"

export interface AzureDevOpsDependencies {
  fetch?: typeof fetch
  env?: Readonly<Record<string, string | undefined>>
}

interface AzureProject {
  id: string
  name: string
}

interface AzureRepository {
  id: string
  name: string
  remoteUrl: string
  project?: { id?: string }
}

export function assertAzureId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError(
      "INVALID_INPUT",
      "Identificador de Azure DevOps inválido"
    )
  }
}

// Resolution cache: reuses a repository resolution the same PAT already
// achieved within the TTL, so repeated tag/RCC requests against the same
// repository never re-probe Azure DevOps. Keys embed a PAT digest, so one
// credential never consumes another credential's cached verdict. Negative
// results (repository not authorized for this PAT) are cached briefly with
// a sentinel to absorb repeated invalid requests.
const RESOLUTION_CACHE_POSITIVE_TTL_MS = 10 * 60 * 1000
const RESOLUTION_CACHE_NEGATIVE_TTL_MS = 60 * 1000

interface ResolutionCacheEntry {
  /** Authorized repository, or `null` as the cached NOT_FOUND sentinel. */
  value: AuthorizedRepository | null
  expiresAt: number
}

const RESOLUTION_CACHE = new Map<string, ResolutionCacheEntry>()

export function clearRepositoryResolutionCache(): void {
  RESOLUTION_CACHE.clear()
}

function resolutionCacheKey(
  config: ServerConfig,
  projectId: string,
  repositoryId: string
): string {
  const patDigest = createHash("sha256")
    .update(config.pat)
    .digest("hex")
    .slice(0, 16)
  return `${patDigest}/${projectId}/${repositoryId}`
}

function validateOrganization(organization: string): URL {
  let url: URL
  try {
    url = new URL(organization)
  } catch (cause) {
    throw new AppError("INTERNAL_ERROR", ORGANIZATION_NOT_ALLOWED_MESSAGE, {
      cause,
    })
  }
  if (url.protocol !== "https:" || !AZURE_DEVOPS_HOSTS.has(url.hostname)) {
    throw new AppError("INTERNAL_ERROR", ORGANIZATION_NOT_ALLOWED_MESSAGE)
  }
  return url
}

function responseError(status: number): AppError {
  if (status === 401) {
    return new AppError("AUTH_REJECTED", "Azure DevOps rechazó el PAT")
  }
  if (status === 403) {
    return new AppError(
      "FORBIDDEN",
      "El PAT no tiene permisos suficientes"
    )
  }
  if (status === 404) {
    return new AppError(
      "NOT_FOUND",
      "Azure DevOps no encontró el recurso solicitado"
    )
  }
  return new AppError("PROCESS_FAILED", PROCESS_FAILED_MESSAGE)
}

function requireListValue<T>(payload: unknown): T[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { value?: unknown }).value)
  ) {
    throw new AppError("PROCESS_FAILED", INVALID_RESPONSE_MESSAGE)
  }
  return (payload as { value: unknown[] }).value as T[]
}

export function createAzureDevOpsClient(
  dependencies: AzureDevOpsDependencies = {}
) {
  const injectedFetch = dependencies.fetch ?? globalThis.fetch
  const env = dependencies.env ?? process.env

  async function requestJson(url: URL): Promise<unknown> {
    const config = getServerConfig(env)

    // The PAT travels only in the Authorization header; it is never placed
    // in the URL, so transport errors cannot echo the credential back.
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`:${config.pat}`).toString("base64")}`,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      // Fetch rejection and the
      // REQUEST_TIMEOUT_MS abort share the CONNECTION_FAILED mapping.
      response = await injectedFetch(url, {
        headers,
        signal: controller.signal,
      })
    } catch (cause) {
      throw new AppError("CONNECTION_FAILED", CONNECTION_FAILED_MESSAGE, {
        cause,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw responseError(response.status)
    }

    try {
      return await response.json()
    } catch (cause) {
      throw new AppError("PROCESS_FAILED", INVALID_RESPONSE_MESSAGE, {
        cause,
      })
    }
  }

  function apiUrl(
    path: string,
    params: Readonly<Record<string, string>> = {}
  ): URL {
    const config = getServerConfig(env)
    const base = validateOrganization(config.organization)
    // A relative path replaces the last path segment of the base unless the
    // base ends with "/", which would silently drop the organization path
    // ("/alianzaapps") from the endpoint URL.
    const baseUrl = base.href.endsWith("/") ? base.href : `${base.href}/`
    const url = new URL(path, baseUrl)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url
  }

  async function listProjects(): Promise<ProjectSummary[]> {
    // Paged responses may include a continuation token; it is deliberately
    // ignored for now because the project catalog fits a single page.
    const payload = await requestJson(
      apiUrl("_apis/projects", { "api-version": API_VERSION })
    )
    return requireListValue<AzureProject>(payload).map(
      ({ id, name }) => ({ id, name })
    )
  }

  async function authorizedRepositories(
    projectId: string
  ): Promise<AuthorizedRepository[]> {
    assertAzureId(projectId)
    const payload = await requestJson(
      apiUrl(`${encodeURIComponent(projectId)}/_apis/git/repositories`, {
        "api-version": API_VERSION,
        includeHidden: "false",
      })
    )
    return requireListValue<AzureRepository>(payload).map((repository) => ({
      id: repository.id,
      name: repository.name,
      projectId: repository.project?.id || projectId,
      remoteUrl: repository.remoteUrl,
    }))
  }

  async function listRepositories(
    projectId: string
  ): Promise<RepositorySummary[]> {
    return (await authorizedRepositories(projectId)).map(
      ({ id, name }) => ({ id, name })
    )
  }

  async function lookupAuthorizedRepositoryInProject(
    projectId: string,
    repositoryId: string
  ): Promise<AuthorizedRepository | undefined> {
    assertAzureId(projectId)
    assertAzureId(repositoryId)
    const repositories = await authorizedRepositories(projectId)
    return repositories.find(
      (candidate) => candidate.id === repositoryId
    )
  }

  async function resolveAuthorizedRepositoryInProject(
    projectId: string,
    repositoryId: string
  ): Promise<AuthorizedRepository> {
    assertAzureId(projectId)
    assertAzureId(repositoryId)
    const config = getServerConfig(env)
    const key = resolutionCacheKey(config, projectId, repositoryId)
    const cached = RESOLUTION_CACHE.get(key)
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        if (cached.value) return cached.value
        throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE)
      }
      RESOLUTION_CACHE.delete(key)
    }
    const found = await lookupAuthorizedRepositoryInProject(
      projectId,
      repositoryId
    )
    RESOLUTION_CACHE.set(key, {
      value: found ?? null,
      expiresAt:
        Date.now() +
        (found
          ? RESOLUTION_CACHE_POSITIVE_TTL_MS
          : RESOLUTION_CACHE_NEGATIVE_TTL_MS),
    })
    if (!found) {
      throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE)
    }
    return found
  }

  async function resolveAuthorizedRepository(
    repositoryId: string
  ): Promise<AuthorizedRepository> {
    assertAzureId(repositoryId)
    for (const project of await listProjects()) {
      try {
        return await resolveAuthorizedRepositoryInProject(
          project.id,
          repositoryId
        )
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_FOUND") {
          continue
        }
        throw error
      }
    }
    throw new AppError("NOT_FOUND", NOT_FOUND_MESSAGE)
  }

  return {
    listProjects,
    listRepositories,
    resolveAuthorizedRepository,
    resolveAuthorizedRepositoryInProject,
  }
}

export function listProjects() {
  return createAzureDevOpsClient().listProjects()
}

export function listRepositories(projectId: string) {
  return createAzureDevOpsClient().listRepositories(projectId)
}

export function resolveAuthorizedRepository(repositoryId: string) {
  return createAzureDevOpsClient().resolveAuthorizedRepository(repositoryId)
}

export function resolveAuthorizedRepositoryInProject(
  projectId: string,
  repositoryId: string
) {
  return createAzureDevOpsClient().resolveAuthorizedRepositoryInProject(
    projectId,
    repositoryId
  )
}
