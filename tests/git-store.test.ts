import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, test } from "node:test"

import type { AuthorizedRepository } from "../lib/rcc/types"
import { createGitStore } from "../lib/server/git-store"
import type { ProcessOptions, ProcessResult } from "../lib/server/process"

const roots: string[] = []
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }))
)

const env = { AZURE_DEVOPS_EXT_PAT: "secret-pat" }
const repository: AuthorizedRepository = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Repo",
  projectId: "11111111-1111-4111-8111-111111111111",
  remoteUrl: "https://alianzaapps@dev.azure.com/alianzaapps/Project/_git/Repo",
}

type Runner = (
  command: string,
  args: readonly string[],
  options?: ProcessOptions
) => Promise<ProcessResult>

function root() {
  const value = mkdtempSync(path.join(tmpdir(), "rcc-store-"))
  roots.push(value)
  return value
}

function success(): ProcessResult {
  return { stdout: Buffer.alloc(0), stderr: "", exitCode: 0 }
}

test("clones bare without putting credentials in arguments or remote URL", async () => {
  const calls: Array<{
    command: string
    args: readonly string[]
    options?: ProcessOptions
  }> = []
  const runner: Runner = async (command, args, options) => {
    calls.push({ command, args, options })
    mkdirSync(args.at(-1)!, { recursive: true })
    return success()
  }
  const store = createGitStore({ runner, env, root: root() })

  await store.withUpdatedRepository(repository, async (repoPath) => repoPath)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.command, "git")
  assert.deepEqual(calls[0]?.args.slice(0, 2), ["clone", "--bare"])
  assert.equal(calls[0]?.args.join(" ").includes("secret-pat"), false)
  assert.equal(calls[0]?.args.join(" ").includes("@dev.azure.com"), false)
  assert.equal(calls[0]?.options?.env?.GIT_CONFIG_KEY_0, "http.extraHeader")
  assert.match(
    calls[0]?.options?.env?.GIT_CONFIG_VALUE_0 ?? "",
    /^Authorization: Basic /
  )
})

test("shares one update between concurrent operations for one repository", async () => {
  let updates = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const runner: Runner = async (_command, args) => {
    updates += 1
    await gate
    mkdirSync(args.at(-1)!, { recursive: true })
    return success()
  }
  const store = createGitStore({ runner, env, root: root() })

  const first = store.withUpdatedRepository(repository, async () => "first")
  const second = store.withUpdatedRepository(repository, async () => "second")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updates, 1)
  release()

  assert.deepEqual(await Promise.all([first, second]), ["first", "second"])
  assert.equal(updates, 1)
})

test("updates different repositories independently", async () => {
  let active = 0
  let maxActive = 0
  const runner: Runner = async (_command, args) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    mkdirSync(args.at(-1)!, { recursive: true })
    active -= 1
    return success()
  }
  const store = createGitStore({ runner, env, root: root() })
  const other = {
    ...repository,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Other",
  }

  await Promise.all([
    store.withUpdatedRepository(repository, async () => undefined),
    store.withUpdatedRepository(other, async () => undefined),
  ])

  assert.equal(maxActive, 2)
})

test("fetches existing clones with explicit head and tag refspecs", async () => {
  const storeRoot = root()
  mkdirSync(path.join(storeRoot, `${repository.id}.git`))
  const calls: readonly string[][] = []
  const mutableCalls = calls as string[][]
  const runner: Runner = async (_command, args) => {
    mutableCalls.push([...args])
    return success()
  }
  const store = createGitStore({ runner, env, root: storeRoot })

  await store.withUpdatedRepository(repository, async () => undefined)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.includes("--prune"), true)
  assert.equal(calls[0]?.includes("+refs/heads/*:refs/heads/*"), true)
  assert.equal(calls[0]?.includes("+refs/tags/*:refs/tags/*"), true)
})
