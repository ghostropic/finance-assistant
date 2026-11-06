// Server-Sent Events: the wire format for /api/chat (docs/decisions/0006).
// Pure functions, shared by the route (encode) and the browser (parse).

/** Lines starting with ":" are comments, used as keep-alives. */
const isCommentLine = (line: string) => line.startsWith(":")

export interface SseMessage {
  event: string
  data: string
}

/** One SSE message. Multi-line data becomes several data: lines, per the spec. */
export function encodeSse(event: string, data: unknown): string {
  const json = JSON.stringify(data)
  return `event: ${event}\n${json
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n")}\n\n`
}

/**
 * Incremental parser: feed it chunks as they arrive (they can split anywhere,
 * even mid-line) and it calls onMessage for each complete message.
 */
export function createSseParser(onMessage: (msg: SseMessage) => void) {
  let buffer = ""
  let event = "message"
  let data: string[] = []

  const dispatch = () => {
    if (data.length) onMessage({ event, data: data.join("\n") })
    event = "message"
    data = []
  }

  return {
    push(chunk: string) {
      buffer += chunk
      let newline: number
      while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
        // A lone \r at the very end may be the first half of a \r\n split across chunks.
        if (buffer[newline] === "\r" && newline === buffer.length - 1) break
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(
          newline + (buffer.startsWith("\r\n", newline) ? 2 : 1),
        )
        if (line === "") dispatch()
        else if (isCommentLine(line)) continue
        else {
          const colon = line.indexOf(":")
          const field = colon === -1 ? line : line.slice(0, colon)
          const value =
            colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
          if (field === "event") event = value
          else if (field === "data") data.push(value)
        }
      }
    },
    /** Call when the stream ends, in case the last message had no trailing blank line. */
    end() {
      if (buffer) this.push("\n")
      dispatch()
    },
  }
}
