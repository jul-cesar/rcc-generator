# RCC Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js application that discovers Azure DevOps repositories and generates initial or incremental RCC rows from deployment tags.

**Architecture:** Next.js Route Handlers own the HTTP boundary while focused server-only modules execute Azure CLI and Git without a shell. A pure RCC module operates on dedicated bare repositories; a client workbench consumes the API and exports the resulting rows as TSV.

**Tech Stack:** Next.js 16.4, React 19, TypeScript, shadcn/ui, Node `node:test` through `tsx`, Azure CLI with `azure-devops`, Git.

**Spec:** `docs/superpowers/specs/2026-10-16-rcc-helper-design.md`

## Global Constraints

- Organization is always `https://dev.azure.com/alianzaapps`.
- Integration branch defaults to `develop`; deployment tag prefix defaults to `develop_v`.
- `AZURE_DEVOPS_EXT_PAT` stays server-side and never appears in URLs, process arguments, responses, files, or logs.
- Execute Azure CLI and Git with `spawn`, `shell: false`, and argument arrays.
- Git authentication uses child-process `GIT_CONFIG_*` environment variables.
- Repository copies are bare and live under `.data/repositories/<repositoryId>.git`.
- Bind development and production scripts to `127.0.0.1`; do not enable CORS.
- Do not add a database, Excel support, deployment pipeline, custom server, or remote-write operation.
- Use codes `A`, `M`, and `D`; renames are `M` with `previousPath`.
- Parse Git path output with NUL delimiters.
- Keep tests synthetic; never require or invent a real PAT.

## Review Focus

- Malformed UUIDs and tag names must fail before any child process runs.
- A child-process failure containing the PAT or authorization header must return a redacted error.
- Concurrent requests for one repository must share one clone/fetch operation while different repositories remain independent.
- A rename followed by modification must preserve the original path and use the last deployment tag.
- Same-origin validation must accept loopback hosts and reject a foreign `Origin` before RCC work begins.

---

## File Structure

- `lib/rcc/types.ts`: shared API and RCC domain types.
- `lib/rcc/tsv.ts`: deterministic TSV formatting and filename generation.
- `lib/server/config.ts`: validated server configuration.
- `lib/server/errors.ts`: safe application errors and secret redaction.
- `lib/server/process.ts`: shell-free child-process runner.
- `lib/server/rcc-engine.ts`: tag ordering, initial RCC, and incremental RCC.
- `lib/server/azure-devops.ts`: project/repository discovery and authorization.
- `lib/server/git-store.ts`: authenticated bare clone/fetch and per-repository locking.
- `lib/server/http.ts`: identifier/body/origin validation and safe error responses.
- `app/api/**/route.ts`: four public API handlers.
- `components/rcc-workbench.tsx`: client orchestration and state.
- `components/rcc-form.tsx`: project, repository, mode, and tag controls.
- `components/rcc-results.tsx`: results, empty state, copy, and download.
- `tests/helpers/git-fixture.ts`: temporary Git repository builder.
- `tests/*.test.ts`: focused unit and integration tests.

### Task 1: Secure Runtime Foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `lib/rcc/types.ts`
- Create: `lib/server/config.ts`
- Create: `lib/server/errors.ts`
- Create: `lib/server/process.ts`
- Test: `tests/process.test.ts`

**Interfaces:**
- Produces: `RccAction`, `RccRow`, `DeploymentTag`, `RccResult`, `ProjectSummary`, `RepositorySummary`, and `AuthorizedRepository`.
- Produces: `getServerConfig(): ServerConfig` with fixed `organization`, configurable `tagPrefix` and `integrationBranch`, and required `pat`.
- Produces: `runProcess(command, args, options?): Promise<ProcessResult>` where `ProcessResult` contains `stdout: Buffer`, `stderr: string`, and `exitCode: number`.
- Produces: `AppError`, `redactSecrets(value, secrets)`, and `toSafeError(error)`.

- [ ] **Step 1: Add the test runner and local-only scripts**

Install `tsx` as a development dependency. Set `test` to `tsx --test tests/*.test.ts`, `test:watch` to `tsx --test --watch tests/*.test.ts`, and bind `dev`/`start` to `127.0.0.1`; retain existing build, lint, format, and typecheck scripts.

- [ ] **Step 2: Write failing process and configuration tests**

In `tests/process.test.ts`, assert that arguments containing shell metacharacters are passed literally, non-zero exits become `AppError`, missing PAT is classified, and PAT/header values are removed from safe messages.

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npx tsx --test tests/process.test.ts`

Expected: FAIL because the runtime modules do not exist.

- [ ] **Step 4: Implement shared types, configuration, errors, and process execution**

Use `spawn` directly with `shell: false`. Capture stdout as `Buffer`, bound stderr retained for classification, and redact both the raw PAT and derived authorization header before exposing an error.

- [ ] **Step 5: Add safe local configuration files**

Add empty `AZURE_DEVOPS_EXT_PAT`, `RCC_TAG_PREFIX=develop_v`, and `RCC_INTEGRATION_BRANCH=develop` to `.env.example`. Ignore `.env*` except `.env.example`, `.data/`, and test temporary output.

- [ ] **Step 6: Verify the foundation**

Run: `npx tsx --test tests/process.test.ts && npm run typecheck && npm run lint`

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example lib/rcc/types.ts lib/server/config.ts lib/server/errors.ts lib/server/process.ts tests/process.test.ts
git commit -m "feat: add secure server runtime"
```

### Task 2: Deployment Tag Model and Initial RCC

**Files:**
- Create: `lib/server/rcc-engine.ts`
- Create: `tests/helpers/git-fixture.ts`
- Create: `tests/rcc-initial.test.ts`
- Create: `tests/rcc-tags.test.ts`

**Interfaces:**
- Consumes: `runProcess`, `DeploymentTag`, and `RccResult` from Task 1.
- Produces: `listDeploymentTags(repoPath, options): Promise<DeploymentTagCatalog>`.
- Produces: `generateInitialRcc(repoPath, toTag, options): Promise<RccResult>`.
- `RccEngineOptions` contains exact `tagPrefix` and `integrationBranch` strings.

- [ ] **Step 1: Build a reusable synthetic Git fixture**

Implement helpers to create a temporary bare repository plus a working seed repository, commit files with deterministic identities, create lightweight/annotated tags, create branches and merges, and clean up after each test.

- [ ] **Step 2: Write failing tag-catalog tests**

Assert lightweight and annotated tags resolve to full commit SHA values, nonmatching prefixes are excluded, order follows `git rev-list --first-parent --reverse develop`, off-history tags are excluded, and two deployment tags on one commit produce an ambiguity record.

- [ ] **Step 3: Write failing initial-RCC tests**

Assert every file at the selected tag is returned as `{ action: "A", lastChangedTag: toTag }`, including paths with spaces and non-ASCII characters; ensure a later untracked working-tree file is absent.

- [ ] **Step 4: Run the tests and confirm failure**

Run: `npx tsx --test tests/rcc-tags.test.ts tests/rcc-initial.test.ts`

Expected: FAIL because `rcc-engine.ts` does not exist.

- [ ] **Step 5: Implement tag resolution and initial RCC**

Use `for-each-ref`, `rev-parse <ref>^{commit}`, and first-parent commit positions. Use `git ls-tree -r -z --name-only` for initial rows and reject a requested tag unless it is an unambiguous deployment tag in the catalog.

- [ ] **Step 6: Verify the initial engine**

Run: `npx tsx --test tests/rcc-tags.test.ts tests/rcc-initial.test.ts && npm run typecheck`

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/server/rcc-engine.ts tests/helpers/git-fixture.ts tests/rcc-tags.test.ts tests/rcc-initial.test.ts
git commit -m "feat: generate initial RCC data"
```

### Task 3: Incremental RCC Consolidation

**Files:**
- Modify: `lib/server/rcc-engine.ts`
- Create: `tests/rcc-incremental.test.ts`

**Interfaces:**
- Consumes: deployment catalog from Task 2.
- Produces: `generateIncrementalRcc(repoPath, fromTag, toTag, options): Promise<RccResult>`.
- Produces rows ordered by their final chronological change event, preserving Git order within one deployment.

- [ ] **Step 1: Write failing core consolidation tests**

Cover a file modified in several deployments, a file added then modified, deletion, a fully reverted change, and an unchanged range. Assert net action and exact `lastChangedTag` for every row.

- [ ] **Step 2: Write failing lineage and history tests**

Cover rename then modification (`M` plus original `previousPath`), a merge that introduces changes, inverted ranges, divergent/off-first-parent tags, and ambiguous tags inside the selected range.

- [ ] **Step 3: Write failing path parser tests**

Exercise `A`, `M`, `D`, and `R100` records from `git diff --name-status -z -M`, including spaces, tabs, and non-ASCII path bytes decoded as UTF-8.

- [ ] **Step 4: Run the incremental tests and confirm failure**

Run: `npx tsx --test tests/rcc-incremental.test.ts`

Expected: FAIL because incremental generation is not implemented.

- [ ] **Step 5: Implement chronological event tracking**

Compare every consecutive deployment pair from the initial tag exclusive to the final tag inclusive. For renames, transfer lineage from old path to new path and record the current tag. Track event ordinals for stable chronological result ordering.

- [ ] **Step 6: Implement endpoint consolidation**

Diff the two endpoint commits with Git rename detection. Emit only net rows, map `R*` to action `M`, preserve endpoint `previousPath`, and attach the last tracked deployment tag. A missing event mapping is an internal error, not a guessed tag.

- [ ] **Step 7: Verify the complete RCC engine**

Run: `npx tsx --test tests/rcc-tags.test.ts tests/rcc-initial.test.ts tests/rcc-incremental.test.ts && npm run typecheck && npm run lint`

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/server/rcc-engine.ts tests/rcc-incremental.test.ts
git commit -m "feat: consolidate incremental RCC changes"
```

### Task 4: Azure Discovery and Bare Repository Store

**Files:**
- Create: `lib/server/azure-devops.ts`
- Create: `lib/server/git-store.ts`
- Create: `tests/azure-devops.test.ts`
- Create: `tests/git-store.test.ts`

**Interfaces:**
- Consumes: `runProcess`, `getServerConfig`, `ProjectSummary`, and `AuthorizedRepository`.
- Produces: `listProjects(): Promise<ProjectSummary[]>`.
- Produces: `listRepositories(projectId): Promise<RepositorySummary[]>`.
- Produces: `resolveAuthorizedRepository(repositoryId): Promise<AuthorizedRepository>` by checking accessible projects and their repositories.
- Produces: `withUpdatedRepository(repository, operation): Promise<T>`.

- [ ] **Step 1: Write failing Azure CLI contract tests**

Inject a fake process runner and assert every `az` call includes the fixed organization, JSON parsing returns only required fields, malformed UUIDs never invoke the runner, absent/rejected PAT and permission/network failures map to safe `AppError` categories, and repository resolution rejects inaccessible IDs.

- [ ] **Step 2: Write failing Git authentication and locking tests**

Assert clone/fetch arguments contain no PAT, remote URLs contain no credentials, authorization is provided only through child `GIT_CONFIG_*`, two concurrent operations for one repository cause one update, and different repository IDs do not share a lock.

- [ ] **Step 3: Run the integration-layer tests and confirm failure**

Run: `npx tsx --test tests/azure-devops.test.ts tests/git-store.test.ts`

Expected: FAIL because both server modules are absent.

- [ ] **Step 4: Implement Azure discovery and authorization**

Use `az devops project list` and `az repos list` with explicit organization and project arguments. Resolve a repository by scanning only projects returned as accessible; stop at the matching authorized repository and use its Azure-provided remote URL.

- [ ] **Step 5: Implement authenticated bare clone and fetch**

Store repositories under `.data/repositories/<uuid>.git`. Clone with `--bare`; update heads and tags with explicit refspecs. Build the Basic authorization header from the PAT only in child environment values and redact it on every failure.

- [ ] **Step 6: Implement per-repository promise locking**

Keep one in-memory promise chain per repository ID and delete idle entries. A failed operation must release the lock for the next request.

- [ ] **Step 7: Verify server integrations**

Run: `npx tsx --test tests/azure-devops.test.ts tests/git-store.test.ts && npm run typecheck && npm run lint`

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/server/azure-devops.ts lib/server/git-store.ts tests/azure-devops.test.ts tests/git-store.test.ts
git commit -m "feat: integrate Azure repositories"
```

### Task 5: HTTP API Boundary

**Files:**
- Create: `lib/server/http.ts`
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/[projectId]/repositories/route.ts`
- Create: `app/api/repositories/[repositoryId]/tags/route.ts`
- Create: `app/api/repositories/[repositoryId]/rcc/route.ts`
- Create: `tests/http.test.ts`

**Interfaces:**
- Consumes: Azure discovery, `withUpdatedRepository`, RCC engine functions, shared response types.
- Produces: the four API routes defined in the spec.
- Produces: `assertUuid`, `parseRccRequest`, `assertLocalOrigin`, and `errorResponse`.

- [ ] **Step 1: Read the installed Next.js 16 guidance**

Read completely:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md`

Use the documented Next.js 16 async route-parameter signatures and server-only boundaries.

- [ ] **Step 2: Write failing HTTP validation tests**

Assert UUID and request-mode validation, malformed/control-character tag rejection before any child process, required/forbidden `fromTag` combinations, local `Origin` acceptance for `localhost`, `127.0.0.1`, and `[::1]`, foreign-origin rejection, and safe status mapping for 400/401/403/404/409/502 failures.

- [ ] **Step 3: Run the HTTP tests and confirm failure**

Run: `npx tsx --test tests/http.test.ts`

Expected: FAIL because `http.ts` and handlers do not exist.

- [ ] **Step 4: Implement boundary validation and safe responses**

Validate IDs before Azure calls. Validate tags against the deployment catalog before passing them to Git. Require a matching loopback `Origin` on RCC POST and return normalized JSON errors without command output.

- [ ] **Step 5: Implement project and repository routes**

Return only IDs and names. Await Next.js 16 route params and disable accidental caching where current documentation requires it for live Azure data.

- [ ] **Step 6: Implement tag and RCC routes**

Resolve the authorized repository, update its bare clone under lock, then list tags or invoke the selected RCC mode. Include exact tag/SHA references, rows, warnings, and valid empty arrays.

- [ ] **Step 7: Verify the API boundary**

Run: `npx tsx --test tests/http.test.ts && npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0 and Next.js builds all four routes.

- [ ] **Step 8: Commit**

```bash
git add lib/server/http.ts app/api tests/http.test.ts
git commit -m "feat: expose RCC API routes"
```

### Task 6: RCC Workbench and TSV Export

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Create: `components/rcc-workbench.tsx`
- Create: `components/rcc-form.tsx`
- Create: `components/rcc-results.tsx`
- Create: `lib/rcc/tsv.ts`
- Create through shadcn CLI: `components/ui/select.tsx`
- Create through shadcn CLI: `components/ui/table.tsx`
- Create through shadcn CLI: `components/ui/alert.tsx`
- Test: `tests/tsv.test.ts`

**Interfaces:**
- Consumes: public API responses and shared RCC types.
- Produces: `rowsToTsv(rows): string` and `rccFilename(repositoryName, request): string`.
- Produces: one client workbench with project, repository, mode, tags, loading, error, empty, copy, and download states.

- [ ] **Step 1: Install only required shadcn components**

Run: `npx shadcn@latest add select table alert`

Expected: the three component files are generated without replacing the existing theme or button.

- [ ] **Step 2: Write failing TSV tests**

Assert the exact Spanish header `Ruta\tRuta anterior\tAcción\tÚltimo tag`, blank previous paths, one line per row, and safe initial/incremental filenames.

- [ ] **Step 3: Run the TSV test and confirm failure**

Run: `npx tsx --test tests/tsv.test.ts`

Expected: FAIL because `tsv.ts` does not exist.

- [ ] **Step 4: Implement TSV serialization**

Reject or replace embedded tab/newline control characters so one path cannot corrupt row boundaries; preserve ordinary spaces and Unicode. Use the same returned string for clipboard and download.

- [ ] **Step 5: Implement the cascading form**

Project change clears repository, tags, and results; repository change clears tags and results; mode change clears incompatible selections. Disable later controls and submit while prerequisites are missing or requests are loading.

- [ ] **Step 6: Implement result states and exports**

Render columns `Ruta`, `Ruta anterior`, `Acción`, and `Último tag`. Show explicit loading, empty-range, warning, and error states. Copy through `navigator.clipboard`; download through a temporary Blob URL and revoke it.

- [ ] **Step 7: Replace the template page and update metadata/language**

Set Spanish page metadata and document language, retain theme support, and render the workbench in a responsive local-tool layout.

- [ ] **Step 8: Verify UI and export behavior**

Run: `npx tsx --test tests/tsv.test.ts && npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx app/layout.tsx components lib/rcc/tsv.ts tests/tsv.test.ts package.json package-lock.json
git commit -m "feat: add RCC generation workbench"
```

### Task 7: Operating Guide and End-to-End Verification

**Files:**
- Modify: `README.md`
- Create: `tests/api-smoke.test.ts`

**Interfaces:**
- Consumes: completed API, UI, and scripts.
- Produces: installation and operation instructions plus a credential-free smoke test.

- [ ] **Step 1: Write a failing local smoke test**

Start the built application on an available loopback port without a PAT and assert `/api/projects` returns the documented safe authentication error, no secret-like value, and no permissive CORS header.

- [ ] **Step 2: Run the smoke test and confirm the expected failure**

Run: `npx tsx --test tests/api-smoke.test.ts`

Expected: FAIL until the test harness and final error contract are aligned.

- [ ] **Step 3: Document prerequisites and setup**

Replace the template README with requirements for Node, Git, Azure CLI, the `azure-devops` extension, `.env.local` setup, PAT permission to discover/read projects and code, local commands, cache location, and TXT generation steps. State that real Azure verification requires a locally configured PAT and tags do not prove deployment completion.

- [ ] **Step 4: Complete the smoke harness without real credentials**

Build once, launch `next start` on `127.0.0.1` with a temporary port, poll readiness, make the request, and always terminate the child process.

- [ ] **Step 5: Run the full automated acceptance gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0; synthetic Git tests cover every accepted RCC scenario.

- [ ] **Step 6: Perform the local browser check**

Run the application without a PAT and verify cascading controls, initial/incremental mode switching, loading state, and safe authentication error. If a PAT is locally available, additionally verify project/repository/tag discovery without recording returned organization data.

- [ ] **Step 7: Inspect the final diff for secret or generated-data leakage**

Run searches for PAT-like values, credential-bearing Azure URLs, `.env.local`, `.data/`, synthetic repositories, and captured real API responses. Remove any leaked artifact before completion.

- [ ] **Step 8: Commit**

```bash
git add README.md tests/api-smoke.test.ts
git commit -m "docs: add RCC helper operating guide"
```

- [ ] **Step 9: Final verification record**

Record the exact commands and exit statuses in the delivery summary. Label synthetic test output as synthetic and do not claim a real Azure DevOps test unless it was run with the user's local environment.
