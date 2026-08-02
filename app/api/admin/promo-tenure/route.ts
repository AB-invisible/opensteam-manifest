import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/app/lib/auth-helpers";
import { normalizeDiscordSnowflake } from "@/app/lib/discord-id";
import { setRoleTenureDays, TRACKED_TENURE_ROLE_IDS } from "@/app/lib/discord-role-tenure";
import {
  DISCORD_MODERATOR_ROLE_ID,
  DISCORD_SENIOR_MODERATOR_ROLE_ID,
  DISCORD_HEAD_MODERATOR_ROLE_ID,
  PROMO_TIERS,
} from "@/app/lib/promo-tiers";

const DAY_MS = 24 * 60 * 60 * 1000;

const ROLE_LABELS: Record<string, string> = {
  [DISCORD_MODERATOR_ROLE_ID]: "Moderator",
  [DISCORD_SENIOR_MODERATOR_ROLE_ID]: "Senior Moderator",
  [DISCORD_HEAD_MODERATOR_ROLE_ID]: "Head Moderator",
};

/** Days required on a role to attempt the promotion it unlocks (null = no further rank). */
function requiredDaysForRole(roleId: string): number | null {
  for (const tier of Object.values(PROMO_TIERS)) {
    if (tier.fromRoleId === roleId) return tier.tenureDays;
  }
  return null;
}

/** ADMIN / OWNER only — manual tenure override is sensitive (gates promotions). */
function isTenureAdmin(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "OWNER";
}

/** Read a member's current tracked-role tenure (days held) for the override UI. */
export async function GET(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    if (!isTenureAdmin(auth.data.dbUser.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const discordId = normalizeDiscordSnowflake(url.searchParams.get("discordId") || "");
    if (!discordId) {
      return NextResponse.json({ message: "discordId required" }, { status: 400 });
    }

    const [user, rows] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId },
        select: { username: true, role: true },
      }),
      prisma.discordRoleTenure.findMany({
        where: { discordId, roleId: { in: [...TRACKED_TENURE_ROLE_IDS] } },
      }),
    ]);

    const byRole = new Map(rows.map((r) => [r.roleId, r] as const));
    const roles = TRACKED_TENURE_ROLE_IDS.map((roleId) => {
      const row = byRole.get(roleId);
      const days =
        row && !row.removedAt
          ? Math.floor((Date.now() - new Date(row.since).getTime()) / DAY_MS)
          : null;
      const requiredDays = requiredDaysForRole(roleId);
      return {
        roleId,
        label: ROLE_LABELS[roleId] ?? roleId,
        days,
        since: row?.since ?? null,
        removed: Boolean(row?.removedAt),
        source: row?.source ?? null,
        requiredDays,
        meetsRequirement: requiredDays == null ? null : days != null && days >= requiredDays,
      };
    });

    return NextResponse.json({
      discordId,
      username: user?.username ?? null,
      platformRole: user?.role ?? null,
      roles,
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}

/** Force how many days a member has held a tracked role (override tenure tracking). */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.error;
    const actor = auth.data.dbUser;
    if (!isTenureAdmin(actor.role)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const discordId = normalizeDiscordSnowflake(typeof body.discordId === "string" ? body.discordId : "");
    const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
    const daysRaw = Number(body.days);

    if (!discordId) {
      return NextResponse.json({ message: "discordId required" }, { status: 400 });
    }
    if (!TRACKED_TENURE_ROLE_IDS.includes(roleId as (typeof TRACKED_TENURE_ROLE_IDS)[number])) {
      return NextResponse.json({ message: "Unknown or untracked roleId" }, { status: 400 });
    }
    if (!Number.isFinite(daysRaw) || daysRaw < 0) {
      return NextResponse.json({ message: "days must be a non-negative number" }, { status: 400 });
    }

    const days = Math.min(Math.round(daysRaw), 3650);
    const since = await setRoleTenureDays(discordId, roleId, days, "manual");

    await prisma.auditLog
      .create({
        data: {
          userId: actor.id,
          action: "SET_ROLE_TENURE",
          targetId: discordId,
          details: { roleId, roleLabel: ROLE_LABELS[roleId] ?? roleId, days, since: since.toISOString() },
        },
      })
      .catch(() => {});

    return NextResponse.json({
      ok: true,
      discordId,
      roleId,
      days,
      since: since.toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ message: safeErrorMessage(error) }, { status: 500 });
  }
}
