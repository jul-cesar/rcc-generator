import assert from "node:assert/strict"
import { afterEach, test } from "node:test"

import { generateInitialRcc } from "../lib/server/rcc-engine"
import { createGitFixture, type GitFixture } from "./helpers/git-fixture"

const fixtures: GitFixture[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()))

function fixture() {
  const value = createGitFixture()
  fixtures.push(value)
  return value
}

test("lists every versioned file at the selected tag as added", async () => {
  const repo = fixture()
  repo.write("src/con espacio.txt", "hola")
  repo.write("src/ñandú.ts", "export const ave = true")
  const sha = repo.commit("initial")
  repo.tag("develop_v1", true)
  repo.sync()
  repo.write("solo-local.tmp", "not versioned")

  const result = await generateInitialRcc(repo.bare, "develop_v1", {
    tagPrefix: "develop_v",
    integrationBranch: "develop",
  })

  assert.equal(result.mode, "initial")
  assert.deepEqual(result.to, { tag: "develop_v1", sha })
  assert.deepEqual(
    result.rows
      .map((row) => ({ ...row }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    [
      {
        path: "src/con espacio.txt",
        action: "A",
        lastChangedTag: "develop_v1",
      },
      {
        path: "src/ñandú.ts",
        action: "A",
        lastChangedTag: "develop_v1",
      },
    ].sort((a, b) => a.path.localeCompare(b.path))
  )
  assert.deepEqual(result.warnings, [])
})

test("rejects an ambiguous deployment tag", async () => {
  const repo = fixture()
  repo.write("file.txt", "content")
  repo.commit("initial")
  repo.tag("develop_v1")
  repo.tag("develop_v1-alias")
  repo.sync()

  await assert.rejects(
    generateInitialRcc(repo.bare, "develop_v1", {
      tagPrefix: "develop_v",
      integrationBranch: "develop",
    }),
    /ambiguos/i
  )
})
