/** Shared shape for API usage & web generation time-series charts (UTC buckets). */

export interface UsageSeriesPoint {
  period: string
  requests: number
  success: number
  /** API: distinct IPs. Web: distinct App IDs in the bucket. */
  uniqueIps: number
}

export interface ApiUsageChartsData {
  daily: UsageSeriesPoint[]
  weekly: UsageSeriesPoint[]
  monthly: UsageSeriesPoint[]
}
