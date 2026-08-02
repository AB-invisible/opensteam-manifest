import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { randomBytes } from "crypto";
import { buildRealtimeExamAsync } from "@/app/lib/mod-assessment-exam-realtime";
import { parseQuestions, totalMaxPoints } from "@/app/lib/mod-assessment-types";
import { buildExamAnswerKey } from "@/app/lib/mod-assessment-answer-key";
import {
  liveExamOverview,
  findActiveLiveTrialTest,
  liveExamOverlapContextExcludingUser,
  LIVE_EXAM_KIND,
} from "@/app/lib/mod-assessment-service";

export async function POST() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const actor = auth.data.dbUser;

    const u = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { modTestReadyAt: true },
    });

    const overview = await liveExamOverview(actor.id);

    if (!u?.modTestReadyAt) {
      return NextResponse.json({ message: "Assessment not unlocked yet." }, { status: 403 });
    }
    if (overview.hasPassedLive) {
      return NextResponse.json({ message: "Already completed successfully." }, { status: 400 });
    }
    if (overview.pendingReviewTestId) {
      return NextResponse.json(
        {
          message: "A submission is still awaiting manual review.",
          attemptId: overview.pendingReviewTestId,
        },
        { status: 409 }
      );
    }

    const existing = await findActiveLiveTrialTest(actor.id);
    if (existing) {
      return NextResponse.json({
        attemptId: existing.id,
        status: existing.sessionState === "paused" ? "paused" : "in_progress",
        reopened: true,
      });
    }

    const entropy = `${actor.id}:${Date.now()}:${randomBytes(16).toString("hex")}`;
    const overlap = await liveExamOverlapContextExcludingUser(actor.id);
    
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const onProgress = (collected: number, total: number) => {
            const data = JSON.stringify({ type: "progress", collected, total });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };
          
          const examQs = await buildRealtimeExamAsync(entropy, overlap, onProgress);
          const pq = parseQuestions(examQs);
          const maxPts = totalMaxPoints(pq);
          const passing = Math.ceil(maxPts * 0.7);
          const now = new Date();
          const answerKey = buildExamAnswerKey(pq);

          const created = await prisma.trialTest.create({
            data: {
              userId: actor.id,
              examKind: LIVE_EXAM_KIND,
              status: "ACTIVE",
              sessionState: "in_progress",
              examAnswerKey: answerKey as object,
              questions: examQs as object[],
              answers: {},
              maxScore: maxPts,
              passingScore: passing,
              generatedAt: now,
            },
            select: { id: true, sessionState: true },
          });

          const successData = JSON.stringify({
            type: "success",
            attemptId: created.id,
            status: "in_progress",
            reopened: false,
          });
          controller.enqueue(encoder.encode(`data: ${successData}\n\n`));
          controller.close();
        } catch (error) {
          const errData = JSON.stringify({ type: "error", message: safeErrorMessage(error) });
          controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
