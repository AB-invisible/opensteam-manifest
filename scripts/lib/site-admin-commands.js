const { writeSiteSettings, readSiteSettings } = require('./site-settings');
const { CONFIG_KEY } = require('./sync-community-invites');

const ADD_COMMAND = {
  name: 'add',
  description: 'Owner utilities for OpenSteam site configuration',
  options: [
    {
      name: 'discord-link',
      description: 'Set the Discord invite shown on the OpenSteam website',
      type: 1,
      options: [
        {
          name: 'url',
          description: 'Invite URL or code (e.g. https://discord.gg/abc or abc)',
          type: 3,
          required: true,
          max_length: 200,
        },
      ],
    },
  ],
};

const SET_COMMAND = {
  name: 'set',
  description: 'Owner channel configuration for OpenSteam bot',
  options: [
    {
      name: 'upload-channel',
      description: 'Set the channel where admins upload manifest zip files to the database',
      type: 1,
      options: [
        {
          name: 'channel',
          description: 'Channel for manifest zip uploads (e.g. 730.zip)',
          type: 7,
          required: true,
        },
      ],
    },
    {
      name: 'added-games-channel',
      description: 'Set the channel where new game announcements are posted',
      type: 1,
      options: [
        {
          name: 'channel',
          description: 'Public channel for “game added” embed announcements',
          type: 7,
          required: true,
        },
      ],
    },
    {
      name: 'verify-channel',
      description: 'Set the channel where the Discord verification panel is posted',
      type: 1,
      options: [
        {
          name: 'channel',
          description: 'Channel for the OpenSteam verify / sign-in panel',
          type: 7,
          required: true,
        },
      ],
    },
  ],
};

const MANIFEST_UPLOAD_CHANNEL_KEY = 'DISCORD_MANIFEST_UPLOAD_CHANNEL_ID';
const ADDED_GAMES_CHANNEL_KEY = 'DISCORD_ADDED_GAMES_CHANNEL_ID';
const VERIFY_CHANNEL_KEY = 'DISCORD_VERIFY_CHANNEL_ID';

function isPlatformOwner(user) {
  return Boolean(user && user.role === 'OWNER');
}

function isPlatformAdmin(user) {
  return Boolean(user && (user.role === 'OWNER' || user.role === 'ADMIN'));
}

function normalizeDiscordInviteUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  if (/^https:\/\/discord\.(gg|com\/invite)\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  if (/^discord\.(gg|com\/invite)\//i.test(trimmed)) {
    return `https://${trimmed.replace(/\/+$/, '')}`;
  }

  const code = trimmed.replace(/^https?:\/\//i, '').replace(/^discord\.(gg|com\/invite)\//i, '').split(/[/?#]/)[0];
  if (!code || !/^[a-zA-Z0-9-]+$/i.test(code)) return null;
  return `https://discord.gg/${code}`;
}

async function replyOwnerOnly(interaction) {
  return interaction.reply({
    content: 'Only the OpenSteam **owner** can update site links.',
    ephemeral: true,
  });
}

async function replyAdminOnly(interaction) {
  return interaction.reply({
    content: 'Only an OpenSteam **owner** or **admin** linked to Discord can change bot channels.',
    ephemeral: true,
  });
}

async function upsertCommunityInviteConfig(prisma, url) {
  const value = JSON.stringify([url]);
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value, isSecret: false },
    create: { key: CONFIG_KEY, value, isSecret: false },
  });
}

async function handleAddCommand(interaction, prisma) {
  const sub = interaction.options.getSubcommand(false);
  if (sub !== 'discord-link') {
    return interaction.reply({
      content: 'Unknown `/add` subcommand.',
      ephemeral: true,
    });
  }

  const platformUser = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
    select: { role: true },
  });

  if (!isPlatformOwner(platformUser)) {
    return replyOwnerOnly(interaction);
  }

  const rawUrl = interaction.options.getString('url');
  const inviteUrl = normalizeDiscordInviteUrl(rawUrl);
  if (!inviteUrl) {
    return interaction.reply({
      content: 'Invalid Discord invite. Use a full URL like `https://discord.gg/yourcode` or just the invite code.',
      ephemeral: true,
    });
  }

  const updated = writeSiteSettings({ discordInvite: inviteUrl });
  await upsertCommunityInviteConfig(prisma, inviteUrl);

  const settings = readSiteSettings();
  return interaction.reply({
    content: [
      '✅ **Discord link updated**',
      `• Website footer: \`${updated.discordInvite}\``,
      `• \`/discord\` redirect: \`${inviteUrl}\``,
      `• Site URL: ${settings.siteUrl || updated.siteUrl}`,
    ].join('\n'),
    ephemeral: true,
  });
}

async function upsertSystemConfig(prisma, key, value, isSecret = false) {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value, isSecret },
    create: { key, value, isSecret },
  });
}

async function handleSetCommand(interaction, prisma) {
  const sub = interaction.options.getSubcommand(false);

  const platformUser = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
    select: { role: true },
  });

  if (!isPlatformAdmin(platformUser)) {
    return replyAdminOnly(interaction);
  }

  if (sub === 'upload-channel') {
    const channel = interaction.options.getChannel('channel', true);
    if (!channel || channel.type !== 0) {
      return interaction.reply({
        content: 'Pick a regular text channel for manifest uploads.',
        ephemeral: true,
      });
    }

    const channelId = String(channel.id);
    await upsertSystemConfig(prisma, MANIFEST_UPLOAD_CHANNEL_KEY, channelId, false);

    return interaction.reply({
      content: [
        '✅ **Manifest upload channel set**',
        `• Channel: ${channel} (\`${channelId}\`)`,
        '',
      '**How to upload:**',
      '1. Be an OpenSteam **Admin/Owner** (`/admin set-role`) or a Discord **Administrator**.',
      '2. Post a zip/rar/7z attachment named `{appId}.zip` (example: `730.zip`).',
      '3. The bot saves the manifest to the database and local storage automatically.',
      ].join('\n'),
      ephemeral: true,
    });
  }

  if (sub === 'added-games-channel') {
    const channel = interaction.options.getChannel('channel', true);
    if (!channel || channel.type !== 0) {
      return interaction.reply({
        content: 'Pick a regular text channel for new game announcements.',
        ephemeral: true,
      });
    }

    const channelId = String(channel.id);
    await upsertSystemConfig(prisma, ADDED_GAMES_CHANNEL_KEY, channelId, false);

    return interaction.reply({
      content: [
        '✅ **Added games channel set**',
        `• Channel: ${channel} (\`${channelId}\`)`,
        '',
        'When a **new** game is added to OpenSteam, the bot will post a rich embed there with the game name (links to Steam), App ID, and header image.',
      ].join('\n'),
      ephemeral: true,
    });
  }

  if (sub === 'verify-channel') {
    const channel = interaction.options.getChannel('channel', true);
    if (!channel || channel.type !== 0) {
      return interaction.reply({
        content: 'Pick a regular text channel for the verification panel.',
        ephemeral: true,
      });
    }

    const channelId = String(channel.id);
    await upsertSystemConfig(prisma, VERIFY_CHANNEL_KEY, channelId, false);

    return interaction.reply({
      content: [
        '✅ **Verify channel set**',
        `• Channel: ${channel} (\`${channelId}\`)`,
        '',
        'Restart the bot or wait for the next startup so the verify panel is posted in this channel.',
      ].join('\n'),
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: 'Unknown `/set` subcommand.',
    ephemeral: true,
  });
}

module.exports = {
  ADD_COMMAND,
  SET_COMMAND,
  MANIFEST_UPLOAD_CHANNEL_KEY,
  ADDED_GAMES_CHANNEL_KEY,
  VERIFY_CHANNEL_KEY,
  handleAddCommand,
  handleSetCommand,
  normalizeDiscordInviteUrl,
};
