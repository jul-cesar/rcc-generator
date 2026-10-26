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
    "Tag/Versión",
  ]
  assert.deepEqual(
    headers.map((header) => html.indexOf(header)),
    [...headers]
      .map((header) => html.indexOf(header))
      .sort((left, right) => left - right)
  )
  assert.match(html, />1<\/td>/)
  assert.match(html, />src\/app\.ts<\/td>/)
  assert.match(html, />develop_v1<\/td>/)
  assert.doesNotMatch(html, /Ruta anterior/)
})

test("orders complete rows by tag version from oldest to newest", () => {
  const html = renderToStaticMarkup(
    createElement(RccResults, {
      repositoryName: "repo",
      request: {
        mode: "incremental",
        fromTag: "develop_v1",
        toTag: "develop_v10",
      },
      result: {
        mode: "incremental",
        from: { tag: "develop_v1", sha: "one" },
        to: { tag: "develop_v10", sha: "ten" },
        rows: [
          { path: "src/ten.ts", action: "M", lastChangedTag: "develop_v10" },
          { path: "src/two.ts", action: "M", lastChangedTag: "develop_v2" },
        ],
        warnings: [],
      },
    })
  )

  assert.ok(html.indexOf("src/two.ts") < html.indexOf("src/ten.ts"))
  assert.ok(html.indexOf("develop_v2") < html.indexOf("develop_v10"))
})
