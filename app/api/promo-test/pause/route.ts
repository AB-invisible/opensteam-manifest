import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { notifyModStaffWide } from "@/app/lib/notify-mod-staff";
import { PROMO_KINDS } from "@/app/lib/promo-exam-service";
import { getPromoTier } from "@/app/lib/promo-tiers";

/** Tab switch / fullscreen exit — freezes the promo session and pings staff (timers keep running). */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;

    const body = await req.json().catch(() => ({}));
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    const reason = typeof body.reason === "string" ? body.reason : "paused";
    if (!attemptId) return NextResponse.json({ message: "attemptId required" }, { status: 400 });

    const attempt = await prisma.trialTest.findFirst({
      where: { id: attemptId, examKind: { in: PROMO_KINDS } },
      include: { user: true },
    });
    if (!attempt) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (attempt.userId !== auth.data.dbUser.id) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    if (attempt.sessionState !== "in_progress") {
      return NextResponse.json({ skipped: true, sessionState: attempt.sessionState });
    }

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: { sessionState: "paused", pausedAt: new Date(), lastPauseReason: reason.slice(0, 200) },
    });

    const tier = getPromoTier(attempt.examKind);
    const examDiscordId = attempt.user?.discordId?.trim();

    await notifyModStaffWide({
      title: `${tier?.label ?? "Promotion exam"} paused`,
      lines: [
        `Candidate ${attempt.user?.username ?? "Unknown"} · Discord ${examDiscordId ?? "—"}`,
        `Reason: ${reason}`,
        `Resume from dashboard → moderator attempts → TrialTest \`${attemptId.slice(0, 8)}\`…`,
      ],
      ...(examDiscordId ? { excludeDiscordUserIds: [examDiscordId] } : {}),
    }).catch(() => {});

    return NextResponse.json({ ok: true, status: "paused" });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
