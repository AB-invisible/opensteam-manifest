import { authOptions } from '@/app/lib/auth-options'
import { APPLICATION_MAX_SCORE, APPLICATION_PASS_SCORE } from '@/app/lib/config'
import { normalizeDiscordSnowflake } from '@/app/lib/discord-id'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { pushApplicationStatus } from '@/app/lib/trello'
import { grantTrialModDiscordRole, logDiscordModRoleResult } from '@/app/lib/discord-mod-roles'
import axios from 'axios'

const DISCORD_RESULTS_CHANNEL_ID = '1497850215271497808'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { responseId, discordUserId: discordRaw, score, feedback, username } = await request.json()
  const discordUserId = normalizeDiscordSnowflake(discordRaw) || String(discordRaw || '').trim()

  if (!score || !discordUserId) {
    return NextResponse.json({ error: 'Score and Discord User ID are required' }, { status: 400 })
  }

  const numericScore = parseInt(score)
  const isPassed = numericScore >= APPLICATION_PASS_SCORE
  const resultStatus = isPassed ? 'Passed' : 'Failed'
  const color = isPassed ? 0x10b981 : 0xef4444 // Green if passed, Red if failed

  // Get Discord Bot Token from DB
  const tokenCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } })
  if (!tokenCfg?.value) {
    return NextResponse.json({ error: 'Discord Bot Token not configured' }, { status: 500 })
  }

  try {
    // Send to Discord via REST API
    const messageContent = {
      embeds: [{
        title: `📝 Application Result: ${resultStatus}`,
        description: `Results for **${username || discordUserId}**`,
        color: color,
        fields: [
          { name: 'User', value: `<@${discordUserId}>`, inline: true },
          { name: 'Score', value: `**${numericScore}/${APPLICATION_MAX_SCORE}**`, inline: true },
          { name: 'Status', value: isPassed ? '✅ Passed' : '❌ Failed', inline: true },
          { name: 'Feedback', value: feedback || 'No additional feedback provided.' }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'OpenSteam Application System' }
      }]
    }

    await axios.post(
      `https://discord.com/api/v10/channels/${DISCORD_RESULTS_CHANNEL_ID}/messages`,
      messageContent,
      {
        headers: {
          Authorization: `Bot ${tokenCfg.value}`,
          'Content-Type': 'application/json'
        }
      }
    )

    // Log the grading action
    const auditDetails = `Graded application for ${discordUserId}: ${resultStatus} (${numericScore}/${APPLICATION_MAX_SCORE}) | ResponseID: ${responseId && String(responseId).trim() ? String(responseId).trim() : 'Unknown'}`
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'GRADE_APPLICATION',
        targetId: discordUserId,
        details: auditDetails,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })

    const trelloResult = await pushApplicationStatus(
      discordUserId,
      username || discordUserId,
      resultStatus as 'Passed' | 'Failed',
      numericScore,
      feedback
    )

    // Email candidate if passed
    if (isPassed) {
      void grantTrialModDiscordRole(discordUserId).then((result) =>
        logDiscordModRoleResult('application_pass', discordUserId, result)
      )

      try {
        const targetUser = await prisma.user.findUnique({ where: { discordId: discordUserId } });
        let email = targetUser?.email;
        let answersOrdered = null;

        // Fetch form response to enrich email address and gather submitted answers for the candidate
        try {
          const { getFormResponses } = await import('@/app/lib/google-forms');
          const formId = '17zWGbRUjIVxZTtha80EfDlDQFqyHZj46xDBBxDTaoGk';
          const data = await getFormResponses(formId);
          const resp = data.responses.find(r => {
            const discordKey = Object.keys(r.answers).find(
              k => k.toLowerCase().includes('discord') && !k.toLowerCase().includes('username')
            );
            const raw = discordKey ? r.answers[discordKey] : null;
            const dId = raw && String(raw).trim() ? normalizeDiscordSnowflake(raw) || String(raw).trim() : null;
            return dId === discordUserId;
          });
          if (resp) {
            if (!email && (resp as any).email) {
              email = (resp as any).email;
            }
            answersOrdered = resp.answersOrdered;
          }
        } catch (err) {
          console.error('[Grade API Get Form Responses Error]', err);
        }

        if (email) {
          const { sendBrandedEmail, renderInitialAppAnswersHtml } = await import('@/app/lib/email');
          const answerSheetHtml = answersOrdered ? renderInitialAppAnswersHtml(answersOrdered) : '';
          await sendBrandedEmail(
            email,
            'Application Passed — OpenSteam Moderator Team',
            'Application Passed',
            `Hello <strong>${username || discordUserId}</strong>,<br><br>` +
            `Congratulations! We are pleased to inform you that your application for the OpenSteam Moderator Team has **Passed** our initial screening.<br><br>` +
            `You scored <strong>${numericScore}/${APPLICATION_MAX_SCORE}</strong> on your application evaluation.<br><br>` +
            (feedback ? `<strong>Staff Feedback:</strong> ${feedback}<br><br>` : '') +
            `Your moderator trial period has started. Please log in to your dashboard to view your trial details.<br><br>` +
            (answerSheetHtml ? `Below is a copy of your submitted application for your reference:<br><br>${answerSheetHtml}` : ''),
            '#10b981',
            undefined,
            {
              buttonText: 'Open Dashboard',
              buttonUrl: 'http://127.0.0.1:3000/dashboard',
              badge: 'Passed screening'
            }
          );
        }
      } catch (emailErr) {
        console.error('[Grade API Email Error]', emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      trelloSynced: trelloResult.ok,
      ...(trelloResult.ok ? {} : { trelloError: trelloResult.error }),
    })
  } catch (error: any) {
    console.error('[Grading API Error]', error.response?.data || error)
    return NextResponse.json({ 
      error: 'Failed to send result to Discord: ' + (error.response?.data?.message || error.message) 
    }, { status: 500 })
  }
}
