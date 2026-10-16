import { listProjects } from "@/lib/server/azure-devops"
import { errorResponse } from "@/lib/server/http"

export async function GET() {
  try {
    return Response.json({ projects: await listProjects() })
  } catch (error) {
    return errorResponse(error)
  }
}
