import { resolveAuthorizedRepository } from "@/lib/server/azure-devops"
import { getServerConfig } from "@/lib/server/config"
import { withUpdatedRepository } from "@/lib/server/git-store"
import { assertUuid, errorResponse } from "@/lib/server/http"
import { listDeploymentTags } from "@/lib/server/rcc-engine"

interface RouteContext {
  params: Promise<{ repositoryId: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { repositoryId } = await context.params
    const repository = await resolveAuthorizedRepository(
      assertUuid(repositoryId)
    )
    const catalog = await withUpdatedRepository(repository, (repoPath) => {
      const config = getServerConfig()
      return listDeploymentTags(repoPath, {
        tagPrefix: config.tagPrefix,
        integrationBranch: config.integrationBranch,
      })
    })
    return Response.json({
      ...catalog,
      warnings: catalog.ambiguities.map(
        ({ sha, tags }) => `Tags ambiguos en ${sha}: ${tags.join(", ")}`
      ),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
