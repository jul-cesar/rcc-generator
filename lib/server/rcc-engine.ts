import type {
  DeploymentTag,
  DeploymentTagCatalog,
  RccResult,
} from "../rcc/types"
import { AppError } from "./errors"
import { runProcess } from "./process"

export interface RccEngineOptions {
  tagPrefix: string
  integrationBranch: string
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

export async function listDeploymentTags(
  repoPath: string,
  options: RccEngineOptions,
): Promise<DeploymentTagCatalog> {
  const [tagNames, firstParentHistory] = await Promise.all([
    git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/tags"]),
    git(repoPath, [
      "rev-list",
      "--first-parent",
      "--reverse",
      `refs/heads/${options.integrationBranch}`,
    ]),
  ])
  const commitPositions = new Map(
    lines(firstParentHistory).map((sha, index) => [sha, index]),
  )
  const resolved = await Promise.all(
    lines(tagNames)
      .filter((name) => name.startsWith(options.tagPrefix))
      .map(async (name): Promise<DeploymentTag> => {
        const sha = (
          await git(repoPath, [
            "rev-parse",
            "--verify",
            `refs/tags/${name}^{commit}`,
          ])
        )
          .toString("utf8")
          .trim()
        return { name, sha }
      }),
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
    commitTags.sort((left, right) => left.name.localeCompare(right.name))
    if (commitTags.length > 1) {
      ambiguities.push({ sha, tags: commitTags.map((tag) => tag.name) })
    } else {
      tags.push(commitTags[0]!)
    }
  }

  const byHistory = (left: { sha: string }, right: { sha: string }) =>
    commitPositions.get(left.sha)! - commitPositions.get(right.sha)!

  tags.sort(byHistory)
  ambiguities.sort(byHistory)

  return { tags, ambiguities }
}

export async function generateInitialRcc(
  repoPath: string,
  toTag: string,
  options: RccEngineOptions,
): Promise<RccResult> {
  const catalog = await listDeploymentTags(repoPath, options)
  const ambiguity = catalog.ambiguities.find((item) => item.tags.includes(toTag))

  if (ambiguity) {
    throw new AppError(
      "CONFLICT",
      `Tags de despliegue ambiguos para ${ambiguity.sha}: ${ambiguity.tags.join(", ")}`,
    )
  }

  const selected = catalog.tags.find((tag) => tag.name === toTag)
  if (!selected) {
    throw new AppError("NOT_FOUND", `Tag de despliegue no válido: ${toTag}`)
  }

  const paths = (await git(repoPath, ["ls-tree", "-r", "-z", "--name-only", selected.sha]))
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
