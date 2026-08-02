import { authOptions } from '@/app/lib/auth-options'
import { LEGACY_EXAM_KIND } from '@/app/lib/mod-assessment-service'
import { prisma } from '@/app/lib/prisma'
import { getDocumentContent } from '@/app/lib/google-forms'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

const HANDBOOK_DOC_ID = '1ZTLsqqYVtnbZL_0YRiBaf4-06nkJLoeKk65CnsYCT1U'
const FORM_ID = '17zWGbRUjIVxZTtha80EfDlDQFqyHZj46xDBBxDTaoGk'

/**
 * Generates questions from handbook sections and form content.
 * Uses the actual document structure to create relevant questions.
 */
function generateQuestionsFromContent(docData: { fullText: string; sections: { heading: string; content: string }[] }): any[] {
  const questions: any[] = []
  const sections = docData.sections.filter(s => s.content.length > 50) // Only sections with meaningful content

  for (const section of sections) {
    const sectionQuestions = extractQuestionsFromSection(section.heading, section.content)
    questions.push(...sectionQuestions)
  }

  // If we didn't get enough from doc parsing, add baseline knowledge questions
  if (questions.length < 15) {
    questions.push(...getBaselineQuestions())
  }

  return questions
}

/**
 * Extract questions from a section by analyzing key statements and rules
 */
function extractQuestionsFromSection(heading: string, content: string): any[] {
  const questions: any[] = []
  const sentences = content
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 300)

  // Find sentences that contain rules, procedures, or important facts
  const rulePatterns = [
    /must|should|always|never|required|prohibited|important|ensure|responsible/i,
    /shall|will be|is not allowed|is required|must not/i,
    /procedure|process|step|follow|report|escalate/i,
  ]

  const keyStatements = sentences.filter(s =>
    rulePatterns.some(p => p.test(s))
  )

  // Generate questions from key statements (up to 3 per section)
  const usedStatements = keyStatements.slice(0, 3)
  
  for (const statement of usedStatements) {
    const question = generateQuestionFromStatement(heading, statement, sentences)
    if (question) {
      questions.push(question)
    }
  }

  return questions
}

/**
 * Generate a multiple choice question from a key statement
 */
function generateQuestionFromStatement(
  section: string,
  statement: string,
  allSentences: string[]
): any | null {
  // Clean up the statement
  const clean = statement.replace(/\s+/g, ' ').trim()
  if (clean.length < 20) return null

  // Create a question about this statement
  const questionTemplates = [
    `According to the handbook, which of the following is correct regarding "${section}"?`,
    `What does the "${section}" section state about proper procedure?`,
    `Which statement best reflects the policy in "${section}"?`,
    `Based on the handbook's "${section}" guidelines, what is the correct approach?`,
  ]

  const questionText = questionTemplates[Math.floor(Math.random() * questionTemplates.length)]

  // The correct answer is the actual statement (shortened if needed)
  const correctAnswer = clean.length > 120 ? clean.substring(0, 117) + '...' : clean

  // Generate plausible but wrong answers
  const wrongAnswers = generateWrongAnswers(clean, allSentences)
  if (wrongAnswers.length < 3) return null

  // Build options array with correct answer at random position
  const options = [...wrongAnswers.slice(0, 3)]
  const correctIndex = Math.floor(Math.random() * 4)
  options.splice(correctIndex, 0, correctAnswer)

  return {
    section,
    question: questionText,
    options,
    correctIndex,
  }
}

/**
 * Generate wrong but plausible answers by inverting or altering the correct statement
 */
function generateWrongAnswers(correctStatement: string, allSentences: string[]): string[] {
  const wrongs: string[] = []

  // Strategy 1: Invert the meaning
  const inversions: [RegExp, string][] = [
    [/must/gi, 'should never'],
    [/should/gi, 'must not'],
    [/always/gi, 'never'],
    [/never/gi, 'always'],
    [/required/gi, 'optional'],
    [/important/gi, 'unnecessary'],
    [/prohibited/gi, 'encouraged'],
    [/ensure/gi, 'avoid'],
    [/escalate/gi, 'handle independently without reporting'],
  ]

  for (const [pattern, replacement] of inversions) {
    if (pattern.test(correctStatement)) {
      const inverted = correctStatement.replace(pattern, replacement)
      if (inverted !== correctStatement && inverted.length > 15) {
        wrongs.push(inverted.length > 120 ? inverted.substring(0, 117) + '...' : inverted)
        break
      }
    }
  }

  // Strategy 2: Pick unrelated sentences from other parts of the doc
  const otherSentences = allSentences
    .filter(s => s !== correctStatement && s.length > 20 && s.length < 150)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)

  for (const s of otherSentences) {
    wrongs.push(s.length > 120 ? s.substring(0, 117) + '...' : s)
  }

  // Strategy 3: Generic wrong answers as fallback
  const generics = [
    'This is not covered in the handbook and is left to personal discretion',
    'There is no official policy on this matter',
    'This only applies to Admin-level staff, not moderators',
    'This rule was deprecated and no longer applies',
    'This is handled entirely by the automated system without staff involvement',
  ]
  
  while (wrongs.length < 3) {
    wrongs.push(generics[wrongs.length % generics.length])
  }

  return wrongs
}

/**
 * Baseline questions that are always relevant regardless of handbook content
 */
function getBaselineQuestions(): any[] {
  return [
    {
      section: 'General Knowledge',
      question: 'What role hierarchy does OpenSteam follow?',
      options: [
        'User → Admin → Owner',
        'User → Moderator → Admin → Owner',
        'User → Trial Moderator → Moderator → Admin → Owner',
        'Member → Staff → Admin'
      ],
      correctIndex: 2
    },
    {
      section: 'Moderation Actions',
      question: 'When should a moderator escalate an issue to an Admin?',
      options: [
        'Only when they feel like it',
        'When the issue involves banning, system changes, or complex disputes',
        'Never, moderators handle everything',
        'Only during weekdays'
      ],
      correctIndex: 1
    },
    {
      section: 'Security',
      question: 'What should a moderator do if they suspect API key abuse?',
      options: [
        'Nothing, it is not their responsibility',
        'Immediately revoke the keys, restrict the user, and escalate to Admin',
        'Give them more keys',
        'Ask the user politely to stop'
      ],
      correctIndex: 1
    },
    {
      section: 'Ethics & Conduct',
      question: 'Can a moderator use their privileges for personal gain?',
      options: [
        'Yes, that is the point of being a moderator',
        'No, moderator privileges must only be used for legitimate moderation purposes',
        'Only on weekends',
        'Only if no one is watching'
      ],
      correctIndex: 1
    },
    {
      section: 'Ethics & Conduct',
      question: 'What should a moderator do if they have a personal conflict with a user they need to moderate?',
      options: [
        'Ban them immediately',
        'Recuse themselves and ask another moderator or admin to handle the situation',
        'Abuse their power',
        'Ignore the conflict entirely'
      ],
      correctIndex: 1
    },
    {
      section: 'Community Management',
      question: 'How should moderators interact with the community?',
      options: [
        'Be rude and authoritarian',
        'Be professional, helpful, fair, and consistent in enforcing rules',
        'Avoid all interaction',
        'Only talk to premium users'
      ],
      correctIndex: 1
    },
    {
      section: 'API & Technical',
      question: 'What happens when a user exceeds their API rate limit?',
      options: [
        'Their account is deleted',
        'They receive a 429 Too Many Requests response and are temporarily throttled',
        'Nothing happens',
        'They get upgraded automatically'
      ],
      correctIndex: 1
    },
    {
      section: 'General Knowledge',
      question: 'What is the minimum score required to pass an application?',
      options: [
        '200 out of 475',
        '310 out of 475',
        '400 out of 475',
        '250 out of 475'
      ],
      correctIndex: 1
    },
  ]
}

/**
 * POST /api/admin/trial/generate
 * Generate a unique test for a trial moderator using handbook + form content
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  // Allow system-triggered generation (no admin) or admin-triggered
  const isSystem = !admin
  if (!isSystem && admin && admin.role !== 'ADMIN' && admin.role !== 'OWNER' && admin.role !== 'SENIOR_MODERATOR') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } })
  if (!targetUser || targetUser.role !== 'TRIAL_MODERATOR') {
    return NextResponse.json({ error: 'User is not a Trial Moderator' }, { status: 400 })
  }

  // Check if there's already an active/pending test
  const existingTest = await prisma.trialTest.findFirst({
    where: {
      userId,
      examKind: LEGACY_EXAM_KIND,
      status: { in: ['ACTIVE', 'PENDING'] },
    },
  })

  if (existingTest) {
    return NextResponse.json({ error: 'User already has an active test' }, { status: 400 })
  }

  // Fetch handbook content from Google Docs
  let allQuestions: any[] = []
  try {
    const rawContent = await getDocumentContent(HANDBOOK_DOC_ID)
    const docData = JSON.parse(rawContent)
    allQuestions = generateQuestionsFromContent(docData)
  } catch (error) {
    console.warn('[Trial Test] Failed to fetch handbook, using baseline questions:', (error as Error).message)
    allQuestions = getBaselineQuestions()
  }

  // Select 15 random questions (or all if less than 15)
  const shuffled = allQuestions.sort(() => Math.random() - 0.5)
  const selectedQuestions = shuffled.slice(0, Math.min(15, shuffled.length))

  // Shuffle options for each question
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

  const test = await prisma.trialTest.create({
    data: {
      userId,
      examKind: LEGACY_EXAM_KIND,
      questions: finalQuestions as any,
      maxScore: questionCount,
      passingScore,
      status: 'ACTIVE',
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days to complete
    }
  })

  if (admin) {
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'GENERATE_TRIAL_TEST',
        targetId: userId,
        details: `Generated trial test with ${questionCount} questions (${passingScore} to pass)`,
        ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
      }
    })
  }

  return NextResponse.json({ success: true, testId: test.id, questionCount })
}
