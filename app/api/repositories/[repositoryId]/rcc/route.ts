import { resolveAuthorizedRepository } from "@/lib/server/azure-devops"
import { getServerConfig } from "@/lib/server/config"
import { AppError } from "@/lib/server/errors"
import { withUpdatedRepository } from "@/lib/server/git-store"
import {
  assertLocalOrigin,
  assertUuid,
  errorResponse,
  parseRccRequest,
} from "@/lib/server/http"
import {
  generateIncrementalRcc,
  generateInitialRcc,
} from "@/lib/server/rcc-engine"

interface RouteContext {
  params: Promise<{ repositoryId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertLocalOrigin(request)
    const { repositoryId } = await context.params
    assertUuid(repositoryId)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new AppError("INVALID_INPUT", "El cuerpo debe ser JSON válido")
    }
    const rccRequest = parseRccRequest(body)
    const repository = await resolveAuthorizedRepository(repositoryId)

    return Response.json(
      await withUpdatedRepository(repository, (repoPath) => {
        const config = getServerConfig()
        const options = {
          tagPrefix: config.tagPrefix,
          integrationBranch: config.integrationBranch,
        }
        return rccRequest.mode === "initial"
          ? generateInitialRcc(repoPath, rccRequest.toTag, options)
          : generateIncrementalRcc(
              repoPath,
              rccRequest.fromTag,
              rccRequest.toTag,
              options,
            )
      }),
    )
  } catch (error) {
    return errorResponse(error)
  }
}
