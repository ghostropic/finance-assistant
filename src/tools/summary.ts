// Display helpers for tool calls. Pure, so the browser can use them too.

/** One-line description of a tool result, for display. Never shown to Claude. */
export function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return "done"
  const r = result as Record<string, unknown>
  const parts: string[] = []
  const count = (key: string, label: string) =>
    Array.isArray(r[key]) &&
    parts.push(`${(r[key] as unknown[]).length} ${label}`)
  if (typeof r.match_count === "number") parts.push(`${r.match_count} matches`)
  count("accounts", "accounts")
  count("categories", "categories")
  count("recurring", "recurring charges")
  if (typeof r.total_spent === "number")
    parts.push(`$${r.total_spent.toFixed(2)} spent`)
  if (r.status === "up_to_date") parts.push("already up to date")
  else if (typeof r.new_transactions === "number" && Array.isArray(r.banks))
    parts.push(`${r.new_transactions} new transactions`)
  if (
    Array.isArray(r.banks) &&
    r.banks.some(
      (b) => (b as { status?: unknown }).status === "needs_reconnect",
    )
  )
    parts.push("a bank needs reconnecting")
  return parts.join(", ") || "done"
}

/** "spending_by_category" -> "Spending by category" */
export function formatToolName(name: string): string {
  const words = name.replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}
