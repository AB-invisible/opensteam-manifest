const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const CLAIM_WINDOW_HOURS = 12;
const MAX_WINNERS = 25;
const MIN_DURATION_MS = 30 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PLAN_DURATION_DAYS = 30;
const MAX_PLAN_DURATION_DAYS = 730;
const BOOSTER_ROLE_ID = '1519671891533627583';
const BOOSTER_ENTRY_WEIGHT = 2;

const ENTER_PREFIX = 'ggw_enter_';
const CLAIM_PREFIX = 'ggw_claim_';
const CONFIRM_PLAN_PREFIX = 'ggw_confirm_plan_';
const CONFIRM_CUSTOM_PREFIX = 'ggw_confirm_custom_';

const pendingConfirmations = new Map();

const GIVEAWAY_REFERENCE_OPTION = {
  name: 'message_id',
  description: 'Giveaway message ID or discord.com/channels/... link (defaults to latest in channel)',
  type: 3,
  required: false,
  max_length: 120,
};

const GIVEAWAY_COMMAND = {
  name: 'giveaway',
  description: 'Giveaway management with claimable prizes and auto rerolls (owner only)',
  options: [
    {
      name: 'create',
      description: 'Create a new giveaway in this channel',
      type: 1,
      options: [
        {
          name: 'prize',
          description: 'Prize title, e.g. Premium Plan or Steam key bundle',
          type: 3,
          required: true,
          max_length: 250,
        },
        {
          name: 'duration',
          description: 'How long to run it, e.g. 30m, 2h, 1d',
          type: 3,
          required: true,
          max_length: 32,
        },
        {
          name: 'winners',
          description: 'How many winners to draw',
          type: 4,
          required: true,
          min_value: 1,
          max_value: MAX_WINNERS,
        },
        {
          name: 'description',
          description: 'Extra details shown on the giveaway embed',
          type: 3,
          required: false,
          max_length: 500,
        },
        {
          name: 'reward',
          description: 'What winners receive on claim. Use separate lines for separate prizes.',
          type: 3,
          required: false,
          max_length: 4000,
        },
        {
          name: 'separate_prizes',
          description: 'Give winner 1 line 1, winner 2 line 2, and so on',
          type: 5,
          required: false,
        },
        {
          name: 'plan_duration',
          description: 'Plan giveaway only: how long winners keep the plan (e.g. 30d, 3mo, 1y). Default 30d.',
          type: 3,
          required: false,
          max_length: 32,
        },
      ],
    },
    {
      name: 'list',
      description: 'List active giveaways in this server',
      type: 1,
    },
    {
      name: 'info',
      description: 'View entries, winners, and claim status for a giveaway',
      type: 1,
      options: [
        GIVEAWAY_REFERENCE_OPTION,
        {
          name: 'giveaway_id',
          description: 'Internal giveaway ID from /giveaway list',
          type: 3,
          required: false,
          max_length: 32,
        },
      ],
    },
    {
      name: 'entries',
      description: 'List who entered a giveaway (ephemeral)',
      type: 1,
      options: [
        GIVEAWAY_REFERENCE_OPTION,
        {
          name: 'giveaway_id',
          description: 'Internal giveaway ID from /giveaway list',
          type: 3,
          required: false,
          max_length: 32,
        },
      ],
    },
    {
      name: 'end',
      description: 'End an active giveaway early and draw winners now',
      type: 1,
      options: [
        GIVEAWAY_REFERENCE_OPTION,
        {
          name: 'giveaway_id',
          description: 'Internal giveaway ID from /giveaway list',
          type: 3,
          required: false,
          max_length: 32,
        },
      ],
    },
    {
      name: 'cancel',
      description: 'Cancel an active giveaway without drawing winners',
      type: 1,
      options: [
        GIVEAWAY_REFERENCE_OPTION,
        {
          name: 'giveaway_id',
          description: 'Internal giveaway ID from /giveaway list',
          type: 3,
          required: false,
          max_length: 32,
        },
      ],
    },
    {
      name: 'reroll',
      description: 'Reroll unclaimed winner slots immediately',
      type: 1,
      options: [
        GIVEAWAY_REFERENCE_OPTION,
        {
          name: 'giveaway_id',
          description: 'Internal giveaway ID from /giveaway list',
          type: 3,
          required: false,
          max_length: 32,
        },
      ],
    },
    {
      name: 'repost',
      description: 'Repost an active giveaway announcement in this channel',
      type: 1,
      options: [
        {
          name: 'giveaway_id',
          description: 'Giveaway ID from /giveaway list (short ID works)',
          type: 3,
          required: true,
          max_length: 32,
        },
        {
          name: 'ping_everyone',
          description: 'Ping @everyone on the repost (default: yes)',
          type: 5,
          required: false,
        },
      ],
    },
    {
      name: 'dmresend',
      description: 'Resend winner claim DMs for an ended giveaway',
      type: 1,
      options: [
        GIVEAWAY_REFERENCE_OPTION,
        {
          name: 'giveaway_id',
          description: 'Giveaway ID from /giveaway list',
          type: 3,
          required: false,
          max_length: 32,
        },
        {
          name: 'force',
          description: 'Resend to all pending winners, even if a prior DM was recorded',
          type: 5,
          required: false,
        },
      ],
    },
  ],
};

function truncate(value, max = 1024) {
  const text = String(value || '').trim();
  if (text.length <= max) return text || 'None';
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function unixTime(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function messageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function normalizePrizeLines(text) {
  return String(text || '')
    .replace(/\\n/g, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseDurationMs(input) {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return { ok: false, error: 'Duration is required.' };

  const unitMs = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };

  let total = 0;
  let matched = false;
  const pattern = /(\d+)\s*(seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d)/gi;
  for (const match of text.matchAll(pattern)) {
    matched = true;
    total += Number(match[1]) * unitMs[match[2].toLowerCase()];
  }

  if (!matched || total <= 0) {
    return { ok: false, error: 'Use a duration like 30m, 2h, or 1d.' };
  }
  if (total < MIN_DURATION_MS) {
    return { ok: false, error: 'Giveaways must run for at least 30 seconds.' };
  }
  if (total > MAX_DURATION_MS) {
    return { ok: false, error: 'Giveaways can run for at most 30 days.' };
  }

  return { ok: true, ms: total };
}

function parsePlanDurationDays(input) {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return { ok: true, days: DEFAULT_PLAN_DURATION_DAYS };

  const unitDays = {
    d: 1,
    day: 1,
    days: 1,
    w: 7,
    week: 7,
    weeks: 7,
    mo: 30,
    mon: 30,
    month: 30,
    months: 30,
    y: 365,
    yr: 365,
    year: 365,
    years: 365,
  };

  let total = 0;
  let matched = false;
  const pattern = /(\d+)\s*(years?|yrs?|yr|y|months?|mons?|mo|weeks?|w|days?|d)/gi;
  for (const match of text.matchAll(pattern)) {
    matched = true;
    total += Number(match[1]) * unitDays[match[2].toLowerCase()];
  }

  if (!matched || total <= 0) {
    return { ok: false, error: 'Use a plan duration like 30d, 3mo, or 1y.' };
  }
  if (total > MAX_PLAN_DURATION_DAYS) {
    return { ok: false, error: `Plan duration can be at most ${MAX_PLAN_DURATION_DAYS} days.` };
  }

  return { ok: true, days: Math.round(total) };
}

function formatPlanDuration(days) {
  const value = Number(days) || DEFAULT_PLAN_DURATION_DAYS;
  if (value % 365 === 0 && value >= 365) {
    const years = value / 365;
    return years === 1 ? '1 year' : `${years} years`;
  }
  if (value % 30 === 0 && value >= 30) {
    const months = value / 30;
    return months === 1 ? '1 month' : `${months} months`;
  }
  return value === 1 ? '1 day' : `${value} days`;
}

function detectOpenSteamPlanFromPrize(prize) {
  const text = String(prize || '').toLowerCase();
  const hasPlanContext = /\b(plan|tier|subscription|membership|gamegen|gen)\b/.test(text);
  const candidates = [
    ['BUSINESS', /\bbusiness\b/],
    ['RESELLER', /\breseller\b/],
    ['PREMIUM', /\bpremium\b/],
    ['REGULAR', /\bregular\b/],
    ['CUSTOM', /\bcustom\b/],
  ];

  for (const [plan, pattern] of candidates) {
    if (pattern.test(text) && (hasPlanContext || plan === 'PREMIUM')) return plan;
  }
  return null;
}

function isPlatformOwner(user) {
  return Boolean(user && user.role === 'OWNER');
}

async function getPlatformUser(prisma, discordId) {
  return prisma.user.findUnique({ where: { discordId } }).catch(() => null);
}

async function canManageGiveaways(prisma, interaction) {
  const user = await getPlatformUser(prisma, interaction.user.id);
  return isPlatformOwner(user);
}

function shortGiveawayId(id) {
  return String(id || '').slice(0, 8);
}

function parseDiscordMessageRef(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const urlMatch = text.match(/\/channels\/\d+\/\d+\/(\d{17,20})/);
  if (urlMatch) return urlMatch[1];
  if (/^\d{17,20}$/.test(text)) return text;
  return null;
}

async function resolveGiveawayReference(prisma, interaction, opts = {}) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const messageRef = parseDiscordMessageRef(opts.messageId);
  const giveawayId = String(opts.giveawayId || '').trim() || null;

  if (giveawayId) {
    const byId = await prisma.giveaway.findFirst({
      where: { id: giveawayId, guildId },
    });
    if (byId) return byId;

    if (giveawayId.length >= 6) {
      const byPrefix = await prisma.giveaway.findMany({
        where: { guildId, id: { startsWith: giveawayId } },
        orderBy: { createdAt: 'desc' },
        take: 2,
      });
      if (byPrefix.length === 1) return byPrefix[0];
    }
  }

  if (messageRef) {
    const byMessage = await prisma.giveaway.findFirst({
      where: { messageId: messageRef, guildId },
    });
    if (byMessage) return byMessage;
  }

  if (opts.strict) return null;

  return prisma.giveaway.findFirst({
    where: { guildId, channelId },
    orderBy: { createdAt: 'desc' },
  });
}

function statusLabel(status) {
  const labels = {
    ACTIVE: 'Active',
    ENDING: 'Ending…',
    ENDED: 'Ended — claims open',
    REROLLING: 'Rerolling…',
    COMPLETE: 'Complete',
    CANCELLED: 'Cancelled',
  };
  return labels[status] || status;
}

async function replyOwnerOnly(interaction) {
  return interaction.reply({
    content: 'Only the OpenSteam **owner** can manage giveaways.',
    ephemeral: true,
  });
}

async function ensureGuild(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Giveaway commands only work inside a server.', ephemeral: true });
    return false;
  }
  return true;
}

function buildEntryRow(giveawayId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ENTER_PREFIX}${giveawayId}`)
      .setLabel(disabled ? 'Giveaway ended' : 'Enter giveaway')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(disabled))
  );
}

function buildClaimRow(winnerId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CLAIM_PREFIX}${winnerId}`)
      .setLabel(disabled ? 'Claimed' : 'Claim prize')
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(disabled))
  );
}

function buildConfirmRows(confirmId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PLAN_PREFIX}${confirmId}`)
        .setLabel('Yes, OpenSteam plan')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_CUSTOM_PREFIX}${confirmId}`)
        .setLabel('No, regular prize')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function getGiveawayPrizeLabel(giveaway) {
  if (giveaway.prizeType === 'PLAN' && giveaway.plan) {
    return `OpenSteam ${giveaway.plan} plan`;
  }
  return giveaway.prize;
}

function getPrizeTextForIndex(giveaway, prizeIndex) {
  if (giveaway.prizeType === 'PLAN' && giveaway.plan) {
    const days = giveaway.planDurationDays || DEFAULT_PLAN_DURATION_DAYS;
    return `OpenSteam ${giveaway.plan} plan - ${formatPlanDuration(days)}`;
  }

  const rewardText = giveaway.rewardText || giveaway.prize;
  if (!giveaway.separatePrizes) return rewardText;

  const lines = normalizePrizeLines(rewardText);
  return lines[prizeIndex] || giveaway.prize;
}

function validateGiveawayPayload(payload) {
  if (!payload.prize) return 'Prize is required.';
  if (payload.winnerCount < 1 || payload.winnerCount > MAX_WINNERS) {
    return `Winner count must be between 1 and ${MAX_WINNERS}.`;
  }
  if (payload.prizeType !== 'PLAN' && payload.separatePrizes) {
    const lines = normalizePrizeLines(payload.rewardText || payload.prize);
    if (lines.length < payload.winnerCount) {
      return `Separate prizes needs at least ${payload.winnerCount} non-empty line(s) in the reward text.`;
    }
  }
  if (payload.prizeType === 'PLAN' && (!payload.planDurationDays || payload.planDurationDays < 1)) {
    return 'Plan giveaways need a valid plan duration.';
  }
  return null;
}

function buildGiveawayEmbed(giveaway, entryCount = 0) {
  const ended = !['ACTIVE'].includes(giveaway.status);
  const cancelled = giveaway.status === 'CANCELLED';
  const embed = new EmbedBuilder()
    .setTitle(cancelled ? 'Giveaway cancelled' : (ended ? 'Giveaway ended' : 'Giveaway'))
    .setColor(cancelled ? 0xef4444 : (ended ? 0x6b7280 : 0x6366f1))
    .setDescription(`Prize: **${truncate(getGiveawayPrizeLabel(giveaway), 350)}**`)
    .addFields(
      { name: 'Winners', value: `\`${giveaway.winnerCount}\``, inline: true },
      { name: 'Entries', value: `\`${entryCount}\``, inline: true },
      {
        name: ended ? 'Ended' : 'Ends',
        value: cancelled
          ? 'Cancelled'
          : `<t:${unixTime(ended ? giveaway.endedAt || giveaway.endsAt : giveaway.endsAt)}:R>`,
        inline: true,
      },
      { name: 'Host', value: `<@${giveaway.createdByDiscordId}>`, inline: true },
      { name: 'Status', value: statusLabel(giveaway.status), inline: true },
      { name: 'ID', value: `\`${shortGiveawayId(giveaway.id)}\``, inline: true },
    )
    .setFooter({
      text: giveaway.prizeType === 'PLAN'
        ? 'AI-assisted plan giveaway. Boosters get 2× win chance. Winners must claim in DM within 12 hours.'
        : 'Boosters get 2× win chance. Winners must claim in DM within 12 hours.',
    });

  if (!ended && !cancelled) {
    embed.addFields({
      name: 'Booster bonus',
      value: 'Server boosters get **2×** win chance.',
      inline: false,
    });
  }

  if (giveaway.description) {
    embed.addFields({
      name: 'Details',
      value: truncate(giveaway.description, 500),
      inline: false,
    });
  }

  if (giveaway.prizeType === 'PLAN' && giveaway.plan) {
    embed.addFields({
      name: 'Plan length',
      value: formatPlanDuration(giveaway.planDurationDays || DEFAULT_PLAN_DURATION_DAYS),
      inline: true,
    });
  }

  if (!ended && !cancelled && giveaway.separatePrizes && giveaway.rewardText) {
    embed.addFields({
      name: 'Prize delivery',
      value: 'Each winner receives a different reward (see host for details after claim).',
      inline: false,
    });
  }

  if (!ended && !cancelled) {
    embed.addFields({
      name: 'How to enter',
      value: 'Click the button below before the timer ends.',
      inline: false,
    });
  }

  return embed;
}

function memberHasBoosterRole(member) {
  return Boolean(member?.roles?.cache?.has(BOOSTER_ROLE_ID));
}

async function getBoosterDiscordIds(client, guildId, discordIds) {
  const unique = [...new Set(discordIds.filter(Boolean))];
  const boosters = new Set();
  if (unique.length === 0) return boosters;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return boosters;

  await Promise.all(unique.map(async (discordId) => {
    const member = guild.members.cache.get(discordId)
      || await guild.members.fetch(discordId).catch(() => null);
    if (memberHasBoosterRole(member)) boosters.add(discordId);
  }));

  return boosters;
}

function pickWeightedRandomEntries(entries, count, doubledDiscordIds = new Set()) {
  const selected = [];
  const remaining = [...entries];
  const target = Math.min(count, remaining.length);

  while (selected.length < target && remaining.length > 0) {
    const pool = [];
    for (const entry of remaining) {
      pool.push(entry);
      if (doubledDiscordIds.has(entry.discordId)) {
        for (let extra = 1; extra < BOOSTER_ENTRY_WEIGHT; extra += 1) {
          pool.push(entry);
        }
      }
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    selected.push(pick);
    remaining.splice(remaining.findIndex((entry) => entry.discordId === pick.discordId), 1);
  }

  return selected;
}

async function pickGiveawayWinners(client, giveaway, entries, count) {
  const boosterIds = await getBoosterDiscordIds(
    client,
    giveaway.guildId,
    entries.map((entry) => entry.discordId)
  );
  return pickWeightedRandomEntries(entries, count, boosterIds);
}

async function fetchTextChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function sendGiveawayAnnouncement(channel, giveaway, entryCount, { pingEveryone = true } = {}) {
  return channel.send({
    content: pingEveryone ? '@everyone' : null,
    embeds: [buildGiveawayEmbed(giveaway, entryCount)],
    components: [buildEntryRow(giveaway.id, giveaway.status !== 'ACTIVE')],
    allowedMentions: pingEveryone ? { parse: ['everyone'] } : { parse: [] },
  });
}

async function disablePreviousGiveawayPost(client, giveaway) {
  if (!giveaway.messageId) return;

  const channel = await fetchTextChannel(client, giveaway.channelId);
  if (!channel) return;

  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!message) return;

  await message.edit({
    components: [buildEntryRow(giveaway.id, true)],
    content: message.content
      ? `${message.content}\n\n_Reposted — enter on the latest message below._`
      : '_Reposted — enter on the latest message below._',
  }).catch(() => {});
}

async function refreshGiveawayMessage(client, prisma, giveawayId) {
  const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
  if (!giveaway?.messageId) return;

  const [entryCount, channel] = await Promise.all([
    prisma.giveawayEntry.count({ where: { giveawayId } }),
    fetchTextChannel(client, giveaway.channelId),
  ]);
  if (!channel) return;

  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!message) return;

  await message.edit({
    embeds: [buildGiveawayEmbed(giveaway, entryCount)],
    components: [buildEntryRow(giveaway.id, giveaway.status !== 'ACTIVE')],
  }).catch(() => {});
}

function buildStatusEmbed(giveaway, winners) {
  const pendingCount = winners.filter((winner) => winner.status === 'PENDING').length;
  const claimedCount = winners.filter((winner) => winner.status === 'CLAIMED').length;
  const lines = winners
    .sort((a, b) => {
      if (a.prizeIndex !== b.prizeIndex) return a.prizeIndex - b.prizeIndex;
      return new Date(a.selectedAt).getTime() - new Date(b.selectedAt).getTime();
    })
    .map((winner) => {
      if (winner.status === 'CLAIMED') {
        return `<@${winner.discordId}> - claimed <t:${unixTime(winner.claimedAt)}:R>`;
      }
      if (winner.status === 'REROLLED') {
        return `<@${winner.discordId}> - did not claim; rerolled`;
      }
      const dmNote = winner.dmMessageId ? '' : ' (DM may be closed)';
      return `<@${winner.discordId}> - not claimed yet${dmNote}`;
    });

  const description = pendingCount > 0
    ? `Claim deadline: <t:${unixTime(giveaway.claimDeadlineAt)}:R>`
    : 'All available claims are resolved.';

  return new EmbedBuilder()
    .setTitle('Giveaway claim status')
    .setColor(pendingCount > 0 ? 0xf59e0b : 0x10b981)
    .setDescription(description)
    .addFields(
      { name: 'Prize', value: `**${truncate(getGiveawayPrizeLabel(giveaway), 300)}**`, inline: false },
      { name: 'Claimed', value: `\`${claimedCount}\``, inline: true },
      { name: 'Waiting', value: `\`${pendingCount}\``, inline: true },
      { name: 'Winners', value: truncate(lines.join('\n'), 1024), inline: false }
    )
    .setTimestamp();
}

async function refreshStatusMessage(client, prisma, giveawayId) {
  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    include: { winners: true },
  });
  if (!giveaway) return;

  const channel = await fetchTextChannel(client, giveaway.channelId);
  if (!channel) return;

  const payload = {
    embeds: [buildStatusEmbed(giveaway, giveaway.winners)],
    allowedMentions: { users: giveaway.winners.map((winner) => winner.discordId) },
  };

  if (giveaway.statusMessageId) {
    const statusMessage = await channel.messages.fetch(giveaway.statusMessageId).catch(() => null);
    if (statusMessage) {
      await statusMessage.edit(payload).catch(() => {});
      return;
    }
  }

  const original = giveaway.messageId
    ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
    : null;
  const sent = original
    ? await original.reply(payload).catch(() => null)
    : await channel.send(payload).catch(() => null);

  if (sent) {
    await prisma.giveaway.update({
      where: { id: giveaway.id },
      data: { statusMessageId: sent.id },
    }).catch(() => {});
  }
}

async function sendWinnerDm(client, prisma, giveaway, winner) {
  const result = {
    ok: false,
    reason: null,
    dmMessageId: null,
  };

  const user = await client.users.fetch(winner.discordId).catch((err) => {
    result.reason = `USER_FETCH_FAILED: ${err?.message || 'unknown'}`;
    return null;
  });
  if (!user) {
    if (!result.reason) result.reason = 'USER_NOT_FOUND';
    await logGiveawayDmDeliveryIssue(prisma, giveaway, winner, result.reason, { stage: 'fetch_user' });
    return result;
  }

  const embed = new EmbedBuilder()
    .setTitle('You won a giveaway')
    .setColor(0x10b981)
    .setDescription(
      `You won **${truncate(getGiveawayPrizeLabel(giveaway), 300)}**.\n\n` +
      `Click the button below to claim within 12 hours.`
    )
    .addFields({ name: 'Claim deadline', value: `<t:${unixTime(giveaway.claimDeadlineAt)}:F>` });

  const message = await user.send({
    embeds: [embed],
    components: [buildClaimRow(winner.id)],
  }).catch((err) => {
    result.reason = `DM_SEND_FAILED: ${err?.message || 'unknown'}`;
    return null;
  });

  if (!message) {
    if (!result.reason) result.reason = 'DM_SEND_FAILED';
    await logGiveawayDmDeliveryIssue(prisma, giveaway, winner, result.reason, { stage: 'send_dm' });
    return result;
  }

  await prisma.giveawayWinner.update({
    where: { id: winner.id },
    data: { dmMessageId: message.id },
  }).catch((err) => {
    console.warn('[Giveaway] failed to store dmMessageId:', winner.id, err?.message || err);
  });

  result.ok = true;
  result.dmMessageId = message.id;
  return result;
}

async function logGiveawayDmDeliveryIssue(prisma, giveaway, winner, reason, meta = {}) {
  const payload = {
    giveawayId: giveaway.id,
    winnerId: winner.id,
    discordId: winner.discordId,
    username: winner.username || null,
    reason,
    ...meta,
  };
  console.error('[Giveaway] DM delivery issue:', JSON.stringify(payload));

  if (!giveaway.createdByUserId) return;

  await prisma.auditLog.create({
    data: {
      userId: giveaway.createdByUserId,
      action: 'GIVEAWAY_DM_DELIVERY_ISSUE',
      targetId: winner.id,
      details: payload,
      ip: 'DiscordBot',
    },
  }).catch((err) => console.warn('[Giveaway] audit log failed:', err?.message || err));
}

async function winnerDmNeedsResend(client, winner) {
  if (!winner.dmMessageId) return true;

  try {
    const user = await client.users.fetch(winner.discordId);
    const dmChannel = user.dmChannel || await user.createDM();
    await dmChannel.messages.fetch(winner.dmMessageId);
    return false;
  } catch {
    return true;
  }
}

async function announceChannelMessage(client, giveaway, content) {
  const channel = await fetchTextChannel(client, giveaway.channelId);
  if (!channel) return;

  const original = giveaway.messageId
    ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
    : null;
  const payload = {
    content,
    allowedMentions: { parse: ['users'] },
  };

  if (original) {
    await original.reply(payload).catch(() => {});
  } else {
    await channel.send(payload).catch(() => {});
  }
}

async function createGiveawayFromPayload(interaction, prisma, client, payload) {
  const validationError = validateGiveawayPayload(payload);
  if (validationError) {
    return interaction.editReply({ content: `Could not create giveaway: ${validationError}`, components: [] });
  }

  const creator = await getPlatformUser(prisma, interaction.user.id);
  const now = new Date();
  const endsAt = new Date(now.getTime() + payload.durationMs);

  const giveaway = await prisma.giveaway.create({
    data: {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      createdByDiscordId: interaction.user.id,
      createdByUserId: creator?.id || null,
      prize: payload.prize,
      description: payload.description || null,
      prizeType: payload.prizeType,
      plan: payload.plan || null,
      planDurationDays: payload.prizeType === 'PLAN' ? (payload.planDurationDays || DEFAULT_PLAN_DURATION_DAYS) : null,
      winnerCount: payload.winnerCount,
      rewardText: payload.rewardText || null,
      separatePrizes: Boolean(payload.separatePrizes),
      endsAt,
      claimWindowHours: CLAIM_WINDOW_HOURS,
    },
  });

  const channel = interaction.channel || await fetchTextChannel(client, interaction.channelId);
  if (!channel || !channel.isTextBased()) {
    await prisma.giveaway.update({ where: { id: giveaway.id }, data: { status: 'CANCELLED' } }).catch(() => {});
    return interaction.editReply({ content: 'Could not create giveaway: this channel is not text-based.', components: [] });
  }

  const sent = await sendGiveawayAnnouncement(channel, giveaway, 0);

  await prisma.giveaway.update({
    where: { id: giveaway.id },
    data: { messageId: sent.id },
  });

  return interaction.editReply({
    content: `Giveaway created: ${messageUrl(giveaway.guildId, giveaway.channelId, sent.id)}`,
    components: [],
  });
}

async function handleGiveawayCommand(interaction, prisma, client) {
  if (!(await ensureGuild(interaction))) return;

  const sub = interaction.options.getSubcommand(false) || 'create';

  if (sub === 'create') {
    return handleGiveawayCreate(interaction, prisma, client);
  }

  if (!(await canManageGiveaways(prisma, interaction))) {
    return replyOwnerOnly(interaction);
  }

  switch (sub) {
    case 'list':
      return handleGiveawayList(interaction, prisma);
    case 'info':
      return handleGiveawayInfo(interaction, prisma);
    case 'entries':
      return handleGiveawayEntries(interaction, prisma);
    case 'end':
      return handleGiveawayEnd(interaction, prisma, client);
    case 'cancel':
      return handleGiveawayCancel(interaction, prisma, client);
    case 'reroll':
      return handleGiveawayReroll(interaction, prisma, client);
    case 'repost':
      return handleGiveawayRepost(interaction, prisma, client);
    case 'dmresend':
      return handleGiveawayDmResend(interaction, prisma, client);
    default:
      return interaction.reply({ content: 'Unknown giveaway subcommand.', ephemeral: true });
  }
}

async function handleGiveawayCreate(interaction, prisma, client) {
  if (!(await canManageGiveaways(prisma, interaction))) {
    return replyOwnerOnly(interaction);
  }

  const prize = String(interaction.options.getString('prize') || '').trim();
  const durationInput = interaction.options.getString('duration');
  const winnerCount = interaction.options.getInteger('winners') || 1;
  const description = String(interaction.options.getString('description') || '').trim();
  const rewardText = String(interaction.options.getString('reward') || '').trim();
  const separatePrizes = Boolean(interaction.options.getBoolean('separate_prizes') || false);
  const planDurationInput = interaction.options.getString('plan_duration');

  if (separatePrizes && !rewardText) {
    return interaction.reply({
      content: 'When **separate_prizes** is enabled, fill in **reward** with one prize per line (line 1 = winner 1, line 2 = winner 2, etc.).',
      ephemeral: true,
    });
  }

  const parsedDuration = parseDurationMs(durationInput);
  if (!parsedDuration.ok) {
    return interaction.reply({ content: parsedDuration.error, ephemeral: true });
  }

  const parsedPlanDuration = parsePlanDurationDays(planDurationInput);
  if (!parsedPlanDuration.ok) {
    return interaction.reply({ content: parsedPlanDuration.error, ephemeral: true });
  }

  const payload = {
    prize,
    description: description || null,
    durationMs: parsedDuration.ms,
    winnerCount,
    rewardText: rewardText || prize,
    separatePrizes,
    prizeType: 'CUSTOM',
    plan: null,
    planDurationDays: parsedPlanDuration.days,
  };

  const detectedPlan = detectOpenSteamPlanFromPrize(prize);
  if (detectedPlan) {
    const planDurationLabel = formatPlanDuration(parsedPlanDuration.days);
    const confirmId = crypto.randomBytes(8).toString('hex');
    pendingConfirmations.set(confirmId, {
      authorId: interaction.user.id,
      createdAt: Date.now(),
      payload: {
        ...payload,
        prizeType: 'PLAN',
        plan: detectedPlan,
        rewardText: null,
        separatePrizes: false,
        planDurationDays: parsedPlanDuration.days,
      },
      customPayload: payload,
    });
    setTimeout(() => pendingConfirmations.delete(confirmId), 10 * 60 * 1000);

    return interaction.reply({
      content:
        `I detected **${detectedPlan}** in the prize. Do you want this to be a OpenSteam plan giveaway?\n` +
        `If yes, winners will be upgraded for **${planDurationLabel}** when they claim. If no, it will be treated as a regular prize.`,
      components: buildConfirmRows(confirmId),
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  return createGiveawayFromPayload(interaction, prisma, client, payload);
}

async function handleGiveawayList(interaction, prisma) {
  await interaction.deferReply({ ephemeral: true });

  const giveaways = await prisma.giveaway.findMany({
    where: {
      guildId: interaction.guildId,
      status: { in: ['ACTIVE', 'ENDED', 'ENDING', 'REROLLING'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { _count: { select: { entries: true, winners: true } } },
  });

  if (giveaways.length === 0) {
    return interaction.editReply('No active or claim-pending giveaways in this server.');
  }

  const lines = giveaways.map((gw) => {
    const link = gw.messageId
      ? messageUrl(gw.guildId, gw.channelId, gw.messageId)
      : 'no message';
    return (
      `**\`${shortGiveawayId(gw.id)}\`** · ${statusLabel(gw.status)} · ` +
      `${truncate(getGiveawayPrizeLabel(gw), 60)} · ` +
      `${gw._count.entries} entries · <t:${unixTime(gw.endsAt)}:R> · ${link}`
    );
  });

  const embed = new EmbedBuilder()
    .setTitle('Server giveaways')
    .setColor(0x6366f1)
    .setDescription(truncate(lines.join('\n'), 4000))
    .setFooter({ text: 'Use /giveaway info, repost, or dmresend giveaway_id:<short id>.' });

  return interaction.editReply({ embeds: [embed] });
}

async function handleGiveawayInfo(interaction, prisma) {
  await interaction.deferReply({ ephemeral: true });

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    messageId: interaction.options.getString('message_id'),
    giveawayId: interaction.options.getString('giveaway_id'),
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found. Provide a message link/ID or run this in the giveaway channel.');
  }

  const [entryCount, winners, pendingCount, claimedCount] = await Promise.all([
    prisma.giveawayEntry.count({ where: { giveawayId: giveaway.id } }),
    prisma.giveawayWinner.findMany({ where: { giveawayId: giveaway.id }, orderBy: { prizeIndex: 'asc' } }),
    prisma.giveawayWinner.count({ where: { giveawayId: giveaway.id, status: 'PENDING' } }),
    prisma.giveawayWinner.count({ where: { giveawayId: giveaway.id, status: 'CLAIMED' } }),
  ]);

  const embed = new EmbedBuilder()
    .setTitle('Giveaway info')
    .setColor(0x6366f1)
    .addFields(
      { name: 'ID', value: `\`${giveaway.id}\``, inline: false },
      { name: 'Prize', value: `**${truncate(getGiveawayPrizeLabel(giveaway), 300)}**`, inline: false },
    );

  if (giveaway.description) {
    embed.addFields({ name: 'Description', value: truncate(giveaway.description, 500), inline: false });
  }

  embed.addFields(
      { name: 'Status', value: statusLabel(giveaway.status), inline: true },
      { name: 'Entries', value: `\`${entryCount}\``, inline: true },
      { name: 'Winner slots', value: `\`${giveaway.winnerCount}\``, inline: true },
      { name: 'Claimed', value: `\`${claimedCount}\``, inline: true },
      { name: 'Waiting to claim', value: `\`${pendingCount}\``, inline: true },
      {
        name: 'Ends / ended',
        value: giveaway.endedAt
          ? `<t:${unixTime(giveaway.endedAt)}:F>`
          : `<t:${unixTime(giveaway.endsAt)}:F>`,
        inline: true,
      },
    );

  if (giveaway.messageId) {
    embed.addFields({
      name: 'Message',
      value: messageUrl(giveaway.guildId, giveaway.channelId, giveaway.messageId),
      inline: false,
    });
  }

  if (winners.length > 0) {
    embed.addFields({
      name: 'Winners',
      value: truncate(
        winners.map((w) => {
          if (w.status === 'CLAIMED') return `<@${w.discordId}> — claimed`;
          if (w.status === 'REROLLED') return `<@${w.discordId}> — rerolled (no claim)`;
          return `<@${w.discordId}> — waiting`;
        }).join('\n'),
        1024
      ),
      inline: false,
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handleGiveawayEntries(interaction, prisma) {
  await interaction.deferReply({ ephemeral: true });

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    messageId: interaction.options.getString('message_id'),
    giveawayId: interaction.options.getString('giveaway_id'),
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found.');
  }

  const entries = await prisma.giveawayEntry.findMany({
    where: { giveawayId: giveaway.id },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  if (entries.length === 0) {
    return interaction.editReply(`No entries yet for **${truncate(getGiveawayPrizeLabel(giveaway), 80)}**.`);
  }

  const lines = entries.map((e, i) => `${i + 1}. <@${e.discordId}> (\`${e.username}\`)`);
  const total = await prisma.giveawayEntry.count({ where: { giveawayId: giveaway.id } });
  const more = total > entries.length ? `\n… and ${total - entries.length} more.` : '';

  return interaction.editReply({
    content: `**Entries for ${truncate(getGiveawayPrizeLabel(giveaway), 80)}** (\`${total}\` total)\n\n${lines.join('\n')}${more}`,
    allowedMentions: { users: entries.map((e) => e.discordId) },
  });
}

async function handleGiveawayEnd(interaction, prisma, client) {
  await interaction.deferReply({ ephemeral: true });

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    messageId: interaction.options.getString('message_id'),
    giveawayId: interaction.options.getString('giveaway_id'),
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found.');
  }
  if (giveaway.status !== 'ACTIVE') {
    return interaction.editReply(`That giveaway is **${statusLabel(giveaway.status)}** and cannot be ended early.`);
  }

  await endGiveaway(client, prisma, giveaway.id);
  return interaction.editReply(
    `Giveaway **${truncate(getGiveawayPrizeLabel(giveaway), 80)}** ended early. Winners were drawn and DMed to claim.`
  );
}

async function cancelGiveaway(client, prisma, giveawayId) {
  const locked = await prisma.giveaway.updateMany({
    where: { id: giveawayId, status: 'ACTIVE' },
    data: { status: 'CANCELLED', endedAt: new Date() },
  });
  if (locked.count === 0) return false;

  await refreshGiveawayMessage(client, prisma, giveawayId);
  const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });
  if (giveaway) {
    await announceChannelMessage(client, giveaway, `Giveaway for **${truncate(getGiveawayPrizeLabel(giveaway), 120)}** was cancelled by the host.`);
  }
  return true;
}

async function handleGiveawayCancel(interaction, prisma, client) {
  await interaction.deferReply({ ephemeral: true });

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    messageId: interaction.options.getString('message_id'),
    giveawayId: interaction.options.getString('giveaway_id'),
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found.');
  }
  if (giveaway.status !== 'ACTIVE') {
    return interaction.editReply(`That giveaway is already **${statusLabel(giveaway.status)}**.`);
  }

  const ok = await cancelGiveaway(client, prisma, giveaway.id);
  if (!ok) {
    return interaction.editReply('Could not cancel that giveaway.');
  }

  return interaction.editReply(`Cancelled giveaway **${truncate(getGiveawayPrizeLabel(giveaway), 80)}**.`);
}

async function handleGiveawayReroll(interaction, prisma, client) {
  await interaction.deferReply({ ephemeral: true });

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    messageId: interaction.options.getString('message_id'),
    giveawayId: interaction.options.getString('giveaway_id'),
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found.');
  }
  if (!['ENDED', 'REROLLING'].includes(giveaway.status)) {
    return interaction.editReply('Reroll only works on ended giveaways with unclaimed prizes.');
  }

  const pending = await prisma.giveawayWinner.count({
    where: { giveawayId: giveaway.id, status: 'PENDING' },
  });
  if (pending === 0) {
    return interaction.editReply('No unclaimed winner slots to reroll.');
  }

  await rerollExpiredGiveaway(client, prisma, giveaway.id);
  return interaction.editReply(`Rerolled **${pending}** unclaimed slot(s) for **${truncate(getGiveawayPrizeLabel(giveaway), 80)}**.`);
}

async function handleGiveawayRepost(interaction, prisma, client) {
  await interaction.deferReply({ ephemeral: true });

  const giveawayId = interaction.options.getString('giveaway_id');
  const pingEveryone = interaction.options.getBoolean('ping_everyone') ?? true;

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    giveawayId,
    strict: true,
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found for that ID. Use `/giveaway list` to copy the short ID.');
  }
  if (giveaway.status !== 'ACTIVE') {
    return interaction.editReply(`Only **active** giveaways can be reposted. This one is **${statusLabel(giveaway.status)}**.`);
  }
  if (new Date(giveaway.endsAt).getTime() <= Date.now()) {
    return interaction.editReply('This giveaway has already passed its end time.');
  }

  const channel = interaction.channel || await fetchTextChannel(client, interaction.channelId);
  if (!channel || !channel.isTextBased()) {
    return interaction.editReply('Repost only works in a text channel.');
  }

  const entryCount = await prisma.giveawayEntry.count({ where: { giveawayId: giveaway.id } });
  await disablePreviousGiveawayPost(client, giveaway);

  const sent = await sendGiveawayAnnouncement(channel, giveaway, entryCount, { pingEveryone });
  await prisma.giveaway.update({
    where: { id: giveaway.id },
    data: {
      channelId: channel.id,
      messageId: sent.id,
    },
  });

  return interaction.editReply(
    `Reposted **${truncate(getGiveawayPrizeLabel(giveaway), 80)}**: ${messageUrl(giveaway.guildId, channel.id, sent.id)}` +
    (pingEveryone ? ' (`@everyone` pinged)' : '')
  );
}

async function handleGiveawayDmResend(interaction, prisma, client) {
  await interaction.deferReply({ ephemeral: true });

  const giveawayId = interaction.options.getString('giveaway_id');
  const force = interaction.options.getBoolean('force') ?? false;

  const giveaway = await resolveGiveawayReference(prisma, interaction, {
    messageId: interaction.options.getString('message_id'),
    giveawayId,
    strict: Boolean(giveawayId),
  });

  if (!giveaway) {
    return interaction.editReply('No giveaway found. Provide a message link/ID or **giveaway_id** from `/giveaway list`.');
  }

  if (!['ENDED', 'REROLLING'].includes(giveaway.status)) {
    return interaction.editReply(
      `DM resend only works on ended giveaways waiting for claims. This one is **${statusLabel(giveaway.status)}**.`
    );
  }

  if (!giveaway.claimDeadlineAt || new Date(giveaway.claimDeadlineAt) <= new Date()) {
    return interaction.editReply('The claim deadline has passed. Use `/giveaway reroll` if prizes are still unclaimed.');
  }

  const winners = await prisma.giveawayWinner.findMany({
    where: { giveawayId: giveaway.id, status: 'PENDING' },
    orderBy: { prizeIndex: 'asc' },
  });

  if (winners.length === 0) {
    return interaction.editReply('No pending winners need claim DMs for this giveaway.');
  }

  let sent = 0;
  let skipped = 0;
  const failed = [];

  for (const winner of winners) {
    if (!force) {
      const needsResend = await winnerDmNeedsResend(client, winner);
      if (!needsResend) {
        skipped += 1;
        continue;
      }
    }

    const delivery = await sendWinnerDm(client, prisma, giveaway, winner);
    if (delivery.ok) {
      sent += 1;
    } else {
      failed.push({
        discordId: winner.discordId,
        username: winner.username,
        reason: delivery.reason || 'UNKNOWN',
      });
    }
  }

  await refreshStatusMessage(client, prisma, giveaway.id);

  const operator = await getPlatformUser(prisma, interaction.user.id);
  if (operator) {
    await prisma.auditLog.create({
      data: {
        userId: operator.id,
        action: 'GIVEAWAY_DM_RESEND',
        targetId: giveaway.id,
        details: {
          giveawayId: giveaway.id,
          force,
          sent,
          skipped,
          failed,
        },
        ip: 'DiscordBot',
      },
    }).catch((err) => console.warn('[Giveaway] dmresend audit log failed:', err?.message || err));
  }

  let reply =
    `DM resend for **${truncate(getGiveawayPrizeLabel(giveaway), 80)}**:\n` +
    `Sent: **${sent}** · Skipped (DM still OK): **${skipped}** · Failed: **${failed.length}**`;

  if (failed.length > 0) {
    const lines = failed.map(
      (entry) => `<@${entry.discordId}> — \`${truncate(entry.reason, 120)}\``
    );
    reply += `\n\n**Delivery issues:**\n${truncate(lines.join('\n'), 1500)}`;
    console.error('[Giveaway] dmresend failures:', JSON.stringify({ giveawayId: giveaway.id, failed }));
  }

  return interaction.editReply({
    content: reply,
    allowedMentions: { users: failed.map((entry) => entry.discordId) },
  });
}

async function handleConfirmationButton(interaction, prisma, client, customId) {
  const isPlan = customId.startsWith(CONFIRM_PLAN_PREFIX);
  const confirmId = customId.replace(isPlan ? CONFIRM_PLAN_PREFIX : CONFIRM_CUSTOM_PREFIX, '');
  const pending = pendingConfirmations.get(confirmId);

  if (!pending) {
    return interaction.reply({ content: 'This giveaway confirmation expired. Run `/giveaway create` again.', ephemeral: true });
  }
  if (pending.authorId !== interaction.user.id) {
    return interaction.reply({ content: 'Only the person who created this giveaway can confirm it.', ephemeral: true });
  }

  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    pendingConfirmations.delete(confirmId);
    return interaction.reply({ content: 'This giveaway confirmation expired. Run `/giveaway create` again.', ephemeral: true });
  }

  await interaction.deferUpdate();
  pendingConfirmations.delete(confirmId);
  return createGiveawayFromPayload(
    interaction,
    prisma,
    client,
    isPlan ? pending.payload : pending.customPayload
  );
}

async function handleEnterButton(interaction, prisma, client, customId) {
  const giveawayId = customId.replace(ENTER_PREFIX, '');
  const giveaway = await prisma.giveaway.findUnique({ where: { id: giveawayId } });

  if (!giveaway) {
    return interaction.reply({ content: 'This giveaway no longer exists.', ephemeral: true });
  }
  if (giveaway.status !== 'ACTIVE' || new Date(giveaway.endsAt).getTime() <= Date.now()) {
    if (giveaway.status === 'CANCELLED') {
      return interaction.reply({ content: 'This giveaway was cancelled.', ephemeral: true });
    }
    return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
  }

  try {
    await prisma.giveawayEntry.create({
      data: {
        giveawayId: giveaway.id,
        discordId: interaction.user.id,
        username: interaction.user.username || interaction.user.tag || interaction.user.id,
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      return interaction.reply({ content: 'You are already entered in this giveaway.', ephemeral: true });
    }
    console.error('[Giveaway] entry error:', err);
    return interaction.reply({ content: 'Could not enter this giveaway right now.', ephemeral: true });
  }

  await refreshGiveawayMessage(client, prisma, giveaway.id);
  const isBooster = memberHasBoosterRole(interaction.member);
  return interaction.reply({
    content: isBooster
      ? 'You entered the giveaway. Server boosters get **2×** win chance.'
      : 'You entered the giveaway.',
    ephemeral: true,
  });
}

function hostedBotTypeForPlan(plan) {
  if (['REGULAR', 'PREMIUM'].includes(plan)) return 'BRANDED';
  if (['RESELLER', 'BUSINESS'].includes(plan)) return 'CUSTOM';
  return null;
}

async function upsertHostedBotInstance(tx, userId, plan) {
  const type = hostedBotTypeForPlan(plan);
  if (!type) return;

  const existing = await tx.hostedBotInstance.findUnique({ where: { userId } });
  if (!existing) {
    await tx.hostedBotInstance.create({
      data: { userId, type, status: 'PENDING' },
    });
    return;
  }

  const data = { type };
  if (existing.type !== type) {
    data.guildId = null;
    data.status = 'PENDING';
    data.inviteUrl = null;
    data.botClientId = null;
    data.botTokenEnc = null;
    data.botSecretEnc = null;
  } else if (existing.status === 'SUSPENDED' && !existing.lockedByOwner) {
    data.status = existing.guildId ? 'ACTIVE' : existing.botClientId ? 'SETUP' : 'PENDING';
  }

  await tx.hostedBotInstance.update({ where: { userId }, data });
}

async function claimPlanPrize(tx, discordUser, winner, giveaway) {
  const now = new Date();
  const dbUser = await tx.user.upsert({
    where: { discordId: discordUser.id },
    update: {
      username: discordUser.username || discordUser.tag || discordUser.id,
      discriminator: discordUser.discriminator || '0000',
      avatar: discordUser.avatar || null,
    },
    create: {
      discordId: discordUser.id,
      username: discordUser.username || discordUser.tag || discordUser.id,
      discriminator: discordUser.discriminator || '0000',
      avatar: discordUser.avatar || null,
    },
  });

  const plan = giveaway.plan;
  const grantDays = giveaway.planDurationDays || DEFAULT_PLAN_DURATION_DAYS;
  let expiry = new Date(now);
  if (dbUser.plan === plan && dbUser.planExpiry && new Date(dbUser.planExpiry) > now) {
    expiry = new Date(dbUser.planExpiry);
  }
  expiry.setDate(expiry.getDate() + grantDays);

  await tx.user.update({
    where: { id: dbUser.id },
    data: {
      plan,
      planExpiry: expiry,
      planIsCanceled: false,
    },
  });

  await upsertHostedBotInstance(tx, dbUser.id, plan);

  if (giveaway.createdByUserId) {
    await tx.auditLog.create({
      data: {
        userId: giveaway.createdByUserId,
        action: 'GIVEAWAY_PLAN_CLAIM',
        targetId: dbUser.id,
        details: `Giveaway ${giveaway.id}: ${discordUser.id} claimed ${plan}`,
        ip: 'DiscordBot',
      },
    }).catch(() => {});
  }

  return { dbUser, expiry };
}

async function handleClaimButton(interaction, prisma, client, customId) {
  const winnerId = customId.replace(CLAIM_PREFIX, '');
  const now = new Date();

  const winner = await prisma.giveawayWinner.findUnique({
    where: { id: winnerId },
    include: { giveaway: true },
  });

  if (!winner) {
    return interaction.reply({ content: 'This claim no longer exists.', ephemeral: interaction.inGuild() });
  }
  if (winner.discordId !== interaction.user.id) {
    return interaction.reply({ content: 'This claim button is not for you.', ephemeral: interaction.inGuild() });
  }
  if (winner.status === 'CLAIMED') {
    return interaction.reply({ content: 'You already claimed this prize.', ephemeral: interaction.inGuild() });
  }
  if (winner.status === 'REROLLED') {
    return interaction.reply({ content: 'This claim expired and was rerolled.', ephemeral: interaction.inGuild() });
  }
  if (winner.giveaway.claimDeadlineAt && new Date(winner.giveaway.claimDeadlineAt) <= now) {
    return interaction.reply({
      content: 'This claim window has expired. The giveaway will reroll this slot automatically.',
      ephemeral: interaction.inGuild(),
    });
  }

  await interaction.deferReply({ ephemeral: interaction.inGuild() });

  let claimResult = null;
  const updated = await prisma.$transaction(async (tx) => {
    const freshWinner = await tx.giveawayWinner.findUnique({
      where: { id: winnerId },
      include: { giveaway: true },
    });
    if (!freshWinner || freshWinner.status !== 'PENDING') return false;

    if (freshWinner.giveaway.prizeType === 'PLAN') {
      claimResult = await claimPlanPrize(tx, interaction.user, freshWinner, freshWinner.giveaway);
    }

    await tx.giveawayWinner.update({
      where: { id: freshWinner.id },
      data: { status: 'CLAIMED', claimedAt: now },
    });
    return true;
  });

  if (!updated) {
    return interaction.editReply('This prize was already claimed or rerolled.');
  }

  await interaction.message.edit({ components: [buildClaimRow(winner.id, true)] }).catch(() => {});

  const prizeText = winner.prizeText || getPrizeTextForIndex(winner.giveaway, winner.prizeIndex);
  if (winner.giveaway.prizeType === 'PLAN') {
    const days = winner.giveaway.planDurationDays || DEFAULT_PLAN_DURATION_DAYS;
    await interaction.editReply(
      `Claimed. Your OpenSteam account was upgraded to **${winner.giveaway.plan}** for **${formatPlanDuration(days)}** (until <t:${unixTime(claimResult.expiry)}:D>).`
    );
  } else {
    await interaction.editReply(`Claimed. Your prize:\n\n${truncate(prizeText, 1800)}`);
  }

  const pendingCount = await prisma.giveawayWinner.count({
    where: { giveawayId: winner.giveawayId, status: 'PENDING' },
  });
  if (pendingCount === 0) {
    await prisma.giveaway.update({
      where: { id: winner.giveawayId },
      data: { status: 'COMPLETE' },
    }).catch(() => {});
  }

  await announceChannelMessage(
    client,
    winner.giveaway,
    `<@${interaction.user.id}> claimed their prize from **${truncate(getGiveawayPrizeLabel(winner.giveaway), 120)}**.`
  );
  await refreshStatusMessage(client, prisma, winner.giveawayId);
}

async function handleGiveawayButton(interaction, prisma, client) {
  if (!interaction.isButton()) return false;
  const { customId } = interaction;

  if (customId.startsWith(CONFIRM_PLAN_PREFIX) || customId.startsWith(CONFIRM_CUSTOM_PREFIX)) {
    await handleConfirmationButton(interaction, prisma, client, customId);
    return true;
  }
  if (customId.startsWith(ENTER_PREFIX)) {
    await handleEnterButton(interaction, prisma, client, customId);
    return true;
  }
  if (customId.startsWith(CLAIM_PREFIX)) {
    await handleClaimButton(interaction, prisma, client, customId);
    return true;
  }
  return false;
}

async function endGiveaway(client, prisma, giveawayId) {
  const locked = await prisma.giveaway.updateMany({
    where: { id: giveawayId, status: 'ACTIVE' },
    data: { status: 'ENDING' },
  });
  if (locked.count === 0) return;

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    include: { entries: true },
  });
  if (!giveaway) return;

  const now = new Date();
  const claimDeadlineAt = new Date(now.getTime() + giveaway.claimWindowHours * 60 * 60 * 1000);
  const selectedEntries = await pickGiveawayWinners(
    client,
    giveaway,
    giveaway.entries,
    Math.min(giveaway.winnerCount, giveaway.entries.length)
  );

  if (selectedEntries.length === 0) {
    const completed = await prisma.giveaway.update({
      where: { id: giveaway.id },
      data: { status: 'COMPLETE', endedAt: now },
    });
    await refreshGiveawayMessage(client, prisma, giveaway.id);
    await announceChannelMessage(client, completed, `Giveaway ended for **${truncate(getGiveawayPrizeLabel(giveaway), 120)}**. No valid entries were found.`);
    return;
  }

  const createdWinners = await prisma.$transaction(async (tx) => {
    const winners = [];
    for (let i = 0; i < selectedEntries.length; i += 1) {
      const entry = selectedEntries[i];
      const winner = await tx.giveawayWinner.create({
        data: {
          giveawayId: giveaway.id,
          discordId: entry.discordId,
          username: entry.username,
          prizeIndex: i,
          prizeText: getPrizeTextForIndex(giveaway, i),
          status: 'PENDING',
          selectedAt: now,
        },
      });
      winners.push(winner);
    }

    await tx.giveaway.update({
      where: { id: giveaway.id },
      data: {
        status: 'ENDED',
        endedAt: now,
        claimDeadlineAt,
      },
    });
    return winners;
  });

  const endedGiveaway = { ...giveaway, status: 'ENDED', endedAt: now, claimDeadlineAt };
  await refreshGiveawayMessage(client, prisma, giveaway.id);

  for (const winner of createdWinners) {
    await sendWinnerDm(client, prisma, endedGiveaway, winner);
  }

  const mentions = createdWinners.map((winner) => `<@${winner.discordId}>`).join(', ');
  await announceChannelMessage(
    client,
    endedGiveaway,
    `Giveaway ended for **${truncate(getGiveawayPrizeLabel(giveaway), 120)}**. Winner(s): ${mentions}. Check your DMs to claim within 12 hours.`
  );
  await refreshStatusMessage(client, prisma, giveaway.id);
}

async function processDueGiveaways(client, prisma) {
  const due = await prisma.giveaway.findMany({
    where: {
      status: 'ACTIVE',
      endsAt: { lte: new Date() },
    },
    select: { id: true },
    take: 10,
  });

  for (const giveaway of due) {
    try {
      await endGiveaway(client, prisma, giveaway.id);
    } catch (err) {
      console.error('[Giveaway] end error:', giveaway.id, err);
      await prisma.giveaway.updateMany({
        where: { id: giveaway.id, status: 'ENDING' },
        data: { status: 'ACTIVE' },
      }).catch(() => {});
    }
  }
}

async function rerollExpiredGiveaway(client, prisma, giveawayId) {
  const locked = await prisma.giveaway.updateMany({
    where: { id: giveawayId, status: 'ENDED' },
    data: { status: 'REROLLING' },
  });
  if (locked.count === 0) return;

  const giveaway = await prisma.giveaway.findUnique({
    where: { id: giveawayId },
    include: { entries: true, winners: true },
  });
  if (!giveaway) return;

  const now = new Date();
  const pending = giveaway.winners.filter((winner) => winner.status === 'PENDING');
  if (pending.length === 0) {
    await prisma.giveaway.update({ where: { id: giveaway.id }, data: { status: 'COMPLETE' } });
    return;
  }

  const excluded = new Set(giveaway.winners.map((winner) => winner.discordId));
  const eligibleEntries = giveaway.entries.filter((entry) => !excluded.has(entry.discordId));
  const replacements = await pickGiveawayWinners(client, giveaway, eligibleEntries, pending.length);
  const claimDeadlineAt = new Date(now.getTime() + giveaway.claimWindowHours * 60 * 60 * 1000);

  const newWinners = await prisma.$transaction(async (tx) => {
    await tx.giveawayWinner.updateMany({
      where: { giveawayId: giveaway.id, status: 'PENDING' },
      data: { status: 'REROLLED', rerolledAt: now },
    });

    const created = [];
    for (let i = 0; i < replacements.length; i += 1) {
      const entry = replacements[i];
      const oldSlot = pending[i];
      const winner = await tx.giveawayWinner.create({
        data: {
          giveawayId: giveaway.id,
          discordId: entry.discordId,
          username: entry.username,
          prizeIndex: oldSlot.prizeIndex,
          prizeText: oldSlot.prizeText || getPrizeTextForIndex(giveaway, oldSlot.prizeIndex),
          status: 'PENDING',
          selectedAt: now,
        },
      });
      created.push(winner);
    }

    await tx.giveaway.update({
      where: { id: giveaway.id },
      data: {
        status: created.length > 0 ? 'ENDED' : 'COMPLETE',
        claimDeadlineAt: created.length > 0 ? claimDeadlineAt : giveaway.claimDeadlineAt,
      },
    });

    return created;
  });

  const refreshedGiveaway = {
    ...giveaway,
    status: newWinners.length > 0 ? 'ENDED' : 'COMPLETE',
    claimDeadlineAt: newWinners.length > 0 ? claimDeadlineAt : giveaway.claimDeadlineAt,
  };

  if (newWinners.length === 0) {
    await announceChannelMessage(
      client,
      giveaway,
      `${pending.length} giveaway prize(s) were not claimed within 12 hours, but there are no eligible entries left to reroll.`
    );
    await refreshStatusMessage(client, prisma, giveaway.id);
    return;
  }

  for (const winner of newWinners) {
    await sendWinnerDm(client, prisma, refreshedGiveaway, winner);
  }

  const mentions = newWinners.map((winner) => `<@${winner.discordId}>`).join(', ');
  await announceChannelMessage(
    client,
    refreshedGiveaway,
    `${pending.length} giveaway prize(s) were not claimed within 12 hours. Rerolled winner(s): ${mentions}. Check your DMs to claim.`
  );
  await refreshStatusMessage(client, prisma, giveaway.id);
}

async function processExpiredGiveawayClaims(client, prisma) {
  const expired = await prisma.giveaway.findMany({
    where: {
      status: 'ENDED',
      claimDeadlineAt: { lte: new Date() },
      winners: { some: { status: 'PENDING' } },
    },
    select: { id: true },
    take: 10,
  });

  for (const giveaway of expired) {
    try {
      await rerollExpiredGiveaway(client, prisma, giveaway.id);
    } catch (err) {
      console.error('[Giveaway] reroll error:', giveaway.id, err);
      await prisma.giveaway.updateMany({
        where: { id: giveaway.id, status: 'REROLLING' },
        data: { status: 'ENDED' },
      }).catch(() => {});
    }
  }
}

async function processGiveawayTimers(client, prisma) {
  await processDueGiveaways(client, prisma);
  await processExpiredGiveawayClaims(client, prisma);
}

module.exports = {
  GIVEAWAY_COMMAND,
  handleGiveawayCommand,
  handleGiveawayButton,
  processGiveawayTimers,
  parseDurationMs,
  parsePlanDurationDays,
  formatPlanDuration,
  detectOpenSteamPlanFromPrize,
};
