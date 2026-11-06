import { Geist, Geist_Mono } from "next/font/google"
import Script from "next/script"
import { THEME_SCRIPT } from "./theme-script"
import "./globals.css"
import type { Metadata } from "next"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const FONT_CLASSES = `${geistSans.variable} ${geistMono.variable}`

const THEME_SCRIPT_HTML = { __html: THEME_SCRIPT }

// Exactly the URL react-plaid-link loads, so its hook finds this tag and reuses it.
// Loading it from the hook instead embeds it twice under React's development
// double-mount, which Plaid doesn't support. beforeInteractive means it has
// loaded before the hook first runs, which the hook assumes for an existing tag.
const PLAID_LINK_SCRIPT_URL =
  "https://cdn.plaid.com/link/v2/stable/link-initialize.js"

export const metadata: Metadata = {
  title: "Finance Assistant",
  description: "Ask questions about your own finances",
}

// The theme script adds a class to <html> before React hydrates, so the attribute differs by design.
const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html lang="en" className={FONT_CLASSES} suppressHydrationWarning>
    <body>
      <Script
        id="theme"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={THEME_SCRIPT_HTML}
      />
      <Script
        id="plaid-link"
        src={PLAID_LINK_SCRIPT_URL}
        strategy="beforeInteractive"
      />
      {children}
    </body>
  </html>
)

export default RootLayout
