import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { randomBytes } from "crypto";
import { parseQuestions, totalMaxPoints } from "@/app/lib/mod-assessment-types";
import { buildExamAnswerKey } from "@/app/lib/mod-assessment-answer-key";
import { buildExecCategoryAsync } from "@/app/lib/exec-officer-exam";
import { buildExecTimerState } from "@/app/lib/exec-timer";
import {
  resolveExecEligibility,
  findActiveExecTrialTest,
  execTier,
} from "@/app/lib/exec-officer-service";
import { promoExamOverlapContext } from "@/app/lib/promo-exam-service";
import { EXEC_OFFICER_EXAM_KIND } from "@/app/lib/promo-tiers";
import { EXEC_CATEGORIES, execCategoryTotals } from "@/app/lib/exec-categories";
import { initialCategoryProgress } from "@/app/lib/exec-adaptive";
import { difficultyForCategory } from "@/app/lib/exec-adaptive";

export async function POST() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const actor = auth.data.dbUser;

    const existing = await findActiveExecTrialTest(actor.id);
    if (existing) {
      return NextResponse.json({
        attemptId: existing.id,
        status: existing.sessionState === "paused" ? "paused" : "in_progress",
        reopened: true,
      });
    }

    const elig = await resolveExecEligibility(actor);
    if (!elig.eligible) {
      return NextResponse.json(
        { message: elig.reason ?? "You are not eligible for the Executive Officer exam right now." },
        { status: 403 },
      );
    }
    const tier = execTier();

    const entropy = `${actor.id}:${Date.now()}:${randomBytes(16).toString("hex")}`;
    const overlap = await promoExamOverlapContext(actor.id, tier.examKind);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const firstCat = EXEC_CATEGORIES[0];
          const progress = initialCategoryProgress();
          const firstDifficulty = difficultyForCategory(firstCat.id, progress);
          const catTotal = firstCat.mcqCount + firstCat.writtenCount;
          const totals = execCategoryTotals();

          const onProgress = (collected: number, total: number) => {
            const data = JSON.stringify({
              type: "progress",
              collected,
              total: totals.total,
              phase: `category:${firstCat.id}`,
              categoryLabel: firstCat.label,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          const examQs = await buildExecCategoryAsync(
            firstCat.id,
            firstDifficulty,
            entropy,
            overlap,
            progress,
            (collected) => onProgress(collected, catTotal),
          );
          const pq = parseQuestions(examQs);
          const maxPts = totalMaxPoints(pq);
          const projectedMax = totals.mcq * 3 + totals.written * 10;
          const passing = Math.ceil(projectedMax * 0.7);
          const now = new Date();
          const timerState = {
            ...buildExecTimerState(tier, now),
            categoryProgress: progress,
          };
          const answerKey = buildExamAnswerKey(pq);

          const created = await prisma.trialTest.create({
            data: {
              userId: actor.id,
              examKind: EXEC_OFFICER_EXAM_KIND,
              status: "ACTIVE",
              sessionState: "in_progress",
              currentSection: firstCat.id,
              timerState: timerState as object,
              expiresAt: new Date(timerState.exam!.endsAt),
              examAnswerKey: answerKey as object,
              questions: examQs as object[],
              answers: {},
              typingMetrics: { perQuestion: {} } as object,
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
