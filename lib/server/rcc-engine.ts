import type {
  DeploymentTag,
  DeploymentTagCatalog,
  RccAction,
  RccResult,
  RccRow,
} from "../rcc/types"
import { AppError } from "./errors"
import { runProcess } from "./process"

export interface RccEngineOptions {
  tagPrefix: string
  integrationBranch: string
}

// One batched pass over refs/tags: the refname, the tag object's own sha, and
// the sha of the dereferenced object for annotated tags. `%(*objectname)` is
// the documented dereferencing shorthand and is empty for lightweight tags,
// which already point at a commit (this git version does not accept the
// explicit `%(peel:objectname)` token). Fields are tab-delimited because NUL
// delimiters cannot travel safely through argv on Windows.
const TAG_LIST_FORMAT =
  "%(refname:short)%09%(*objectname)%09%(objectname)%09%(*committerdate:short)%09%(committerdate:short)"

function parseTagRefs(output: Buffer): DeploymentTag[] {
  const resolved: DeploymentTag[] = []
  for (const line of output.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue
    const [name = "", peel = "", objectId = "", peeledDate = "", date = ""] =
      line.split("\t")
    if (!name) continue
    // Annotated tags need the peeled commit; lightweight tags are commits.
    resolved.push({
      name,
      sha: peel || objectId,
      commitDate: peeledDate || date,
    })
  }
  return resolved
}

async function git(repoPath: string, args: readonly string[]): Promise<Buffer> {
  const result = await runProcess("git", ["--git-dir", repoPath, ...args])
  return result.stdout
}

function lines(output: Buffer): string[] {
  return output
    .toString("utf8")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
}

async function resolveIntegrationBranch(
  repoPath: string,
  configuredBranch: string
): Promise<{ name: string; warnings: string[] }> {
  const [branchRefs, defaultBranchRef] = await Promise.all([
    git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() =>
      Buffer.alloc(0)
    ),
  ])
  const branches = lines(branchRefs)
  if (branches.includes(configuredBranch)) {
    return { name: configuredBranch, warnings: [] }
  }

  const defaultBranch = lines(defaultBranchRef)[0]
  if (defaultBranch && branches.includes(defaultBranch)) {
    return {
      name: defaultBranch,
      warnings: [
        `La rama "${configuredBranch}" no existe; se usará la rama predeterminada "${defaultBranch}".`,
      ],
    }
  }

  throw new AppError(
    "NOT_FOUND",
    `La rama de integración "${configuredBranch}" no existe y el repositorio no tiene una rama predeterminada válida. Ramas disponibles: ${branches.join(", ") || "ninguna"}.`
  )
}

export async function listDeploymentTags(
  repoPath: string,
  options: RccEngineOptions
): Promise<DeploymentTagCatalog> {
  const [tagRefs, branch] = await Promise.all([
    git(repoPath, [
      "for-each-ref",
      "--sort=version:refname",
      `--format=${TAG_LIST_FORMAT}`,
      "refs/tags",
    ]),
    resolveIntegrationBranch(repoPath, options.integrationBranch),
  ])
  const firstParentHistory = await git(repoPath, [
    "rev-list",
    "--first-parent",
    "--reverse",
    `refs/heads/${branch.name}`,
  ])
  const commitPositions = new Map(
    lines(firstParentHistory).map((sha, index) => [sha, index])
  )
  const resolved = parseTagRefs(tagRefs).filter((ref) =>
    ref.name.startsWith(options.tagPrefix)
  )
  const byCommit = new Map<string, DeploymentTag[]>()

  for (const tag of resolved) {
    if (!commitPositions.has(tag.sha)) continue
    const tags = byCommit.get(tag.sha) ?? []
    tags.push(tag)
    byCommit.set(tag.sha, tags)
  }

  const tags: DeploymentTag[] = []
  const ambiguities: DeploymentTagCatalog["ambiguities"] = []

  for (const [sha, commitTags] of byCommit) {
    commitTags.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true })
    )
    if (commitTags.length > 1) {
      ambiguities.push({ sha, tags: commitTags.map((tag) => tag.name) })
    }
    const canonicalTag = commitTags.at(-1)
    if (canonicalTag) tags.push(canonicalTag)
  }

  const byHistory = (left: { sha: string }, right: { sha: string }) =>
    commitPositions.get(left.sha)! - commitPositions.get(right.sha)!

  tags.sort(byHistory)
  ambiguities.sort(byHistory)

  const warnings = [...branch.warnings]
  if (tags.length === 0) {
    warnings.push(
      `No se encontraron tags con el prefijo "${options.tagPrefix}" en la rama "${branch.name}".`
    )
  }

  return { tags, ambiguities, warnings }
}

export interface NameStatusChange {
  status: RccAction | "R"
  path: string
  previousPath?: string
}

export function parseNameStatus(output: Buffer): NameStatusChange[] {
  const fields = output.toString("utf8").split("\0")
  const changes: NameStatusChange[] = []
  let index = 0

  while (index < fields.length && fields[index]) {
    const rawStatus = fields[index++]!
    const statusCode = rawStatus[0]

    if (statusCode === "R") {
      const previousPath = fields[index++]
      const path = fields[index++]
      if (!previousPath || !path) {
        throw new AppError(
          "INTERNAL_ERROR",
          "Salida Git de renombrado incompleta"
        )
      }
      changes.push({ status: "R", path, previousPath })
      continue
    }

    const path = fields[index++]
    if (!path) {
      throw new AppError("INTERNAL_ERROR", "Salida Git de cambio incompleta")
    }
    const status: RccAction =
      statusCode === "A" ? "A" : statusCode === "D" ? "D" : "M"
    changes.push({ status, path })
  }

  return changes
}

export async function generateInitialRcc(
  repoPath: string,
  toTag: string,
  options: RccEngineOptions
): Promise<RccResult> {
  const catalog = await listDeploymentTags(repoPath, options)
  const selected = catalog.tags.find((tag) => tag.name === toTag)
  if (!selected) {
    throw new AppError("NOT_FOUND", `Tag de despliegue no válido: ${toTag}`)
  }

  const paths = (
    await git(repoPath, ["ls-tree", "-r", "-z", "--name-only", selected.sha])
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)

  return {
    mode: "initial",
    to: { tag: selected.name, sha: selected.sha },
    rows: paths.map((path) => ({
      path,
      action: "A",
      lastChangedTag: selected.name,
    })),
    warnings: [],
  }
}

interface ChangeEvent {
  tag: string
  ordinal: number
}

async function diff(repoPath: string, fromSha: string, toSha: string) {
  return parseNameStatus(
    await git(repoPath, ["diff", "--name-status", "-z", "-M", fromSha, toSha])
  )
}

export async function generateIncrementalRcc(
  repoPath: string,
  fromTag: string,
  toTag: string,
  options: RccEngineOptions
): Promise<RccResult> {
  const catalog = await listDeploymentTags(repoPath, options)
  const fromIndex = catalog.tags.findIndex((tag) => tag.name === fromTag)
  const toIndex = catalog.tags.findIndex((tag) => tag.name === toTag)
  if (fromIndex < 0 || toIndex < 0) {
    throw new AppError(
      "NOT_FOUND",
      "Uno o ambos tags están fuera del historial válido"
    )
  }
  if (fromIndex >= toIndex) {
    throw new AppError(
      "CONFLICT",
      "El rango está invertido o no avanza en el historial"
    )
  }

  const from = catalog.tags[fromIndex]!
  const to = catalog.tags[toIndex]!
  const lastEvent = new Map<string, ChangeEvent>()
  const aliasesByPath = new Map<string, Set<string>>()
  let ordinal = 0
  let previous = from

  for (const deployment of catalog.tags.slice(fromIndex + 1, toIndex + 1)) {
    for (const change of await diff(repoPath, previous.sha, deployment.sha)) {
      const event = { tag: deployment.name, ordinal: ordinal++ }
      if (change.status === "R") {
        const aliases =
          aliasesByPath.get(change.previousPath!) ?? new Set<string>()
        aliases.add(change.previousPath!)
        aliases.add(change.path)
        aliasesByPath.delete(change.previousPath!)
        aliasesByPath.set(change.path, aliases)
        for (const alias of aliases) lastEvent.set(alias, event)
        continue
      }

      const aliases =
        change.status === "A"
          ? new Set([change.path])
          : (aliasesByPath.get(change.path) ?? new Set([change.path]))
      aliasesByPath.set(change.path, aliases)
      for (const alias of aliases) lastEvent.set(alias, event)
    }
    previous = deployment
  }

  const consolidated: Array<{ row: RccRow; ordinal: number }> = []
  for (const change of await diff(repoPath, from.sha, to.sha)) {
    const event = lastEvent.get(change.path)
    if (!event) {
      throw new AppError(
        "INTERNAL_ERROR",
        `No se encontró el despliegue del último cambio para ${change.path}`
      )
    }
    consolidated.push({
      row: {
        path: change.path,
        ...(change.status === "R" ? { previousPath: change.previousPath } : {}),
        action: change.status === "R" ? "M" : change.status,
        lastChangedTag: event.tag,
      },
      ordinal: event.ordinal,
    })
  }
  // Rows are serialized in path-lexical order (git ls-tree order); ordinals
  // remain only for lastChangedTag attribution above.
  consolidated.sort((left, right) =>
    left.row.path < right.row.path ? -1 : left.row.path > right.row.path ? 1 : 0
  )

  return {
    mode: "incremental",
    from: { tag: from.name, sha: from.sha },
    to: { tag: to.name, sha: to.sha },
    rows: consolidated.map(({ row }) => row),
    warnings: [],
  }
}
