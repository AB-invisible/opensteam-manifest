const { EmbedBuilder } = require('discord.js');

const AUTOGEN_STATUS = {
  added: { emoji: '✅', label: 'Added', color: 0x10b981 },
  already: { emoji: '📦', label: 'Already in DB', color: 0x6366f1 },
  not_found: { emoji: '🔍', label: 'Not Found', color: 0xf59e0b },
  skipped: { emoji: '⏭️', label: 'Skipped', color: 0x71717a },
  failed: { emoji: '❌', label: 'Failed', color: 0xef4444 },
};

function truncate(text, max = 280) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function steamStoreUrl(appId) {
  return appId ? `https://store.steampowered.com/app/${appId}` : null;
}

function pickSummaryColor(counts) {
  if ((counts.added || 0) > 0) return 0x10b981;
  if ((counts.failed || 0) > 0) return 0xef4444;
  if ((counts.not_found || 0) > 0) return 0xf59e0b;
  return 0x6366f1;
}

function formatResultLine(item) {
  const meta = AUTOGEN_STATUS[item.status] || AUTOGEN_STATUS.skipped;
  const fulfilled = item.fulfilled ? ` · ${item.fulfilled} request(s) fulfilled` : '';
  const appId = item.appId && item.appId !== 'N/A' ? `\`${item.appId}\`` : '`—`';
  return `${meta.emoji} **${truncate(item.name || 'Unknown', 64)}** · ${appId}\n└ ${truncate(item.detail || meta.label, 120)}${fulfilled}`;
}

function buildAutogenFulfilledEmbed({ request, gameName, appId, gameInfo, detail, source }) {
  const steamUrl = steamStoreUrl(appId);
  const description =
    truncate(gameInfo?.short_description, 320) ||
    truncate(request?.reason?.replace(/^\[Discord\]\s*/i, ''), 320) ||
    'Indexed automatically and is now available in the manifest database.';

  const embed = new EmbedBuilder()
    .setTitle(`✅ Fulfilled · ${gameName}`)
    .setURL(steamUrl || undefined)
    .setDescription(description)
    .setColor(0x10b981)
    .addFields(
      { name: 'App ID', value: `\`${appId}\``, inline: true },
      {
        name: 'Requester',
        value: request?.user?.discordId ? `<@${request.user.discordId}>` : 'Unknown',
        inline: true,
      },
      { name: 'Status', value: '🤖 **FULFILLED** · Autogen', inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'OpenSteam Request Pipeline · Autogen' });

  if (source) {
    embed.addFields({ name: 'Source', value: source, inline: true });
  }
  if (detail && detail !== source) {
    embed.addFields({ name: 'Details', value: truncate(detail, 256), inline: false });
  }
  if (gameInfo?.developers?.[0]) {
    embed.addFields({ name: 'Developer', value: truncate(gameInfo.developers[0], 64), inline: true });
  }
  if (gameInfo?.publishers?.[0]) {
    embed.addFields({ name: 'Publisher', value: truncate(gameInfo.publishers[0], 64), inline: true });
  }
  if (gameInfo?.header_image) {
    embed.setThumbnail(gameInfo.header_image);
  }

  return embed;
}

function autogenModeLabel(mode) {
  if (mode === 'depotbox') return 'DepotBox (paced)';
  if (mode === 'upstream') return 'Ryuu/Morrenus scan';
  if (mode === 'heavygen') return 'Heavygen';
  return 'Request Queue';
}

function buildAutogenSummaryEmbeds(results, limit, mode = 'requests') {
  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  const summaryTitle = mode === 'depotbox'
    ? '🤖 DepotBox Autogen Complete'
    : mode === 'upstream'
      ? '🤖 Ryuu/Morrenus Autogen Complete'
      : '🤖 Autogen Batch Complete';

  const summaryDescription = mode === 'depotbox' || mode === 'upstream'
    ? `Processed **${results.length}** of **${limit}** missing Steam game candidate(s).`
    : `Processed **${results.length}** of **${limit}** queued game request(s).`;

  const summary = new EmbedBuilder()
    .setTitle(summaryTitle)
    .setDescription(summaryDescription)
    .setColor(pickSummaryColor(counts))
    .addFields(
      { name: '✅ Added', value: String(counts.added || 0), inline: true },
      { name: '📦 Already in DB', value: String(counts.already || 0), inline: true },
      { name: '🔍 Not Found', value: String(counts.not_found || 0), inline: true },
      { name: '⏭️ Skipped', value: String(counts.skipped || 0), inline: true },
      { name: '❌ Failed', value: String(counts.failed || 0), inline: true },
      {
        name: '📬 Requests Fulfilled',
        value: String(results.reduce((sum, item) => sum + (item.fulfilled || 0), 0)),
        inline: true,
      },
    )
    .setTimestamp()
    .setFooter({ text: 'OpenSteam Autogen · Manifest Indexer' });

  const embeds = [summary];

  if (results.length === 0) {
    return embeds;
  }

  const lines = results.map(formatResultLine);
  let chunk = '';
  let part = 1;

  for (const line of lines) {
    const next = chunk ? `${chunk}\n\n${line}` : line;
    if (next.length > 950) {
      embeds.push(
        new EmbedBuilder()
          .setTitle(embeds.length > 1 ? `Results (${part})` : 'Results')
          .setDescription(chunk)
          .setColor(0x27272a),
      );
      part += 1;
      chunk = line;
    } else {
      chunk = next;
    }
  }

  if (chunk) {
    const title =
      embeds.length === 1
        ? 'Results'
        : results.length > 20
          ? `Results (${part}) · showing first ${Math.min(results.length, 20)}`
          : `Results (${part})`;
    embeds.push(
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(chunk)
        .setColor(0x27272a),
    );
  }

  if (results.length > 20) {
    embeds[embeds.length - 1].setFooter({ text: `…and ${results.length - 20} more not shown` });
  }

  return embeds.slice(0, 10);
}

function buildAutogenStatusEmbed({
  enabled,
  mode = 'requests',
  dailyLimit,
  pendingCount,
  lastRunRaw,
  hasProviderKey,
  running,
  depotboxStatus = null,
  upstreamStatus = null,
  heavygenStatus = null,
}) {
  const modeDescription = running
    ? 'A batch is **currently running**. Wait for it to finish before starting another.'
    : mode === 'depotbox'
      ? 'DepotBox mode imports missing Steam games on a **paced 24h schedule** (~1 game every 12 min at 120/day) so traffic does not look like scraping.'
      : mode === 'upstream'
        ? 'Upstream mode scans Steam for games missing from OpenSteam, then tries **Ryuu first** and **Morrenus** as fallback before adding them.'
        : 'Automatic manifest indexing for pending game requests.';

  const embed = new EmbedBuilder()
    .setTitle('🤖 Autogen Status')
    .setDescription(modeDescription)
    .setColor(enabled ? 0x10b981 : 0x71717a)
    .addFields(
      { name: 'Daily Autogen', value: enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Mode', value: autogenModeLabel(mode), inline: true },
      { name: 'Provider Keys', value: hasProviderKey ? '🟢 Configured' : '🔴 Missing', inline: true },
      { name: 'Daily Limit', value: String(dailyLimit), inline: true },
      { name: 'Pending Requests', value: String(pendingCount), inline: true },
      {
        name: mode === 'depotbox' ? 'Request Queue Last Run' : 'Last Daily Run',
        value: lastRunRaw && Number.isFinite(Date.parse(lastRunRaw)) ? `<t:${Math.floor(Date.parse(lastRunRaw) / 1000)}:R>` : 'Never',
        inline: true,
      },
      { name: 'Runner', value: running ? '⏳ In progress' : '🟢 Idle', inline: true },
    );

  if (mode === 'depotbox' && depotboxStatus) {
    embed.addFields(
      {
        name: 'Today Imported',
        value: `${depotboxStatus.dayCount}/${dailyLimit} (${depotboxStatus.remaining} left)`,
        inline: true,
      },
      {
        name: 'Tick Spacing',
        value: `~${depotboxStatus.spacingMinutes} min over ${depotboxStatus.spreadHours}h`,
        inline: true,
      },
      {
        name: 'Next Import',
        value:
          depotboxStatus.nextRunRaw && Number.isFinite(Date.parse(depotboxStatus.nextRunRaw))
            ? `<t:${Math.floor(Date.parse(depotboxStatus.nextRunRaw) / 1000)}:R>`
            : 'Scheduling…',
        inline: true,
      },
    );
  }

  if (mode === 'upstream' && upstreamStatus) {
    embed.addFields(
      {
        name: 'Today Imported',
        value: `${upstreamStatus.dayCount}/${dailyLimit} (${upstreamStatus.remaining} left)`,
        inline: true,
      },
      {
        name: 'Tick Spacing',
        value: `~${upstreamStatus.spacingMinutes} min over ${upstreamStatus.spreadHours}h`,
        inline: true,
      },
      {
        name: 'Next Import',
        value:
          upstreamStatus.nextRunRaw && Number.isFinite(Date.parse(upstreamStatus.nextRunRaw))
            ? `<t:${Math.floor(Date.parse(upstreamStatus.nextRunRaw) / 1000)}:R>`
            : 'Scheduling…',
        inline: true,
      },
    );
  }

  if (heavygenStatus) {
    embed.addFields(
      {
        name: 'Heavygen Added Today',
        value: `${heavygenStatus.dayCount}/${dailyLimit} (${heavygenStatus.remaining} left)`,
        inline: true,
      },
      {
        name: 'Heavygen Tick Spacing',
        value: `~${heavygenStatus.spacingMinutes} min over ${heavygenStatus.spreadHours}h`,
        inline: true,
      },
      {
        name: 'Heavygen Next Import',
        value:
          heavygenStatus.nextRunRaw && Number.isFinite(Date.parse(heavygenStatus.nextRunRaw))
            ? `<t:${Math.floor(Date.parse(heavygenStatus.nextRunRaw) / 1000)}:R>`
            : 'Scheduling…',
        inline: true,
      },
    );
  }

  return embed
    .setTimestamp()
    .setFooter({ text: mode === 'depotbox' ? 'DepotBox API: 120 req/min cap · 120 imports/day spread' : 'Use /autogen run to process pending requests manually' });
}

function buildAutogenToggleEmbed(enabled, mode = 'requests') {
  return new EmbedBuilder()
    .setTitle(enabled ? '🟢 Daily Autogen Enabled' : '🔴 Daily Autogen Disabled')
    .setDescription(
      enabled
        ? mode === 'heavygen'
          ? 'Heavygen mode is enabled. The bot will slowly scan Steam and import missing games into OpenSteam automatically.'
          : mode === 'depotbox'
            ? 'The bot will import up to **120 missing Steam games per day**, spaced evenly across 24 hours (~12 min apart with jitter) so DepotBox traffic stays natural.'
            : mode === 'upstream'
              ? 'The bot will scan Steam for missing games and import up to **100 per day** using **Ryuu**, then **Morrenus** when Ryuu does not have the manifest.'
              : 'The bot will automatically process pending requests on the daily schedule.'
        : 'Automatic daily runs are paused. Staff can still trigger `/autogen run` manually.',
    )
    .setColor(enabled ? 0x10b981 : 0xef4444)
    .setTimestamp()
    .setFooter({ text: 'OpenSteam Autogen' });
}

function buildAutogenProgressEmbed(batchCount, requestId, mode = 'requests') {
  return new EmbedBuilder()
    .setTitle('⏳ Autogen Started')
    .setDescription(
      requestId
        ? `Processing request \`${requestId}\`…`
        : mode === 'heavygen'
          ? `Processing **${batchCount}** missing Steam game(s) through Heavygen proxies.`
          : mode === 'depotbox'
            ? `Processing up to **${batchCount}** missing Steam game candidate(s) through DepotBox (manual run respects remaining daily quota).`
            : mode === 'upstream'
              ? `Scanning **${batchCount}** missing Steam game candidate(s) via Ryuu → Morrenus…`
              : `Processing **${batchCount}** pending request(s). Results will appear when the batch finishes.`,
    )
    .setColor(0xf59e0b)
    .setTimestamp()
    .setFooter({ text: 'OpenSteam Autogen · Please wait' });
}

function buildAutogenErrorEmbed(title, message) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(truncate(message, 3800))
    .setColor(0xef4444)
    .setTimestamp()
    .setFooter({ text: 'OpenSteam Autogen' });
}

function buildAutogenInfoEmbed(title, message, color = 0x6366f1) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncate(message, 3800))
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'OpenSteam Autogen' });
}

module.exports = {
  AUTOGEN_STATUS,
  buildAutogenFulfilledEmbed,
  buildAutogenSummaryEmbeds,
  buildAutogenStatusEmbed,
  buildAutogenToggleEmbed,
  buildAutogenProgressEmbed,
  buildAutogenErrorEmbed,
  buildAutogenInfoEmbed,
};
