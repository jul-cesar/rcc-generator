import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { RccResults } from "../components/rcc-results"

test("renders the Excel column order and installation sequence", () => {
  const html = renderToStaticMarkup(
    createElement(RccResults, {
      repositoryName: "repo",
      request: { mode: "initial", toTag: "develop_v1" },
      result: {
        mode: "initial",
        to: { tag: "develop_v1", sha: "abc123" },
        rows: [
          {
            path: "src/app.ts",
            action: "A",
            lastChangedTag: "develop_v1",
          },
        ],
        warnings: [],
      },
    })
  )

  const headers = [
    "Orden de Instalación",
    "Pasos",
    "Acción",
    "Directorio|Objeto|",
  ]
  assert.deepEqual(
    headers.map((header) => html.indexOf(header)),
    [...headers]
      .map((header) => html.indexOf(header))
      .sort((left, right) => left - right)
  )
  assert.match(html, />1<\/td>/)
  assert.match(html, />src\/app\.ts<\/td>/)
  assert.doesNotMatch(html, /Ruta anterior|Último tag/)
})
