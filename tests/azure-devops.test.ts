import assert from "node:assert/strict"
import { test } from "node:test"

import { createAzureDevOpsClient } from "../lib/server/azure-devops"
import { AppError } from "../lib/server/errors"
import type { ProcessOptions, ProcessResult } from "../lib/server/process"

const PROJECT_ONE = "11111111-1111-4111-8111-111111111111"
const PROJECT_TWO = "22222222-2222-4222-8222-222222222222"
const REPOSITORY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const env = { AZURE_DEVOPS_EXT_PAT: "test-pat" }

type Runner = (
  command: string,
  args: readonly string[],
  options?: ProcessOptions
) => Promise<ProcessResult>

function result(value: unknown): ProcessResult {
  return { stdout: Buffer.from(JSON.stringify(value)), stderr: "", exitCode: 0 }
}

test("discovers projects and resolves repositories inside the authorized catalog", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const runner: Runner = async (command, args) => {
    calls.push({ command, args })
    if (args[0] === "devops") {
      return result({
        value: [
          { id: PROJECT_ONE, name: "Uno", ignored: true },
          { id: PROJECT_TWO, name: "Dos" },
        ],
      })
    }
    const project = args[args.indexOf("--project") + 1]
    return result(
      project === PROJECT_TWO
        ? [
            {
              id: REPOSITORY,
              name: "Repo",
              remoteUrl: "https://dev.azure.com/alianzaapps/Dos/_git/Repo",
              project: { id: PROJECT_TWO },
              ignored: true,
            },
          ]
        : []
    )
  }
  const client = createAzureDevOpsClient({ runner, env })

  assert.deepEqual(await client.listProjects(), [
    { id: PROJECT_ONE, name: "Uno" },
    { id: PROJECT_TWO, name: "Dos" },
  ])
  assert.deepEqual(await client.listRepositories(PROJECT_TWO), [
    { id: REPOSITORY, name: "Repo" },
  ])
  assert.deepEqual(await client.resolveAuthorizedRepository(REPOSITORY), {
    id: REPOSITORY,
    name: "Repo",
    projectId: PROJECT_TWO,
    remoteUrl: "https://dev.azure.com/alianzaapps/Dos/_git/Repo",
  })
  assert.equal(
    calls.every((call) => call.command === "az"),
    true
  )
  assert.equal(
    calls.every((call) =>
      call.args.includes("https://dev.azure.com/alianzaapps")
    ),
    true
  )
})

test("rejects malformed IDs before invoking Azure CLI", async () => {
  let calls = 0
  const runner: Runner = async () => {
    calls += 1
    return result([])
  }
  const client = createAzureDevOpsClient({ runner, env })

  await assert.rejects(client.listRepositories("not-a-uuid"), {
    code: "INVALID_INPUT",
  })
  await assert.rejects(client.resolveAuthorizedRepository("also-invalid"), {
    code: "INVALID_INPUT",
  })
  assert.equal(calls, 0)
})

test("classifies missing, rejected, forbidden, and network authentication failures", async () => {
  const unused: Runner = async () => result([])
  await assert.rejects(
    createAzureDevOpsClient({ runner: unused, env: {} }).listProjects(),
    { code: "AUTH_MISSING" }
  )

  const cases = [
    ["TF400813: unauthorized", "AUTH_REJECTED"],
    ["TF401027: permission denied", "FORBIDDEN"],
    ["Unable to connect to dev.azure.com", "CONNECTION_FAILED"],
  ] as const

  for (const [message, code] of cases) {
    const runner: Runner = async () => {
      throw new AppError("PROCESS_FAILED", message)
    }
    await assert.rejects(
      createAzureDevOpsClient({ runner, env }).listProjects(),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === code &&
        !error.message.includes(message)
    )
  }
})

test("classifies the az login prompt as missing credentials", async () => {
  const runner: Runner = async () => {
    throw new AppError(
      "PROCESS_FAILED",
      "Before you can run Azure DevOps commands, you need to run the login command(az login if using AAD/MSA identity else az devops login if using PAT token) to setup credentials."
    )
  }

  await assert.rejects(
    createAzureDevOpsClient({ runner, env }).listProjects(),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "AUTH_MISSING" &&
      error.message.includes("AZURE_DEVOPS_EXT_PAT")
  )
})

test("classifies a missing az executable as a diagnosable process failure", async () => {
  const runner: Runner = async () => {
    throw new AppError("PROCESS_FAILED", "spawn az ENOENT")
  }

  await assert.rejects(
    createAzureDevOpsClient({ runner, env }).listProjects(),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "PROCESS_FAILED" &&
      error.message.includes("No se encontró la CLI de Azure") &&
      /instal/i.test(error.message)
  )
})

test("classifies the Windows cmd 'command not recognized' failure for a missing az", async () => {
  const runner: Runner = async () => {
    throw new AppError(
      "PROCESS_FAILED",
      '"az" no se reconoce como un comando interno o externo, programa o archivo por lotes ejecutable.'
    )
  }

  await assert.rejects(
    createAzureDevOpsClient({ runner, env }).listProjects(),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "PROCESS_FAILED" &&
      error.message.includes("No se encontró la CLI de Azure")
  )
})

test("rejects a repository outside accessible projects", async () => {
  const runner: Runner = async (_command, args) =>
    args[0] === "devops"
      ? result({ value: [{ id: PROJECT_ONE, name: "Uno" }] })
      : result([])

  await assert.rejects(
    createAzureDevOpsClient({ runner, env }).resolveAuthorizedRepository(
      REPOSITORY
    ),
    { code: "NOT_FOUND" }
  )
})
