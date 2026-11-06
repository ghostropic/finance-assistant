import type { Usage } from "@/agent/loop"

export const formatNumber = (value: number) => value.toLocaleString("en-US")

/** `input_tokens` counts only the uncached part, so the cached parts are added back for the total. */
export const formatUsage = (usage: Usage) => {
  const totalIn =
    usage.input_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens
  const cached = [
    usage.cache_read_input_tokens > 0 &&
      `${formatNumber(usage.cache_read_input_tokens)} from cache`,
    usage.cache_creation_input_tokens > 0 &&
      `${formatNumber(usage.cache_creation_input_tokens)} written to cache`,
  ].filter(Boolean)
  const cacheNote = cached.length ? ` (${cached.join(", ")})` : ""
  return `${formatNumber(totalIn)} tokens in${cacheNote} · ${formatNumber(usage.output_tokens)} out`
}
