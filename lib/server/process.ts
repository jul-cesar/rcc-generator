import { spawn } from "node:child_process"

import { AppError, redactSecrets } from "./errors"

const MAX_STDERR_LENGTH = 32_768

export interface ProcessResult {
  stdout: Buffer
  stderr: string
  exitCode: number
}

export interface ProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string | Buffer
  secrets?: readonly string[]
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const childStdout = child.stdout
    const childStderr = child.stderr

    if (!childStdout || !childStderr) {
      child.kill()
      reject(
        new AppError(
          "PROCESS_FAILED",
          "No se pudo capturar la salida del proceso"
        )
      )
      return
    }

    childStdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    childStderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", (error) => {
      reject(
        new AppError(
          "PROCESS_FAILED",
          redactSecrets(error.message, options.secrets ?? []),
          { cause: error }
        )
      )
    })
    child.on("close", (exitCode) => {
      const stderrText = Buffer.concat(stderr)
        .toString("utf8")
        .slice(-MAX_STDERR_LENGTH)

      if (exitCode !== 0) {
        reject(
          new AppError(
            "PROCESS_FAILED",
            redactSecrets(
              stderrText.trim() || `${command} finalizó con código ${exitCode}`,
              options.secrets ?? []
            )
          )
        )
        return
      }

      resolve({
        stdout: Buffer.concat(stdout),
        stderr: stderrText,
        exitCode: exitCode ?? 0,
      })
    })

    if (options.input !== undefined) {
      if (!child.stdin) {
        child.kill()
        reject(
          new AppError("PROCESS_FAILED", "No se pudo enviar datos al proceso")
        )
        return
      }
      child.stdin.end(options.input)
    }
  })
}
