import type Anthropic from "@anthropic-ai/sdk"

// A scripted fake of the streaming Messages API: no network, no key.
// Each request takes the next scripted response; text blocks are streamed as deltas.

export type Scripted =
  | { content: Anthropic.Beta.BetaContentBlock[]; stop_reason: string }
  | { error: Error }

export interface RecordedRequest {
  messages: Anthropic.Beta.BetaMessageParam[]
  fallbacks: unknown
  betas: unknown
}

export function fakeClient(responses: Scripted[]) {
  const requests: RecordedRequest[] = []
  const client = {
    beta: {
      messages: {
        stream(params: RecordedRequest) {
          requests.push({
            ...params,
            messages: structuredClone(params.messages),
          })
          const next = responses.shift()
          if (!next) throw new Error("unexpected extra request")
          if ("error" in next) throw next.error
          const events = next.content
            .filter((b) => b.type === "text")
            .map((b) => ({
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: (b as Anthropic.Beta.BetaTextBlock).text,
              },
            }))
          return {
            async *[Symbol.asyncIterator]() {
              yield* events
            },
            finalMessage: async () => ({
              ...next,
              usage: {
                input_tokens: 100,
                output_tokens: 20,
                cache_read_input_tokens: 50,
                cache_creation_input_tokens: 0,
              },
            }),
          }
        },
      },
    },
  }
  return { client: client as unknown as Anthropic, requests }
}

export const toolUse = (id: string, name: string, input: unknown) =>
  ({
    type: "tool_use",
    id,
    name,
    input,
  }) as unknown as Anthropic.Beta.BetaContentBlock
export const text = (t: string) =>
  ({
    type: "text",
    text: t,
    citations: null,
  }) as unknown as Anthropic.Beta.BetaContentBlock
export const thinking = (signature: string) =>
  ({
    type: "thinking",
    thinking: "",
    signature,
  }) as unknown as Anthropic.Beta.BetaContentBlock

export async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = []
  for await (const e of gen) events.push(e)
  return events
}
