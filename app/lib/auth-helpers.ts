import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { authOptions } from "@/app/lib/auth-options";
import { prisma } from "@/app/lib/prisma";

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Dashboard “staff” for moderator trial + assessment controls (not `DISCORD_MOD_OWNER_USER_IDS` — alerts use DB roles + webhook). */
export function isPrivilegedStaff(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "OWNER" || role === "SENIOR_MODERATOR";
}

/**
 * Resolves the signed-in Discord user’s DB row (by `discordId` from the session).
 * Avoids shadowing mix-ups for “who is the actor” on staff routes.
 */
export async function requireAuth(): Promise<
  | { ok: true; data: { dbUser: User } }
  | { ok: false; error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  const discordId = (session?.user as { discordId?: string } | undefined)?.discordId;
  if (!session?.user || !discordId) {
    return { ok: false, error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  const dbUser = await prisma.user.findUnique({
    where: { discordId },
  });

  if (!dbUser) {
    return { ok: false, error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true, data: { dbUser } };
}
