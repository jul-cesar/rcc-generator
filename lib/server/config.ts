import { AppError } from "./errors"

export const AZURE_DEVOPS_ORGANIZATION = "https://dev.azure.com/alianzaapps"

export interface ServerConfig {
  organization: typeof AZURE_DEVOPS_ORGANIZATION
  pat: string
  tagPrefix: string
  integrationBranch: string
}

export function getServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServerConfig {
  const pat = env.AZURE_DEVOPS_EXT_PAT?.trim()

  if (!pat) {
    throw new AppError("AUTH_MISSING", "AZURE_DEVOPS_EXT_PAT no está configurado")
  }

  return {
    organization: AZURE_DEVOPS_ORGANIZATION,
    pat,
    tagPrefix: env.RCC_TAG_PREFIX?.trim() || "develop_v",
    integrationBranch: env.RCC_INTEGRATION_BRANCH?.trim() || "develop",
  }
}
