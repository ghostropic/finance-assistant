// Runs once when the Next.js server starts (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { configureLogging } = await import("@/lib/log")
  configureLogging({ stdout: true })
  const { checkEnvironmentAtStartup } = await import("@/server/startup")
  await checkEnvironmentAtStartup()
}
