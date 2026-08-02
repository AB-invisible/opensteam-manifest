/**
 * Shared logging helper for hosted bot daemons.
 *
 * Writes structured log lines into the `hosted_bot_logs` table so they can be
 * surfaced in the user/admin consoles, and keeps the table bounded by pruning
 * old rows. Each call still mirrors to stdout so the file logs keep working.
 */

const MAX_ROWS_PER_INSTANCE = 300;
const MAX_AGE_DAYS = 3;

// Throttle pruning so we don't run a delete on every single log line.
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60_000;

function consoleMirror(level, source, message) {
  const prefix = `[${source || 'hosted-bot'}]`;
  if (level === 'ERROR') console.error(prefix, message);
  else if (level === 'WARN') console.warn(prefix, message);
  else console.log(prefix, message);
}

async function pruneInstanceLogs(prisma, instanceId) {
  if (!instanceId) return;
  // Keep only the newest MAX_ROWS_PER_INSTANCE rows for this instance.
  const cutoff = await prisma.hostedBotLog.findMany({
    where: { instanceId },
    orderBy: { createdAt: 'desc' },
    skip: MAX_ROWS_PER_INSTANCE,
    take: 1,
    select: { createdAt: true },
  });
  if (cutoff.length > 0) {
    await prisma.hostedBotLog.deleteMany({
      where: { instanceId, createdAt: { lt: cutoff[0].createdAt } },
    });
  }
}

async function pruneOldLogs(prisma) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const threshold = new Date(now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.hostedBotLog.deleteMany({ where: { createdAt: { lt: threshold } } });
  } catch (e) {
    /* best-effort */
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ instanceId?: string|null, scope?: 'BRANDED'|'CUSTOM'|null, level?: 'INFO'|'WARN'|'ERROR'|'EVENT', source?: string, message: string }} entry
 */
async function logEntry(prisma, entry) {
  const level = entry.level || 'INFO';
  const source = entry.source || (entry.scope === 'BRANDED' ? 'hosted-branded' : 'hosted-custom');
  const message = String(entry.message || '').slice(0, 2000);

  consoleMirror(level, source, message);

  try {
    await prisma.hostedBotLog.create({
      data: {
        instanceId: entry.instanceId || null,
        scope: entry.scope || null,
        level,
        source,
        message,
      },
    });
    if (entry.instanceId) await pruneInstanceLogs(prisma, entry.instanceId);
    await pruneOldLogs(prisma);
  } catch (e) {
    // Never let logging crash the daemon.
    console.error('[hosted-bot-logger] failed to persist log:', e.message);
  }
}

module.exports = { logEntry };
