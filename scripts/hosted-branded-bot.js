process.title = process.env.HOSTED_BOT_PROCESS_TITLE || 'OpenSteam-Hosted-Branded-Bot';

const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const { initS3, registerHostedCommands, handleHostedInteraction } = require('./lib/hosted-bot-commands');
const { enforceBrandedBotCustomExclusion } = require('./lib/hosted-bot-guild');
const { applyOpenSteamListeningPresence } = require('./lib/bot-presence');
const { logEntry } = require('./lib/hosted-bot-logger');
const { captureGuildMeta, touchHeartbeat } = require('./lib/hosted-bot-runtime');
const { S3Client } = require('@aws-sdk/client-s3');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  });
}

const prisma = new PrismaClient();
let botS3Client = null;

initS3();
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME) {
  botS3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

async function getBrandedCredentials() {
  const keys = ['HOSTED_BRANDED_BOT_TOKEN', 'HOSTED_BRANDED_CLIENT_ID', 'HOSTED_BRANDED_ENABLED'];
  const configs = await prisma.systemConfig.findMany({ where: { key: { in: keys } } });
  const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));
  return {
    token: map.HOSTED_BRANDED_BOT_TOKEN,
    clientId: map.HOSTED_BRANDED_CLIENT_ID,
    enabled: map.HOSTED_BRANDED_ENABLED === 'true',
  };
}

async function brandedInstanceIdForGuild(guildId) {
  if (!guildId) return null;
  const inst = await prisma.hostedBotInstance
    .findFirst({ where: { type: 'BRANDED', guildId }, select: { id: true } })
    .catch(() => null);
  return inst?.id || null;
}

async function syncBrandedInstances(client) {
  let instances;
  try {
    instances = await prisma.hostedBotInstance.findMany({
      where: { type: 'BRANDED', guildId: { not: null } },
      select: { id: true, guildId: true, connectedAt: true },
    });
  } catch (e) {
    return;
  }
  for (const inst of instances) {
    try {
      if (client.guilds.cache.has(inst.guildId)) {
        await captureGuildMeta(client, prisma, inst);
      } else {
        await touchHeartbeat(prisma, inst.id);
      }
    } catch (e) { /* best-effort */ }
  }
}

async function resolveSendableChannel(guild) {
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const canSend = (ch) => {
    if (!ch || typeof ch.isTextBased !== 'function' || !ch.isTextBased()) return false;
    if (!me) return true;
    const perms = ch.permissionsFor(me);
    return perms ? perms.has('SendMessages') && perms.has('ViewChannel') : false;
  };
  if (canSend(guild.systemChannel)) return guild.systemChannel;
  const channels = await guild.channels.fetch().catch(() => null);
  if (channels) {
    for (const ch of channels.values()) {
      if (canSend(ch)) return ch;
    }
  }
  return null;
}

async function processBrandedCommands(client) {
  let pending;
  try {
    pending = await prisma.hostedBotCommand.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 10,
      include: { instance: true },
    });
  } catch (e) {
    return;
  }

  for (const cmd of pending) {
    if (!cmd.instance || cmd.instance.type !== 'BRANDED') continue;
    await prisma.hostedBotCommand.update({ where: { id: cmd.id }, data: { status: 'RUNNING' } });
    try {
      let result;
      if (cmd.type === 'SEND_MESSAGE') {
        const text = String(cmd.payload || '').trim();
        if (!text) throw new Error('Message payload is empty.');
        const guildId = cmd.instance.guildId;
        if (!guildId) throw new Error('No linked server to send a message to.');
        const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
        if (!guild) throw new Error('Branded bot is not in the linked server.');
        const channel = await resolveSendableChannel(guild);
        if (!channel) throw new Error('No channel available where the bot can send messages.');
        await channel.send({ content: text.slice(0, 2000) });
        result = `Sent message to #${channel.name || channel.id}.`;
      } else if (cmd.type === 'RECONNECT') {
        result = 'Branded bot is shared and always running; reconnect is a no-op.';
      } else {
        throw new Error(`Unsupported command type: ${cmd.type}`);
      }
      await prisma.hostedBotCommand.update({
        where: { id: cmd.id },
        data: { status: 'DONE', result: result.slice(0, 1000), executedAt: new Date() },
      });
      await logEntry(prisma, {
        instanceId: cmd.instanceId,
        scope: 'BRANDED',
        level: 'EVENT',
        source: 'admin',
        message: `Admin command ${cmd.type}: ${result}`.slice(0, 2000),
      });
    } catch (e) {
      await prisma.hostedBotCommand.update({
        where: { id: cmd.id },
        data: { status: 'FAILED', result: String(e.message || e).slice(0, 1000), executedAt: new Date() },
      });
      await logEntry(prisma, {
        instanceId: cmd.instanceId,
        scope: 'BRANDED',
        level: 'ERROR',
        source: 'admin',
        message: `Admin command ${cmd.type} failed: ${e.message || e}`,
      });
    }
  }
}

async function startBrandedBot() {
  const creds = await getBrandedCredentials();
  if (!creds.enabled) {
    console.log('[Hosted Branded Bot] Disabled in settings. Exiting.');
    process.exit(0);
  }
  if (!creds.token || !creds.clientId) {
    console.error('[Hosted Branded Bot] Missing HOSTED_BRANDED_BOT_TOKEN or HOSTED_BRANDED_CLIENT_ID');
    process.exit(1);
  }

  try {
    await registerHostedCommands(creds.token, creds.clientId, 'BRANDED');
    console.log('[Hosted Branded Bot] Slash commands registered.');
  } catch (e) {
    console.warn('[Hosted Branded Bot] Command registration failed:', e.message);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.on(Events.ClientReady, async () => {
    console.log(`[Hosted Branded Bot] Logged in as ${client.user.tag}`);
    applyOpenSteamListeningPresence(client);
    await logEntry(prisma, {
      scope: 'BRANDED',
      level: 'EVENT',
      source: 'lifecycle',
      message: `Branded bot connected to Discord as ${client.user.tag}.`,
    });
    enforceBrandedBotCustomExclusion(client, prisma).catch((e) => {
      console.warn('[Hosted Branded Bot] Guild exclusion failed:', e.message);
    });
    syncBrandedInstances(client).catch(() => {});
  });

  client.on('guildCreate', (guild) => {
    enforceBrandedBotCustomExclusion(client, prisma).catch((e) => {
      console.warn('[Hosted Branded Bot] Guild exclusion failed:', e.message);
    });
    logEntry(prisma, {
      scope: 'BRANDED',
      level: 'EVENT',
      source: 'guild',
      message: `Branded bot joined server ${guild?.name || guild?.id || 'unknown'}.`,
    }).catch(() => {});
    syncBrandedInstances(client).catch(() => {});
  });

  client.on('guildDelete', (guild) => {
    logEntry(prisma, {
      scope: 'BRANDED',
      level: 'EVENT',
      source: 'guild',
      message: `Branded bot removed from server ${guild?.name || guild?.id || 'unknown'}.`,
    }).catch(() => {});
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!['gen', 'request', 'status', 'link'].includes(interaction.commandName)) return;

    const instanceId = await brandedInstanceIdForGuild(interaction.guildId);
    await logEntry(prisma, {
      instanceId,
      scope: 'BRANDED',
      level: 'EVENT',
      source: 'command',
      message: `/${interaction.commandName} used by ${interaction.user?.tag || interaction.user?.id || 'unknown'}.`,
    });

    try {
      await handleHostedInteraction(interaction, prisma, botS3Client, {
        type: 'BRANDED',
        useApiLimit: false,
        botToken: creds.token,
      });
    } catch (e) {
      console.error('[Hosted Branded Bot] Interaction error:', e);
      await logEntry(prisma, {
        instanceId,
        scope: 'BRANDED',
        level: 'ERROR',
        source: 'command',
        message: `Error handling /${interaction.commandName}: ${e.message}`,
      });
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Unexpected error.', ephemeral: true }).catch(() => {});
      }
    }
  });

  await client.login(creds.token);

  setInterval(() => {
    enforceBrandedBotCustomExclusion(client, prisma).catch((e) => {
      console.warn('[Hosted Branded Bot] Guild exclusion failed:', e.message);
    });
    syncBrandedInstances(client).catch(() => {});
  }, 60000);

  setInterval(() => {
    processBrandedCommands(client).catch((e) => console.error('[Hosted Branded Bot] Command error:', e));
  }, 4000);

  const shutdown = async () => {
    console.log('[Hosted Branded Bot] Shutting down...');
    client.destroy();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startBrandedBot().catch((err) => {
  console.error('[Hosted Branded Bot] Fatal:', err);
  process.exit(1);
});
