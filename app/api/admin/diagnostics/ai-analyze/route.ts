import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getStorageUsage } from '@/app/lib/storage'
import { countPlaceholderManifests, performHealthCheck } from '@/app/lib/platform-health'
import { computeVerifyFunnel } from '@/app/lib/verify-funnel'
import { buildHealthNodes } from '@/app/lib/health-resolution'
import { callLlmWithFallback } from '@/app/lib/llm-client'
import { getActiveJails } from '@/app/lib/ratelimit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId },
    })

    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Gather live telemetry data for LLM analysis
    const [
      userCount,
      manifestCount,
      keyCount,
      totalRequests,
      storage,
      placeholderManifestCount,
      verifyFunnel,
      platformHealth,
      recentErrors,
      jailsList,
      blacklistCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.manifest.count(),
      prisma.apiKey.count(),
      prisma.apiUsage.count(),
      getStorageUsage(),
      countPlaceholderManifests(),
      computeVerifyFunnel(24),
      performHealthCheck().catch(() => null),
      prisma.apiUsage.findMany({
        where: { status: { gte: 400 } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { method: true, endpoint: true, status: true, createdAt: true, ip: true },
      }),
      getActiveJails().catch(() => []),
      (prisma as any).blacklistedIp?.count?.().catch(() => 0) || 0,
    ])

    const healthNodes = platformHealth ? buildHealthNodes(platformHealth) : []
    const jailsCount = Array.isArray(jailsList) ? jailsList.length : 0

    const telemetryContext = {
      timestamp: new Date().toISOString(),
      userCount,
      manifestCount,
      keyCount,
      totalRequests,
      placeholderManifestCount,
      storage: {
        totalGB: (storage.totalBytes / (1024 * 1024 * 1024)).toFixed(2),
        localBufferMB: (storage.localBufferBytes / (1024 * 1024)).toFixed(1),
        manifestCount: storage.manifestCount,
      },
      verifyFunnel: {
        completionRatePct: Math.round((verifyFunnel.completionRate || 0) * 100),
        failureRatePct: Math.round((verifyFunnel.failureRate || 0) * 100),
        counts: verifyFunnel.counts,
      },
      firewall: {
        jailsCount,
        blacklistCount,
        totalBlocked: jailsCount + blacklistCount,
      },
      subsystems: healthNodes.map((n) => ({
        id: n.id,
        label: n.label,
        ok: n.ok,
        status: n.status,
        summary: n.summary,
      })),
      recentApiErrors: (recentErrors || []).map((e: any) => `${e.method} ${e.endpoint} -> ${e.status}`),
    }

    // Call Local LLM / Fallback to analyze system health
    const prompt = `You are an expert Lead Systems Architect & Infrastructure AI Auditor.
Analyze the following live platform telemetry data and generate a JSON diagnostic report:

PLATFORM TELEMETRY:
${JSON.stringify(telemetryContext, null, 2)}

Requirements:
1. Provide an overall healthScore (integer between 0 and 100).
2. Set overallStatus to one of: "OPERATIONAL", "DEGRADED", "CRITICAL".
3. Write a concise executive summary (2-3 sentences).
4. Provide findings as an array of objects: { category: string, severity: "critical" | "warning" | "info", title: string, description: string, recommendation: string, quickFixKey?: string }.
5. Provide rawMarkdown containing a full formatted Markdown report with sections, root causes, and technical remediation steps.

Respond ONLY with valid JSON matching this structure:
{
  "healthScore": 95,
  "overallStatus": "OPERATIONAL",
  "summary": "...",
  "findings": [...],
  "rawMarkdown": "..."
}`

    const llmResult = await callLlmWithFallback({
      messages: [
        {
          role: 'system',
          content: 'You are an automated AI Systems Diagnostic Auditor. Always respond in valid JSON format.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    })

    if (!llmResult || !llmResult.message?.content) {
      return NextResponse.json({
        healthScore: platformHealth?.healthy ? 95 : 70,
        overallStatus: platformHealth?.healthy ? 'OPERATIONAL' : 'DEGRADED',
        summary: platformHealth?.healthy
          ? 'All critical subsystems are operational. No immediate action required.'
          : 'Infrastructure degradation detected. Review subsystem nodes below.',
        provider: 'rule-engine',
        model: 'system-rules',
        findings: healthNodes
          .filter((n) => !n.ok)
          .map((n) => ({
            category: 'Subsystems',
            severity: 'warning',
            title: `${n.label} Degraded`,
            description: n.summary || 'Subsystem reported degraded performance.',
            recommendation: n.resolutionSteps?.[0] || 'Check service logs and restart process.',
          })),
        rawMarkdown: `### Platform Health Summary\n\n- **Status**: ${platformHealth?.healthy ? 'Operational' : 'Degraded'}\n- **Users**: ${userCount.toLocaleString()}\n- **Storage**: ${(storage.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      })
    }

    try {
      const cleaned = llmResult.message.content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
      const parsed = JSON.parse(cleaned)
      return NextResponse.json({
        ...parsed,
        provider: llmResult.provider,
        model: llmResult.model,
        analyzedAt: new Date().toISOString(),
      })
    } catch {
      return NextResponse.json({
        healthScore: platformHealth?.healthy ? 90 : 65,
        overallStatus: platformHealth?.healthy ? 'OPERATIONAL' : 'DEGRADED',
        summary: 'AI analysis generated raw text report.',
        provider: llmResult.provider,
        model: llmResult.model,
        findings: [],
        rawMarkdown: llmResult.message.content,
        analyzedAt: new Date().toISOString(),
      })
    }
  } catch (error) {
    console.error('[AI Diagnostics Error]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
