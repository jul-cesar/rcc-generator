import type { RccRequest, RccRow } from "./types"

const HEADER = "Orden de Instalación\tPasos\tAcción\tDirectorio|Objeto|"

function safeCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ")
}

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function rowsToTsv(rows: readonly RccRow[]): string {
  return [
    HEADER,
    ...rows.map((row, index) =>
      [String(index + 1), "", row.action, row.path].map(safeCell).join("\t")
    ),
  ].join("\n")
}

export function rccFilename(
  repositoryName: string,
  request: RccRequest
): string {
  const parts = [safeFilenamePart(repositoryName)]
  if (request.mode === "incremental")
    parts.push(safeFilenamePart(request.fromTag))
  parts.push(safeFilenamePart(request.toTag))
  return `rcc-${parts.join("-")}.txt`
}
