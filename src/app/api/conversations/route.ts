import { getDb } from "@/lib/db"
import { loadConversationSummaries } from "@/server/chat"
import { rejectNonLocal } from "@/server/local-only"

export async function GET(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected
  return Response.json({
    conversations: await loadConversationSummaries(getDb()),
  })
}
