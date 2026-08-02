import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage, isPrivilegedStaff } from "@/app/lib/auth-helpers";
import { STAFF_REVIEWABLE_EXAM_KINDS, getPromoTier } from "@/app/lib/promo-tiers";
import { PROMO_BRAND } from "@/app/lib/promo-brand";
import { pdfFromTrialSnapshot } from "@/app/lib/mod-assessment-pdf";
import { GRADED_BY_LABEL, approvedByLabel } from "@/app/lib/trial-result-discord";

/**
 * Staff printable PDFs for a live moderator attempt TrialTest row.
 * Works for any status (including ACTIVE / in progress before submit): answers may be empty or partial.
 * ?kind=blank — questions only (no keys)
 * ?kind=keyed — staff packet: prompts, saved candidate responses, MCQ keys & written rubrics
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!isPrivilegedStaff(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const kind = req.nextUrl.searchParams.get("kind");
    if (kind !== "blank" && kind !== "keyed") {
      return NextResponse.json({ message: "Use kind=blank or kind=keyed" }, { status: 400 });
    }

    const tt = await prisma.trialTest.findFirst({
      where: { id, examKind: { in: [...STAFF_REVIEWABLE_EXAM_KINDS] } },
      include: {
        user: { select: { username: true } },
        reviewedBy: { select: { id: true, username: true, discordId: true } },
        admin: { select: { id: true, username: true, discordId: true } },
      },
    });

    if (!tt) return NextResponse.json({ message: "Not found" }, { status: 404 });

    const promoBrand = getPromoTier(tt.examKind) ? PROMO_BRAND : undefined;
    const mode = kind === "blank" ? "blank" : "staff_packet";
    const grader = tt.reviewedBy ?? tt.admin ?? null;
    const isGraded = ["PASSED", "FAILED", "OVERRIDE_PASS", "OVERRIDE_FAIL"].includes(tt.status);

    const bytes = await pdfFromTrialSnapshot({
      questionsJson: tt.questions,
      answersJson: tt.answers,
      examAnswerKeyJson: tt.examAnswerKey,
      mode,
      aiGradeJson: tt.aiGrade,
      brand: promoBrand,
      meta:
        mode === "staff_packet"
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

    const slug = (tt.user?.username ?? "candidate").replace(/[^\w\-]+/g, "_").slice(0, 24);
    const name =
      kind === "blank"
        ? `mod-exam-blank-${tt.id.slice(0, 10)}.pdf`
        : `mod-exam-staff-${slug}-${tt.id.slice(0, 10)}.pdf`;

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
