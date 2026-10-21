export type RccAction = "A" | "M" | "D"

export interface RccRow {
  path: string
  previousPath?: string
  action: RccAction
  lastChangedTag: string
}

export interface DeploymentTag {
  name: string
  sha: string
  commitDate: string
  commitMessage?: string
}

export interface TagAmbiguity {
  sha: string
  tags: string[]
}

export interface DeploymentTagCatalog {
  tags: DeploymentTag[]
  ambiguities: TagAmbiguity[]
  warnings: string[]
}

export interface TagReference {
  tag: string
  sha: string
}

export interface RccResult {
  mode: "initial" | "incremental"
  from?: TagReference
  to: TagReference
  rows: RccRow[]
  warnings: string[]
}

export interface ProjectSummary {
  id: string
  name: string
}

export interface RepositorySummary {
  id: string
  name: string
}

export interface AuthorizedRepository extends RepositorySummary {
  projectId: string
  remoteUrl: string
}

export type RccRequest =
  | { mode: "initial"; toTag: string }
  | { mode: "incremental"; fromTag: string; toTag: string }
