import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

// Structured logs as JSON lines (docs/milestone-4.md). Every event has a fixed
// schema, checked on write: numbers, booleans, UUIDs, and strings from fixed sets
// or strict patterns. There's no free-text field, so transaction details,
// balances, prompts, tool results and error messages can't be logged, in Sandbox
// or with real data (docs/security.md). An event that doesn't match is dropped.

const count = z.number().int().nonnegative()
const durationMs = z.number().nonnegative()
/** Lower snake case: tool names, stop reasons. */
const snakeName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
/** Upper snake case: Plaid error codes. */
const errorCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)
/** A JavaScript error's class name, never its message. */
const errorClass = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/)
const modelId = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/)

const ROUTES = [
  "/api/chat",
  "/api/status",
  "/api/sync",
  "/api/banks",
  "/api/banks/[id]",
  "/api/conversations",
  "/api/conversations/[id]",
  "/api/plaid/link-token",
  "/api/plaid/exchange",
] as const

const SYNC_TRIGGERS = [
  "button",
  "page_open",
  "reconnect",
  "tool",
  "connect",
  "script",
] as const

const EVENT_SCHEMAS = {
  chat_turn: z.object({
    conversationId: z.uuid().optional(),
    model: modelId,
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    /** `cut_short`: stopped by the loop (round limit, refusal, output limit) without an answer. */
    outcome: z.enum(["answered", "cut_short", "stopped", "failed"]),
    stopReason: snakeName.optional(),
    errorKind: z.enum(["api_error", "internal"]).optional(),
    apiStatus: z.number().int().optional(),
    rounds: count,
    toolCalls: count,
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
    durationMs,
  }),
  tool_call: z.object({
    tool: snakeName,
    ok: z.boolean(),
    errorKind: z
      .enum(["unknown_tool", "invalid_input", "timeout", "failed"])
      .optional(),
    errorClass: errorClass.optional(),
    durationMs,
  }),
  sync_run: z.object({
    trigger: z.enum(SYNC_TRIGGERS),
    status: z.enum(["synced", "up_to_date", "failed"]),
    errorKind: z.enum(["environment_mismatch", "internal"]).optional(),
    banks: count,
    synced: count,
    needsReconnect: count,
    failed: count,
    waitingForPlaid: count,
    added: count,
    modified: count,
    removed: count,
    /** Transactions for an account Plaid didn't return in the same sync. */
    skipped: count,
    errorCodes: z.array(errorCode).max(20),
    durationMs,
  }),
  http_error: z.object({
    route: z.enum(ROUTES),
    status: z.number().int(),
    errorKind: z.enum([
      "plaid_error",
      "duplicate_bank",
      "bank_not_found",
      "environment_mismatch",
      "conversation_not_found",
      "internal",
    ]),
    plaidCode: errorCode.optional(),
    errorClass: errorClass.optional(),
  }),
  startup_check: z.object({
    result: z.enum(["ok", "environment_mismatch", "database_unreachable"]),
  }),
} as const

type Schemas = typeof EVENT_SCHEMAS
export type LogEventName = keyof Schemas
export type LogEvent = {
  [K in LogEventName]: { event: K } & z.input<Schemas[K]>
}[LogEventName]
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number]

type Sink = (line: string) => void
interface LogConfig {
  sinks: Sink[]
}

const DEFAULT_FILE = join(process.cwd(), "logs", "app.jsonl")

function fileSink(path: string): Sink {
  let isReady = false
  return (line) => {
    if (!isReady) {
      mkdirSync(dirname(path), { recursive: true })
      isReady = true
    }
    appendFileSync(path, `${line}\n`)
  }
}

const stdoutSink: Sink = (line) => process.stdout.write(`${line}\n`)

// On globalThis because Next.js can load this module once per route bundle, and
// the web server configures logging once, at startup (src/instrumentation.ts).
const holder = globalThis as unknown as { __financeLogConfig?: LogConfig }

const config = (): LogConfig => {
  holder.__financeLogConfig ??= {
    sinks: process.env.VITEST
      ? []
      : [fileSink(process.env.LOG_FILE ?? DEFAULT_FILE)],
  }
  return holder.__financeLogConfig
}

/** The web server also logs to stdout. Scripts log to the file only, so lines don't interrupt the terminal chat. */
export function configureLogging({ stdout }: { stdout: boolean }): void {
  const { sinks } = config()
  if (stdout && !sinks.includes(stdoutSink)) sinks.push(stdoutSink)
}

function write(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry })
  for (const sink of config().sinks) {
    try {
      sink(line)
    } catch {
      // Logging must never break the app.
    }
  }
}

/** Writes one event, or a `log_rejected` line naming only the event if it doesn't match its schema. */
export function log(entry: LogEvent): void {
  const { event, ...fields } = entry
  const schema = (EVENT_SCHEMAS as Record<string, z.ZodObject>)[event]
  const parsed = schema?.strict().safeParse(fields)
  if (parsed?.success) {
    write({ event, ...parsed.data })
    return
  }
  write({ event: "log_rejected", rejectedEvent: schema ? event : "unknown" })
}

/** An error's class name when it fits the log pattern, so a malformed name doesn't get the whole event dropped. */
export function errorClassOf(err: unknown): string | undefined {
  const name = err instanceof Error ? err.constructor.name : undefined
  return name && errorClass.safeParse(name).success ? name : undefined
}

/** For tests: collects entries instead of writing them, until `stop()`. */
export function captureLogs(extraSink?: Sink) {
  const previous = config().sinks
  const entries: Record<string, unknown>[] = []
  holder.__financeLogConfig = {
    sinks: [
      (line) => entries.push(JSON.parse(line)),
      ...(extraSink ? [extraSink] : []),
    ],
  }
  return {
    entries,
    stop: () => {
      holder.__financeLogConfig = { sinks: previous }
    },
  }
}
