import { z } from "zod"
import { connectBank } from "@/server/banks"
import { getBanksDeps } from "@/server/clients"
import { toErrorResponse } from "@/server/errors"
import { rejectNonLocal } from "@/server/local-only"

const exchangeRequestInput = z
  .object({
    publicToken: z.string().trim().min(1).max(200),
    /** The institution Link reported, used to refuse a duplicate before exchanging. */
    institutionId: z
      .string()
      .regex(/^ins_[a-z0-9]{1,40}$/)
      .optional(),
  })
  .strict()

/** POST { publicToken, institutionId? } from Plaid Link -> { bankId, firstSync }. Connects the bank and runs its first sync. */
export async function POST(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const parsed = exchangeRequestInput.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success)
    return Response.json(
      { error: "Expected { publicToken, institutionId? }." },
      { status: 400 },
    )

  try {
    return Response.json(
      await connectBank(
        getBanksDeps(),
        parsed.data.publicToken,
        parsed.data.institutionId,
      ),
    )
  } catch (err) {
    return toErrorResponse(err, "/api/plaid/exchange")
  }
}
