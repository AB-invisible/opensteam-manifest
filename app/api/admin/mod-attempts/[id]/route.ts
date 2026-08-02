import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage, isPrivilegedStaff } from "@/app/lib/auth-helpers";
import { parseQuestions } from "@/app/lib/mod-assessment-types";
import { buildAiGrade } from "@/app/lib/mod-assessment-grade";
import { notifyModStaffWide } from "@/app/lib/notify-mod-staff";
import { normalizeTrialAnswersJson } from "@/app/lib/mod-assessment-normalize-answers";
import {
  graduateTrialModDiscordRoles,
  logDiscordModRoleResult,
} from "@/app/lib/discord-mod-roles";
import { postTrialResultToDiscord } from "@/app/lib/trial-result-discord";
import {
  isStaffReviewableExamKind,
  getPromoTier,
  promoteRankDiscordRoles,
  logPromoRoleResult,
} from "@/app/lib/promo-tiers";
import { PROMO_BRAND } from "@/app/lib/promo-brand";
import { resetRoleTenure } from "@/app/lib/discord-role-tenure";

/** Resume / approve / reject / re-grade live `TrialTest` rows (same ID shown in moderator attempts UI). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!isPrivilegedStaff(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    const tt = await prisma.trialTest.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!tt || !isStaffReviewableExamKind(tt.examKind)) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }

    const reviewerId = auth.data.dbUser.id;
    const promoTier = getPromoTier(tt.examKind);

    if (action === "resume") {
      if (tt.sessionState !== "paused" || tt.status !== "ACTIVE") {
        return NextResponse.json({ message: `Cannot resume (${tt.status}/${tt.sessionState})` }, { status: 409 });
      }
      await prisma.trialTest.update({
        where: { id },
        data: {
          sessionState: "in_progress",
          pausedAt: null,
          lastPauseReason: null,
        },
      });

      await notifyModStaffWide({
        title: "Moderator assessment resumed",
        lines: [`Staff cleared TrialTest ${id.slice(0, 12)} · ${tt.user?.username ?? "candidate"}`],
      }).catch(() => {});

      return NextResponse.json({ ok: true, status: "in_progress" });
    }

    if (action === "publish_discord") {
      const outcome =
        tt.status === "PASSED" || tt.status === "OVERRIDE_PASS"
          ? "PASSED"
          : tt.status === "FAILED" || tt.status === "OVERRIDE_FAIL"
            ? "FAILED"
            : null;
      if (!outcome) {
        return NextResponse.json(
          { message: `Can only publish graded attempts (current status: ${tt.status}).` },
          { status: 409 }
        );
      }

      // Original grader of record (reviewer → legacy admin → current staff).
      const graderId = tt.reviewedByUserId || tt.adminId || reviewerId;
      const grader =
        graderId === auth.data.dbUser.id
          ? auth.data.dbUser
          : (await prisma.user.findUnique({
              where: { id: graderId },
              select: { id: true, username: true, discordId: true },
            })) ?? auth.data.dbUser;

      const result = await postTrialResultToDiscord({
        test: tt,
        grader,
        outcome,
        ...(promoTier
          ? { resultLabel: promoTier.label, brand: PROMO_BRAND, footerText: "OpenSteam Promotion System" }
          : {}),
      });
      if (!result.ok) {
        return NextResponse.json(
          { message: `Failed to publish to Discord: ${result.error ?? "unknown error"}` },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: true, published: true, status: tt.status });
    }

    if (tt.status !== "AWAITING_STAFF" && ["approve", "reject", "regrade"].includes(action)) {
      return NextResponse.json({ message: "Exam not awaiting staff review." }, { status: 409 });
    }

    if (action === "approve" && promoTier) {
      const grade = tt.aiGrade as { totalEarned?: number; totalMax?: number } | undefined;
      const earned = typeof grade?.totalEarned === "number" ? grade.totalEarned : tt.score ?? 0;

      await prisma.trialTest.update({
        where: { id },
        data: {
          status: "PASSED",
          gradedAt: new Date(),
          reviewedByUserId: reviewerId,
          score: earned,
          feedback: `Staff approved ${promoTier.label}. AI draft totaled ${earned}/${tt.maxScore}.`,
          adminNotes:
            typeof body.staffNotes === "string" ? body.staffNotes.slice(0, 2000) : undefined,
        },
      });

      await prisma.user.update({
        where: { id: tt.userId },
        data: { role: promoTier.platformRole, roleLevel: promoTier.roleLevel },
      });

      if (tt.user?.discordId) {
        const discordId = tt.user.discordId;
        void promoteRankDiscordRoles(discordId, promoTier).then((result) => {
          logPromoRoleResult("promo_approve", discordId, result);
          if (result.ok) void resetRoleTenure(discordId, promoTier.toRoleId);
        });
      }

      if (tt.user?.email) {
        try {
          const { sendBrandedEmail, renderTrialExamAnswersHtml } = await import("@/app/lib/email");
          const questions = parseQuestions(tt.questions);
          const answers = normalizeTrialAnswersJson(tt.answers);
          const examSheetHtml = renderTrialExamAnswersHtml(questions, answers);
          await sendBrandedEmail(
            tt.user.email,
            `${promoTier.label} Passed — OpenSteam`,
            "Promotion Approved",
            `Hello <strong>${tt.user.username}</strong>,<br><br>` +
              `Congratulations! Your <strong>${promoTier.label}</strong> exam has been approved by the staff team. ` +
              `You have been promoted from <strong>${promoTier.fromRoleName}</strong> to <strong>${promoTier.toRoleName}</strong>.<br><br>` +
              `Exam score: <strong>${earned}/${tt.maxScore}</strong>.<br><br>` +
              `Below is a copy of your completed exam answer sheet for your records:<br><br>` +
              examSheetHtml,
            "#10b981",
            undefined,
            { buttonText: "Go to Dashboard", buttonUrl: "http://127.0.0.1:3000/dashboard", badge: "Promoted" },
          );
        } catch (emailErr) {
          console.error("[Promo Approve Email Error]", emailErr);
        }
      }

      void postTrialResultToDiscord({
        test: { ...tt, status: "PASSED", score: earned },
        grader: auth.data.dbUser,
        outcome: "PASSED",
        resultLabel: promoTier.label,
        brand: PROMO_BRAND,
        footerText: "OpenSteam Promotion System",
      }).then((r) => {
        if (!r.ok) console.error("[Promo Result Discord] approve post failed:", r.error);
      });

      return NextResponse.json({ ok: true, status: "PASSED" });
    }

    if (action === "reject" && promoTier) {
      await prisma.trialTest.update({
        where: { id },
        data: {
          status: "FAILED",
          gradedAt: new Date(),
          reviewedByUserId: reviewerId,
          feedback: `Staff rejected this ${promoTier.label} attempt.`,
          adminNotes:
            typeof body.staffNotes === "string" ? body.staffNotes.slice(0, 2000) : undefined,
        },
      });
      // Note: a failed promotion does NOT demote the candidate — they keep their current rank.

      if (tt.user?.email) {
        try {
          const { sendBrandedEmail, renderTrialExamAnswersHtml } = await import("@/app/lib/email");
          const questions = parseQuestions(tt.questions);
          const answers = normalizeTrialAnswersJson(tt.answers);
          const examSheetHtml = renderTrialExamAnswersHtml(questions, answers);
          await sendBrandedEmail(
            tt.user.email,
            `${promoTier.label} Result — OpenSteam`,
            "Promotion Not Approved",
            `Hello <strong>${tt.user.username}</strong>,<br><br>` +
              `Thank you for taking the <strong>${promoTier.label}</strong> exam. ` +
              `After review, this attempt was not approved, so you remain a <strong>${promoTier.fromRoleName}</strong>. ` +
              `You may be eligible to try again in the future.<br><br>` +
              `Below is a copy of your completed exam answer sheet for your records:<br><br>` +
              examSheetHtml,
            "#dc2626",
            undefined,
            { buttonText: "Go to Dashboard", buttonUrl: "http://127.0.0.1:3000/dashboard", badge: "Not Approved" },
          );
        } catch (emailErr) {
          console.error("[Promo Reject Email Error]", emailErr);
        }
      }

      void postTrialResultToDiscord({
        test: { ...tt, status: "FAILED" },
        grader: auth.data.dbUser,
        outcome: "FAILED",
        resultLabel: promoTier.label,
        brand: PROMO_BRAND,
        footerText: "OpenSteam Promotion System",
      }).then((r) => {
        if (!r.ok) console.error("[Promo Result Discord] reject post failed:", r.error);
      });

      return NextResponse.json({ ok: true, status: "FAILED" });
    }

    if (action === "approve") {
      const grade = tt.aiGrade as { totalEarned?: number; totalMax?: number } | undefined;
      const earned =
        typeof grade?.totalEarned === "number" ? grade.totalEarned : tt.score ?? 0;

      await prisma.trialTest.update({
        where: { id },
        data: {
          status: "PASSED",
          gradedAt: new Date(),
          reviewedByUserId: reviewerId,
          score: earned,
          feedback: `Staff approved. AI draft totaled ${earned}/${tt.maxScore} (subject to moderator standards).`,
          adminNotes:
            typeof body.staffNotes === "string" ? body.staffNotes.slice(0, 2000) : undefined,
        },
      });

      await prisma.user.update({
        where: { id: tt.userId },
        data: {
          role: "MODERATOR",
          roleLevel: 50,
          trialStartDate: null,
          trialWelcomeDmDeliveredAt: null,
        },
      });

      if (tt.user?.discordId) {
        void graduateTrialModDiscordRoles(tt.user.discordId).then((result) =>
          logDiscordModRoleResult("trial_assessment_approve", tt.user!.discordId, result)
        );
      }

      // Send congratulations email
      if (tt.user?.email) {
        try {
          const { sendBrandedEmail, renderTrialExamAnswersHtml } = await import("@/app/lib/email");
          const questions = parseQuestions(tt.questions);
          const answers = normalizeTrialAnswersJson(tt.answers);
          const examSheetHtml = renderTrialExamAnswersHtml(questions, answers);

          await sendBrandedEmail(
            tt.user.email,
            'Trial Moderator Assessment Passed — OpenSteam',
            'Assessment Passed',
            `Hello <strong>${tt.user.username}</strong>,<br><br>` +
            `Congratulations! We are absolutely thrilled to inform you that your live moderator assessment has been **Approved** by the staff team!<br><br>` +
            `Your trial exam score: <strong>${earned}/${tt.maxScore}</strong>.<br><br>` +
            `Your moderator permissions and roles have been updated. Welcome to the official OpenSteam Moderator Team!<br><br>` +
            `Below is a copy of your completed exam answer sheet for your records:<br><br>` +
            examSheetHtml,
            '#10b981',
            undefined,
            {
              buttonText: 'Go to Dashboard',
              buttonUrl: 'http://127.0.0.1:3000/dashboard',
              badge: 'Trial Approved'
            }
          );
        } catch (emailErr) {
          console.error('[Trial Approve Email Error]', emailErr);
        }
      }

      void postTrialResultToDiscord({
        test: { ...tt, status: "PASSED", score: earned },
        grader: auth.data.dbUser,
        outcome: "PASSED",
      }).then((r) => {
        if (!r.ok) console.error("[Trial Result Discord] approve post failed:", r.error);
      });

      return NextResponse.json({ ok: true, status: "PASSED" });
    }

    if (action === "reject") {
      await prisma.trialTest.update({
        where: { id },
        data: {
          status: "FAILED",
          gradedAt: new Date(),
          reviewedByUserId: reviewerId,
          feedback: "Staff rejected this attempt.",
          adminNotes:
            typeof body.staffNotes === "string" ? body.staffNotes.slice(0, 2000) : undefined,
        },
      });
      await prisma.user.update({
        where: { id: tt.userId },
        data: {
          role: "USER",
          roleLevel: 0,
          trialStartDate: null,
          trialWelcomeDmDeliveredAt: null,
        },
      });

      // Send rejection email
      if (tt.user?.email) {
        try {
          const { sendBrandedEmail, renderTrialExamAnswersHtml } = await import("@/app/lib/email");
          const questions = parseQuestions(tt.questions);
          const answers = normalizeTrialAnswersJson(tt.answers);
          const examSheetHtml = renderTrialExamAnswersHtml(questions, answers);

          await sendBrandedEmail(
            tt.user.email,
            'Trial Moderator Assessment Concluded — OpenSteam',
            'Assessment Concluded',
            `Hello <strong>${tt.user.username}</strong>,<br><br>` +
            `Thank you for taking the time to complete the OpenSteam live moderator trial assessment.<br><br>` +
            `After careful evaluation, we regret to inform you that you did not pass this assessment, and your trial has concluded.<br><br>` +
            `We appreciate your efforts and commitment during the trial period. Below is a copy of your completed exam answer sheet for your records:<br><br>` +
            examSheetHtml,
            '#dc2626',
            undefined,
            {
              buttonText: 'Submit an Appeal',
              buttonUrl: 'http://127.0.0.1:3000/support',
              badge: 'Trial Concluded'
            }
          );
        } catch (emailErr) {
          console.error('[Trial Reject Email Error]', emailErr);
        }
      }

      void postTrialResultToDiscord({
        test: { ...tt, status: "FAILED" },
        grader: auth.data.dbUser,
        outcome: "FAILED",
      }).then((r) => {
        if (!r.ok) console.error("[Trial Result Discord] reject post failed:", r.error);
      });

      return NextResponse.json({ ok: true, status: "FAILED" });
    }

    if (action === "regrade") {
      const qs = parseQuestions(tt.questions);
      if (!qs.length) {
        return NextResponse.json({ message: "Missing questions snapshot." }, { status: 409 });
      }
      const ans =
        tt.answers && typeof tt.answers === "object" && tt.answers !== null
          ? (tt.answers as Record<string, string>)
          : {};

      const grade = await buildAiGrade({ questions: qs, answers: ans });
      const pct =
        grade.totalMax > 0 ? Math.round((grade.totalEarned / grade.totalMax) * 1000) / 10 : 0;

      await prisma.trialTest.update({
        where: { id },
        data: {
          status: "AWAITING_STAFF",
          aiGrade: grade as object,
          score: grade.totalEarned,
          regradeRequestedAt: new Date(),
          reviewedByUserId: reviewerId,
          feedback: `AI draft: ${grade.totalEarned}/${grade.totalMax} (${pct}%). Awaiting staff review.`,
          adminNotes:
            typeof body.staffNotes === "string" ? body.staffNotes.slice(0, 2000) : undefined,
        },
      });

      await notifyModStaffWide({
        title: "Assessment re-graded by AI — needs manual confirmation",
        lines: [
          `TrialTest ${id.slice(0, 14)} · ${tt.user?.username ?? ""}`,
          `New draft totals: ${grade.totalEarned}/${grade.totalMax}`,
        ],
      }).catch(() => {});

      return NextResponse.json({ ok: true, awaitingManualReview: true, grade });
    }

    return NextResponse.json({ message: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
