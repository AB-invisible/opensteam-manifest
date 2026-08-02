import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { EXEC_OFFICER_EXAM_KIND } from "@/app/lib/promo-tiers";
import { parseCategoryReports } from "@/app/lib/exec-category-grade";

function requireOwner(role: string) {
  return role === "OWNER";
}

/** Owner-only: list Executive Officer attempts + per-category report summaries for a user. */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!requireOwner(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Owner only" }, { status: 403 });
    }

    const userId = req.nextUrl.searchParams.get("userId")?.trim();
    if (!userId) {
      return NextResponse.json({ message: "userId required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, discordId: true },
    });
    if (!user) return NextResponse.json({ message: "User not found" }, { status: 404 });

    const attempts = await prisma.trialTest.findMany({
      where: {
        userId,
        examKind: EXEC_OFFICER_EXAM_KIND,
        submittedAt: { not: null },
      },
      orderBy: { submittedAt: "desc" },
      take: 12,
      select: {
        id: true,
        status: true,
        submittedAt: true,
        score: true,
        maxScore: true,
        englishLevel: true,
        categoryReports: true,
      },
    });

    const rows = attempts.map((a) => {
      const reports = parseCategoryReports(a.categoryReports);
      return {
        attemptId: a.id,
        status: a.status,
        submittedAt: a.submittedAt?.toISOString() ?? null,
        score: a.score,
        maxScore: a.maxScore,
        englishLevel: a.englishLevel,
        overallFit: reports?.overallFit ?? null,
        categories:
          reports?.categories.map((c) => ({
            id: c.categoryId,
            label: c.label,
            pct: c.pct,
            handledLevel: c.handledLevel,
            isFit: c.isFit,
            fitRecommendation: c.fitRecommendation ?? null,
            pdfUrl: `/api/admin/executive-reports/${a.id}/${c.categoryId}`,
          })) ?? [],
      };
    });

    return NextResponse.json({ user, attempts: rows });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
