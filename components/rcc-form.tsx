"use client"

import * as React from "react"
import type {
  DeploymentTag,
  ProjectSummary,
  RepositorySummary,
} from "@/lib/rcc/types"
import {
  Combobox,
  ComboboxContent,
  ComboboxControl,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  createComboboxItems,
} from "@/components/ui/combobox"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LoaderCircle, Search } from "lucide-react"

export type RccMode = "initial" | "incremental"
export type LoadingStage = "projects" | "repositories" | "tags" | "rcc" | null

export function formatDeploymentTagLabel(tag: DeploymentTag) {
  const date = tag.commitDate.split("-").reverse().join("/")
  return tag.commitMessage
    ? `${date} · ${tag.sha.slice(0, 7)} · ${tag.commitMessage}`
    : `${tag.name} · ${date}`
}

export function resolveRangeSelection(
  tags: DeploymentTag[],
  fromTag: string,
  toTag: string
): { mode: RccMode; fromTag: string } {
  const fromIndex = tags.findIndex((tag) => tag.name === fromTag)
  const toIndex = tags.findIndex((tag) => tag.name === toTag)
  if (fromIndex >= 0 && fromIndex < toIndex) {
    return { mode: "incremental", fromTag }
  }

  const previousTag = tags[toIndex - 1]
  return previousTag
    ? { mode: "incremental", fromTag: previousTag.name }
    : { mode: "initial", fromTag: "" }
}

interface RccFormProps {
  projects: ProjectSummary[]
  repositories: RepositorySummary[]
  tags: DeploymentTag[]
  projectId: string
  repositoryId: string
  mode: RccMode
  fromTag: string
  toTag: string
  loading: LoadingStage
  onProjectChange(value: string): void
  onRepositoryChange(value: string): void
  onModeChange(value: RccMode): void
  onFromTagChange(value: string): void
  onToTagChange(value: string): void
  onSubmit(): void
}

interface FieldProps {
  id: string
  label: string
  value: string
  placeholder: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange(value: string): void
}

function SelectField({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: FieldProps) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Select
        items={Object.fromEntries(
          options.map((option) => [option.value, option.label])
        )}
        value={value || null}
        onValueChange={(nextValue) => nextValue && onChange(nextValue)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full rounded-xl border-border bg-background"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type FieldOption = FieldProps["options"][number]

function ComboboxField({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: FieldProps) {
  const items = React.useMemo(
    () =>
      createComboboxItems(options, {
        getValue: (option) => option.value,
        getLabel: (option) => option.label,
      }),
    [options]
  )

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Combobox
        items={items}
        autoHighlight
        value={value || null}
        onValueChange={(nextValue) => nextValue && onChange(nextValue)}
        disabled={disabled}
      >
        <ComboboxControl>
          <ComboboxInput id={id} placeholder={placeholder} />
        </ComboboxControl>
        <ComboboxContent>
          <ComboboxEmpty />
          <ComboboxList>
            {(option: FieldOption) => (
              <ComboboxItem key={option.value} value={option.value}>
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

export function RccForm(props: RccFormProps) {
  const busy = props.loading !== null
  const range = resolveRangeSelection(props.tags, props.fromTag, props.toTag)
  const canSubmit =
    !busy &&
    props.repositoryId !== "" &&
    props.toTag !== "" &&
    (props.mode === "initial" ||
      (range.mode === "incremental" && range.fromTag === props.fromTag))

  return (
    <section
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby="rcc-form-title"
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 id="rcc-form-title" className="text-lg font-semibold">
            Configuración del RCC
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Selecciona el repositorio y los despliegues que quieres comparar.
          </p>
        </div>
        {busy && props.loading !== "rcc" && (
          <LoaderCircle
            className="mt-1 size-5 animate-spin text-muted-foreground"
            aria-label="Cargando"
          />
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ComboboxField
          id="project"
          label="Proyecto"
          value={props.projectId}
          placeholder={
            props.loading === "projects"
              ? "Cargando proyectos…"
              : "Selecciona un proyecto"
          }
          options={props.projects.map(({ id, name }) => ({
            value: id,
            label: name,
          }))}
          disabled={busy || props.projects.length === 0}
          onChange={props.onProjectChange}
        />
        <ComboboxField
          id="repository"
          label="Repositorio"
          value={props.repositoryId}
          placeholder={
            props.loading === "repositories"
              ? "Cargando repositorios…"
              : "Selecciona un repositorio"
          }
          options={props.repositories.map(({ id, name }) => ({
            value: id,
            label: name,
          }))}
          disabled={busy || !props.projectId || props.repositories.length === 0}
          onChange={props.onRepositoryChange}
        />
        <SelectField
          id="mode"
          label="Tipo de entrega"
          value={props.mode}
          placeholder="Selecciona el tipo"
          options={[
            { value: "incremental", label: "RCC incremental" },
            { value: "initial", label: "Primer RCC" },
          ]}
          disabled={busy}
          onChange={(value) => props.onModeChange(value as RccMode)}
        />
        {props.mode === "incremental" && (
          <ComboboxField
            id="from-tag"
            label="Entrega anterior"
            value={props.fromTag}
            placeholder="Tag inicial (no se incluye)"
            options={props.tags.map((tag) => ({
              value: tag.name,
              label: formatDeploymentTagLabel(tag),
            }))}
            disabled={busy || !props.repositoryId || props.tags.length === 0}
            onChange={props.onFromTagChange}
          />
        )}
        <ComboboxField
          id="to-tag"
          label={props.mode === "initial" ? "Primera entrega" : "Entrega final"}
          value={props.toTag}
          placeholder="Tag final (sí se incluye)"
          options={props.tags.map((tag) => ({
            value: tag.name,
            label: formatDeploymentTagLabel(tag),
          }))}
          disabled={busy || !props.repositoryId || props.tags.length === 0}
          onChange={props.onToTagChange}
        />
      </div>

      <div className="mt-6 flex justify-end border-t pt-5">
        <Button size="lg" disabled={!canSubmit} onClick={props.onSubmit}>
          {props.loading === "rcc" ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Search data-icon="inline-start" />
          )}
          {props.loading === "rcc" ? "Consultando…" : "Consultar cambios"}
        </Button>
      </div>
    </section>
  )
}
