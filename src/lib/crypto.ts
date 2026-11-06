import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM for Plaid access tokens at rest.
// Stored format: v1:<iv>:<auth tag>:<ciphertext>, each part base64.

const VERSION = "v1"

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64")
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).",
    )
  }
  return key
}

export function encrypt(plaintext: string, base64Key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", decodeKey(base64Key), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64")))
    .join(":")
}

export function decrypt(stored: string, base64Key: string): string {
  const [version, iv, tag, ciphertext] = stored.split(":")
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognized encrypted token format.")
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(base64Key),
    Buffer.from(iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
