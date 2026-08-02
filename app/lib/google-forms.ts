import { google } from 'googleapis';
import { APPLICATION_MAX_SCORE, APPLICATION_PASS_SCORE } from './config';
import { normalizeDiscordSnowflake } from './discord-id';
import { prisma } from './prisma';

export async function getGoogleFormsClient() {
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'GOOGLE_SERVICE_ACCOUNT' }
  });

  if (!config?.value) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT configuration is missing.');
  }

  try {
    const credentials = JSON.parse(config.value);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/forms.responses.readonly',
        'https://www.googleapis.com/auth/forms.body.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
      ],
    });
    return { forms: google.forms({ version: 'v1', auth }), auth };
  } catch (error) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT JSON: ' + (error as Error).message);
  }
}

export async function getFormResponses(formId: string) {
  const { forms } = await getGoogleFormsClient();
  
  // Get Form metadata to know question titles
  const formMetadata = await forms.forms.get({ formId });
  const items = formMetadata.data.items || [];
  
  // Get Responses
  const response = await forms.forms.responses.list({ formId });
  const responses = response.data.responses || [];

  // Get grading audit logs to check which responses were graded
  const gradeLogs = await prisma.auditLog.findMany({
    where: { action: 'GRADE_APPLICATION' },
    select: { targetId: true, details: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // Build maps of graded responses by discord user IDs and response IDs
  const gradedByDiscord = new Map<string, { score: number, gradedAt: Date }>();
  const gradedByResponse = new Map<string, { score: number, gradedAt: Date }>();
  
  for (const log of gradeLogs) {
    const scoreRe = new RegExp(`\\((\\d+)/${APPLICATION_MAX_SCORE}\\)`);
    const scoreMatch = typeof log.details === 'string' ? log.details.match(scoreRe) : null;
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    const gradeData = { score, gradedAt: log.createdAt };

    const normTarget = log.targetId ? normalizeDiscordSnowflake(log.targetId) : '';
    if (normTarget) {
      gradedByDiscord.set(normTarget, gradeData);
    }
    
    const responseIdMatch = typeof log.details === 'string' ? log.details.match(/ResponseID:\s*([a-zA-Z0-9_-]+)/) : null;
    if (responseIdMatch && responseIdMatch[1] && responseIdMatch[1] !== 'Unknown') {
      gradedByResponse.set(responseIdMatch[1], gradeData);
    }
  }

  // Calculate all scores for percentile
  const allScores = Array.from(gradedByDiscord.values()).map(v => v.score).sort((a, b) => a - b);

  const built = responses.map(r => {
      const answersById = Object.entries(r.answers || {}).reduce((acc, [questionId, answer]) => {
        const value = (answer as any).textAnswers?.answers?.map((a: any) => a.value).join(', ') || '';
        acc[questionId] = value;
        return acc;
      }, {} as Record<string, string>);

      // Keep legacy map for any existing UI usage, but don't rely on it for ordering.
      // Titles can collide and object iteration order isn't guaranteed to match the form.
      const answers = items.reduce((acc, it) => {
        const qid = it.questionItem?.question?.questionId;
        if (!qid) return acc;
        const title = it.title || 'Untitled Question';
        acc[title] = answersById[qid] ?? '';
        return acc;
      }, {} as Record<string, string>);

      const answersOrdered = [
        // 1) questions in the exact form order
        ...items
          .filter(it => Boolean(it.questionItem?.question?.questionId))
          .map(it => {
            const qid = it.questionItem!.question!.questionId as string;
            return {
              questionId: qid,
              title: it.title || 'Untitled Question',
              value: answersById[qid] ?? '',
            };
          }),
        // 2) any "orphan" answers not present in metadata (rare, but possible)
        ...Object.entries(answersById)
          .filter(([qid]) => !items.some(it => it.questionItem?.question?.questionId === qid))
          .map(([qid, value]) => ({
            questionId: qid,
            title: 'Unknown Question',
            value: value ?? '',
          })),
      ];

      // Find discord ID from answers
      const discordKey = Object.keys(answers).find(k => k.toLowerCase().includes('discord') && !k.toLowerCase().includes('username'));
      const discordIdRaw = discordKey ? answers[discordKey] : null;
      let discordId: string | null = null;
      if (discordIdRaw && String(discordIdRaw).trim()) {
        const n = normalizeDiscordSnowflake(discordIdRaw);
        discordId = (n || String(discordIdRaw).trim()) || null;
      }
      
      // Find email from answers or Google Forms respondentEmail
      const emailKey = Object.keys(answers).find(k => k.toLowerCase().includes('email') || k.toLowerCase().includes('e-mail'));
      const respondentEmail = r.respondentEmail || (emailKey ? answers[emailKey] : null);
      
      // Check if this response was graded (try response ID first, then fallback to Discord ID)
      const gradeInfo = gradedByResponse.get(r.responseId || '') || (discordId ? gradedByDiscord.get(discordId) : null);
      
      // Calculate percentile if graded
      let percentile = null;
      if (gradeInfo && allScores.length > 0) {
        const belowCount = allScores.filter(s => s < gradeInfo.score).length;
        percentile = Math.round((belowCount / allScores.length) * 100);
      }

      return {
        responseId: r.responseId,
        createTime: r.createTime,
        lastSubmittedTime: r.lastSubmittedTime,
        answers,
        answersOrdered,
        graded: !!gradeInfo,
        score: gradeInfo?.score || null,
        gradedAt: gradeInfo?.gradedAt || null,
        percentile,
        email: respondentEmail ? String(respondentEmail).trim() : null,
      };
    });

  return {
    items,
    responses: built,
    stats: {
      total: responses.length,
      graded: allScores.length,
      ungraded: responses.length - allScores.length,
      avgScore: allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null,
      passCount: allScores.filter(s => s >= APPLICATION_PASS_SCORE).length,
      failCount: allScores.filter(s => s < APPLICATION_PASS_SCORE).length,
    }
  };
}

/**
 * Fetches Google Doc content as plain text for test generation
 */
export async function getDocumentContent(docId: string): Promise<string> {
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'GOOGLE_SERVICE_ACCOUNT' }
  });

  if (!config?.value) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT configuration is missing.');
  }

  const credentials = JSON.parse(config.value);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/documents.readonly'],
  });

  const docs = google.docs({ version: 'v1', auth });
  const doc = await docs.documents.get({ documentId: docId });
  
  // Extract text content from the document
  const body = doc.data.body;
  if (!body?.content) return '';

  let text = '';
  const sections: { heading: string; content: string }[] = [];
  let currentHeading = 'General';
  let currentContent = '';

  for (const element of body.content) {
    if (element.paragraph) {
      const para = element.paragraph;
      let paraText = '';
      
      for (const el of para.elements || []) {
        if (el.textRun?.content) {
          paraText += el.textRun.content;
        }
      }

      // Check if this is a heading
      const style = para.paragraphStyle?.namedStyleType || '';
      if (style.startsWith('HEADING')) {
        if (currentContent.trim()) {
          sections.push({ heading: currentHeading, content: currentContent.trim() });
        }
        currentHeading = paraText.trim();
        currentContent = '';
      } else {
        currentContent += paraText;
      }
      
      text += paraText;
    }
  }

  // Push last section
  if (currentContent.trim()) {
    sections.push({ heading: currentHeading, content: currentContent.trim() });
  }

  return JSON.stringify({ fullText: text, sections });
}
