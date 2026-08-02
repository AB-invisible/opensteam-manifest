import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { PROMO_KINDS } from "@/app/lib/promo-exam-service";
import { getPromoTier } from "@/app/lib/promo-tiers";
import { parseTimerState, withFillTimer } from "@/app/lib/promo-timer";

/**
 * Advance from the ABCD (mcq) section to the written (fill) section. Idempotent: if already on the
 * written section, returns the current state. Called by the candidate ("next section") or
 * automatically by the client when the ABCD timer expires.
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
      where: { id: attemptId, userId: dbUser.id, examKind: { in: PROMO_KINDS } },
    });
    if (!test) return NextResponse.json({ message: "Not found" }, { status: 404 });
    if (test.status !== "ACTIVE") {
      return NextResponse.json({ message: "Exam is not active." }, { status: 409 });
    }

    const tier = getPromoTier(test.examKind);
    if (!tier) return NextResponse.json({ message: "Unknown exam tier." }, { status: 409 });

    const current = test.currentSection ?? "mcq";
    const timer = parseTimerState(test.timerState);

    if (current !== "mcq") {
      return NextResponse.json({ ok: true, currentSection: current, timerState: timer });
    }

    const now = new Date();
    const nextTimer = withFillTimer(timer, tier, now);

    await prisma.trialTest.update({
      where: { id: attemptId },
      data: { currentSection: "fill", timerState: nextTimer as object },
    });

    return NextResponse.json({ ok: true, currentSection: "fill", timerState: nextTimer });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
