import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const ONLY_TRANSACTIONS =
  "Only the read-only `transactions` Plaid product may be requested."

const contentRules = [
  {
    pattern: /\bProducts\.(?!Transactions\b)[A-Z]\w*/,
    reason: ONLY_TRANSACTIONS,
  },
  {
    pattern:
      /\b(?:initial|required_if_supported|optional|additional_consented)_products\s*:\s*\[[^\]]*["'](?!transactions["'])\w+["']/,
    reason: ONLY_TRANSACTIONS,
  },
  {
    pattern:
      /\.\s*(?:transfer|bankTransfer|sandboxTransfer|paymentInitiation|wallet|processor)[A-Z]\w*\s*\(|\.\s*(?:authGet|identityGet|identityMatch)\s*\(/,
    reason:
      "Plaid endpoints that move money or expose full account numbers or identity data are off-limits.",
  },
  {
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/,
    reason: "This looks like an Anthropic API key. Secrets stay in .env.",
  },
  {
    pattern:
      /\b(?:access|public|link)-(?:sandbox|development|production)-[0-9a-f]{8}-[0-9a-f]{4}/,
    reason:
      "This looks like a Plaid token. Tokens are never written into code, tests, fixtures or docs.",
  },
]

const checkContent = (text: string) =>
  contentRules.find((rule) => rule.pattern.test(text))?.reason ?? null

// Forbidden strings are assembled at runtime so this file does not trip the rules it tests.
const join = (...parts: string[]) => parts.join("")
const forbidden = {
  product: join("Products.", "Auth"),
  productString: "initial_products: \x5b'transactions', 'transfer']",
  transfer: join("plaid.", "transferCreate({})"),
  auth: join("client.", "authGet({ access_token })"),
  anthropicKey: join("sk-ant-", "api03-", "a".repeat(30)),
  plaidToken: join(
    "access-",
    "sandbox-",
    "de3ce8ef-33f8-452c-a685-8671031fc0f6",
  ),
}

describe("repository security rules", () => {
  it("allows the transactions product and ordinary code", () => {
    expect(checkContent("initial_products: [Products.Transactions]")).toBeNull()
    expect(checkContent("initial_products: ['transactions']")).toBeNull()
    expect(
      checkContent("await client.transactionsSync({ access_token: token })"),
    ).toBeNull()
    expect(checkContent("process.env.ANTHROPIC_API_KEY")).toBeNull()
  })

  it.each(Object.entries(forbidden))("blocks %s", (_, text) => {
    expect(checkContent(text)).not.toBeNull()
  })

  it("holds for every file in the repository", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(
        (file) =>
          /\.(?:[cm]?[jt]sx?|json|md|prisma|sql|ya?ml|css)$/.test(file) &&
          !file.startsWith("src/generated/"),
      )
    const violations = files.flatMap((file) => {
      const text = readFileSync(file, "utf8")
      return contentRules
        .filter((rule) => rule.pattern.test(text))
        .map((rule) => `${file}: ${rule.reason}`)
    })
    expect(violations).toEqual([])
  })
})
