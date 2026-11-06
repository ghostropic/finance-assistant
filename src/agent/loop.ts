import Anthropic from "@anthropic-ai/sdk"
import { log } from "@/lib/log"
import { runTool, toolDefinitions, type ToolContext } from "@/tools"
import { summarizeToolResult } from "@/tools/summary"
import { systemPrompt } from "./prompt"

// The tool loop (docs/decisions/0005). Streams one Claude response; if it asks
// for tools, runs them, appends the results and asks again, until Claude
// answers. It yields events instead of printing, so the terminal chat (M1) and
// the SSE route (M2) can share it.

const MAX_JSON_RETRIES = 2
const DEFAULT_MAX_ROUNDS = 10
const MAX_OUTPUT_TOKENS = 64_000
/** Stop reasons that mean Claude finished its answer. */
const ANSWERED_STOP_REASONS = new Set(["end_turn", "stop_sequence"])

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | {
      type: "tool_result"
      id: string
      name: string
      ok: boolean
      summary: string
      durationMs: number
    }
  | { type: "notice"; message: string }
  | { type: "done"; stopReason: string; rounds: number; usage: Usage }

export interface AgentOptions {
  client: Anthropic
  ctx: ToolContext
  /** Conversation so far, ending with the new user message. Appended to in place. */
  history: Anthropic.Beta.BetaMessageParam[]
  model: string
  effort: "low" | "medium" | "high" | "xhigh" | "max"
  /** Maximum Claude calls for one question. */
  maxRounds?: number
  signal?: AbortSignal
  /** For the `chat_turn` log line. */
  conversationId?: string
}

interface TurnStats {
  usage: Usage
  rounds: number
  toolCalls: number
}

/** Runs one question to its answer, and writes a `chat_turn` log line however it ends. */
export async function* runAgent(
  opts: AgentOptions,
): AsyncGenerator<AgentEvent> {
  const started = Date.now()
  const stats: TurnStats = {
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    rounds: 0,
    toolCalls: 0,
  }
  let stopReason: string | undefined
  let failure: unknown
  try {
    for await (const event of runRounds(opts, stats)) {
      if (event.type === "done") stopReason = event.stopReason
      yield event
    }
  } catch (err) {
    failure = err
    throw err
  } finally {
    logChatTurn(opts, stats, stopReason, failure, Date.now() - started)
  }
}

function logChatTurn(
  opts: AgentOptions,
  stats: TurnStats,
  stopReason: string | undefined,
  failure: unknown,
  durationMs: number,
) {
  const isStopped =
    opts.signal?.aborted || (failure === undefined && stopReason === undefined)
  const outcome = isStopped
    ? "stopped"
    : failure !== undefined
      ? "failed"
      : ANSWERED_STOP_REASONS.has(stopReason!)
        ? "answered"
        : "cut_short"
  const apiStatus =
    failure instanceof Anthropic.APIError && typeof failure.status === "number"
      ? failure.status
      : undefined
  log({
    event: "chat_turn",
    ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    model: opts.model,
    effort: opts.effort,
    outcome,
    ...(stopReason ? { stopReason } : {}),
    ...(outcome === "failed"
      ? {
          errorKind:
            failure instanceof Anthropic.APIError ? "api_error" : "internal",
        }
      : {}),
    ...(outcome === "failed" && apiStatus !== undefined ? { apiStatus } : {}),
    rounds: stats.rounds,
    toolCalls: stats.toolCalls,
    inputTokens: stats.usage.input_tokens,
    outputTokens: stats.usage.output_tokens,
    cacheReadTokens: stats.usage.cache_read_input_tokens,
    cacheWriteTokens: stats.usage.cache_creation_input_tokens,
    durationMs,
  })
}

async function* runRounds(
  opts: AgentOptions,
  stats: TurnStats,
): AsyncGenerator<AgentEvent> {
  const { client, ctx, history, model, effort, signal } = opts
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS
  const { usage } = stats
  const system = systemPrompt(ctx.today)
  let jsonRetries = 0

  for (let round = 1; ; round++) {
    if (round > maxRounds) {
      yield {
        type: "notice",
        message: `Stopped after ${maxRounds} rounds of tool calls without a final answer.`,
      }
      yield {
        type: "done",
        stopReason: "max_rounds",
        rounds: round - 1,
        usage,
      }
      return
    }
    stats.rounds = round

    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: toolDefinitions,
        messages: history,
        output_config: { effort },
        // Caches the stable prefix (tools, system, earlier turns) between calls.
        cache_control: { type: "ephemeral" },
        // On a safety decline, re-run on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    )

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", text: event.delta.text }
      } else if (
        event.type === "content_block_start" &&
        event.content_block.type === "fallback"
      ) {
        const { from, to } = event.content_block
        yield {
          type: "notice",
          message: `${from.model} declined; ${to.model} continued the answer.`,
        }
      }
    }

    let message: Anthropic.Beta.BetaMessage
    try {
      message = await stream.finalMessage()
      jsonRetries = 0
    } catch (err) {
      // With eager input streaming a tool input can arrive as unparseable
      // JSON. Re-issue that turn a couple of times; API errors are real.
      if (
        err instanceof Anthropic.APIError ||
        signal?.aborted ||
        jsonRetries++ >= MAX_JSON_RETRIES
      )
        throw err
      yield {
        type: "notice",
        message: "A tool request arrived garbled; asking again.",
      }
      continue
    }

    usage.input_tokens += message.usage.input_tokens
    usage.output_tokens += message.usage.output_tokens
    usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0
    usage.cache_creation_input_tokens +=
      message.usage.cache_creation_input_tokens ?? 0

    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    )

    if (message.stop_reason === "refusal") {
      yield {
        type: "notice",
        message: "Claude declined to answer this request.",
      }
      yield { type: "done", stopReason: "refusal", rounds: round, usage }
      return
    }
    if (message.stop_reason === "max_tokens" && toolUses.length) {
      // A cut-off tool input can still look valid; don't run it.
      yield {
        type: "notice",
        message:
          "The response hit the output limit in the middle of a tool call.",
      }
      yield { type: "done", stopReason: "max_tokens", rounds: round, usage }
      return
    }

    // Append the whole response (thinking and fallback blocks included) unchanged.
    history.push({ role: "assistant", content: message.content })

    if (message.stop_reason === "pause_turn") continue
    if (message.stop_reason !== "tool_use" || !toolUses.length) {
      yield {
        type: "done",
        stopReason: message.stop_reason ?? "unknown",
        rounds: round,
        usage,
      }
      return
    }

    // All results go back in one message: splitting them discourages Claude from calling tools in parallel.
    stats.toolCalls += toolUses.length
    for (const t of toolUses)
      yield { type: "tool_start", id: t.id, name: t.name, input: t.input }
    const outcomes = await Promise.all(
      toolUses.map(async (t) => {
        const started = Date.now()
        const outcome = await runTool(ctx, t.name, t.input)
        return { tool: t, outcome, durationMs: Date.now() - started }
      }),
    )

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const { tool, outcome, durationMs } of outcomes) {
      yield {
        type: "tool_result",
        id: tool.id,
        name: tool.name,
        ok: outcome.ok,
        summary: outcome.ok
          ? summarizeToolResult(outcome.result)
          : outcome.error,
        durationMs,
      }
      results.push(
        outcome.ok
          ? {
              type: "tool_result",
              tool_use_id: tool.id,
              content: JSON.stringify(outcome.result),
            }
          : {
              type: "tool_result",
              tool_use_id: tool.id,
              content: outcome.error,
              is_error: true,
            },
      )
    }
    history.push({ role: "user", content: results })
  }
}
