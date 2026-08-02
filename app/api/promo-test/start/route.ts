import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { randomBytes } from "crypto";
import { parseQuestions, totalMaxPoints } from "@/app/lib/mod-assessment-types";
import { buildExamAnswerKey } from "@/app/lib/mod-assessment-answer-key";
import { buildPromoExamAsync } from "@/app/lib/promo-exam";
import { buildInitialTimerState } from "@/app/lib/promo-timer";
import {
  resolvePromoEligibility,
  findActivePromoTrialTest,
  promoExamOverlapContext,
  shouldBypassLowerPromoAttempt,
} from "@/app/lib/promo-exam-service";

export async function POST() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const actor = auth.data.dbUser;

    const existing = await findActivePromoTrialTest(actor.id);
    const elig = await resolvePromoEligibility(actor);

    if (existing) {
      const bypassLower = shouldBypassLowerPromoAttempt(elig.tier, existing.examKind);
      if (!bypassLower) {
        return NextResponse.json({
          attemptId: existing.id,
          status: existing.sessionState === "paused" ? "paused" : "in_progress",
          reopened: true,
        });
      }
    }

    if (!elig.eligible || !elig.tier) {
      return NextResponse.json(
        { message: elig.reason ?? "You are not eligible for a promotion exam right now." },
        { status: 403 },
      );
    }
    const tier = elig.tier;

    const entropy = `${actor.id}:${Date.now()}:${randomBytes(16).toString("hex")}`;
    const overlap = await promoExamOverlapContext(actor.id, tier.examKind);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const onProgress = (collected: number, total: number) => {
            const data = JSON.stringify({ type: "progress", collected, total });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          const examQs = await buildPromoExamAsync(tier, entropy, overlap, onProgress);
          const pq = parseQuestions(examQs);
          const maxPts = totalMaxPoints(pq);
          const passing = Math.ceil(maxPts * 0.7);
          const now = new Date();
          const answerKey = buildExamAnswerKey(pq);

          const created = await prisma.trialTest.create({
            data: {
              userId: actor.id,
              examKind: tier.examKind,
              status: "ACTIVE",
              sessionState: "in_progress",
              currentSection: "mcq",
              timerState: buildInitialTimerState(tier, now) as object,
              examAnswerKey: answerKey as object,
              questions: examQs as object[],
              answers: {},
              maxScore: maxPts,
              passingScore: passing,
              generatedAt: now,
            },
            select: { id: true },
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
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
