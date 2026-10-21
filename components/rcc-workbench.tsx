"use client"

import { useEffect, useState } from "react"
import { AlertCircle, GitBranch, Info } from "lucide-react"

import {
  RccForm,
  resolveRangeSelection,
  type LoadingStage,
  type RccMode,
} from "@/components/rcc-form"
import { RccLoadingOverlay } from "@/components/rcc-loading-overlay"
import { RccResults } from "@/components/rcc-results"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type {
  DeploymentTag,
  ProjectSummary,
  RccRequest,
  RccResult,
  RepositorySummary,
} from "@/lib/rcc/types"

interface ProjectsResponse {
  projects: ProjectSummary[]
}

interface RepositoriesResponse {
  repositories: RepositorySummary[]
}

interface TagsResponse {
  tags: DeploymentTag[]
  warnings: string[]
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json()) as T & {
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(
      body.error?.message || "No fue posible completar la solicitud"
    )
  }
  return body
}

export function RccWorkbench() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [repositories, setRepositories] = useState<RepositorySummary[]>([])
  const [tags, setTags] = useState<DeploymentTag[]>([])
  const [projectId, setProjectId] = useState("")
  const [repositoryId, setRepositoryId] = useState("")
  const [mode, setMode] = useState<RccMode>("incremental")
  const [fromTag, setFromTag] = useState("")
  const [toTag, setToTag] = useState("")
  const [loading, setLoading] = useState<LoadingStage>("projects")
  const [error, setError] = useState("")
  const [warnings, setWarnings] = useState<string[]>([])
  const [result, setResult] = useState<RccResult | null>(null)
  const [lastRequest, setLastRequest] = useState<RccRequest | null>(null)

  useEffect(() => {
    let active = true
    requestJson<ProjectsResponse>("/api/projects")
      .then((response) => {
        if (active) setProjects(response.projects)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Error desconocido")
      })
      .finally(() => {
        if (active) setLoading(null)
      })
    return () => {
      active = false
    }
  }, [])

  function clearRepositorySelection() {
    setRepositoryId("")
    setRepositories([])
    setTags([])
    setFromTag("")
    setToTag("")
    setWarnings([])
    setResult(null)
    setLastRequest(null)
  }

  async function selectProject(value: string) {
    setProjectId(value)
    clearRepositorySelection()
    setError("")
    setLoading("repositories")
    try {
      const response = await requestJson<RepositoriesResponse>(
        `/api/projects/${encodeURIComponent(value)}/repositories`
      )
      setRepositories(response.repositories)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible cargar repositorios"
      )
    } finally {
      setLoading(null)
    }
  }

  async function selectRepository(value: string) {
    setRepositoryId(value)
    setTags([])
    setFromTag("")
    setToTag("")
    setWarnings([])
    setResult(null)
    setLastRequest(null)
    setError("")
    setLoading("tags")
    try {
      const response = await requestJson<TagsResponse>(
        // projectId lets the server resolve the repository in one REST call
        // instead of scanning every accessible project.
        `/api/repositories/${encodeURIComponent(value)}/tags?projectId=${encodeURIComponent(projectId)}`
      )
      setTags(response.tags)
      setWarnings(response.warnings)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible cargar tags"
      )
    } finally {
      setLoading(null)
    }
  }

  function selectMode(value: RccMode) {
    setMode(value)
    setFromTag("")
    setToTag("")
    setResult(null)
    setLastRequest(null)
    setError("")
  }

  async function generateRcc() {
    const request: RccRequest =
      mode === "initial" ? { mode, toTag } : { mode, fromTag, toTag }
    setLoading("rcc")
    setError("")
    setResult(null)
    try {
      const response = await requestJson<RccResult>(
        `/api/repositories/${encodeURIComponent(repositoryId)}/rcc`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }
      )
      setResult(response)
      setLastRequest(request)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible generar el RCC"
      )
    } finally {
      setLoading(null)
    }
  }

  const repositoryName =
    repositories.find((repository) => repository.id === repositoryId)?.name ??
    "repositorio"

  // Only the RCC generation request gets the full-screen overlay; the quick
  // cascading select loads keep their inline placeholder texts.
  const generatingRcc = loading === "rcc"

  return (
    <div
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-8 sm:px-6 sm:pt-8 sm:pb-10 lg:px-8 lg:pb-12 xl:max-w-[1440px] 2xl:max-w-[1680px]"
      aria-busy={generatingRcc ? true : undefined}
    >
      {/* The app header (RccHeader) now carries the page title; this slim row
          keeps the context badge and description without repeating it. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            <GitBranch className="size-3.5" />
            Azure DevOps · develop
          </div>
          <p className="text-sm text-pretty text-muted-foreground sm:text-base">
            Consolida cambios entre entregas, identifica el último tag y exporta
            el resultado listo para Excel.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>No se pudo completar la operación</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {warnings.map((warning) => (
        <Alert key={warning}>
          <Info />
          <AlertTitle>Advertencia del repositorio</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <RccForm
        projects={projects}
        repositories={repositories}
        tags={tags}
        projectId={projectId}
        repositoryId={repositoryId}
        mode={mode}
        fromTag={fromTag}
        toTag={toTag}
        loading={loading}
        onProjectChange={(value) => void selectProject(value)}
        onRepositoryChange={(value) => void selectRepository(value)}
        onModeChange={selectMode}
        onFromTagChange={(value) => {
          setFromTag(value)
          setResult(null)
        }}
        onToTagChange={(value) => {
          setToTag(value)
          if (mode === "incremental") {
            const range = resolveRangeSelection(tags, fromTag, value)
            setMode(range.mode)
            setFromTag(range.fromTag)
          }
          setResult(null)
        }}
        onSubmit={() => void generateRcc()}
      />

      {result && lastRequest ? (
        <RccResults
          result={result}
          request={lastRequest}
          repositoryName={repositoryName}
        />
      ) : (
        <section className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Los resultados aparecerán aquí después de consultar un rango.
        </section>
      )}

      <RccLoadingOverlay open={generatingRcc} />
    </div>
  )
}
