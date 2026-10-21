import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatDeploymentTagLabel,
  resolveRangeSelection,
} from "../components/rcc-form"

test("shows the commit date in a deployment tag label", () => {
  assert.equal(
    formatDeploymentTagLabel({
      name: "develop_v1.0.19",
      sha: "abc123",
      commitDate: "2026-10-20",
    }),
    "develop_v1.0.19 · 20/10/2026"
  )
})

const tags = ["1", "2", "3"].map((version) => ({
  name: `develop_v${version}`,
  sha: `sha-${version}`,
  commitDate: "2026-10-20",
}))

test("keeps a valid incremental range", () => {
  assert.deepEqual(resolveRangeSelection(tags, "develop_v1", "develop_v3"), {
    mode: "incremental",
    fromTag: "develop_v1",
  })
})

test("uses the preceding deployment when the range does not advance", () => {
  assert.deepEqual(resolveRangeSelection(tags, "develop_v3", "develop_v3"), {
    mode: "incremental",
    fromTag: "develop_v2",
  })
  assert.deepEqual(resolveRangeSelection(tags, "develop_v3", "develop_v2"), {
    mode: "incremental",
    fromTag: "develop_v1",
  })
})

test("uses initial mode for the first deployment", () => {
  assert.deepEqual(resolveRangeSelection(tags, "", "develop_v1"), {
    mode: "initial",
    fromTag: "",
  })
})
