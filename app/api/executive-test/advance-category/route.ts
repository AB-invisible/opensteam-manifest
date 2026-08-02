import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { randomBytes } from "crypto";
import { parseQuestions, totalMaxPoints } from "@/app/lib/mod-assessment-types";
import { buildExamAnswerKey } from "@/app/lib/mod-assessment-answer-key";
import { appendCategoryQuestions, buildExecCategoryAsync } from "@/app/lib/exec-officer-exam";
import { parseExecTimerState } from "@/app/lib/exec-timer";
import { EXEC_OFFICER_EXAM_KIND } from "@/app/lib/promo-tiers";
import { EXEC_CATEGORIES, getExecCategory } from "@/app/lib/exec-categories";
import {
  difficultyForCategory,
  nextCategoryId,
  parseCategoryProgress,
  recordCategoryCompletion,
} from "@/app/lib/exec-adaptive";
import { promoExamOverlapContext } from "@/app/lib/promo-exam-service";

/**
 * Complete the current category and generate the next at an adapted difficulty tier.
 * Category 5 (fit) is generated last using professional performance context only.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const { dbUser } = auth.data;

    const body = await req.json().catch(() => ({}));
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    if (!attemptId) return NextResponse.json({ message: "attemptId required" }, { status: 400 });

    const test = await prisma.trialTest.findFirst({
      where: { id: attemptId, userId: dbUser.id, examKind: EXEC_OFFICER_EXAM_KIND },
    });
    if (!test) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (test.sessionState !== "in_progress") {
      return NextResponse.json({ message: "Cannot advance while paused or submitted." }, { status: 409 });
    }

    const timer = parseExecTimerState(test.timerState);
    const progress = parseCategoryProgress(timer.categoryProgress) ?? {
      currentCategoryId: (test.currentSection as (typeof EXEC_CATEGORIES)[number]["id"]) ?? "leadership",
      completed: [],
    };

    const currentId = progress.currentCategoryId;
    const currentDef = getExecCategory(currentId);
    if (!currentDef) return NextResponse.json({ message: "Invalid category state." }, { status: 409 });

    if (progress.completed.some((c) => c.categoryId === currentId)) {
      return NextResponse.json({ message: "This category is already completed." }, { status: 409 });
    }

    const existingQs = parseQuestions(test.questions);
    const answers =
      test.answers && typeof test.answers === "object" && test.answers !== null
        ? (test.answers as Record<string, string>)
        : {};

    const appliedDifficulty = difficultyForCategory(currentId, progress);
    const { entry: completedEntry, progress: afterComplete } = recordCategoryCompletion({
      progress,
      categoryId: currentId,
      appliedDifficulty,
      questions: existingQs,
      answers,
    });

    const nextId = nextCategoryId(currentId);
    if (!nextId) {
      await prisma.trialTest.update({
        where: { id: attemptId },
        data: { timerState: { ...timer, categoryProgress: afterComplete } as object },
      });
      return NextResponse.json({
        ok: true,
        done: true,
        previousCategory: {
          id: currentId,
          label: currentDef.label,
          pct: completedEntry.pct,
          handledLevel: completedEntry.handledLevel,
          appliedDifficulty,
        },
        message: "All categories complete. Submit when ready.",
      });
    }

    const entropy = `${dbUser.id}:${attemptId}:${randomBytes(8).toString("hex")}`;
    const overlap = await promoExamOverlapContext(dbUser.id, EXEC_OFFICER_EXAM_KIND);
    const nextDifficulty = difficultyForCategory(nextId, afterComplete);
    const nextDef = getExecCategory(nextId)!;

    const newBlock = await buildExecCategoryAsync(
      nextId,
      nextDifficulty,
      entropy,
      overlap,
      afterComplete,
    );

    const slug = attemptId.slice(0, 10);
    const mergedQs = appendCategoryQuestions(existingQs, newBlock, slug);
    const mergedKey = buildExamAnswerKey(mergedQs);
    const maxPts = totalMaxPoints(mergedQs);

    const nextProgress = { ...afterComplete, currentCategoryId: nextId };
    const nextTimer = { ...timer, categoryProgress: nextProgress };

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: {
        currentSection: nextId,
        questions: mergedQs as object[],
        examAnswerKey: mergedKey as object,
        maxScore: maxPts,
        timerState: nextTimer as object,
      },
    });

    return NextResponse.json({
      ok: true,
      done: false,
      previousCategory: {
        id: currentId,
        label: currentDef.label,
        pct: completedEntry.pct,
        handledLevel: completedEntry.handledLevel,
        appliedDifficulty,
      },
      currentCategory: {
        id: nextId,
        label: nextDef.label,
        difficulty: nextDifficulty,
        questionCount: nextDef.mcqCount + nextDef.writtenCount,
      },
      categoriesCompleted: afterComplete.completed.length,
      totalCategories: EXEC_CATEGORIES.length,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
