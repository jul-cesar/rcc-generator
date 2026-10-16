"use client"

import { useEffect, useState } from "react"
import { AlertCircle, GitBranch, Info, ShieldCheck } from "lucide-react"

import { RccForm, type LoadingStage, type RccMode } from "@/components/rcc-form"
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
    throw new Error(body.error?.message || "No fue posible completar la solicitud")
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
        if (active) setError(cause instanceof Error ? cause.message : "Error desconocido")
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
        `/api/projects/${encodeURIComponent(value)}/repositories`,
      )
      setRepositories(response.repositories)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar repositorios")
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
        `/api/repositories/${encodeURIComponent(value)}/tags`,
      )
      setTags(response.tags)
      setWarnings(response.warnings)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar tags")
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
      mode === "initial"
        ? { mode, toTag }
        : { mode, fromTag, toTag }
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
        },
      )
      setResult(response)
      setLastRequest(request)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible generar el RCC")
    } finally {
      setLoading(null)
    }
  }

  const repositoryName =
    repositories.find((repository) => repository.id === repositoryId)?.name ??
    "repositorio"

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-col gap-5 rounded-3xl border bg-card/70 p-6 shadow-sm backdrop-blur sm:p-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            <GitBranch className="size-3.5" />
            Azure DevOps · develop
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Generador de RCC
          </h1>
          <p className="mt-3 text-pretty text-muted-foreground sm:text-lg">
            Consolida cambios entre entregas, identifica el último tag y exporta el resultado listo para Excel.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          El PAT permanece en este equipo
        </div>
      </header>

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
          <AlertTitle>Advertencia de tags</AlertTitle>
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
    </div>
  )
}
