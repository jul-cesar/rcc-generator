import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clearRepositoryResolutionCache,
  createAzureDevOpsClient,
  REQUEST_TIMEOUT_MS,
} from "../lib/server/azure-devops"
import { AppError } from "../lib/server/errors"

const PAT = "test-pat"
const env = { AZURE_DEVOPS_EXT_PAT: PAT }
// Header credential echo assertions: neither the raw PAT nor its Basic token
// may ever surface inside an error message.
const PAT_BASIC = Buffer.from(`:${PAT}`).toString("base64")
const ORGANIZATION = "https://dev.azure.com/alianzaapps"

const PROJECT_ONE = "11111111-1111-4111-8111-111111111111"
const PROJECT_TWO = "22222222-2222-4222-8222-222222222222"
const REPOSITORY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REPOSITORY_URL = `https://dev.azure.com/alianzaapps/Dos/_git/Repo`

interface RecordedRequest {
  url: string
  headers: Record<string, string>
}

interface Recording {
  fetch: typeof fetch
  calls: RecordedRequest[]
}

function recordingFetch(
  respond: (call: RecordedRequest) => Response | Promise<Response>
): Recording {
  const calls: RecordedRequest[] = []
  const fetchImplementation: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {}
    const provided = new Headers(init?.headers)
    provided.forEach((value, key) => {
      headers[key] = value
    })
    const call: RecordedRequest = { url: String(input), headers }
    calls.push(call)
    return await respond(call)
  }
  return { fetch: fetchImplementation, calls }
}

function repositoryPayload() {
  return {
    value: [
      {
        id: REPOSITORY,
        name: "Repo",
        remoteUrl: REPOSITORY_URL,
        project: { id: PROJECT_TWO },
        ignored: true,
      },
    ],
  }
}

test("lists projects with a single REST request to the canonical endpoint", async () => {
  const recording = recordingFetch(() =>
    Response.json({ value: [{ id: PROJECT_ONE, name: "Uno", ignored: true }] })
  )
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  assert.deepEqual(await client.listProjects(), [
    { id: PROJECT_ONE, name: "Uno" },
  ])
  assert.equal(recording.calls.length, 1)
  const call = recording.calls[0]
  assert.equal(call.url, `${ORGANIZATION}/_apis/projects?api-version=7.1`)
  assert.equal(call.headers["accept"], "application/json")
  assert.match(call.headers["authorization"], /^Basic /)
})

test("never leaks the PAT inside any mapped error message", async () => {
  const statuses = [401, 403, 404, 500]
  for (const status of statuses) {
    const recording = recordingFetch(() => Response.json({}, { status }))
    const client = createAzureDevOpsClient({ fetch: recording.fetch, env })
    await assert.rejects(client.listProjects(), (error: unknown) => {
      const message = (error as Error)?.message ?? ""
      return (
        message.length > 0 &&
        !message.includes(PAT) &&
        !message.includes(PAT_BASIC)
      )
    })
  }
})

test("classifies REST status codes and transport failures", async () => {
  const cases: Array<{
    respond: () => Promise<Response>
    code: string
    message: string
  }> = [
    {
      respond: () => {
        throw new TypeError("fetch failed")
      },
      code: "CONNECTION_FAILED",
      message: "No fue posible conectar con Azure DevOps",
    },
    {
      respond: () =>
        Promise.reject(new TypeError("fetch failed")),
      code: "CONNECTION_FAILED",
      message: "No fue posible conectar con Azure DevOps",
    },
    {
      respond: async () => Response.json({}, { status: 401 }),
      code: "AUTH_REJECTED",
      message: "Azure DevOps rechazó el PAT",
    },
    {
      respond: async () => Response.json({}, { status: 403 }),
      code: "FORBIDDEN",
      message: "El PAT no tiene permisos suficientes",
    },
    {
      respond: async () => Response.json({}, { status: 404 }),
      code: "NOT_FOUND",
      message: "Azure DevOps no encontró el recurso solicitado",
    },
    {
      respond: async () => Response.json({}, { status: 500 }),
      code: "PROCESS_FAILED",
      message: "Azure DevOps no respondió correctamente",
    },
    {
      respond: async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      code: "PROCESS_FAILED",
      message: "Azure DevOps devolvió una respuesta inválida",
    },
    {
      respond: async () => Response.json({ value: "not-an-array" }),
      code: "PROCESS_FAILED",
      message: "Azure DevOps devolvió una respuesta inválida",
    },
    {
      respond: async () => Response.json({}),
      code: "PROCESS_FAILED",
      message: "Azure DevOps devolvió una respuesta inválida",
    },
  ]

  for (const testCase of cases) {
    const recording = recordingFetch(() => testCase.respond())
    const client = createAzureDevOpsClient({ fetch: recording.fetch, env })
    await assert.rejects(
      client.listProjects(),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === testCase.code &&
        error.message === testCase.message &&
        !error.message.includes(PAT) &&
        !error.message.includes(PAT_BASIC)
    )
  }
})

test("aborts stale requests after the 10 second timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const fetchImplementation: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("The operation was aborted"))
      })
    })
  const client = createAzureDevOpsClient({ fetch: fetchImplementation, env })

  const pending = client.listProjects()
  t.mock.timers.tick(REQUEST_TIMEOUT_MS)
  await assert.rejects(pending, {
    code: "CONNECTION_FAILED",
    message: "No fue posible conectar con Azure DevOps",
  })
})

test("rejects malformed IDs before contacting Azure DevOps", async () => {
  let calls = 0
  const fetchImplementation: typeof fetch = async () => {
    calls += 1
    return Response.json({ value: [] })
  }
  const client = createAzureDevOpsClient({
    fetch: fetchImplementation,
    env,
  })

  await assert.rejects(client.listRepositories("not-a-uuid"), {
    code: "INVALID_INPUT",
  })
  await assert.rejects(
    client.resolveAuthorizedRepository("also-invalid"),
    { code: "INVALID_INPUT" }
  )
  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, "bad"),
    { code: "INVALID_INPUT" }
  )
  assert.equal(calls, 0)
})

test("requires the PAT to be configured before any request", async () => {
  let calls = 0
  const fetchImplementation: typeof fetch = async () => {
    calls += 1
    return Response.json({ value: [] })
  }
  const client = createAzureDevOpsClient({
    fetch: fetchImplementation,
    env: {},
  })

  await assert.rejects(client.listProjects(), { code: "AUTH_MISSING" })
  assert.equal(calls, 0)
})

test("resolves a repository inside a project with exactly one fetch", async () => {
  const recording = recordingFetch(() => Response.json(repositoryPayload()))
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  assert.deepEqual(
    await client.resolveAuthorizedRepositoryInProject(
      PROJECT_TWO,
      REPOSITORY
    ),
    {
      id: REPOSITORY,
      name: "Repo",
      projectId: PROJECT_TWO,
      remoteUrl: REPOSITORY_URL,
    }
  )
  assert.equal(recording.calls.length, 1)
  const url = new URL(recording.calls[0].url)
  assert.equal(url.hostname, "dev.azure.com")
  assert.equal(
    url.pathname,
    `/alianzaapps/${PROJECT_TWO}/_apis/repositories`
  )
  assert.equal(url.searchParams.get("api-version"), "7.1")
  assert.equal(url.searchParams.get("includeHidden"), "false")
})

test("maps an absent repository to NOT_FOUND without extra fetches", async () => {
  clearRepositoryResolutionCache()
  const recording = recordingFetch(() => Response.json({ value: [] }))
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "NOT_FOUND" &&
      error.message === "Repositorio no disponible para este usuario"
  )
  assert.equal(recording.calls.length, 1)
})

test("caches positive resolutions for the TTL and expires them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] })
  clearRepositoryResolutionCache()
  const recording = recordingFetch(() => Response.json(repositoryPayload()))
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  const first = await client.resolveAuthorizedRepositoryInProject(
    PROJECT_TWO,
    REPOSITORY
  )
  const second = await client.resolveAuthorizedRepositoryInProject(
    PROJECT_TWO,
    REPOSITORY
  )
  assert.equal(recording.calls.length, 1)
  assert.deepEqual(second, first)

  t.mock.timers.tick(10 * 60 * 1000)
  await client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY)
  assert.equal(recording.calls.length, 2)
})

test("caches negative NOT_FOUND resolutions briefly", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] })
  clearRepositoryResolutionCache()
  const recording = recordingFetch(() => Response.json({ value: [] }))
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY),
    { code: "NOT_FOUND" }
  )
  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY),
    { code: "NOT_FOUND" }
  )
  assert.equal(recording.calls.length, 1)

  t.mock.timers.tick(60 * 1000)
  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY),
    { code: "NOT_FOUND" }
  )
  assert.equal(recording.calls.length, 2)
})

test("clearRepositoryResolutionCache bypasses cached entries", async () => {
  clearRepositoryResolutionCache()
  const recording = recordingFetch(() => Response.json({ value: [] }))
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY),
    { code: "NOT_FOUND" }
  )
  clearRepositoryResolutionCache()
  await assert.rejects(
    client.resolveAuthorizedRepositoryInProject(PROJECT_TWO, REPOSITORY),
    { code: "NOT_FOUND" }
  )
  assert.equal(recording.calls.length, 2)
})

test("legacy resolution still scans the accessible project catalog", async () => {
  clearRepositoryResolutionCache()
  const recording = recordingFetch((call) => {
    if (call.url.includes("/_apis/projects")) {
      return Response.json({
        value: [
          { id: PROJECT_ONE, name: "Uno" },
          { id: PROJECT_TWO, name: "Dos" },
        ],
      })
    }
    if (call.url.includes(encodeURIComponent(PROJECT_TWO))) {
      return Response.json(repositoryPayload())
    }
    return Response.json({ value: [] })
  })
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  assert.deepEqual(
    await client.resolveAuthorizedRepository(REPOSITORY),
    {
      id: REPOSITORY,
      name: "Repo",
      projectId: PROJECT_TWO,
      remoteUrl: REPOSITORY_URL,
    }
  )
  assert.deepEqual(await client.listRepositories(PROJECT_TWO), [
    { id: REPOSITORY, name: "Repo" },
  ])
})

test("maps an unresolvable repository outside accessible projects", async () => {
  clearRepositoryResolutionCache()
  const recording = recordingFetch((call) =>
    call.url.includes("/_apis/projects")
      ? Response.json({ value: [{ id: PROJECT_ONE, name: "Uno" }] })
      : Response.json({ value: [] })
  )
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  await assert.rejects(client.resolveAuthorizedRepository(REPOSITORY), {
    code: "NOT_FOUND",
  })
})

test("lists repositories of a project via the REST endpoint", async () => {
  const recording = recordingFetch(() => Response.json(repositoryPayload()))
  const client = createAzureDevOpsClient({ fetch: recording.fetch, env })

  assert.deepEqual(await client.listRepositories(PROJECT_TWO), [
    { id: REPOSITORY, name: "Repo" },
  ])
  assert.equal(recording.calls.length, 1)
})
