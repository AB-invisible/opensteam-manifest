import { NextRequest, NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { EXEC_OFFICER_EXAM_KIND } from "@/app/lib/promo-tiers";
import { parseCategoryReports } from "@/app/lib/exec-category-grade";
import { EXEC_CATEGORY_MAP, type ExecCategoryId } from "@/app/lib/exec-categories";
import { pdfExecCategoryReport } from "@/app/lib/exec-category-pdf";

/** Owner-only per-category expertise PDF download. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string; categoryId: string }> },
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (auth.data.dbUser.role !== "OWNER") {
      return NextResponse.json({ message: "Owner only" }, { status: 403 });
    }

    const { attemptId, categoryId } = await params;
    const cat = EXEC_CATEGORY_MAP[categoryId as ExecCategoryId];
    if (!cat) {
      return NextResponse.json({ message: "Unknown category" }, { status: 400 });
    }

    const tt = await prisma.trialTest.findFirst({
      where: { id: attemptId, examKind: EXEC_OFFICER_EXAM_KIND },
      include: { user: { select: { username: true } } },
    });
    if (!tt || !tt.submittedAt) {
      return NextResponse.json({ message: "Attempt not found or not submitted" }, { status: 404 });
    }

    const reports = parseCategoryReports(tt.categoryReports);
    const report = reports?.categories.find((c) => c.categoryId === categoryId);
    if (!report) {
      return NextResponse.json({ message: "Category report not generated yet" }, { status: 404 });
    }

    const bytes = await pdfExecCategoryReport({
      categoryId: categoryId as ExecCategoryId,
      report,
      questionsJson: tt.questions,
      answersJson: tt.answers,
      aiGradeJson: tt.aiGrade,
      candidateName: tt.user?.username,
      attemptId: tt.id,
      submittedAtIso: tt.submittedAt.toISOString(),
      englishLevel: tt.englishLevel,
    });

    const slug = cat.shortLabel.toLowerCase().replace(/\s+/g, "-");
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="eo-${slug}-${tt.id.slice(0, 8)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
