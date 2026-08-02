import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage, isPrivilegedStaff } from "@/app/lib/auth-helpers";
import { STAFF_REVIEWABLE_EXAM_KINDS, getPromoTier } from "@/app/lib/promo-tiers";

/** Live moderator assessment + promotional + Executive Officer exam rows (`trial_tests`) — IDs are TrialTest IDs. */
const REVIEWABLE_EXAM_KINDS = [...STAFF_REVIEWABLE_EXAM_KINDS];

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!isPrivilegedStaff(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const rows = await prisma.trialTest.findMany({
      where: { examKind: { in: REVIEWABLE_EXAM_KINDS } },
      orderBy: { updatedAt: "desc" },
      take: 80,
      include: {
        user: { select: { id: true, username: true, discordId: true } },
      },
    });

    const attempts = rows
      .filter((tt) => tt.user != null)
      .map((tt) => {
      const uiStatus =
        tt.status === "ACTIVE" && tt.sessionState === "paused"
          ? "paused"
          : tt.status === "ACTIVE" && tt.sessionState === "in_progress"
            ? "in_progress"
            : tt.status === "AWAITING_STAFF"
              ? "awaiting_manual_review"
              : tt.status;

      const manualReview = tt.status === "AWAITING_STAFF" ? "pending" : null;
      const examLabel = getPromoTier(tt.examKind)?.label ?? "Trial Moderator (live)";

      return { ...tt, uiStatus, manualReview, examLabel };
    });

    return NextResponse.json({ attempts });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
