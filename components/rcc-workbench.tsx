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
import {
  parseRccSearchParams,
  rccSearchParams,
  type RccSearchSelection,
} from "@/lib/rcc/search-params"
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

function requestRcc(repositoryId: string, request: RccRequest) {
  return requestJson<RccResult>(
    `/api/repositories/${encodeURIComponent(repositoryId)}/rcc`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }
  )
}

async function loadSharedSearch(
  selection: RccSearchSelection,
  projects: readonly ProjectSummary[]
) {
  if (!projects.some((project) => project.id === selection.projectId)) {
    throw new Error("El proyecto del enlace compartido ya no está disponible")
  }

  const repositoriesResponse = await requestJson<RepositoriesResponse>(
    `/api/projects/${encodeURIComponent(selection.projectId)}/repositories`
  )
  if (
    !repositoriesResponse.repositories.some(
      (repository) => repository.id === selection.repositoryId
    )
  ) {
    throw new Error(
      "El repositorio del enlace compartido ya no está disponible"
    )
  }

  const tagsResponse = await requestJson<TagsResponse>(
    `/api/repositories/${encodeURIComponent(selection.repositoryId)}/tags?projectId=${encodeURIComponent(selection.projectId)}`
  )
  const requestedTags =
    selection.request.mode === "initial"
      ? [selection.request.toTag]
      : [selection.request.fromTag, selection.request.toTag]
  if (
    requestedTags.some(
      (requestedTag) =>
        !tagsResponse.tags.some((tag) => tag.name === requestedTag)
    )
  ) {
    throw new Error(
      "Uno o más tags del enlace compartido ya no están disponibles"
    )
  }

  return {
    repositories: repositoriesResponse.repositories,
    tags: tagsResponse.tags,
    warnings: tagsResponse.warnings,
    result: await requestRcc(selection.repositoryId, selection.request),
  }
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

    async function load() {
      try {
        const response = await requestJson<ProjectsResponse>("/api/projects")
        if (!active) return
        setProjects(response.projects)

        const params = new URLSearchParams(window.location.search)
        const selection = parseRccSearchParams(params)
        const hasSharedSearch = [
          "project",
          "repository",
          "mode",
          "fromTag",
          "toTag",
        ].some((key) => params.has(key))
        if (!selection) {
          if (hasSharedSearch) {
            throw new Error(
              "El enlace compartido está incompleto o no es válido"
            )
          }
          return
        }

        setLoading("rcc")
        const restored = await loadSharedSearch(selection, response.projects)
        if (!active) return
        setProjectId(selection.projectId)
        setRepositoryId(selection.repositoryId)
        setMode(selection.request.mode)
        setFromTag(
          selection.request.mode === "incremental"
            ? selection.request.fromTag
            : ""
        )
        setToTag(selection.request.toTag)
        setRepositories(restored.repositories)
        setTags(restored.tags)
        setWarnings(restored.warnings)
        setResult(restored.result)
        setLastRequest(selection.request)
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Error desconocido")
        }
      } finally {
        if (active) setLoading(null)
      }
    }

    void load()
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
      const response = await requestRcc(repositoryId, request)
      setResult(response)
      setLastRequest(request)
      const params = rccSearchParams({ projectId, repositoryId, request })
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params}${window.location.hash}`
      )
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
