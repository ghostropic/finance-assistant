import { z } from "zod"
import { mapMessagesToTurns } from "@/chat/display"
import { getDb } from "@/lib/db"
import { deleteConversation, loadHistory, loadUsageBySeq } from "@/server/chat"
import { rejectNonLocal } from "@/server/local-only"

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/conversations/[id]">,
) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Not found." }, { status: 404 })
  const db = getDb()
  const conversation = await db.conversation.findUnique({
    where: { id },
    select: { id: true, title: true },
  })
  if (!conversation)
    return Response.json({ error: "Not found." }, { status: 404 })

  const [history, usageBySeq] = await Promise.all([
    loadHistory(db, id),
    loadUsageBySeq(db, id),
  ])
  return Response.json({
    ...conversation,
    turns: mapMessagesToTurns(history, id, usageBySeq),
  })
}

/** DELETE -> 204. Deletes the conversation with its messages and usage. */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/conversations/[id]">,
) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const { id } = await ctx.params
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Not found." }, { status: 404 })
  return (await deleteConversation(getDb(), id))
    ? new Response(null, { status: 204 })
    : Response.json({ error: "Not found." }, { status: 404 })
}
