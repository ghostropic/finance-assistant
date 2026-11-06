import { z } from "zod"
import { getSyncRunner } from "@/server/clients"
import { toErrorResponse } from "@/server/errors"
import { rejectNonLocal } from "@/server/local-only"

const syncRequestInput = z
  .object({
    trigger: z.enum(["button", "page_open", "reconnect"]).default("button"),
  })
  .strict()

/** POST { trigger? } -> SyncRun. Syncs every bank, or joins a sync already running. */
export async function POST(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const parsed = syncRequestInput.safeParse(
    await request.json().catch(() => ({})),
  )
  if (!parsed.success)
    return Response.json({ error: "Expected { trigger? }." }, { status: 400 })

  try {
    return Response.json(
      await getSyncRunner().sync({ trigger: parsed.data.trigger }),
    )
  } catch (err) {
    return toErrorResponse(err, "/api/sync")
  }
}
