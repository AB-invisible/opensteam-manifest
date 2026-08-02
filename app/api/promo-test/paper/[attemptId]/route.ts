import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { pdfFromTrialSnapshot } from "@/app/lib/mod-assessment-pdf";
import { GRADED_BY_LABEL, approvedByLabel } from "@/app/lib/trial-result-discord";
import { PROMO_KINDS } from "@/app/lib/promo-exam-service";
import { PROMO_BRAND } from "@/app/lib/promo-brand";

/**
 * Candidate PDFs for their own promotional exam attempts.
 * ?variant=blank — question paper without responses.
 * ?variant=record — your answers, score, outcome (after submit / once grading started).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const { attemptId } = await params;

    const variant = req.nextUrl.searchParams.get("variant");
    if (variant !== "blank" && variant !== "record") {
      return NextResponse.json({ message: "Use variant=blank or variant=record" }, { status: 400 });
    }

    const tt = await prisma.trialTest.findFirst({
      where: { id: attemptId, userId: auth.data.dbUser.id, examKind: { in: PROMO_KINDS } },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        score: true,
        maxScore: true,
        passingScore: true,
        questions: true,
        answers: true,
        examAnswerKey: true,
        user: { select: { username: true } },
        aiGrade: true,
        reviewedBy: { select: { id: true, username: true, discordId: true } },
        admin: { select: { id: true, username: true, discordId: true } },
      },
    });

    if (!tt) return NextResponse.json({ message: "Assessment not found" }, { status: 404 });

    if (variant === "record") {
      const inProgressNoSubmit = tt.status === "ACTIVE" && tt.submittedAt == null;
      if (tt.status === "PENDING" || inProgressNoSubmit) {
        return NextResponse.json(
          { message: "Your answer record is available after you submit the examination." },
          { status: 403 },
        );
      }
    }

    const mode = variant === "blank" ? "blank" : "candidate_record";
    const grader = tt.reviewedBy ?? tt.admin ?? null;
    const isGraded = ["PASSED", "FAILED", "OVERRIDE_PASS", "OVERRIDE_FAIL"].includes(tt.status);

    const bytes = await pdfFromTrialSnapshot({
      questionsJson: tt.questions,
      answersJson: tt.answers,
      examAnswerKeyJson: tt.examAnswerKey,
      mode,
      aiGradeJson: tt.aiGrade,
      brand: PROMO_BRAND,
      meta:
        mode === "candidate_record"
          ? {
              candidateDisplayName: tt.user?.username ?? undefined,
              trialStatus: tt.status,
              score: tt.score ?? null,
              maxScore: tt.maxScore,
              passingScore: tt.passingScore,
              submittedAtIso: tt.submittedAt?.toISOString() ?? null,
              gradedByLabel: isGraded ? GRADED_BY_LABEL : undefined,
              approvedByLabel: isGraded ? approvedByLabel(grader) : undefined,
            }
          : undefined,
    });

    const name =
      variant === "blank"
        ? `promotion-exam-blank-${tt.id.slice(0, 8)}.pdf`
        : `promotion-exam-your-answers-${tt.id.slice(0, 8)}.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
