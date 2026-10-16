import assert from "node:assert/strict"
import { afterEach, test } from "node:test"

import {
  generateIncrementalRcc,
  parseNameStatus,
} from "../lib/server/rcc-engine"
import { createGitFixture, type GitFixture } from "./helpers/git-fixture"

const options = { tagPrefix: "develop_v", integrationBranch: "develop" }
const fixtures: GitFixture[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()))

function fixture() {
  const value = createGitFixture()
  fixtures.push(value)
  return value
}

test("consolidates net changes with their last deployment tag", async () => {
  const repo = fixture()
  repo.write("multi.txt", "one")
  repo.write("deleted.txt", "remove me")
  repo.write("reverted.txt", "original")
  repo.commit("v1")
  repo.tag("develop_v1")

  repo.write("multi.txt", "two")
  repo.write("added.txt", "first")
  repo.write("reverted.txt", "temporary")
  repo.remove("deleted.txt")
  repo.commit("v2")
  repo.tag("develop_v2")

  repo.write("multi.txt", "three")
  repo.write("added.txt", "second")
  repo.write("reverted.txt", "original")
  repo.commit("v3")
  repo.tag("develop_v3")

  repo.commit("empty deployment")
  repo.tag("develop_v4")
  repo.sync()

  const result = await generateIncrementalRcc(
    repo.bare,
    "develop_v1",
    "develop_v3",
    options,
  )

  assert.deepEqual(
    result.rows.map(({ path, action, lastChangedTag }) => ({
      path,
      action,
      lastChangedTag,
    })),
    [
      { path: "deleted.txt", action: "D", lastChangedTag: "develop_v2" },
      { path: "added.txt", action: "A", lastChangedTag: "develop_v3" },
      { path: "multi.txt", action: "M", lastChangedTag: "develop_v3" },
    ],
  )
  assert.equal(result.rows.some((row) => row.path === "reverted.txt"), false)

  const unchanged = await generateIncrementalRcc(
    repo.bare,
    "develop_v3",
    "develop_v4",
    options,
  )
  assert.deepEqual(unchanged.rows, [])
})

test("tracks a rename followed by modification", async () => {
  const repo = fixture()
  const original = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n")
  repo.write("src/old name.txt", original)
  repo.commit("v1")
  repo.tag("develop_v1")

  repo.rename("src/old name.txt", "src/nuevo ñ.txt")
  repo.commit("rename")
  repo.tag("develop_v2")

  repo.write("src/nuevo ñ.txt", `${original}\nlast line`)
  repo.commit("modify renamed file")
  repo.tag("develop_v3")
  repo.sync()

  const result = await generateIncrementalRcc(
    repo.bare,
    "develop_v1",
    "develop_v3",
    options,
  )

  assert.deepEqual(result.rows, [
    {
      path: "src/nuevo ñ.txt",
      previousPath: "src/old name.txt",
      action: "M",
      lastChangedTag: "develop_v3",
    },
  ])
})

test("includes changes introduced by a merge", async () => {
  const repo = fixture()
  repo.write("base.txt", "base")
  repo.commit("base")
  repo.tag("develop_v1")

  repo.checkout("feature", "develop")
  repo.write("merged.txt", "from feature")
  repo.commit("feature")
  repo.checkout("develop")
  repo.merge("feature")
  repo.tag("develop_v2")
  repo.sync()

  const result = await generateIncrementalRcc(
    repo.bare,
    "develop_v1",
    "develop_v2",
    options,
  )

  assert.deepEqual(result.rows, [
    {
      path: "merged.txt",
      action: "A",
      lastChangedTag: "develop_v2",
    },
  ])
})

test("rejects inverted, divergent, and ambiguous histories", async () => {
  const repo = fixture()
  repo.write("file.txt", "one")
  const first = repo.commit("v1")
  repo.tag("develop_v1")

  repo.write("file.txt", "two")
  repo.commit("v2")
  repo.tag("develop_v2")
  repo.tag("develop_v2-alias")

  repo.write("file.txt", "three")
  repo.commit("v3")
  repo.tag("develop_v3")

  repo.checkout("side", first)
  repo.write("side.txt", "side")
  repo.commit("side")
  repo.tag("develop_v-side")
  repo.checkout("develop")
  repo.sync()

  await assert.rejects(
    generateIncrementalRcc(repo.bare, "develop_v3", "develop_v1", options),
    /invertido/i,
  )
  await assert.rejects(
    generateIncrementalRcc(repo.bare, "develop_v-side", "develop_v3", options),
    /historial|válido/i,
  )
  await assert.rejects(
    generateIncrementalRcc(repo.bare, "develop_v1", "develop_v3", options),
    /ambiguos/i,
  )
})

test("parses NUL-delimited add, modify, delete, and rename records", () => {
  const output = Buffer.from(
    "M\0a b.txt\0A\0tab\tfile.txt\0D\0ñ.txt\0R100\0old.txt\0new.txt\0",
  )

  assert.deepEqual(parseNameStatus(output), [
    { status: "M", path: "a b.txt" },
    { status: "A", path: "tab\tfile.txt" },
    { status: "D", path: "ñ.txt" },
    { status: "R", path: "new.txt", previousPath: "old.txt" },
  ])
})
