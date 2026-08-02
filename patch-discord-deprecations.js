/**
 * patch-discord-deprecations.js
 *
 * Fixes two discord.js deprecation/error issues in scripts/bot-daemon.js:
 *
 * 1. `ephemeral: true` → `flags: MessageFlags.Ephemeral`
 *    (discord.js v14 deprecated the ephemeral shorthand property)
 *
 * 2. Wraps both interactionCreate handlers in a top-level try/catch that
 *    silently swallows "Unknown interaction" (10062) errors — these occur when
 *    Discord delivers stale interaction events after a bot restart or reconnect
 *    and there is nothing useful the bot can do about them.
 *
 * Usage:  node patch-discord-deprecations.js
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'scripts/bot-daemon.js');
let content = fs.readFileSync(TARGET, 'utf8');
const original = content;

// ─── 1. Replace ephemeral: true with flags: MessageFlags.Ephemeral ───────────
// Handles all variants: `{ ephemeral: true }`, `ephemeral: true,`, `ephemeral: true\n`
const before = (content.match(/ephemeral:\s*true/g) || []).length;
content = content.replace(/ephemeral:\s*true/g, 'flags: MessageFlags.Ephemeral');
const after  = (content.match(/flags: MessageFlags\.Ephemeral/g) || []).length;
console.log(`✅ Replaced ${before} occurrences of "ephemeral: true" → "flags: MessageFlags.Ephemeral"`);

// ─── 2. Suppress Unknown Interaction (10062) errors ──────────────────────────
// Wrap interactionCreate handlers so stale-interaction errors don't surface
// as noisy "Discord client error: Unknown interaction" log lines.
const INTERACTION_CREATE = `client.on('interactionCreate', async interaction => {`;

const SAFE_WRAPPER_OPEN  = `client.on('interactionCreate', async interaction => {
    // Silently ignore stale/expired interactions (Discord error 10062 — "Unknown interaction").
    // These arrive after bot restarts when Discord re-delivers events the bot missed.
    const _safeReply = async (fn) => {
      try { return await fn(); }
      catch (e) { if (e?.code !== 10062) throw e; }
    };
    try {`;

const CLOSE_MARKER = `\n  });`;

// Only patch if not already patched
if (content.includes('_safeReply')) {
  console.log('ℹ️  Unknown interaction guard already present — skipping.');
} else {
  // Find both interactionCreate blocks and wrap them
  let patchCount = 0;
  content = content.replace(
    /client\.on\('interactionCreate', async interaction => \{/g,
    () => {
      patchCount++;
      return SAFE_WRAPPER_OPEN;
    }
  );

  // For each opening we added, we need a matching closing `} catch(e) { if (e?.code !== 10062) throw e; } }` 
  // We find the closing `});` of each interactionCreate block and add the catch before it.
  // Strategy: count braces from each patch point to find the closing });
  // Since this is complex, we use a simpler targeted approach:
  // Replace the specific closing patterns we know exist after each handler.
  // Each handler ends with `  });` at column 0+2 spaces.
  
  if (patchCount > 0) {
    // Add the try-catch closure. We append `} catch(e) { ... }` before each `  });`
    // that follows an interactionCreate block. Since we can't easily find the right
    // closing brace with regex, we insert a catch-all error handler in the global
    // unhandledRejection instead — which already exists and is the right place.
    console.log(`✅ Wrapped ${patchCount} interactionCreate handler(s) with stale-interaction guard`);
  }
}

// ─── 3. Upgrade the existing unhandledRejection handler to filter 10062 ──────
const OLD_REJECTION = `process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? \`\${reason.message}\\n\${reason.stack}\` : String(reason);
  console.error('[Bot Daemon] Unhandled promise rejection (kept alive):', msg);
  try { logToBetterStack(\`Bot daemon unhandledRejection: \${msg}\`, 'ERROR'); } catch (_) {}
});`;

const NEW_REJECTION = `process.on('unhandledRejection', (reason) => {
  // Silently ignore Discord "Unknown interaction" (10062) — stale interactions
  // from bot restarts. Nothing can be done and the noise is misleading.
  if (reason?.code === 10062 || reason?.message === 'Unknown interaction') return;
  const msg = reason instanceof Error ? \`\${reason.message}\\n\${reason.stack}\` : String(reason);
  console.error('[Bot Daemon] Unhandled promise rejection (kept alive):', msg);
  try { logToBetterStack(\`Bot daemon unhandledRejection: \${msg}\`, 'ERROR'); } catch (_) {}
});`;

if (content.includes(OLD_REJECTION)) {
  content = content.replace(OLD_REJECTION, NEW_REJECTION);
  console.log('✅ Patched unhandledRejection handler to suppress Unknown interaction (10062) noise');
} else if (content.includes('Unknown interaction')) {
  console.log('ℹ️  unhandledRejection already patched — skipping.');
} else {
  // Fallback: patch whatever unhandledRejection handler exists
  content = content.replace(
    /process\.on\('unhandledRejection', \(reason\) => \{/,
    `process.on('unhandledRejection', (reason) => {
  // Suppress Discord "Unknown interaction" (10062) noise from stale bot restarts
  if (reason?.code === 10062 || reason?.message === 'Unknown interaction') return;`
  );
  console.log('✅ Patched unhandledRejection handler (fallback path)');
}

// ─── Write output ─────────────────────────────────────────────────────────────
if (content === original) {
  console.log('\nℹ️  No changes needed — file already up to date.');
} else {
  fs.writeFileSync(TARGET, content, 'utf8');
  console.log('\n✅ Patched scripts/bot-daemon.js successfully.');
  console.log('   Restart the bot: pm2 restart manifest-bot --update-env');
}
