import { describe, expect, it } from "vitest"
import { rejectNonLocal } from "@/server/local-only"

const req = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3000/api/chat", { method: "POST", headers })

describe("rejectNonLocal", () => {
  it("allows same-origin requests to localhost addresses", () => {
    expect(
      rejectNonLocal(
        req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }),
      ),
    ).toBeNull()
    expect(
      rejectNonLocal(
        req({ host: "localhost:3000", origin: "http://localhost:3000" }),
      ),
    ).toBeNull()
    expect(rejectNonLocal(req({ host: "[::1]:3000" }))).toBeNull()
    expect(rejectNonLocal(req({ host: "127.0.0.1:3000" }))).toBeNull() // curl, no Origin
  })

  it("rejects other hosts (LAN access, DNS rebinding)", () => {
    expect(rejectNonLocal(req({ host: "192.168.1.20:3000" }))?.status).toBe(403)
    expect(rejectNonLocal(req({ host: "evil.example:3000" }))?.status).toBe(403)
    expect(
      rejectNonLocal(req({ host: "localhost.evil.example" }))?.status,
    ).toBe(403)
  })

  it("rejects requests from other websites", () => {
    expect(
      rejectNonLocal(
        req({ host: "127.0.0.1:3000", origin: "https://evil.example" }),
      )?.status,
    ).toBe(403)
    expect(
      rejectNonLocal(
        req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:4000" }),
      )?.status,
    ).toBe(403)
    expect(
      rejectNonLocal(req({ host: "127.0.0.1:3000", origin: "null" }))?.status,
    ).toBe(403)
  })
})
