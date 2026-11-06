import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  assertEnvironmentMatches,
  EnvironmentMismatchError,
} from "@/lib/environment"
import { startTestDb, type TestDb } from "./helpers/db"

let testDb: TestDb

beforeAll(async () => {
  testDb = await startTestDb()
})
afterAll(() => testDb?.stop())
beforeEach(() => testDb.db.plaidItem.deleteMany())

const addBank = (environment: string, plaidItemId = `item-${environment}`) =>
  testDb.db.plaidItem.create({
    data: { plaidItemId, environment, accessTokenEncrypted: "sealed" },
  })

describe("assertEnvironmentMatches", () => {
  it("passes with no banks, or banks from the same environment", async () => {
    await expect(
      assertEnvironmentMatches(testDb.db, "production"),
    ).resolves.toBeUndefined()
    await addBank("sandbox")
    await expect(
      assertEnvironmentMatches(testDb.db, "sandbox"),
    ).resolves.toBeUndefined()
  })

  it("refuses a database holding banks from another environment, naming both", async () => {
    await addBank("sandbox")
    const check = assertEnvironmentMatches(testDb.db, "production")
    await expect(check).rejects.toBeInstanceOf(EnvironmentMismatchError)
    await expect(check).rejects.toThrow(/PLAID_ENV is production.*sandbox/)
  })

  it("refuses a database that already mixes environments", async () => {
    await addBank("sandbox")
    await addBank("production")
    await expect(
      assertEnvironmentMatches(testDb.db, "sandbox"),
    ).rejects.toThrow(/production/)
  })
})
