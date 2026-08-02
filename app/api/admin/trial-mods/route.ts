import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage, isPrivilegedStaff } from "@/app/lib/auth-helpers";
import { computeTrialModEnd } from "@/app/lib/moderator-trial";
import { trySendDiscordDm } from "@/app/lib/discord-dm";
import { LIVE_EXAM_KIND } from "@/app/lib/mod-assessment-service";

type Action = "start" | "release-test" | "clear";

function buildTestReadyMessage() {
  const custom = process.env.DISCORD_MOD_TEST_MESSAGE?.trim();
  if (custom) return custom;
  const link =
    process.env.MOD_ASSESSMENT_URL?.trim() ||
    (process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/dashboard/mod-assessment`
      : "");
  const base =
    "Your moderator trial assessment is ready. Sign in and open your dashboard.";
  return link ? `${base}\n${link}` : base;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!isPrivilegedStaff(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const action = body.action as Action;
    const userId = typeof body.userId === "string" ? body.userId : "";

    if (!userId || !["start", "release-test", "clear"].includes(action)) {
      return NextResponse.json({ message: "Invalid request" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    if (action === "start") {
      const ends = computeTrialModEnd(new Date());
      await prisma.user.update({
        where: { id: userId },
        data: {
          trialModEndsAt: ends,
          modTestReadyAt: null,
        },
      });
      return NextResponse.json({
        ok: true,
        trialModEndsAt: ends.toISOString(),
        modTestReadyAt: null,
      });
    }

    if (action === "clear") {
      await prisma.trialTest.deleteMany({
        where: { userId, examKind: LIVE_EXAM_KIND },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { trialModEndsAt: null, modTestReadyAt: null },
      });
      return NextResponse.json({ ok: true, trialModEndsAt: null, modTestReadyAt: null });
    }

    // release-test: end trial now, unlock test, notify via DM/email when possible
    const now = new Date();
    await prisma.user.update({
      where: { id: userId },
      data: {
        trialModEndsAt: now,
        modTestReadyAt: now,
      },
    });

    let dmSent = false;
    let dmSkipped = false;
    let dmWarning: string | undefined;
    let dmTokenUsed: "primary" | "backup" | undefined;

    if (!target.discordId) {
      dmSkipped = true;
    } else {
      const dmResult = await trySendDiscordDm(target.discordId, buildTestReadyMessage());
      dmSent = dmResult.sent;
      dmTokenUsed = dmResult.tokenUsed;
      if (!dmResult.sent) {
        dmWarning = dmResult.error ?? "Discord DM failed";
        console.warn("[trial-mods] release-test: DB unlocked but Discord DM failed:", dmWarning);
      }
    }

    let emailSent = false;
    // Send email notification to target if they have an email address
    if (target.email) {
      try {
        const { sendBrandedEmail } = await import("@/app/lib/email");
        const dashboardUrl = process.env.MOD_ASSESSMENT_URL?.trim() ||
          (process.env.NEXTAUTH_URL
            ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/dashboard/mod-assessment`
            : "http://127.0.0.1:3000/dashboard/mod-assessment");

        await sendBrandedEmail(
          target.email,
          'Moderator Trial Exam Ready — OpenSteam',
          'Trial Exam Ready',
          `Hello <strong>${target.username}</strong>,<br><br>` +
          `We are excited to let you know that your live moderator trial exam is now ready and unlocked!<br><br>` +
          `You can access the exam by clicking the button below or going to your dashboard. Please complete the assessment within your allocated time limit.<br><br>` +
          `Good luck!`,
          '#3b82f6',
          undefined,
          {
            buttonText: 'Start Assessment',
            buttonUrl: dashboardUrl,
            badge: 'Exam Unlocked'
          }
        );
        emailSent = true;
      } catch (err) {
        console.warn("[trial-mods] release-test: unlocked but Email failed:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      trialModEndsAt: now.toISOString(),
      modTestReadyAt: now.toISOString(),
      dmSent,
      dmSkipped,
      dmTokenUsed,
      emailSent,
      dmWarning: dmSent || dmSkipped ? undefined : dmWarning ?? "Discord DM failed",
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
