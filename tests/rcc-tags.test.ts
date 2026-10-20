import assert from "node:assert/strict"
import { afterEach, test } from "node:test"

import { listDeploymentTags } from "../lib/server/rcc-engine"
import { createGitFixture, type GitFixture } from "./helpers/git-fixture"

const fixtures: GitFixture[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()))

function fixture() {
  const value = createGitFixture()
  fixtures.push(value)
  return value
}

test("orders lightweight and annotated deployment tags by first-parent history", async () => {
  const repo = fixture()
  repo.write("app.txt", "one")
  const firstSha = repo.commit("first")
  repo.tag("develop_v1")

  repo.write("app.txt", "two")
  const secondSha = repo.commit("second")
  repo.tag("develop_v2", true)
  repo.tag("release_v2")

  repo.checkout("side", firstSha)
  repo.write("side.txt", "outside")
  repo.commit("side")
  repo.tag("develop_v-side")
  repo.checkout("develop")

  repo.write("app.txt", "three")
  repo.commit("third")
  repo.tag("develop_v3a")
  repo.tag("develop_v3b")
  repo.sync()

  const catalog = await listDeploymentTags(repo.bare, {
    tagPrefix: "develop_v",
    integrationBranch: "develop",
  })

  assert.deepEqual(catalog.tags, [
    { name: "develop_v1", sha: firstSha },
    { name: "develop_v2", sha: secondSha },
  ])
  assert.equal(catalog.ambiguities.length, 1)
  assert.deepEqual(catalog.ambiguities[0]?.tags, ["develop_v3a", "develop_v3b"])
})

test("resolves annotated, lightweight, and duplicate-commit tags in one batched pass", async () => {
  const repo = fixture()
  repo.write("app.txt", "one")
  const firstSha = repo.commit("first")
  repo.tag("develop_v1", true)

  repo.write("app.txt", "two")
  const secondSha = repo.commit("second")
  repo.tag("develop_v2")

  repo.write("app.txt", "three")
  const thirdSha = repo.commit("third")
  repo.tag("develop_v3a", true)
  repo.tag("develop_v3b")
  repo.sync()

  const catalog = await listDeploymentTags(repo.bare, {
    tagPrefix: "develop_v",
    integrationBranch: "develop",
  })

  assert.deepEqual(catalog.tags, [
    { name: "develop_v1", sha: firstSha },
    { name: "develop_v2", sha: secondSha },
  ])
  const ambiguity = catalog.ambiguities[0]
  assert.equal(catalog.ambiguities.length, 1)
  assert.equal(ambiguity?.sha, thirdSha)
  assert.deepEqual(ambiguity?.tags, ["develop_v3a", "develop_v3b"])
})
