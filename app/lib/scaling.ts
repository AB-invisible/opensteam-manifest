import { prisma } from './prisma'

/**
 * ScalingEngine: Monitors platform load and identifies scaling opportunities.
 */
export class ScalingEngine {
  /**
   * Analyzes request velocity over the last 5 minutes.
   * Logs a recomendation if the load exceeds standard capacity.
   */
  static async monitorVelocity() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    
    // Aggregate requests per minute (approx)
    const recentUsage = await prisma.apiUsage.count({
      where: {
        createdAt: { gte: fiveMinutesAgo }
      }
    })

    const rpm = recentUsage / 5
    const THRESHOLD_SCALING = 500 // 500 requests per minute threshold

    console.log(`[Scaling] Current RPM: ${rpm.toFixed(2)} (Threshold: ${THRESHOLD_SCALING})`)

    if (rpm > THRESHOLD_SCALING) {
      const details = {
        currentRpm: rpm,
        threshold: THRESHOLD_SCALING,
        recommendation: 'PROVISION_ADDITIONAL_RELAY_NODE',
        region: 'GLOBAL' // In a multi-region setup, we'd group by region
      }

      await prisma.sentinelLog.create({
        data: {
          action: 'SCALING_RECOMMENDED',
          score: Math.floor(rpm / 10),
          reason: `High request velocity detected (${rpm.toFixed(0)} RPM)`,
          details: JSON.stringify(details)
        }
      })

      // Alert administrators
      import('./bot-admin').then(m => {
        m.sendBotAlert(
          `🚀 **Autonomous Scaling Alert**\nPlatform load detected at **${rpm.toFixed(0)} RPM**. Total Autonomy: Recommendation to provision additional relay nodes.`,
          'SYSTEM'
        )
      })

      return { scalingRequired: true, rpm }
    }

    return { scalingRequired: false, rpm }
  }
}
