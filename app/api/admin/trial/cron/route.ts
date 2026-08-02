import { LEGACY_EXAM_KIND } from '@/app/lib/mod-assessment-service'
import { prisma } from '@/app/lib/prisma'
import { TRIAL_MOD_DAYS } from '@/app/lib/moderator-trial'
import { getDocumentContent } from '@/app/lib/google-forms'
import { verifyAdminApiKeyFromRequest } from '@/app/lib/admin-api-key'
import { requireAuth, isPrivilegedStaff } from '@/app/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'

const HANDBOOK_DOC_ID = '1ZTLsqqYVtnbZL_0YRiBaf4-06nkJLoeKk65CnsYCT1U'

/**
 * GET /api/admin/trial/cron
 * Auto-generate legacy handbook tests for trial moderators 1 day before their trial ends (TRIAL_MOD_DAYS).
 * This endpoint should be called periodically (e.g. by a cron job or on dashboard load).
 * Protected by ADMIN_API_KEY (cron/bot) or a privileged staff session (dashboard nudge).
 */
export async function GET(request: NextRequest) {
  if (!verifyAdminApiKeyFromRequest(request)) {
    const auth = await requireAuth()
    if (!auth.ok) return auth.error
    if (!isPrivilegedStaff(auth.data.dbUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    // Find all trial moderators whose trial ends within the next 24 hours
    const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    
    const trialMods = await prisma.user.findMany({
      where: {
        role: 'TRIAL_MODERATOR',
        trialStartDate: { not: null }
      },
      select: {
        id: true,
        username: true,
        trialStartDate: true,
        modTestReadyAt: true,
        trialTests: {
          where: {
            examKind: LEGACY_EXAM_KIND,
            status: { in: ['ACTIVE', 'PENDING', 'SUBMITTED', 'PASSED'] },
          },
          select: { id: true },
        },
      }
    })

    const generated: string[] = []
    const errors: string[] = []

    for (const mod of trialMods) {
      if (!mod.trialStartDate) continue
      
      // Calculate trial end date (TRIAL_MOD_DAYS after role start)
      const trialEndDate = new Date(
        mod.trialStartDate.getTime() + TRIAL_MOD_DAYS * 24 * 60 * 60 * 1000
      )
      
      // Check if trial ends within 24 hours
      const timeUntilEnd = trialEndDate.getTime() - Date.now()
      if (timeUntilEnd > 24 * 60 * 60 * 1000 || timeUntilEnd < 0) continue

      // Staff opted into live moderator assessment — no auto handbook row
      if (mod.modTestReadyAt != null) continue
      
      // Skip if they already have a legacy handbook test in-flight
      if (mod.trialTests.length > 0) continue

      try {
        // Fetch handbook and generate questions
        let allQuestions: any[] = []
        try {
          const rawContent = await getDocumentContent(HANDBOOK_DOC_ID)
          const docData = JSON.parse(rawContent)
          allQuestions = generateQuestionsFromContent(docData)
        } catch {
          allQuestions = getBaselineQuestions()
        }

        const shuffled = allQuestions.sort(() => Math.random() - 0.5)
        const selectedQuestions = shuffled.slice(0, Math.min(15, shuffled.length))

        // Shuffle options
        const finalQuestions = selectedQuestions.map(q => {
          const indices = q.options.map((_: string, i: number) => i)
          const shuffledIndices = indices.sort(() => Math.random() - 0.5)
          const newCorrectIndex = shuffledIndices.indexOf(q.correctIndex)
          return {
            section: q.section,
            question: q.question,
            options: shuffledIndices.map((i: number) => q.options[i]),
            correctIndex: newCorrectIndex
          }
        })

        const questionCount = finalQuestions.length
        const passingScore = Math.ceil(questionCount * 0.7)

        await prisma.trialTest.create({
          data: {
            userId: mod.id,
            examKind: LEGACY_EXAM_KIND,
            questions: finalQuestions as any,
            maxScore: questionCount,
            passingScore,
            status: 'ACTIVE',
            generatedAt: new Date(),
            expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          }
        })

        await prisma.auditLog.create({
          data: {
            userId: mod.id,
            action: 'AUTO_GENERATE_TRIAL_TEST',
            targetId: mod.id,
            details: `Auto-generated trial test for ${mod.username} (1 day before trial end). ${questionCount} questions.`,
            ip: 'system'
          }
        })

        generated.push(mod.username)
      } catch (err) {
        errors.push(`${mod.username}: ${(err as Error).message}`)
      }
    }

    return NextResponse.json({
      success: true,
      checked: trialMods.length,
      generated,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error: any) {
    console.error('[Trial Cron Error]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── Duplicate question generation logic (same as generate/route.ts) ──────────
// Ideally this would be in a shared lib, but keeping it self-contained for reliability

function generateQuestionsFromContent(docData: { fullText: string; sections: { heading: string; content: string }[] }): any[] {
  const questions: any[] = []
  const sections = docData.sections.filter(s => s.content.length > 50)

  for (const section of sections) {
    const sectionQuestions = extractQuestionsFromSection(section.heading, section.content)
    questions.push(...sectionQuestions)
  }

  if (questions.length < 15) {
    questions.push(...getBaselineQuestions())
  }

  return questions
}

function extractQuestionsFromSection(heading: string, content: string): any[] {
  const questions: any[] = []
  const sentences = content.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 20 && s.length < 300)
  const rulePatterns = [/must|should|always|never|required|prohibited|important|ensure|responsible/i, /shall|will be|is not allowed|is required|must not/i, /procedure|process|step|follow|report|escalate/i]
  const keyStatements = sentences.filter(s => rulePatterns.some(p => p.test(s)))
  const usedStatements = keyStatements.slice(0, 3)
  
  for (const statement of usedStatements) {
    const question = generateQuestionFromStatement(heading, statement, sentences)
    if (question) questions.push(question)
  }
  return questions
}

function generateQuestionFromStatement(section: string, statement: string, allSentences: string[]): any | null {
  const clean = statement.replace(/\s+/g, ' ').trim()
  if (clean.length < 20) return null

  const templates = [
    `According to the handbook, which of the following is correct regarding "${section}"?`,
    `What does the "${section}" section state about proper procedure?`,
    `Which statement best reflects the policy in "${section}"?`,
  ]

  const correctAnswer = clean.length > 120 ? clean.substring(0, 117) + '...' : clean
  const wrongAnswers = generateWrongAnswers(clean, allSentences)
  if (wrongAnswers.length < 3) return null

  const options = [...wrongAnswers.slice(0, 3)]
  const correctIndex = Math.floor(Math.random() * 4)
  options.splice(correctIndex, 0, correctAnswer)

  return { section, question: templates[Math.floor(Math.random() * templates.length)], options, correctIndex }
}

function generateWrongAnswers(correctStatement: string, allSentences: string[]): string[] {
  const wrongs: string[] = []
  const inversions: [RegExp, string][] = [[/must/gi, 'should never'], [/should/gi, 'must not'], [/always/gi, 'never'], [/never/gi, 'always'], [/required/gi, 'optional'], [/important/gi, 'unnecessary'], [/prohibited/gi, 'encouraged']]
  for (const [pattern, replacement] of inversions) {
    if (pattern.test(correctStatement)) {
      const inverted = correctStatement.replace(pattern, replacement)
      if (inverted !== correctStatement && inverted.length > 15) {
        wrongs.push(inverted.length > 120 ? inverted.substring(0, 117) + '...' : inverted)
        break
      }
    }
  }
  const otherSentences = allSentences.filter(s => s !== correctStatement && s.length > 20 && s.length < 150).sort(() => Math.random() - 0.5).slice(0, 3)
  for (const s of otherSentences) wrongs.push(s.length > 120 ? s.substring(0, 117) + '...' : s)
  const generics = ['This is not covered in the handbook and is left to personal discretion', 'There is no official policy on this matter', 'This only applies to Admin-level staff, not moderators', 'This rule was deprecated and no longer applies']
  while (wrongs.length < 3) wrongs.push(generics[wrongs.length % generics.length])
  return wrongs
}

function getBaselineQuestions(): any[] {
  return [
    { section: 'General Knowledge', question: 'What role hierarchy does OpenSteam follow?', options: ['User → Admin → Owner', 'User → Moderator → Admin → Owner', 'User → Trial Moderator → Moderator → Admin → Owner', 'Member → Staff → Admin'], correctIndex: 2 },
    { section: 'Moderation Actions', question: 'When should a moderator escalate an issue to an Admin?', options: ['Only when they feel like it', 'When the issue involves banning, system changes, or complex disputes', 'Never, moderators handle everything', 'Only during weekdays'], correctIndex: 1 },
    { section: 'Security', question: 'What should a moderator do if they suspect API key abuse?', options: ['Nothing', 'Immediately revoke the keys, restrict the user, and escalate to Admin', 'Give them more keys', 'Ask the user politely to stop'], correctIndex: 1 },
    { section: 'Ethics & Conduct', question: 'Can a moderator use their privileges for personal gain?', options: ['Yes', 'No, moderator privileges must only be used for legitimate moderation purposes', 'Only on weekends', 'Only if no one is watching'], correctIndex: 1 },
    { section: 'Ethics & Conduct', question: 'What should a moderator do if they have a personal conflict with a user?', options: ['Ban them', 'Recuse themselves and ask another moderator or admin to handle it', 'Abuse their power', 'Ignore the conflict'], correctIndex: 1 },
    { section: 'Community', question: 'How should moderators interact with the community?', options: ['Be rude', 'Be professional, helpful, fair, and consistent', 'Avoid all interaction', 'Only talk to premium users'], correctIndex: 1 },
    { section: 'API & Technical', question: 'What happens when a user exceeds their API rate limit?', options: ['Account is deleted', 'They receive a 429 response and are temporarily throttled', 'Nothing', 'Auto-upgrade'], correctIndex: 1 },
    { section: 'General Knowledge', question: 'What is the minimum score required to pass an application?', options: ['200/475', '310/475', '400/475', '250/475'], correctIndex: 1 },
  ]
}
