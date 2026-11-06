import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { decrypt, encrypt } from "@/lib/crypto"

const key = randomBytes(32).toString("base64")

describe("access token encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encrypt("access-sandbox-123", key)
    expect(sealed).not.toContain("access-sandbox-123")
    expect(sealed.startsWith("v1:")).toBe(true)
    expect(decrypt(sealed, key)).toBe("access-sandbox-123")
  })

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key))
  })

  it("rejects tampering and the wrong key", () => {
    const sealed = encrypt("secret", key)
    const parts = sealed.split(":")
    parts[3] = Buffer.from("tampered").toString("base64")
    expect(() => decrypt(parts.join(":"), key)).toThrow()
    expect(() => decrypt(sealed, randomBytes(32).toString("base64"))).toThrow()
  })

  it("requires a 32-byte key", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(
      /32 bytes/,
    )
  })
})
