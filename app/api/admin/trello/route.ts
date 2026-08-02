import { authOptions } from '@/app/lib/auth-options'
import { APPLICATION_PASS_SCORE } from '@/app/lib/config'
import { normalizeDiscordSnowflake } from '@/app/lib/discord-id'
import { prisma } from '@/app/lib/prisma'
import { syncTrelloBoard, moveCardToList, getBoardLabels, addLabelToCard, pushApplicationStatus, findTrelloCardByName } from '@/app/lib/trello'
import { getFormResponses } from '@/app/lib/google-forms'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/trello - Fetch and sync Trello board data
 */
export async function GET(request: NextRequest) {
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

  const action = request.nextUrl.searchParams.get('action')

  try {
    if (action === 'labels') {
      const labels = await getBoardLabels()
      return NextResponse.json({ labels })
    }

    const result = await syncTrelloBoard()
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[Trello API Error]', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to sync with Trello' 
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/trello - Perform actions on Trello cards
 * Actions: moveCard, addLabel, syncForms
 */
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

  const body = await request.json()
  const { action, cardId, listId, labelId, cardName, formId } = body

  try {
    if (action === 'moveCard' && cardId && listId) {
      await moveCardToList(cardId, listId)
      
      // Log the action
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'TRELLO_MOVE_CARD',
          targetId: cardId,
          details: `Moved Trello card "${cardName || cardId}" to list ${listId}`,
          ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
        }
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'addLabel' && cardId && labelId) {
      await addLabelToCard(cardId, labelId)

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'TRELLO_ADD_LABEL',
          targetId: cardId,
          details: `Added label ${labelId} to Trello card "${cardName || cardId}"`,
          ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
        }
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'syncForms') {
      const data = await getFormResponses(formId || '17zWGbRUjIVxZTtha80EfDlDQFqyHZj46xDBBxDTaoGk');
      
      // We do this asynchronously to avoid blocking the request too long
      // though for a reasonable number of forms it should be fine.
      let count = 0;
      for (const resp of data.responses) {
        const discordKey = Object.keys(resp.answers).find(
          k => k.toLowerCase().includes('discord') && !k.toLowerCase().includes('username')
        );
        const raw = discordKey ? resp.answers[discordKey] : null;
        const discordId =
          raw && String(raw).trim()
            ? normalizeDiscordSnowflake(raw) || String(raw).trim()
            : null;

        if (discordId) {
          const score = resp.score ?? undefined;
          const status = resp.graded ? (score !== undefined && score >= APPLICATION_PASS_SCORE ? 'Passed' : 'Failed') : 'Pending';
          const nameKey = Object.keys(resp.answers).find(
            (k) =>
              k.toLowerCase().includes('discord') &&
              k.toLowerCase().includes('username')
          );
          const nickKey = Object.keys(resp.answers).find(
            (k) =>
              (k.toLowerCase().includes('name') || k.toLowerCase().includes('nick')) &&
              !k.toLowerCase().includes('discord')
          );
          const displayName =
            (nameKey && String(resp.answers[nameKey]).trim()) ||
            (nickKey && String(resp.answers[nickKey]).trim()) ||
            discordId;

          // Check if card exists before pushing status to detect new registrations
          const existingCard = await findTrelloCardByName(discordId);
          if (!existingCard && status === 'Pending') {
            let email = (resp as any).email;
            if (!email) {
              const dbUser = await prisma.user.findUnique({ where: { discordId } });
              if (dbUser?.email) email = dbUser.email;
            }
            if (email) {
              const { sendBrandedEmail, renderInitialAppAnswersHtml } = await import('@/app/lib/email');
              const answerSheetHtml = renderInitialAppAnswersHtml(resp.answersOrdered);
              await sendBrandedEmail(
                email,
                'Application Received — OpenSteam Moderator Team',
                'Application Registered',
                `Hello <strong>${displayName}</strong>,<br><br>` +
                `Thank you for applying to join the OpenSteam Moderator Team! Your application has been successfully registered in our system and is currently marked as <strong>Pending Review</strong>.<br><br>` +
                `Our administration team will review your application shortly. Below is a copy of the answer sheet you submitted for your records:<br><br>` +
                answerSheetHtml,
                '#ea580c',
                undefined,
                {
                  buttonText: 'Open Dashboard',
                  buttonUrl: 'http://127.0.0.1:3000/dashboard',
                  badge: 'Pending Review'
                }
              ).catch(err => {
                console.error('[SyncForms Email Error]', err);
              });
            }
          }

          await pushApplicationStatus(discordId, displayName, status, score, '');
          count++;
        }
      }

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'TRELLO_SYNC_FORMS',
          details: `Synced ${count} form responses to Trello board`,
          ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
        }
      })

      return NextResponse.json({ success: true, count })
    }

    return NextResponse.json({ error: 'Invalid action or missing parameters' }, { status: 400 })
  } catch (error: any) {
    console.error('[Trello Action Error]', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to perform Trello action' 
    }, { status: 500 })
  }
}
