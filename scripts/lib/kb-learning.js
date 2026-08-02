const fs = require('fs');
const path = require('path');

const TICKETS_CATEGORY_ID = '1444925897949053040';

/**
 * Checks if author is a Staff member
 */
async function isStaffAuthor(message, prisma) {
  if (!message || !message.author) return false;

  // 1. Check DB Role
  if (prisma) {
    try {
      const user = await prisma.user.findUnique({ where: { discordId: message.author.id } });
      if (user && ['OWNER', 'ADMIN', 'SENIOR_MODERATOR', 'MODERATOR', 'TRIAL_MODERATOR'].includes(user.role)) {
        return true;
      }
    } catch (_) {}
  }

  // 2. Check Discord Member permissions / roles
  if (message.member) {
    if (message.member.permissions.has('Administrator') || message.member.permissions.has('ManageGuild')) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates if staff message contains valuable solution knowledge to learn
 */
function isInformativeStaffMessage(content) {
  if (!content || content.length < 35) return false;

  const lower = content.toLowerCase();
  const keywords = [
    'lua', 'manifest', 'appid', 'key', 'verify', 'verification', 'error',
    'fix', 'download', 'step', 'dashboard', 'solution', 'run', 'reset',
    'command', 'role', 'plan', 'upgrade', 'bot', 'status', 'depot', 'zipped',
    'workaround', 'resolved', 'try to', 'make sure', 'you need'
  ];

  const matchCount = keywords.filter((kw) => lower.includes(kw)).length;
  return matchCount >= 2;
}

/**
 * Appends learned staff explanation to docs/kb/learned-staff-insights.md
 */
async function processStaffMessageForLearning(message, prisma) {
  try {
    if (!message || message.author.bot) return false;

    // Check if channel is under ticket category 1444925897949053040 or ticket channel
    const parentId = message.channel?.parentId || message.channel?.parent?.id;
    const isTicketCategory = parentId === TICKETS_CATEGORY_ID;
    const isTicketChannel = (message.channel?.name || '').toLowerCase().includes('ticket');

    if (!isTicketCategory && !isTicketChannel) {
      return false;
    }

    // Verify staff author
    const isStaff = await isStaffAuthor(message, prisma);
    if (!isStaff) return false;

    // Verify content quality
    if (!isInformativeStaffMessage(message.content)) {
      return false;
    }

    const kbFile = path.resolve(__dirname, '../../docs/kb/learned-staff-insights.md');
    const timestamp = new Date().toISOString().split('T')[0];
    const cleanContent = message.content.replace(/\r?\n/g, '\n> ');

    const newEntry = `
### Staff Insight by @${message.author.username} (${timestamp})
- **Channel**: #${message.channel.name}
- **Learned Knowledge**:
> ${cleanContent}
`;

    // Append entry to learned-staff-insights.md
    fs.appendFileSync(kbFile, newEntry, 'utf8');
    console.log(`[KB Learning Engine] Learned new insight from staff @${message.author.username} in #${message.channel.name}`);

    // Invalidate KB cache so Atis uses it immediately
    try {
      const { loadKnowledgeBase } = require('./kb-service');
      loadKnowledgeBase();
    } catch (_) {}

    // Add subtle reaction indicator to staff message
    try {
      await message.react('💡').catch(() => {});
    } catch (_) {}

    return true;
  } catch (err) {
    console.error('[KB Learning Error]', err?.message || err);
    return false;
  }
}

module.exports = {
  TICKETS_CATEGORY_ID,
  isStaffAuthor,
  processStaffMessageForLearning,
};
