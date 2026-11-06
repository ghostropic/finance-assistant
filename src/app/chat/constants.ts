export const SUGGESTED_QUESTIONS = [
  "What did I spend the most on last month?",
  "Did I spend more this month than last month?",
  "How much do I have across all my accounts?",
  "What subscriptions am I paying for?",
] as const

export const MAX_QUESTION_LENGTH = 4000

export const SCROLL_FOLLOW_THRESHOLD_PX = 160

export const CONVERSATION_URL_PARAM = "c"

/** The page syncs on open when the oldest bank's data is older than this. */
export const AUTO_SYNC_AFTER_MS = 12 * 60 * 60 * 1000
