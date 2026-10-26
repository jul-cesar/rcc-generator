import type { RccRequest } from "./types"

export interface RccSearchSelection {
  projectId: string
  repositoryId: string
  request: RccRequest
}

export function rccSearchParams(
  selection: RccSearchSelection
): URLSearchParams {
  const params = new URLSearchParams({
    project: selection.projectId,
    repository: selection.repositoryId,
    mode: selection.request.mode,
    toTag: selection.request.toTag,
  })
  if (selection.request.mode === "incremental") {
    params.set("fromTag", selection.request.fromTag)
  }
  return params
}

export function parseRccSearchParams(
  params: URLSearchParams
): RccSearchSelection | null {
  const projectId = params.get("project")
  const repositoryId = params.get("repository")
  const mode = params.get("mode")
  const toTag = params.get("toTag")
  if (!projectId || !repositoryId || !toTag) return null

  if (mode === "initial") {
    return { projectId, repositoryId, request: { mode, toTag } }
  }
  const fromTag = params.get("fromTag")
  return mode === "incremental" && fromTag
    ? { projectId, repositoryId, request: { mode, fromTag, toTag } }
    : null
}
