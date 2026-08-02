import { sendDiscordDm } from "@/app/lib/discord-dm";
import { prisma } from "@/app/lib/prisma";

/** Optional channel webhook — pause/submit pings still post here alongside staff DMs. */
export async function sendModStaffWebhook(body: string) {
  const url = process.env.DISCORD_MOD_STAFF_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(`${url}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body.slice(0, 1900) }),
    });
  } catch {
    /* non-fatal */
  }
}

/** Discord IDs for DB users whose `role` is ADMIN or OWNER (dashboard controls stay in-app; alerts go here only). */
export async function discordIdsForPrivilegedStaff(
  excludeDiscordIds?: string[]
): Promise<string[]> {
  const exclude = new Set((excludeDiscordIds ?? []).filter(Boolean));
  const rows = await prisma.user.findMany({
    where: {
      role: { in: ["ADMIN", "OWNER"] },
      discordId: { not: undefined },
    },
    select: { discordId: true },
  });
  return [
    ...new Set(
      rows
        .map((r) => r.discordId)
        .filter((id): id is string => Boolean(id && !exclude.has(id)))
    ),
  ];
}

export async function notifyModStaffWide(opts: {
  title: string;
  lines: string[];
  /** Omit these Discord user IDs from DMs (e.g. the examinee triggering pause/submit). Webhook always receives the message when configured. */
  excludeDiscordUserIds?: string[];
}) {
  const text = [`**${opts.title}**`, ...opts.lines.map((l) => `• ${l}`)].join("\n");

  await sendModStaffWebhook(text);

  const ids = await discordIdsForPrivilegedStaff(opts.excludeDiscordUserIds);
  for (const id of ids) {
    try {
      await sendDiscordDm(id, text.slice(0, 1900));
    } catch {
      /* webhook may suffice */
    }
  }
}
