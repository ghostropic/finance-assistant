import { createSseParser } from "@/chat/sse"
import type { ChatEvent } from "@/chat/display"
import type {
  BankSummary,
  ChatRequest,
  ConversationDetail,
  ConversationSummary,
  ItemSyncResult,
  Status,
  SyncRun,
} from "./types"

export class ApiError extends Error {}

const readError = async (res: Response) => {
  const body = await res.json().catch(() => null)
  return new ApiError(body?.error ?? `Request failed (${res.status})`)
}

const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(path, { cache: "no-store" })
  if (!res.ok) throw await readError(res)
  return res.json()
}

const sendJson = async <T>(
  path: string,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<T> => {
  const res = await fetch(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await readError(res)
  return res.status === 204 ? (undefined as T) : res.json()
}

export const fetchStatus = () => fetchJson<Status>("/api/status")

export const fetchBanks = async () =>
  (await fetchJson<{ banks: BankSummary[] }>("/api/banks")).banks

export const runSync = (trigger: "button" | "page_open" | "reconnect") =>
  sendJson<SyncRun>("/api/sync", "POST", { trigger })

/** A Plaid Link token: for a new bank, or with `bankId` to repair that bank (update mode). */
export const createLinkToken = async (bankId?: string) =>
  (
    await sendJson<{ linkToken: string }>(
      "/api/plaid/link-token",
      "POST",
      bankId ? { bankId } : {},
    )
  ).linkToken

/** `institutionId` is what Link reported, so the server can refuse a duplicate before exchanging. */
export const connectBank = (publicToken: string, institutionId?: string) =>
  sendJson<{ bankId: string; firstSync: ItemSyncResult }>(
    "/api/plaid/exchange",
    "POST",
    {
      publicToken,
      ...(institutionId ? { institutionId } : {}),
    },
  )

export const removeBank = (bankId: string) =>
  sendJson<void>(`/api/banks/${bankId}`, "DELETE")

export const fetchConversations = async () =>
  (
    await fetchJson<{ conversations: ConversationSummary[] }>(
      "/api/conversations",
    )
  ).conversations

export const fetchConversation = (id: string) =>
  fetchJson<ConversationDetail>(`/api/conversations/${id}`)

export const deleteConversation = (id: string) =>
  sendJson<void>(`/api/conversations/${id}`, "DELETE")

/** Streams one chat turn, calling `onEvent` for each event as it arrives. Resolves when the stream ends. */
export const streamChat = async (
  request: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) => {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  })
  if (!res.ok || !res.body) throw await readError(res)

  const parser = createSseParser(({ data }) =>
    onEvent(JSON.parse(data) as ChatEvent),
  )
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    parser.push(value)
  }
  parser.end()
}
