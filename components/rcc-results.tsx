"use client"

import { useState } from "react"
import { Check, Clipboard, Download, FileDiff } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RccRequest, RccResult } from "@/lib/rcc/types"
import { rccFilename, rowsToTsv } from "@/lib/rcc/tsv"

interface RccResultsProps {
  result: RccResult
  request: RccRequest
  repositoryName: string
}

export function RccResults({
  result,
  request,
  repositoryName,
}: RccResultsProps) {
  const [copied, setCopied] = useState(false)
  const content = rowsToTsv(result.rows)

  async function copyRows() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function downloadRows() {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/tab-separated-values;charset=utf-8" })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = rccFilename(repositoryName, request)
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      aria-labelledby="results-title"
    >
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <FileDiff className="size-5 text-primary" />
            <h2 id="results-title" className="text-lg font-semibold">
              Resultado
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.rows.length}{" "}
            {result.rows.length === 1 ? "archivo" : "archivos"} con diferencia
            neta
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void copyRows()}>
            {copied ? (
              <Check data-icon="inline-start" />
            ) : (
              <Clipboard data-icon="inline-start" />
            )}
            {copied ? "Copiado" : "Copiar para Excel"}
          </Button>
          <Button variant="secondary" onClick={downloadRows}>
            <Download data-icon="inline-start" />
            Descargar TXT
          </Button>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <div className="space-y-2 border-b p-5 sm:p-6">
          {result.warnings.map((warning) => (
            <Alert key={warning}>
              <AlertTitle>Advertencia</AlertTitle>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {result.rows.length === 0 ? (
        <div className="p-8 text-center sm:p-12">
          <p className="font-medium">El rango no contiene cambios netos.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Los cambios revertidos por completo no se incluyen en el RCC.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ruta</TableHead>
                <TableHead>Ruta anterior</TableHead>
                <TableHead className="w-24">Acción</TableHead>
                <TableHead>Último tag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={`${row.action}:${row.path}`}>
                  <TableCell className="font-mono text-xs">
                    {row.path}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.previousPath ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex min-w-7 justify-center rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                      {row.action}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.lastChangedTag}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {copied ? "Datos copiados al portapapeles" : ""}
      </p>
    </section>
  )
}
