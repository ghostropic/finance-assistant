import { z } from "zod"
import { errorClassOf, log } from "@/lib/log"
import {
  comparePeriods,
  getBalances,
  recurringCharges,
  searchTransactions,
  spendingByCategory,
  type ToolContext,
} from "./handlers"
import {
  comparePeriodsInput,
  getBalancesInput,
  recurringChargesInput,
  searchTransactionsInput,
  spendingByCategoryInput,
  syncNowInput,
} from "./schemas"
import { syncNow } from "./sync-now"

export { toolDefinitions } from "./definitions"
export type { ToolContext } from "./handlers"

type Handler = (ctx: ToolContext, input: unknown) => Promise<unknown>

const DEFAULT_TIMEOUT_MS = 15_000
// Syncing waits on Plaid, and on a sync the user may already have started.
const SYNC_TIMEOUT_MS = 60_000

function registerTool<S extends z.ZodType>(
  schema: S,
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  return { schema, run: run as Handler, timeoutMs }
}

const registry = {
  get_balances: registerTool(getBalancesInput, (ctx) => getBalances(ctx)),
  spending_by_category: registerTool(
    spendingByCategoryInput,
    spendingByCategory,
  ),
  search_transactions: registerTool(
    searchTransactionsInput,
    searchTransactions,
  ),
  compare_periods: registerTool(comparePeriodsInput, comparePeriods),
  recurring_charges: registerTool(recurringChargesInput, recurringCharges),
  sync_now: registerTool(syncNowInput, (ctx) => syncNow(ctx), SYNC_TIMEOUT_MS),
} as const

export type ToolName = keyof typeof registry

export type ToolOutcome =
  { ok: true; result: unknown } | { ok: false; error: string }

type ToolErrorKind = "unknown_tool" | "invalid_input" | "timeout" | "failed"

class ToolTimeoutError extends Error {}

/** Tool names come from Claude, so an unknown one is logged as "unknown" rather than echoed. */
const loggedToolName = (name: string) => (name in registry ? name : "unknown")

/**
 * Validate and run one tool call. Never throws: bad input, unknown tools and
 * failures come back as { ok: false } so the loop can return them to Claude
 * as an error result and let it correct itself. Each call writes a `tool_call` log line.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<ToolOutcome> {
  const started = Date.now()
  const { outcome, errorKind, errorClass } = await executeTool(ctx, name, input)
  log({
    event: "tool_call",
    tool: loggedToolName(name),
    ok: outcome.ok,
    ...(errorKind ? { errorKind } : {}),
    ...(errorClass ? { errorClass } : {}),
    durationMs: Date.now() - started,
  })
  return outcome
}

async function executeTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<{
  outcome: ToolOutcome
  errorKind?: ToolErrorKind
  errorClass?: string
}> {
  const entry = registry[name as ToolName]
  if (!entry)
    return {
      outcome: { ok: false, error: `Unknown tool "${name}".` },
      errorKind: "unknown_tool",
    }

  const parsed = entry.schema.safeParse(input ?? {})
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ")
    return {
      outcome: { ok: false, error: `Invalid input. ${problems}` },
      errorKind: "invalid_input",
    }
  }

  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError()), entry.timeoutMs)
    })
    return {
      outcome: {
        ok: true,
        result: await Promise.race([entry.run(ctx, parsed.data), timeout]),
      },
    }
  } catch (err) {
    // Keep details out of the result and the log: they could include query text or data.
    const isTimeout = err instanceof ToolTimeoutError
    return {
      outcome: {
        ok: false,
        error: isTimeout
          ? `The tool timed out after ${entry.timeoutMs / 1000}s.`
          : "The tool failed. Try again or answer without it.",
      },
      errorKind: isTimeout ? "timeout" : "failed",
      ...(isTimeout ? {} : { errorClass: errorClassOf(err) }),
    }
  } finally {
    clearTimeout(timer)
  }
}
