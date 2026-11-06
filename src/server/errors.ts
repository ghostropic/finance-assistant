import { EnvironmentMismatchError } from "@/lib/environment"
import { errorClassOf, log, type LogEvent } from "@/lib/log"
import { extractPlaidErrorCode } from "@/lib/plaid"
import { BankNotFoundError, DuplicateBankError } from "./banks"

type Route = Extract<LogEvent, { event: "http_error" }>["route"]

/**
 * Turns an error from the bank routes into a JSON response and an `http_error`
 * log line. Plaid errors are logged and returned by code only: the full error
 * holds request config, including the Plaid secret headers (docs/security.md).
 */
export function toErrorResponse(err: unknown, route: Route): Response {
  if (err instanceof DuplicateBankError) {
    log({
      event: "http_error",
      route,
      status: 409,
      errorKind: "duplicate_bank",
    })
    return Response.json({ error: err.message }, { status: 409 })
  }
  if (err instanceof EnvironmentMismatchError) {
    log({
      event: "http_error",
      route,
      status: 409,
      errorKind: "environment_mismatch",
    })
    return Response.json({ error: err.message }, { status: 409 })
  }
  if (err instanceof BankNotFoundError) {
    log({
      event: "http_error",
      route,
      status: 404,
      errorKind: "bank_not_found",
    })
    return Response.json({ error: err.message }, { status: 404 })
  }

  const code = extractPlaidErrorCode(err)
  if (code) {
    log({
      event: "http_error",
      route,
      status: 502,
      errorKind: "plaid_error",
      plaidCode: code,
    })
    return Response.json(
      { error: `Plaid returned an error (${code}).`, code },
      { status: 502 },
    )
  }
  const errorClass = errorClassOf(err)
  log({
    event: "http_error",
    route,
    status: 500,
    errorKind: "internal",
    ...(errorClass ? { errorClass } : {}),
  })
  return Response.json({ error: "Something went wrong." }, { status: 500 })
}
