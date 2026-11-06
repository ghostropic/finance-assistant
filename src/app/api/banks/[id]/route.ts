import { z } from "zod"
import { removeBank } from "@/server/banks"
import { getBanksDeps } from "@/server/clients"
import { toErrorResponse } from "@/server/errors"
import { rejectNonLocal } from "@/server/local-only"

/** DELETE -> 204. Removes the bank at Plaid, then deletes it with its accounts and transactions. */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/banks/[id]">,
) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Not found." }, { status: 404 })

  try {
    const removed = await removeBank(getBanksDeps(), id)
    return removed
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Not found." }, { status: 404 })
  } catch (err) {
    return toErrorResponse(err, "/api/banks/[id]")
  }
}
