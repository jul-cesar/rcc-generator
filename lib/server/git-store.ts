import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"

import type { AuthorizedRepository } from "../rcc/types"
import { getServerConfig } from "./config"
import { AppError } from "./errors"
import {
  runProcess,
  type ProcessOptions,
  type ProcessResult,
} from "./process"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: ProcessOptions,
) => Promise<ProcessResult>

interface GitStoreDependencies {
  runner?: ProcessRunner
  env?: Readonly<Record<string, string | undefined>>
  root?: string
}

function safeRemoteUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError("INVALID_INPUT", "URL de repositorio inválida")
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "dev.azure.com" ||
    !url.pathname.toLowerCase().startsWith("/alianzaapps/")
  ) {
    throw new AppError("INVALID_INPUT", "El repositorio no pertenece a la organización autorizada")
  }
  url.username = ""
  url.password = ""
  return url.toString()
}

export function createGitStore(dependencies: GitStoreDependencies = {}) {
  const runner = dependencies.runner ?? runProcess
  const env = dependencies.env ?? process.env
  const root = dependencies.root ?? path.join(process.cwd(), ".data", "repositories")
  const updates = new Map<string, Promise<string>>()

  async function updateRepository(repository: AuthorizedRepository): Promise<string> {
    if (!UUID_PATTERN.test(repository.id)) {
      throw new AppError("INVALID_INPUT", "Identificador de repositorio inválido")
    }
    const config = getServerConfig(env)
    const header = `Authorization: Basic ${Buffer.from(`:${config.pat}`).toString("base64")}`
    const processOptions: ProcessOptions = {
      env: {
        ...process.env,
        ...env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: header,
      },
      secrets: [config.pat, header],
    }
    const repoPath = path.join(root, `${repository.id}.git`)

    mkdirSync(root, { recursive: true })
    if (!existsSync(repoPath)) {
      await runner(
        "git",
        ["clone", "--bare", safeRemoteUrl(repository.remoteUrl), repoPath],
        processOptions,
      )
    } else {
      await runner(
        "git",
        [
          "--git-dir",
          repoPath,
          "fetch",
          "--prune",
          "origin",
          "+refs/heads/*:refs/heads/*",
          "+refs/tags/*:refs/tags/*",
        ],
        processOptions,
      )
    }
    return repoPath
  }

  function sharedUpdate(repository: AuthorizedRepository): Promise<string> {
    const active = updates.get(repository.id)
    if (active) return active

    const update = updateRepository(repository).finally(() => {
      if (updates.get(repository.id) === update) updates.delete(repository.id)
    })
    updates.set(repository.id, update)
    return update
  }

  async function withUpdatedRepository<T>(
    repository: AuthorizedRepository,
    operation: (repoPath: string) => Promise<T>,
  ): Promise<T> {
    return operation(await sharedUpdate(repository))
  }

  return { withUpdatedRepository }
}

const defaultStore = createGitStore()

export function withUpdatedRepository<T>(
  repository: AuthorizedRepository,
  operation: (repoPath: string) => Promise<T>,
): Promise<T> {
  return defaultStore.withUpdatedRepository(repository, operation)
}
