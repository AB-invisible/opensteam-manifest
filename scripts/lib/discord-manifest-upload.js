/**
 * Ingest manifest archives posted to the configured Discord upload channel by proxying
 * to POST /api/manifests/upload (same pipeline as bulk-upload.ps1 / admin dashboard).
 */
const axios = require('axios');
const FormData = require('form-data');
const { canUploadManifests } = require('./discord-user-sync');

const ARCHIVE_RE = /\.(zip|rar|7z)$/i;
const APP_ID_FROM_NAME_RE = /^(\d+)$/;
const uploadAttempts = new Map();
const UPLOAD_ATTEMPT_TTL_MS = 10 * 60 * 1000;

function pruneUploadAttempts(now = Date.now()) {
  for (const [key, attempt] of uploadAttempts) {
    if (now - attempt.startedAt > UPLOAD_ATTEMPT_TTL_MS) {
      uploadAttempts.delete(key);
    }
  }
}

function uploadAttemptKey(message, attachment, appId) {
  return [
    message.guildId || message.guild?.id || 'dm',
    message.channelId || message.channel?.id || 'unknown-channel',
    message.id || 'unknown-message',
    attachment.id || attachment.url || attachment.name,
    appId,
  ].join(':');
}

async function getManifestUploadChannelId(prisma) {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: 'DISCORD_MANIFEST_UPLOAD_CHANNEL_ID' },
    });
    const fromDb = row?.value?.trim();
    if (fromDb) return fromDb;
  } catch (e) {
    console.warn('[ManifestUpload] Could not read channel id from DB:', e?.message || e);
  }
  const fromEnv = process.env.DISCORD_MANIFEST_UPLOAD_CHANNEL_ID?.trim();
  return fromEnv || '';
}

function isManifestUploadChannel(message, uploadChannelId) {
  const target = String(uploadChannelId || '').trim();
  if (!target) return false;
  const ch = message.channel;
  if (!ch) return false;
  if (String(ch.id) === target) return true;
  if (typeof ch.isThread === 'function' && ch.isThread() && String(ch.parentId) === target) return true;
  return false;
}

/**
 * App ID = filename without extension (e.g. 730.zip → 730).
 * Optional override: first numeric token in message content, or `appId: 12345`.
 */
function resolveAppId(filename, messageContent) {
  const base = String(filename || '').replace(/\.[^.]+$/, '').trim();
  if (APP_ID_FROM_NAME_RE.test(base)) return base;

  const content = String(messageContent || '').trim();
  const explicit = content.match(/\bapp\s*id\s*[:=]\s*(\d{1,10})\b/i);
  if (explicit) return explicit[1];

  const tokens = content.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d{1,10}$/.test(t)) return t;
  }

  return null;
}

function isArchiveAttachment(attachment) {
  const name = String(attachment?.name || '');
  if (ARCHIVE_RE.test(name)) return true;
  const ct = String(attachment?.contentType || '').toLowerCase();
  return (
    ct.includes('zip') ||
    ct.includes('rar') ||
    ct.includes('7z') ||
    ct === 'application/octet-stream'
  );
}

function collectArchiveAttachments(message) {
  return [...message.attachments.values()].filter(isArchiveAttachment);
}

/** Partials.Message often delivers messageCreate before attachments are populated — always refetch. */
async function ensureMessageWithAttachments(message) {
  try {
    const full = await message.fetch();
    if (collectArchiveAttachments(full).length > 0) return full;
    // Rare race: attachment metadata lags behind message create.
    await new Promise((r) => setTimeout(r, 750));
    return await message.fetch();
  } catch (e) {
    console.warn('[ManifestUpload] message.fetch failed:', e?.message || e);
    return message;
  }
}

function uploadServerUrl() {
  const internal =
    process.env.INTERNAL_APP_URL?.trim() ||
    process.env.MANIFEST_UPLOAD_BASE_URL?.trim();
  if (internal) return internal.replace(/\/$/, '');

  const publicUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.PUBLIC_APP_URL ||
    ''
  ).replace(/\/$/, '');

  const localDefault = 'http://127.0.0.1:3000';

  // Bot + web run on the same machine — use loopback HTTP for upload API calls.
  // Avoids TLS failures when the public URL uses self-signed/local HTTPS or a dead tunnel.
  if (
    !publicUrl ||
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(publicUrl)
  ) {
    return publicUrl || localDefault;
  }

  if (process.env.STORAGE_PATH || process.env.BUCKET_TYPE === 'windows') {
    return localDefault;
  }

  return publicUrl;
}

async function downloadAttachment(url, botToken) {
  const headers = {};
  if (botToken) headers.Authorization = `Bot ${botToken}`;
  const res = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 300_000,
    maxContentLength: 5 * 1024 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024 * 1024,
  });
  return Buffer.from(res.data);
}

/**
 * POST multipart to /api/manifests/upload with Admin API key auth.
 * @returns {{ ok: true, data: object } | { ok: false, error: string, status?: number }}
 */
async function postManifestUpload({ buffer, filename, appId, name, serverUrl, apiKey }) {
  const form = new FormData();
  form.append('file', buffer, {
    filename,
    contentType: 'application/octet-stream',
  });
  form.append('appId', appId);
  if (name) form.append('name', name);

  try {
    const res = await axios.post(`${serverUrl}/api/manifests/upload`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300_000,
      validateStatus: () => true,
    });

    const body = res.data;
    if (res.status < 200 || res.status >= 300) {
      const err =
        (body && (body.error || body.message)) ||
        `HTTP ${res.status}`;
      return { ok: false, error: String(err), status: res.status };
    }

    return { ok: true, data: body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Handle a message in the manifest upload channel. Returns true if the message was handled.
 */
async function handleManifestUploadChannelMessage(message, prisma, opts = {}) {
  if (message.author?.bot || !message.guild) return false;

  const uploadChannelId = await getManifestUploadChannelId(prisma);
  if (!uploadChannelId) return false;
  if (!isManifestUploadChannel(message, uploadChannelId)) return false;

  const fullMessage = await ensureMessageWithAttachments(message);
  const botToken = opts.botToken || process.env.DISCORD_BOT_TOKEN || '';

  const uploadAccess = await canUploadManifests(fullMessage, prisma);
  if (!uploadAccess.allowed) {
    await fullMessage.react('❌').catch(() => {});
    await fullMessage
      .reply({
        content:
          'Only **OpenSteam Admin/Owner** or a Discord **Administrator** can upload manifests here.',
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
    return true;
  }

  const archives = collectArchiveAttachments(fullMessage);
  if (archives.length === 0) {
    // Text-only / no file — skip if they didn't send anything meaningful (avoids spam loops).
    if (!String(fullMessage.content || '').trim()) return true;

    await fullMessage
      .reply({
        content:
          'I don’t see a file attachment on that message. Upload the archive **as an attachment** (not a link) named `{appId}.zip` (e.g. `730.zip`).',
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
    return true;
  }

  const apiKey = process.env.ADMIN_API_KEY?.trim();
  const serverUrl = uploadServerUrl();
  const useLocalRegister = process.env.BUCKET_TYPE === 'windows' || !!process.env.STORAGE_PATH;
  if (!useLocalRegister && (!apiKey || !serverUrl)) {
    console.error('[ManifestUpload] Missing ADMIN_API_KEY or upload URL');
    await fullMessage.react('❌').catch(() => {});
    return true;
  }

  const lines = [];
  let anyOk = false;
  let anyFail = false;

  for (const attachment of archives) {
    const appId = resolveAppId(attachment.name, fullMessage.content);
    if (!appId) {
      anyFail = true;
      lines.push(`❌ \`${attachment.name}\` — could not parse App ID (name file \`{appId}.zip\`)`);
      continue;
    }

    pruneUploadAttempts();
    const attemptKey = uploadAttemptKey(fullMessage, attachment, appId);
    const existingAttempt = uploadAttempts.get(attemptKey);
    if (existingAttempt) {
      if (existingAttempt.status === 'done') {
        anyOk = true;
        lines.push(`✅ **${appId}** was already uploaded.`);
      } else {
        lines.push(`⏳ **${appId}** is still uploading…`);
      }
      continue;
    }
    uploadAttempts.set(attemptKey, { status: 'processing', startedAt: Date.now() });

    try {
      const buffer = await downloadAttachment(attachment.url, botToken);
      const { registerManifestLocally } = require('./register-manifest');
      const { announceGameAdded, announceGameAddedViaRest } = require('./discord-game-added');

      const registerResult = await registerManifestLocally(prisma, {
        appId,
        gameName: `App ${appId}`,
        zipBuffer: buffer,
      });

      if (registerResult.ok) {
        uploadAttempts.set(attemptKey, { status: 'done', startedAt: Date.now() });
        anyOk = true;
        lines.push(`✅ **${appId}** has been uploaded.`);

        if (registerResult.isNew) {
          const payload = { appId, gameName: `App ${appId}` };
          const announce = opts.client
            ? await announceGameAdded(opts.client, prisma, payload)
            : await announceGameAddedViaRest(prisma, payload);
          if (!announce.ok && !announce.skipped) {
            console.warn('[GameAdded] Upload channel announce failed:', announce.error || announce.reason);
          }
        }
      } else {
        uploadAttempts.delete(attemptKey);
        anyFail = true;
        lines.push(`❌ **${appId}** — ${registerResult.error}`);
      }
    } catch (e) {
      uploadAttempts.delete(attemptKey);
      anyFail = true;
      const msg = e instanceof Error ? e.message : String(e);
      lines.push(`❌ **${appId || attachment.name}** — ${msg}`);
      console.error('[ManifestUpload] Failed:', msg);
    }
  }

  if (lines.length) {
    const chunk = lines.join('\n').slice(0, 1900);
    await fullMessage.reply({ content: chunk, allowedMentions: { repliedUser: false } }).catch(() => {});
  }

  if (anyOk && !anyFail) await fullMessage.react('✅').catch(() => {});
  else if (anyFail) await fullMessage.react('❌').catch(() => {});

  return true;
}

module.exports = {
  getManifestUploadChannelId,
  isManifestUploadChannel,
  isArchiveAttachment,
  collectArchiveAttachments,
  resolveAppId,
  uploadServerUrl,
  handleManifestUploadChannelMessage,
  postManifestUpload,
};
