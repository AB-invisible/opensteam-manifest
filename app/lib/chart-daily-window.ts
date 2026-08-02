/** Matches `fillMissingDays(days)` first UTC bucket — SQL cutoff must use `days - 1`. */
export const DAILY_CHART_DAYS = 30

/** UTC midnight at start of the calendar day `daysBackFromToday` before today’s UTC date. */
export function utcMidnightDaysAgo(now: Date, daysBackFromToday: number): Date {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysBackFromToday)
  return d
}

/** Lower bound for daily aggregates so every bucket matches `fillMissingDays(days, ...)`. */
export function dailyChartSqlCutoff(now: Date, days = DAILY_CHART_DAYS): Date {
  return utcMidnightDaysAgo(now, days - 1)
}
