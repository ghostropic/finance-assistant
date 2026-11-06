import { Configuration, PlaidApi, PlaidEnvironments } from "plaid"
import { decrypt, encrypt } from "./crypto"
import { plaidEnv } from "./env"

// The only module that sees decrypted access tokens.

export function createPlaidClient(): PlaidApi {
  const env = plaidEnv()
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.PLAID_ENV],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
          "PLAID-SECRET": env.PLAID_SECRET,
        },
      },
    }),
  )
}

export const sealAccessToken = (token: string) =>
  encrypt(token, plaidEnv().TOKEN_ENCRYPTION_KEY)
export const openAccessToken = (stored: string) =>
  decrypt(stored, plaidEnv().TOKEN_ENCRYPTION_KEY)

/** Plaid errors come back as Axios errors; pull out the Plaid error code if there is one. */
export function extractPlaidErrorCode(err: unknown): string | undefined {
  const data = (err as { response?: { data?: { error_code?: unknown } } })
    ?.response?.data
  return typeof data?.error_code === "string" ? data.error_code : undefined
}
