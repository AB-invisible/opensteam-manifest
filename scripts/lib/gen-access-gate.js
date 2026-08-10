/**
 * Shared gates for Discord generation commands (/gen, /dlcgen, /request, /onlinefix).
 * Requires Discord verification — website login alone is not enough.
 */
const {
  findVerifiedAltForGeneration,
} = require('./generation-alt-gate');

function isDiscordVerified(user) {
  return !!(user && user.discordVerifiedAt);
}

function accountNotVerifiedReply(interaction, appUrl) {
  const base = String(appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://manifest-web-ylio.onrender.com').replace(/\/$/, '');
  return interaction.reply({
    content:
      `❌ **Verification Required**: Complete Discord verification in <#1532910591264423988> before using generation commands.\n` +
      `Alt accounts cannot verify or generate. One person = one account.`,
    flags: 64, // Ephemeral
  });
}

async function assertGenerationAccess(prisma, user, { interaction, verifiedRoleId } = {}) {
  if (!user) {
    return { ok: false, code: 'NO_USER', message: 'Account not found.' };
  }

  if (!isDiscordVerified(user)) {
    return {
      ok: false,
      code: 'NOT_VERIFIED',
      message: 'Complete Discord verification before using generation commands.',
    };
  }

  if (user.isBanned) {
    return { ok: false, code: 'BANNED', message: 'Your account is suspended from OpenSteam services.' };
  }

  const alt = await findVerifiedAltForGeneration(prisma, user);
  if (alt) {
    return {
      ok: false,
      code: 'ALT_NETWORK',
      message:
        `Alt account blocked. Another verified account (**${alt.username}**) matched on ${alt.matchType}. ` +
        'Use your original account — alt accounts cannot generate.',
      alt,
    };
  }

  if (interaction && verifiedRoleId) {
    const roles = interaction.member?.roles?.cache;
    if (roles && !roles.has(verifiedRoleId)) {
      return {
        ok: false,
        code: 'NO_VERIFIED_ROLE',
        message: 'You must have the Verified role. Complete verification in the verify channel.',
      };
    }
  }

  return { ok: true };
}

module.exports = {
  isDiscordVerified,
  accountNotVerifiedReply,
  findVerifiedAltForGeneration,
  assertGenerationAccess,
};
