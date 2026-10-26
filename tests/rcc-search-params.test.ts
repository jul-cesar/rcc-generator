import assert from "node:assert/strict"
import { test } from "node:test"

import { parseRccSearchParams, rccSearchParams } from "../lib/rcc/search-params"

test("round-trips a shareable incremental RCC search", () => {
  const selection = {
    projectId: "project-id",
    repositoryId: "repository-id",
    request: {
      mode: "incremental" as const,
      fromTag: "develop_v2",
      toTag: "develop_v10",
    },
  }

  assert.deepEqual(parseRccSearchParams(rccSearchParams(selection)), selection)
})

test("rejects incomplete shared searches", () => {
  assert.equal(
    parseRccSearchParams(new URLSearchParams("project=one&mode=initial")),
    null
  )
})
