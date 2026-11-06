import { getDb } from "@/lib/db"
import { listBanks } from "@/server/banks"
import { rejectNonLocal } from "@/server/local-only"

/** GET -> { banks: BankSummary[] } */
export async function GET(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  return Response.json({ banks: await listBanks(getDb()) })
}
