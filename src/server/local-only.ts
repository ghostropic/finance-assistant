// The API serves one person's finances and spends their Claude credits, so it
// answers only requests addressed to this machine (docs/decisions/0007).
// Checking Host blocks DNS-rebinding; checking Origin blocks other websites
// open in the same browser from calling it.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

// IPv6 hosts arrive bracketed with the port after them: "[::1]:3000".
function extractHostname(host: string): string {
  return host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0]
}

/** Returns a 403 Response if the request isn't local, otherwise null. */
export function rejectNonLocal(request: Request): Response | null {
  const host = request.headers.get("host") ?? ""
  if (!LOCAL_HOSTNAMES.has(extractHostname(host).toLowerCase())) {
    return Response.json(
      { error: "This API only accepts requests to localhost." },
      { status: 403 },
    )
  }
  const origin = request.headers.get("origin")
  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = ""
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return Response.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403 },
      )
    }
  }
  return null
}
