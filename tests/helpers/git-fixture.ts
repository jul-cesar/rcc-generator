import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export interface GitFixture {
  root: string
  work: string
  bare: string
  write(relativePath: string, content: string): void
  remove(relativePath: string): void
  rename(from: string, to: string): void
  commit(message: string): string
  tag(name: string, annotated?: boolean): void
  checkout(name: string, startPoint?: string): void
  merge(name: string): void
  sync(): void
  cleanup(): void
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

export function createGitFixture(): GitFixture {
  const root = mkdtempSync(path.join(tmpdir(), "rcc-helper-"))
  const work = path.join(root, "work")
  const bare = path.join(root, "remote.git")

  mkdirSync(work)
  git(work, "init", "--initial-branch=develop")
  git(work, "config", "user.name", "RCC Tests")
  git(work, "config", "user.email", "rcc-tests@example.invalid")
  git(root, "init", "--bare", bare)
  git(work, "remote", "add", "origin", bare)

  return {
    root,
    work,
    bare,
    write(relativePath, content) {
      const filePath = path.join(work, relativePath)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    },
    remove(relativePath) {
      unlinkSync(path.join(work, relativePath))
    },
    rename(from, to) {
      const destination = path.join(work, to)
      mkdirSync(path.dirname(destination), { recursive: true })
      renameSync(path.join(work, from), destination)
    },
    commit(message) {
      git(work, "add", "-A")
      git(work, "commit", "--allow-empty", "-m", message)
      return git(work, "rev-parse", "HEAD")
    },
    tag(name, annotated = false) {
      if (annotated) git(work, "tag", "-a", name, "-m", name)
      else git(work, "tag", name)
    },
    checkout(name, startPoint) {
      if (startPoint) git(work, "checkout", "-b", name, startPoint)
      else git(work, "checkout", name)
    },
    merge(name) {
      git(work, "merge", "--no-ff", "-m", `merge ${name}`, name)
    },
    sync() {
      git(work, "push", "--force", "origin", "--all")
      git(work, "push", "--force", "origin", "--tags")
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
