/**
 * Staff roles for dashboard Guides, Tests, Overview charts, `/dashboard/api` (API Logs), and related APIs.
 * Includes Trial Moderator (aligned with sidebar and `GET /api/user/api-logs`).
 */

export function isModeratorPlus(role: string | null | undefined): boolean {
  if (!role) return false
  return (
    role === 'TRIAL_MODERATOR' ||
    role === 'MODERATOR' ||
    role === 'SENIOR_MODERATOR' ||
    role === 'ADMIN' ||
    role === 'OWNER'
  )
}
