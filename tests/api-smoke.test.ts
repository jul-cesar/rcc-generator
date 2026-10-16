import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createServer } from "node:net"
import path from "node:path"
import { test } from "node:test"

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("No se pudo reservar un puerto local"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Next.js no inició dentro del tiempo esperado")
}

test("serves a safe missing-PAT response only on loopback", async () => {
  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  )
  execFileSync(process.execPath, [nextBin, "build"], {
    cwd: process.cwd(),
    stdio: "ignore",
  })

  const port = await availablePort()
  const secret = "smoke-secret-never-return"
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        AZURE_DEVOPS_EXT_PAT: "",
        RCC_TEST_SECRET: secret,
      },
      stdio: "ignore",
      windowsHide: true,
    }
  )

  try {
    const origin = `http://127.0.0.1:${port}`
    await waitUntilReady(origin)
    const response = await fetch(`${origin}/api/projects`)
    const text = await response.text()

    assert.equal(response.status, 401)
    assert.equal(response.headers.get("access-control-allow-origin"), null)
    assert.equal(text.includes(secret), false)
    assert.equal(text.includes("AZURE_DEVOPS_EXT_PAT="), false)
    assert.deepEqual(JSON.parse(text), {
      error: {
        code: "AUTH_MISSING",
        message: "AZURE_DEVOPS_EXT_PAT no está configurado",
      },
    })
  } finally {
    child.kill()
  }
})
