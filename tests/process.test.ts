import assert from "node:assert/strict"
import { test } from "node:test"

import { getServerConfig } from "../lib/server/config"
import { AppError, redactSecrets, toSafeError } from "../lib/server/errors"
import { runProcess } from "../lib/server/process"

test(
  "resolves a Windows shell builtin through the cmd.exe fallback",
  { skip: process.platform !== "win32" },
  async () => {
    const result = await runProcess("echo", ["ok"])

    assert.equal(result.stdout.toString().trim(), "ok")
    assert.equal(result.exitCode, 0)
  }
)

test(
  "resolves a POSIX builtin path directly",
  { skip: process.platform === "win32" },
  async () => {
    const result = await runProcess("/bin/echo", ["ok"])

    assert.equal(result.stdout.toString().trim(), "ok")
    assert.equal(result.exitCode, 0)
  }
)

test("passes shell metacharacters as a literal argument", async () => {
  const value = "safe; echo compromised"
  const result = await runProcess(process.execPath, [
    "-e",
    "process.stdout.write(process.argv[1])",
    value,
  ])

  assert.equal(result.stdout.toString(), value)
  assert.equal(result.exitCode, 0)
})

test("turns a non-zero exit into an AppError", async () => {
  await assert.rejects(
    runProcess(process.execPath, [
      "-e",
      "process.stderr.write('boom'); process.exit(7)",
    ]),
    (error: unknown) =>
      error instanceof AppError && error.code === "PROCESS_FAILED"
  )
})

test("classifies a missing PAT without starting a process", () => {
  assert.throws(
    () => getServerConfig({}),
    (error: unknown) =>
      error instanceof AppError && error.code === "AUTH_MISSING"
  )
})

test("redacts PAT and authorization header from safe errors", () => {
  const pat = "secret-pat"
  const header = `Authorization: Basic ${Buffer.from(`:${pat}`).toString("base64")}`
  const raw = `${pat} ${header}`

  assert.equal(redactSecrets(raw, [pat, header]), "[REDACTED] [REDACTED]")
  assert.deepEqual(toSafeError(new Error(raw), [pat, header]), {
    code: "INTERNAL_ERROR",
    message: "Error interno",
  })
})
