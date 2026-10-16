import type {
  AuthorizedRepository,
  ProjectSummary,
  RepositorySummary,
} from "../rcc/types"
import { getServerConfig } from "./config"
import { AppError } from "./errors"
import { runProcess, type ProcessOptions, type ProcessResult } from "./process"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessOptions
) => Promise<ProcessResult>

interface AzureDevOpsDependencies {
  runner?: ProcessRunner
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

function classifyAzureError(error: unknown): AppError {
  if (!(error instanceof AppError) || error.code !== "PROCESS_FAILED") {
    return error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", "Error interno de Azure DevOps")
  }

  const message = error.message.toLowerCase()
  if (/tf401027|forbidden|permission denied|permiso/.test(message)) {
    return new AppError("FORBIDDEN", "El PAT no tiene permisos suficientes")
  }
  if (/tf400813|unauthorized|authentication|401/.test(message)) {
    return new AppError("AUTH_REJECTED", "Azure DevOps rechazó el PAT")
  }
  if (/unable to connect|enotfound|econn|timed? out|conexión/.test(message)) {
    return new AppError(
      "CONNECTION_FAILED",
      "No fue posible conectar con Azure DevOps"
    )
  }
  if (/need to run the login command|az devops login/.test(message)) {
    return new AppError(
      "AUTH_MISSING",
      "Azure CLI no recibió credenciales: verificá AZURE_DEVOPS_EXT_PAT"
    )
  }
  if (/spawn az enoent|az"? (no se reconoce|is not recognized)/.test(message)) {
    return new AppError(
      "PROCESS_FAILED",
      "No se encontró la CLI de Azure (az): instalala o revisá el PATH"
    )
  }
  return new AppError(
    "PROCESS_FAILED",
    "Azure CLI no pudo completar la operación"
  )
}

function parseJson<T>(result: ProcessResult): T {
  try {
    return JSON.parse(result.stdout.toString("utf8")) as T
  } catch (error) {
    throw new AppError("PROCESS_FAILED", "Azure CLI devolvió JSON inválido", {
      cause: error,
    })
  }
}

export function createAzureDevOpsClient(
  dependencies: AzureDevOpsDependencies = {}
) {
  const runner = dependencies.runner ?? runProcess
  const env = dependencies.env ?? process.env

  async function az<T>(args: readonly string[]): Promise<T> {
    const config = getServerConfig(env)
    try {
      const result = await runner(
        "az",
        [...args, "--organization", config.organization, "--output", "json"],
        {
          env: { ...process.env, ...env, AZURE_DEVOPS_EXT_PAT: config.pat },
          secrets: [config.pat],
        }
      )
      return parseJson<T>(result)
    } catch (error) {
      throw classifyAzureError(error)
    }
  }

  async function listProjects(): Promise<ProjectSummary[]> {
    const response = await az<{ value?: AzureProject[] }>([
      "devops",
      "project",
      "list",
    ])
    return (response.value ?? []).map(({ id, name }) => ({ id, name }))
  }

  async function authorizedRepositories(
    projectId: string
  ): Promise<AuthorizedRepository[]> {
    assertAzureId(projectId)
    const repositories = await az<AzureRepository[]>([
      "repos",
      "list",
      "--project",
      projectId,
    ])
    return repositories.map((repository) => ({
      id: repository.id,
      name: repository.name,
      projectId: repository.project?.id || projectId,
      remoteUrl: repository.remoteUrl,
    }))
  }

  async function listRepositories(
    projectId: string
  ): Promise<RepositorySummary[]> {
    return (await authorizedRepositories(projectId)).map(({ id, name }) => ({
      id,
      name,
    }))
  }

  async function resolveAuthorizedRepository(
    repositoryId: string
  ): Promise<AuthorizedRepository> {
    assertAzureId(repositoryId)
    for (const project of await listProjects()) {
      const repository = (await authorizedRepositories(project.id)).find(
        (candidate) => candidate.id === repositoryId
      )
      if (repository) return repository
    }
    throw new AppError(
      "NOT_FOUND",
      "Repositorio no disponible para este usuario"
    )
  }

  return { listProjects, listRepositories, resolveAuthorizedRepository }
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
