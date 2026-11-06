import { z } from "zod"
import { createLinkToken } from "@/server/banks"
import { getBanksDeps } from "@/server/clients"
import { toErrorResponse } from "@/server/errors"
import { rejectNonLocal } from "@/server/local-only"

const linkTokenRequestInput = z.object({ bankId: z.uuid().optional() }).strict()

/** POST { bankId? } -> { linkToken }. With bankId, the token opens Link in update mode to repair that bank. */
export async function POST(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const parsed = linkTokenRequestInput.safeParse(
    await request.json().catch(() => ({})),
  )
  if (!parsed.success)
    return Response.json({ error: "Expected { bankId? }." }, { status: 400 })

  try {
    return Response.json({
      linkToken: await createLinkToken(getBanksDeps(), parsed.data.bankId),
    })
  } catch (err) {
    return toErrorResponse(err, "/api/plaid/link-token")
  }
}
