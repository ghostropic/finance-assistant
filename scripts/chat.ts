// Terminal chat over the agent loop. Prints answers as they stream, plus each tool call.
// Commands: /reset (new conversation), /exit. Ctrl+C stops an answer.
import "@/lib/load-env"
import { createInterface } from "node:readline"
import Anthropic from "@anthropic-ai/sdk"
import { runAgent } from "@/agent/loop"
import { formatUsage } from "@/chat/format"
import { localToday } from "@/lib/dates"
import { disconnectDb, getDb } from "@/lib/db"
import { anthropicEnv, plaidEnvironment } from "@/lib/env"
import { assertEnvironmentMatches } from "@/lib/environment"

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

async function main() {
  const { ANTHROPIC_MODEL: model, ANTHROPIC_EFFORT: effort } = anthropicEnv()
  const client = new Anthropic()
  const db = getDb()
  const transactions = await db.transaction.count().catch((err: unknown) => {
    throw new Error(
      `Can't reach the database. Is Postgres running (npm run db:up) and DATABASE_URL correct?`,
      { cause: err },
    )
  })
  await assertEnvironmentMatches(db, plaidEnvironment())
  console.log(
    dim(
      `Finance Assistant · ${model} · effort ${effort} · ${transactions} transactions in the database`,
    ),
  )
  if (!transactions)
    console.log(
      dim("No data yet. Run `npm run plaid:sandbox` to load Sandbox data."),
    )
  console.log(dim("Ask a question. /reset starts over, /exit quits.\n"))

  // Created after the awaits above so no typed (or piped) input is missed.
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan("you › "),
  })
  let history: Anthropic.Beta.BetaMessageParam[] = []
  let running: AbortController | undefined
  const stopAnswerOrQuit = () => (running ? running.abort() : rl.close())
  rl.on("SIGINT", stopAnswerOrQuit)
  // Piped input can end while an answer is streaming; don't prompt after that.
  let closed = false
  rl.on("close", () => (closed = true))
  const prompt = () => !closed && rl.prompt()

  prompt()
  for await (const line of rl) {
    const question = line.trim()
    if (!question) {
      prompt()
      continue
    }
    if (question === "/exit") break
    if (question === "/reset") {
      history = []
      console.log(dim("Started a new conversation.\n"))
      prompt()
      continue
    }

    history.push({ role: "user", content: question })
    const lengthBeforeQuestion = history.length - 1
    const controller = new AbortController()
    running = controller

    process.stdout.write("\n")
    let midLine = false
    try {
      for await (const event of runAgent({
        client,
        ctx: { db, today: localToday() },
        history,
        model,
        effort,
        signal: controller.signal,
      })) {
        switch (event.type) {
          case "text":
            process.stdout.write(event.text)
            midLine = !event.text.endsWith("\n")
            break
          case "tool_start":
            if (midLine) process.stdout.write("\n")
            midLine = false
            console.log(dim(`→ ${event.name} ${JSON.stringify(event.input)}`))
            break
          case "tool_result":
            console.log(
              dim(
                `${event.ok ? "✓" : "✗"} ${event.name}: ${event.summary} (${event.durationMs} ms)`,
              ),
            )
            break
          case "notice":
            console.log(`\n${red(event.message)}`)
            break
          case "done": {
            const rounds = event.rounds === 1 ? "round" : "rounds"
            console.log(
              dim(
                `\n\n[${event.stopReason} · ${event.rounds} ${rounds} · ${formatUsage(event.usage)}]\n`,
              ),
            )
            break
          }
        }
      }
    } catch (err) {
      history.length = lengthBeforeQuestion
      if (controller.signal.aborted) console.log(dim("\n[stopped]\n"))
      else
        console.error(
          red(`\nError: ${err instanceof Error ? err.message : err}\n`),
        )
    } finally {
      running = undefined
    }
    prompt()
  }
  rl.close()
}

main()
  .catch((err) => {
    console.error(
      err instanceof Error
        ? process.env.DEBUG
          ? err.stack
          : err.message
        : err,
    )
    process.exitCode = 1
  })
  .finally(disconnectDb)
