process.title = process.env.HOSTED_BOT_PROCESS_TITLE || 'OpenSteam-Hosted-Custom-Manager';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const { S3Client } = require('@aws-sdk/client-s3');
const { initS3, registerHostedCommands, handleHostedInteraction } = require('./lib/hosted-bot-commands');
const { enforceCustomBotSingleGuild } = require('./lib/hosted-bot-guild');
const { applyOpenSteamListeningPresence } = require('./lib/bot-presence');
const { logEntry } = require('./lib/hosted-bot-logger');
const { captureGuildMeta, touchHeartbeat } = require('./lib/hosted-bot-runtime');

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
const activeClients = new Map();
let botS3Client = null;
let managerEnabled = true;

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

function decryptSecret(ciphertext) {
  const hex = process.env.HOSTED_BOT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('HOSTED_BOT_ENCRYPTION_KEY not configured');
  const key = Buffer.from(hex, 'hex');
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

function isBusinessPlanActive(user) {
  if (user.plan !== 'BUSINESS') return true;
  if (user.planIsCanceled) return false;
  if (user.planExpiry && new Date(user.planExpiry) < new Date()) return false;
  return true;
}

function shouldRunInstance(instance) {
  if (instance.type !== 'CUSTOM') return false;
  if (instance.lockedByOwner) return false;
  if (!['ACTIVE', 'SETUP'].includes(instance.status)) return false;
  if (!instance.botTokenEnc || !instance.botClientId) return false;
  if (!instance.user) return false;
  if (!['RESELLER', 'BUSINESS'].includes(instance.user.plan)) return false;
  if (instance.user.plan === 'BUSINESS' && !isBusinessPlanActive(instance.user)) return false;
  return true;
}

async function stopClient(instanceId) {
  const entry = activeClients.get(instanceId);
  if (!entry) return;
  try {
    entry.client.destroy();
  } catch (e) { /* ignore */ }
  activeClients.delete(instanceId);
  await logEntry(prisma, {
    instanceId,
    scope: 'CUSTOM',
    level: 'EVENT',
    source: 'lifecycle',
    message: 'Bot client stopped.',
  });
}

async function startClient(instance) {
  if (activeClients.has(instance.id)) return;

  let botToken;
  try {
    botToken = decryptSecret(instance.botTokenEnc);
  } catch (e) {
    console.error(`[Hosted Custom Manager] Decrypt failed for ${instance.id}:`, e.message);
    await logEntry(prisma, {
      instanceId: instance.id,
      scope: 'CUSTOM',
      level: 'ERROR',
      source: 'lifecycle',
      message: `Failed to decrypt bot token: ${e.message}`,
    });
    return;
  }

  try {
    await registerHostedCommands(botToken, instance.botClientId, 'CUSTOM');
  } catch (e) {
    console.warn(`[Hosted Custom Manager] Command reg failed for ${instance.id}:`, e.message);
    await logEntry(prisma, {
      instanceId: instance.id,
      scope: 'CUSTOM',
      level: 'WARN',
      source: 'commands',
      message: `Slash command registration failed: ${e.message}`,
    });
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on(Events.ClientReady, async () => {
    console.log(`[Hosted Custom Manager] Client ${instance.id} ready as ${client.user.tag}`);
    applyOpenSteamListeningPresence(client);
    await logEntry(prisma, {
      instanceId: instance.id,
      scope: 'CUSTOM',
      level: 'EVENT',
      source: 'lifecycle',
      message: `Bot connected to Discord as ${client.user.tag}.`,
    });
    try {
      await captureGuildMeta(client, prisma, instance);
    } catch (e) { /* best-effort */ }
    try {
      await enforceCustomBotSingleGuild(client, prisma, instance);
    } catch (e) {
      console.warn(`[Hosted Custom Manager] Guild enforcement failed (${instance.id}):`, e.message);
    }
  });

  client.on('guildCreate', async (guild) => {
    try {
      const fresh = await prisma.hostedBotInstance.findUnique({ where: { id: instance.id } });
      await enforceCustomBotSingleGuild(client, prisma, fresh || instance);
      await captureGuildMeta(client, prisma, fresh || instance);
      await logEntry(prisma, {
        instanceId: instance.id,
        scope: 'CUSTOM',
        level: 'EVENT',
        source: 'guild',
        message: `Joined server ${guild?.name || guild?.id || 'unknown'}.`,
      });
    } catch (e) {
      console.warn(`[Hosted Custom Manager] Guild enforcement failed (${instance.id}):`, e.message);
    }
  });

  client.on('guildDelete', async (guild) => {
    await logEntry(prisma, {
      instanceId: instance.id,
      scope: 'CUSTOM',
      level: 'EVENT',
      source: 'guild',
      message: `Removed from server ${guild?.name || guild?.id || 'unknown'}.`,
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!['gen', 'request', 'status', 'link'].includes(interaction.commandName)) return;
    await logEntry(prisma, {
      instanceId: instance.id,
      scope: 'CUSTOM',
      level: 'EVENT',
      source: 'command',
      message: `/${interaction.commandName} used by ${interaction.user?.tag || interaction.user?.id || 'unknown'}.`,
    });
    try {
      await handleHostedInteraction(interaction, prisma, botS3Client, {
        type: 'CUSTOM',
        useApiLimit: true,
        botToken,
        instanceId: instance.id,
      });
    } catch (e) {
      console.error(`[Hosted Custom Manager] Interaction error (${instance.id}):`, e);
      await logEntry(prisma, {
        instanceId: instance.id,
        scope: 'CUSTOM',
        level: 'ERROR',
        source: 'command',
        message: `Error handling /${interaction.commandName}: ${e.message}`,
      });
    }
  });

  await client.login(botToken);
  activeClients.set(instance.id, { client, instanceId: instance.id });
  await logEntry(prisma, {
    instanceId: instance.id,
    scope: 'CUSTOM',
    level: 'EVENT',
    source: 'lifecycle',
    message: 'Bot client started.',
  });
}

async function suspendExpiredBusinessBots(instances) {
  const now = new Date();
  for (const instance of instances) {
    if (instance.user?.plan !== 'BUSINESS') continue;
    if (isBusinessPlanActive(instance.user)) continue;
    if (instance.status === 'SUSPENDED') continue;
    await stopClient(instance.id);
    await prisma.hostedBotInstance.update({
      where: { id: instance.id },
      data: { status: 'SUSPENDED', lastStoppedAt: now },
    });
    console.log(`[Hosted Custom Manager] Suspended BUSINESS instance ${instance.id} (payment lapsed)`);
    await logEntry(prisma, {
      instanceId: instance.id,
      scope: 'CUSTOM',
      level: 'WARN',
      source: 'billing',
      message: 'Bot suspended because the BUSINESS subscription lapsed.',
    });
  }
}

/**
 * Execute interactive commands queued by the admin panel. Polled on a short
 * interval so the admin console feels responsive.
 */
async function processPendingCommands() {
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
    if (!cmd.instance || cmd.instance.type !== 'CUSTOM') continue;
    const entry = activeClients.get(cmd.instanceId);

    await prisma.hostedBotCommand.update({ where: { id: cmd.id }, data: { status: 'RUNNING' } });

    try {
      if (!entry?.client) {
        throw new Error('Bot is not currently connected.');
      }
      const result = await executeCommand(entry.client, cmd);
      await prisma.hostedBotCommand.update({
        where: { id: cmd.id },
        data: { status: 'DONE', result: result.slice(0, 1000), executedAt: new Date() },
      });
      await logEntry(prisma, {
        instanceId: cmd.instanceId,
        scope: 'CUSTOM',
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
        scope: 'CUSTOM',
        level: 'ERROR',
        source: 'admin',
        message: `Admin command ${cmd.type} failed: ${e.message || e}`,
      });
    }
  }
}

async function executeCommand(client, cmd) {
  if (cmd.type === 'SEND_MESSAGE') {
    const text = String(cmd.payload || '').trim();
    if (!text) throw new Error('Message payload is empty.');
    const guildId = cmd.instance.guildId;
    if (!guildId) throw new Error('No linked server to send a message to.');
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) throw new Error('Bot is not in the linked server.');
    const channel = await resolveSendableChannel(guild);
    if (!channel) throw new Error('No channel available where the bot can send messages.');
    await channel.send({ content: text.slice(0, 2000) });
    return `Sent message to #${channel.name || channel.id}.`;
  }
  if (cmd.type === 'RECONNECT') {
    await stopClient(cmd.instanceId);
    const fresh = await prisma.hostedBotInstance.findUnique({
      where: { id: cmd.instanceId },
      include: { user: true },
    });
    if (fresh && shouldRunInstance(fresh)) {
      await startClient(fresh);
      return 'Reconnect requested; client restarted.';
    }
    return 'Reconnect requested; client will restart on the next reconcile.';
  }
  throw new Error(`Unsupported command type: ${cmd.type}`);
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

async function reconcileClients() {
  const enabledCfg = await prisma.systemConfig.findUnique({
    where: { key: 'HOSTED_CUSTOM_MANAGER_ENABLED' },
  });
  managerEnabled = enabledCfg?.value === 'true';
  if (!managerEnabled) {
    for (const id of [...activeClients.keys()]) {
      await stopClient(id);
    }
    return;
  }

  const instances = await prisma.hostedBotInstance.findMany({
    where: { type: 'CUSTOM' },
    include: { user: true },
  });

  await suspendExpiredBusinessBots(instances);

  const refreshed = await prisma.hostedBotInstance.findMany({
    where: { type: 'CUSTOM' },
    include: { user: true },
  });

  const shouldRunIds = new Set();
  for (const instance of refreshed) {
    if (shouldRunInstance(instance)) {
      shouldRunIds.add(instance.id);
      if (!activeClients.has(instance.id)) {
        try {
          await startClient(instance);
        } catch (e) {
          console.error(`[Hosted Custom Manager] Failed to start ${instance.id}:`, e.message);
        }
      }
    }
  }

  for (const id of [...activeClients.keys()]) {
    if (!shouldRunIds.has(id)) {
      await stopClient(id);
    } else {
      const entry = activeClients.get(id);
      const inst = refreshed.find((r) => r.id === id);
      if (entry?.client && inst) {
        enforceCustomBotSingleGuild(entry.client, prisma, inst).catch((e) => {
          console.warn(`[Hosted Custom Manager] Guild enforcement failed (${id}):`, e.message);
        });
        captureGuildMeta(entry.client, prisma, inst).catch(() => touchHeartbeat(prisma, id));
      }
    }
  }
}

async function main() {
  console.log('[Hosted Custom Manager] Starting...');
  await reconcileClients();
  setInterval(() => {
    reconcileClients().catch((e) => console.error('[Hosted Custom Manager] Reconcile error:', e));
  }, 30000);
  setInterval(() => {
    processPendingCommands().catch((e) => console.error('[Hosted Custom Manager] Command error:', e));
  }, 4000);

  const shutdown = async () => {
    console.log('[Hosted Custom Manager] Shutting down...');
    for (const id of [...activeClients.keys()]) {
      await stopClient(id);
    }
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Hosted Custom Manager] Fatal:', err);
  process.exit(1);
});
