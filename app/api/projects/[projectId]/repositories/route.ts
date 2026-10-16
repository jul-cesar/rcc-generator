import { listRepositories } from "@/lib/server/azure-devops"
import { assertUuid, errorResponse } from "@/lib/server/http"

interface RouteContext {
  params: Promise<{ projectId: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params
    return Response.json({ repositories: await listRepositories(assertUuid(projectId)) })
  } catch (error) {
    return errorResponse(error)
  }
}
