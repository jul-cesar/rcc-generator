import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
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
  const thirdSha = repo.commit("third")
  repo.tag("develop_v3a")
  repo.tag("develop_v3b")
  repo.sync()

  const catalog = await listDeploymentTags(repo.bare, {
    tagPrefix: "develop_v",
    integrationBranch: "develop",
  })

  assert.deepEqual(
    catalog.tags.map(({ name, sha }) => ({ name, sha })),
    [
      { name: "develop_v1", sha: firstSha },
      { name: "develop_v2", sha: secondSha },
      { name: "develop_v3b", sha: thirdSha },
    ]
  )
  for (const tag of catalog.tags) {
    assert.match(tag.commitDate, /^\d{4}-\d{2}-\d{2}$/)
  }
  assert.equal(catalog.ambiguities.length, 1)
  assert.deepEqual(catalog.ambiguities[0]?.tags, ["develop_v3a", "develop_v3b"])
})

test("uses the highest version as canonical for duplicate-commit tags", async () => {
  const repo = fixture()
  repo.write("app.txt", "one")
  const firstSha = repo.commit("first")
  repo.tag("develop_v1", true)

  repo.write("app.txt", "two")
  const secondSha = repo.commit("second")
  repo.tag("develop_v2")

  repo.write("app.txt", "three")
  const thirdSha = repo.commit("third")
  repo.tag("develop_v1.0.9", true)
  repo.tag("develop_v1.0.10")
  repo.sync()

  const catalog = await listDeploymentTags(repo.bare, {
    tagPrefix: "develop_v",
    integrationBranch: "develop",
  })

  assert.deepEqual(
    catalog.tags.map(({ name, sha }) => ({ name, sha })),
    [
      { name: "develop_v1", sha: firstSha },
      { name: "develop_v2", sha: secondSha },
      { name: "develop_v1.0.10", sha: thirdSha },
    ]
  )
  const ambiguity = catalog.ambiguities[0]
  assert.equal(catalog.ambiguities.length, 1)
  assert.equal(ambiguity?.sha, thirdSha)
  assert.deepEqual(ambiguity?.tags, ["develop_v1.0.9", "develop_v1.0.10"])
})

test("falls back to the repository default branch", async () => {
  const repo = fixture()
  repo.write("app.txt", "one")
  const sha = repo.commit("first")
  repo.tag("develop_v1")
  repo.sync()
  execFileSync(
    "git",
    ["--git-dir", repo.bare, "symbolic-ref", "HEAD", "refs/heads/develop"],
    { stdio: "ignore" }
  )

  const catalog = await listDeploymentTags(repo.bare, {
    tagPrefix: "develop_v",
    integrationBranch: "missing",
  })

  assert.deepEqual(
    catalog.tags.map(({ name, sha: tagSha }) => ({ name, sha: tagSha })),
    [{ name: "develop_v1", sha }]
  )
  assert.deepEqual(catalog.warnings, [
    'La rama "missing" no existe; se usará la rama predeterminada "develop".',
  ])
})

test("falls back to commits when the selected branch has no deployment tags", async () => {
  const repo = fixture()
  repo.write("app.txt", "one")
  const firstSha = repo.commit("first")
  repo.write("app.txt", "two")
  const secondSha = repo.commit("second")
  repo.sync()

  const catalog = await listDeploymentTags(repo.bare, {
    tagPrefix: "develop_v",
    integrationBranch: "develop",
  })

  assert.deepEqual(
    catalog.tags.map(({ name, sha, commitMessage }) => ({
      name,
      sha,
      commitMessage,
    })),
    [
      { name: firstSha, sha: firstSha, commitMessage: "first" },
      { name: secondSha, sha: secondSha, commitMessage: "second" },
    ]
  )
  for (const commit of catalog.tags) {
    assert.match(commit.commitDate, /^\d{4}-\d{2}-\d{2}$/)
  }
  assert.deepEqual(catalog.warnings, [
    'No se encontraron tags con el prefijo "develop_v" en la rama "develop"; se usarán hasta los últimos 200 commits.',
  ])
})

test("reports a friendly error when no integration branch can be resolved", async () => {
  const repo = fixture()
  repo.write("app.txt", "one")
  repo.commit("first")
  repo.sync()
  execFileSync(
    "git",
    [
      "--git-dir",
      repo.bare,
      "symbolic-ref",
      "HEAD",
      "refs/heads/missing-default",
    ],
    { stdio: "ignore" }
  )

  await assert.rejects(
    listDeploymentTags(repo.bare, {
      tagPrefix: "develop_v",
      integrationBranch: "missing",
    }),
    /rama de integración.*no existe.*Ramas disponibles: develop/i
  )
})
