import { z } from "zod"
import {
  comparePeriodsInput,
  getBalancesInput,
  recurringChargesInput,
  searchTransactionsInput,
  spendingByCategoryInput,
  syncNowInput,
} from "./schemas"
import type Anthropic from "@anthropic-ai/sdk"

// What Claude sees: each tool's name, when to use it, and its input schema
// (generated from the same Zod schema that validates the input).

function defineTool(
  name: string,
  description: string,
  schema: z.ZodType,
): Anthropic.Beta.BetaTool {
  const inputSchema = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >
  delete inputSchema.$schema
  return {
    name,
    description,
    input_schema: inputSchema as Anthropic.Beta.BetaTool["input_schema"],
    // Inputs are small, but streaming them as generated is the recommended
    // default for streamed requests. Inputs are validated before running.
    eager_input_streaming: true,
  }
}

export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  defineTool(
    "get_balances",
    "Current balance of every connected account, plus totals for cash, investments, credit card debt, loans and an estimated net worth. Also says when the data was last synced. Use for questions about how much money there is or is owed right now.",
    getBalancesInput,
  ),
  defineTool(
    "spending_by_category",
    "Total spending per category between two dates (inclusive), largest first, plus the overall total. Spending excludes income, transfers between accounts and credit card payments, and refunds reduce their category's total. Pending transactions are excluded unless include_pending is true. Use for 'where did my money go' and 'what did I spend most on' questions.",
    spendingByCategoryInput,
  ),
  defineTool(
    "search_transactions",
    "Find individual transactions by date range, merchant text, category, direction (spent or received) and amount. Returns the newest matches (up to limit) and totals across all matches, so totals are correct even when the list is cut off. Use for specific merchants, large purchases, deposits, or 'show me' questions.",
    searchTransactionsInput,
  ),
  defineTool(
    "compare_periods",
    "Compare spending between two date ranges, overall and per category (or for one category), with the dollar difference and percent change. Same spending rules as spending_by_category. Use for 'more or less than last month/quarter/year' questions.",
    comparePeriodsInput,
  ),
  defineTool(
    "recurring_charges",
    "Find subscriptions and other recurring charges: merchants charged at a regular interval with similar amounts. Returns frequency, typical amount, estimated monthly cost and the last charge. Use for subscription and 'what am I paying for every month' questions.",
    recurringChargesInput,
  ),
  defineTool(
    "sync_now",
    "Bring the local data up to date by syncing every connected bank from Plaid. Returns, per bank, whether it synced and how many transactions were added, updated or removed, never the transactions themselves: use the other tools afterwards to answer. Use it only when the user asks for fresh or up-to-date data, or when the question is about the last day or two and the data is older than that. It skips Plaid if the data was synced in the last 5 minutes. Plaid refreshes from banks a few times a day, so the newest purchases can still be missing after a sync.",
    syncNowInput,
  ),
]
