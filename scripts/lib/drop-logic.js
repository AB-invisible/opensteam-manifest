const fs = require('fs');
const path = require('path');

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Resolve drops/ — works from bot-daemon (scripts/lib) and Next.js API bundles (.next/server/...). */
function dropsDir() {
  if (process.env.DROPS_PATH) return path.resolve(process.env.DROPS_PATH);

  const candidates = [
    path.join(process.cwd(), 'drops'),
    path.join(__dirname, '../../drops'),
  ];

  // Walk up from this module (bundled or not) until we find a drops/ folder.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, 'drops'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // ignore stat errors
    }
  }

  return path.join(process.cwd(), 'drops');
}

/** Normalise an account line to a stable key for history tracking. */
function accountKey(line) {
  // Use the credential portion (before the first |) trimmed and lowercased
  return line.split('|')[0].trim().toLowerCase();
}

/** List available drop platforms from drops/*.txt filenames (without extension). */
function listDropPlatforms() {
  const dir = dropsDir();
  if (!fs.existsSync(dir)) {
    console.warn('[Drop] drops directory not found:', dir);
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.txt') && !f.startsWith('drop_history_'))
    .map((f) => f.slice(0, -4).toLowerCase())
    .filter((name) => name && name !== 'drops')
    .sort();
}

/** Normalise and validate a platform slug; returns null if invalid. */
function normalizePlatform(platform) {
  const raw = String(platform || '')
    .trim()
    .toLowerCase()
    .replace(/\.txt$/i, '');
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(raw)) return null;
  return raw;
}

/** Resolve drops file and per-platform history path for a platform slug. */
function resolvePlatformPaths(platform) {
  const name = normalizePlatform(platform);
  if (!name) return null;

  const dir = dropsDir();
  const dropsPath = path.join(dir, `${name}.txt`);
  const resolved = path.resolve(dropsPath);
  const resolvedDir = path.resolve(dir);
  const relative = path.relative(resolvedDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return {
    name,
    dropsPath: resolved,
    historyPath: path.join(dropsDir(), `drop_history_${name}.json`),
  };
}

function formatPlatformLabel(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Load the drop history map: { [accountKey]: isoTimestamp } */
function loadHistory(historyPath) {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

/** Save the history map, pruning entries older than the cooldown window. */
function saveHistory(historyPath, history) {
  const cutoff = Date.now() - COOLDOWN_MS;
  const pruned = {};
  for (const [key, ts] of Object.entries(history)) {
    if (new Date(ts).getTime() > cutoff) pruned[key] = ts;
  }
  fs.writeFileSync(historyPath, JSON.stringify(pruned, null, 2), 'utf8');
}

/**
 * Executes an account drop: selects `count` random accounts from drops/{platform}.txt
 * and posts an embed to the Discord drop channel.
 * Accounts dropped within the last 7 days are skipped (per-platform history).
 */
async function executeAccountDrop(count, triggeredByDiscordId, prisma, minGames = 0, platform = '') {
  if (count < 1 || count > 25) {
    return { success: false, message: 'Count must be between 1 and 25.', dropped: 0 };
  }

  const paths = resolvePlatformPaths(platform);
  if (!paths) {
    const available = listDropPlatforms();
    const hint = available.length ? ` Available: ${available.join(', ')}.` : ' Add a .txt file under drops/.';
    return {
      success: false,
      message: `Invalid or missing platform "${platform}".${hint}`,
      dropped: 0,
    };
  }

  const { name: platformName, dropsPath, historyPath } = paths;
  const platformLabel = formatPlatformLabel(platformName);

  const tokenCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
  if (!tokenCfg?.value) return { success: false, message: 'DISCORD_BOT_TOKEN not configured.', dropped: 0 };

  // Fetch dynamic drop channel ID and role ping ID from Admin settings, falling back safely
  const dropChannelCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_DROP_CHANNEL_ID' } });
  const DISCORD_DROP_CHANNEL_ID = dropChannelCfg?.value?.trim() || '1505274869477146684';

  const dropRoleCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_DROP_ROLE_ID' } });
  const rawRole = dropRoleCfg?.value?.trim();
  const rolePing = rawRole ? `<@&${rawRole}>` : '<@&1506996557432750092>';

  if (!fs.existsSync(dropsPath)) {
    const available = listDropPlatforms();
    const dir = dropsDir();
    const hint = available.length
      ? ` Available platforms: ${available.join(', ')}.`
      : ` drops/ directory missing or empty (looked in ${dir}). Set DROPS_PATH or add drops/${platformName}.txt on the server.`;
    return {
      success: false,
      message: `drops/${platformName}.txt not found on server.${hint}`,
      dropped: 0,
    };
  }

  const content = fs.readFileSync(dropsPath, 'utf8');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      success: false,
      message: `No accounts remaining in drops/${platformName}.txt.`,
      dropped: 0,
    };
  }

  // Filter out accounts dropped within the last 7 days
  const history = loadHistory(historyPath);
  const cutoff = Date.now() - COOLDOWN_MS;
  let eligible = lines.filter((line) => {
    const ts = history[accountKey(line)];
    return !ts || new Date(ts).getTime() <= cutoff;
  });

  const totalBeforeGamesFilter = eligible.length;

  // Apply minGames filter if specified (Steam-style TotalGames field)
  function parseTotalGames(line) {
    const match = line.match(/TotalGames\s*=\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  if (minGames && minGames > 0) {
    eligible = eligible.filter((line) => parseTotalGames(line) >= minGames);
  }

  const onCooldown = lines.length - totalBeforeGamesFilter;

  if (eligible.length === 0) {
    if (minGames && minGames > 0 && totalBeforeGamesFilter > 0) {
      return {
        success: false,
        message: `No ${platformLabel} accounts in the eligible pool (${totalBeforeGamesFilter} off cooldown) had at least ${minGames} games.`,
        dropped: 0,
      };
    }
    return {
      success: false,
      message: `All ${lines.length} account${lines.length !== 1 ? 's' : ''} in drops/${platformName}.txt were dropped within the last 7 days. Wait for the cooldown to expire.`,
      dropped: 0,
    };
  }

  // True random selection using a robust Fisher-Yates shuffle on the eligible pool
  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const actualCount = Math.min(count, 25, eligible.length);
  const shuffledEligible = shuffle(eligible);
  const selected = shuffledEligible.slice(0, actualCount);

  const fields = selected.map((line, i) => {
    const parts = line.split('|').map((p) => p.trim());
    const credentials = parts[0] || 'Unknown';
    const details = parts.slice(1).join(' · ');
    return {
      name: `🎁 ${platformLabel} #${i + 1}`,
      value: `\`\`\`\n${credentials}\n\`\`\`${details ? `**Details**: ${details}` : ''}`,
      inline: false,
    };
  });

  const now = new Date();

  const embed = {
    title: `🎁 ${platformLabel} Drop — ${selected.length} Account${selected.length !== 1 ? 's' : ''}`,
    description: `Posted by <@${triggeredByDiscordId}>. Platform: **${platformLabel}**. Grab them while they work! Eligible remaining: **${eligible.length - actualCount}**`,
    color: 0x10b981,
    fields,
    footer: { text: `OpenSteam · /drop · ${platformName}` },
    timestamp: now.toISOString(),
  };

  const postRes = await fetch(`https://discord.com/api/v10/channels/${DISCORD_DROP_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${tokenCfg.value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: rolePing, embeds: [embed] }),
  });

  if (!postRes.ok) {
    const err = await postRes.json().catch(() => ({}));
    return { success: false, message: `Discord error: ${JSON.stringify(err)}`, dropped: 0 };
  }

  // Fetch drop mode
  const dropModeCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_DROP_MODE' } });
  const isConsumeMode = dropModeCfg?.value?.trim().toUpperCase() === 'CONSUME';

  if (isConsumeMode) {
    // Consume mode: physically remove the selected lines from the file
    const remainingLines = [];
    const selectedCopy = [...selected];
    for (const line of lines) {
      const indexInSelected = selectedCopy.indexOf(line);
      if (indexInSelected !== -1) {
        selectedCopy.splice(indexInSelected, 1);
      } else {
        remainingLines.push(line);
      }
    }
    fs.writeFileSync(dropsPath, remainingLines.join('\n'), 'utf8');
  } else {
    // Recycle mode: Record dropped accounts in history and save
    const droppedAt = now.toISOString();
    for (const line of selected) {
      history[accountKey(line)] = droppedAt;
    }
    saveHistory(historyPath, history);
  }

  const cooldownNote = onCooldown > 0 ? ` (${onCooldown} skipped — on 7-day cooldown)` : '';
  const filterNote = minGames > 0 ? ` (filtered for min ${minGames} games)` : '';
  const modeNote = isConsumeMode ? ' [CONSUMED]' : ' [RECYCLED]';
  return {
    success: true,
    message: `Successfully dropped ${selected.length} ${platformLabel} account${selected.length !== 1 ? 's' : ''}${modeNote}. Eligible remaining: ${eligible.length - actualCount}${cooldownNote}${filterNote}`,
    dropped: selected.length,
  };
}

module.exports = { executeAccountDrop, listDropPlatforms, normalizePlatform, dropsDir };
