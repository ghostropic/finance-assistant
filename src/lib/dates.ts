/** Today's date in the machine's local time zone, YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA")
}
