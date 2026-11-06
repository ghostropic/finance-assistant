import { z } from "zod"

// Each consumer reads only the variables it needs, so the terminal chat
// doesn't demand Plaid keys and the sync script doesn't demand the Claude key.

const nonEmpty = z.string().trim().min(1)

const databaseSchema = z.object({ DATABASE_URL: nonEmpty })

const plaidEnvironmentSchema = z.object({
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
})

const plaidSchema = plaidEnvironmentSchema.extend({
  PLAID_CLIENT_ID: nonEmpty,
  PLAID_SECRET: nonEmpty,
  TOKEN_ENCRYPTION_KEY: nonEmpty,
})

export type PlaidEnvironment = z.infer<
  typeof plaidEnvironmentSchema
>["PLAID_ENV"]

const anthropicSchema = z.object({
  ANTHROPIC_MODEL: nonEmpty.default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .default("medium"),
})

function parseEnv<T extends z.ZodType>(schema: T, name: string): z.infer<T> {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ")
    throw new Error(
      `${name} configuration is missing or invalid: ${missing}. See .env.example.`,
    )
  }
  return result.data
}

export const databaseEnv = () => parseEnv(databaseSchema, "Database")
export const plaidEnv = () => parseEnv(plaidSchema, "Plaid")
/** PLAID_ENV alone, for code that checks the environment without calling Plaid (the terminal chat). */
export const plaidEnvironment = () =>
  parseEnv(plaidEnvironmentSchema, "Plaid").PLAID_ENV
// ANTHROPIC_API_KEY is read by the SDK itself (it also accepts other
// credential sources), so it isn't validated here.
export const anthropicEnv = () => parseEnv(anthropicSchema, "Claude")
