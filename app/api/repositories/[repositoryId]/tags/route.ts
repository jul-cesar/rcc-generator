import {
  resolveAuthorizedRepository,
  resolveAuthorizedRepositoryInProject,
} from "@/lib/server/azure-devops"
import { getServerConfig } from "@/lib/server/config"
import { withUpdatedRepository } from "@/lib/server/git-store"
import { assertUuid, errorResponse } from "@/lib/server/http"
import { listDeploymentTags } from "@/lib/server/rcc-engine"

interface RouteContext {
  params: Promise<{ repositoryId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { repositoryId } = await context.params
    assertUuid(repositoryId)
    // Optional projectId scopes the resolution to a single project (one REST
    // request + cache); the legacy path scans all accessible projects.
    const projectId = new URL(request.url).searchParams.get("projectId")
    const repository = projectId
      ? await resolveAuthorizedRepositoryInProject(
          assertUuid(projectId),
          repositoryId
        )
      : await resolveAuthorizedRepository(repositoryId)
    const catalog = await withUpdatedRepository(repository, (repoPath) => {
      const config = getServerConfig()
      return listDeploymentTags(repoPath, {
        tagPrefix: config.tagPrefix,
        integrationBranch: config.integrationBranch,
      })
    })
    return Response.json({
      ...catalog,
      warnings: [
        ...catalog.warnings,
        ...catalog.ambiguities.map(
          ({ sha, tags }) =>
            `Los tags ${tags.join(", ")} apuntan al mismo commit ${sha}; se usará ${tags.at(-1)}.`
        ),
      ],
    })
  } catch (error) {
    return errorResponse(error)
  }
}
