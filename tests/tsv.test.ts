import assert from "node:assert/strict"
import { test } from "node:test"

import { rccFilename, rowsToTsv } from "../lib/rcc/tsv"

test("formats RCC rows as safe tab-separated text", () => {
  const tsv = rowsToTsv([
    {
      path: "src/archivo ñ.ts",
      action: "A",
      lastChangedTag: "develop_v1",
    },
    {
      path: "src/nuevo\tarchivo.ts",
      previousPath: "src/anterior\narchivo.ts",
      action: "M",
      lastChangedTag: "develop_v2",
    },
  ])

  assert.equal(
    tsv,
    [
      "Orden de Instalación\tPasos\tAcción\tDirectorio|Objeto|\tTag/Versión",
      "1\t\tA\tsrc/archivo ñ.ts\tdevelop_v1",
      "2\t\tM\tsrc/nuevo archivo.ts\tdevelop_v2",
    ].join("\n")
  )
})

test("builds safe initial and incremental TXT filenames", () => {
  assert.equal(
    rccFilename("Mi Repo / API", {
      mode: "initial",
      toTag: "develop_v1.2",
    }),
    "rcc-Mi-Repo-API-develop_v1.2.txt"
  )
  assert.equal(
    rccFilename("Mi Repo / API", {
      mode: "incremental",
      fromTag: "develop_v1.2",
      toTag: "develop_v1.3",
    }),
    "rcc-Mi-Repo-API-develop_v1.2-develop_v1.3.txt"
  )
})
