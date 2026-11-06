import { getDb } from "@/lib/db"
import { plaidEnvironment } from "@/lib/env"
import {
  assertEnvironmentMatches,
  EnvironmentMismatchError,
} from "@/lib/environment"
import { log } from "@/lib/log"

/**
 * Stops the server from starting when PLAID_ENV doesn't match the banks in the
 * database (docs/milestone-3.md); the thrown error's message says what to fix.
 * A database that isn't reachable yet only gets a log line: the routes report
 * that themselves once a request comes in.
 */
export async function checkEnvironmentAtStartup(): Promise<void> {
  try {
    await assertEnvironmentMatches(getDb(), plaidEnvironment())
    log({ event: "startup_check", result: "ok" })
  } catch (err) {
    if (err instanceof EnvironmentMismatchError) {
      log({ event: "startup_check", result: "environment_mismatch" })
      throw err
    }
    log({ event: "startup_check", result: "database_unreachable" })
  }
}
