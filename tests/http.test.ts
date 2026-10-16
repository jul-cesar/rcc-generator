import assert from "node:assert/strict"
import { test } from "node:test"

import { AppError } from "../lib/server/errors"
import {
  assertLocalOrigin,
  assertUuid,
  errorResponse,
  parseRccRequest,
} from "../lib/server/http"

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

test("validates UUIDs and RCC request modes", () => {
  assert.equal(assertUuid(UUID), UUID)
  assert.deepEqual(parseRccRequest({ mode: "initial", toTag: "develop_v1" }), {
    mode: "initial",
    toTag: "develop_v1",
  })
  assert.deepEqual(
    parseRccRequest({
      mode: "incremental",
      fromTag: "develop_v1",
      toTag: "develop_v2",
    }),
    { mode: "incremental", fromTag: "develop_v1", toTag: "develop_v2" }
  )

  assert.throws(() => assertUuid("../repo"), { code: "INVALID_INPUT" })
  assert.throws(
    () =>
      parseRccRequest({
        mode: "initial",
        fromTag: "develop_v0",
        toTag: "develop_v1",
      }),
    { code: "INVALID_INPUT" }
  )
  assert.throws(
    () => parseRccRequest({ mode: "incremental", toTag: "develop_v2" }),
    { code: "INVALID_INPUT" }
  )
})

test("rejects malformed tags before they can reach Git", () => {
  for (const toTag of [
    "",
    "../develop_v1",
    "develop v1",
    "develop_v1\0evil",
    "a".repeat(256),
  ]) {
    assert.throws(() => parseRccRequest({ mode: "initial", toTag }), {
      code: "INVALID_INPUT",
    })
  }
})

test("accepts matching loopback origins", () => {
  for (const url of [
    "http://localhost:3000/api/rcc",
    "http://127.0.0.1:3000/api/rcc",
    "http://[::1]:3000/api/rcc",
  ]) {
    const origin = new URL(url).origin
    assert.doesNotThrow(() =>
      assertLocalOrigin(new Request(url, { headers: { origin } }))
    )
  }
})

test("rejects absent, foreign, and host-mismatched origins", () => {
  assert.throws(
    () => assertLocalOrigin(new Request("http://127.0.0.1:3000/api/rcc")),
    { code: "FORBIDDEN" }
  )
  assert.throws(
    () =>
      assertLocalOrigin(
        new Request("http://127.0.0.1:3000/api/rcc", {
          headers: { origin: "https://evil.example" },
        })
      ),
    { code: "FORBIDDEN" }
  )
  assert.throws(
    () =>
      assertLocalOrigin(
        new Request("http://127.0.0.1:3000/api/rcc", {
          headers: { origin: "http://localhost:3000" },
        })
      ),
    { code: "FORBIDDEN" }
  )
})

test("maps application failures to safe HTTP responses", async () => {
  const cases = [
    ["INVALID_INPUT", 400],
    ["AUTH_MISSING", 401],
    ["AUTH_REJECTED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["PROCESS_FAILED", 502],
    ["CONNECTION_FAILED", 502],
  ] as const

  for (const [code, status] of cases) {
    const response = errorResponse(new AppError(code, "Mensaje seguro"))
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), {
      error: { code, message: "Mensaje seguro" },
    })
  }

  const internal = errorResponse(new Error("detalle secreto"))
  assert.equal(internal.status, 500)
  assert.deepEqual(await internal.json(), {
    error: { code: "INTERNAL_ERROR", message: "Error interno" },
  })
})
