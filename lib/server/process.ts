import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"

import { AppError, redactSecrets } from "./errors"

const MAX_STDERR_LENGTH = 32_768

const CMD_PLAIN_TOKEN = /^[\w./:\\-]*$/

// Tokens are passed through cmd.exe's `start string` parsing, which interprets
// shell metacharacters (& | < > ( ) ^ ...) outside double quotes and expands
// %VAR% even inside quotes. Only pass plain tokens without quoting needs.
function isCmdSafe(token: string): boolean {
  return CMD_PLAIN_TOKEN.test(token)
}

// Same quoting algorithm libuv applies when joining argv into a Windows
// command line (escape quotes with their preceding backslashes doubled).
function quoteCmdArg(value: string): string {
  return `"${value
    .replace(/(\\*)"/g, "$1$1\\\"")
    .replace(/(\\+)$/, "$1$1")}"`
}

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
    // On Windows, `az` is a batch wrapper (az.cmd). Since CVE-2024-27580, Node
    // refuses to execute .cmd/.bat with shell disabled, and enabling shell
    // would concatenate unescaped arguments (DEP0190). Invoke through cmd.exe
    // with /d /s /c instead.
    // Plain tokens (no spaces, quotes, or cmd metacharacters) are concatenated
    // verbatim: callers must only pass static flags, the constant organization
    // URL, and IDs validated by assertAzureId. Tokens that need quoting are
    // escaped with libuv's argv rules and the whole command line is wrapped in
    // an extra outer quote pair so cmd's /s "strip first and last quote" rule
    // strips only that outer pair, leaving literal argv intact. `|`, `&`, `^`
    // and friends stay literal inside the outer quotes; `%VAR%` is still
    // expanded by cmd even inside quotes, so no caller may send untrusted `%`.
    const isWindows = process.platform === "win32"
    const tokens = [command, ...args]
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    }

    let child: ChildProcess
    if (!isWindows) {
      child = spawn(command, [...args], spawnOptions)
    } else if (tokens.every(isCmdSafe)) {
      child = spawn("cmd.exe", ["/d", "/s", "/c", ...tokens], spawnOptions)
    } else {
      const needsQuote = /[\s"]/.test(command) || command === ""
      const commandLine = [
        needsQuote ? quoteCmdArg(command) : command,
        ...args.map(quoteCmdArg),
      ].join(" ")
      child = spawn(
        "cmd.exe",
        ["/d", "/s", "/c", `"${commandLine}"`],
        { ...spawnOptions, windowsVerbatimArguments: true }
      )
    }
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
