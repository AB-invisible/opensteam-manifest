const { REST, Routes, PermissionFlagsBits } = require('discord.js');
const {
  initS3,
  getGenAppUrl,
  getCachedSteamInfo,
  upsertGenManifestRecord,
  loadCachedManifestZip,
  sendGenZipToRequester,
  fetchExternalManifest,
  getWebDailyLimit,
  getApiDailyLimit,
  countUserApiUsageToday,
  consumeUserApiQuota,
  countHostedGenerationsToday,
  recordHostedBotGeneration,
  passiveBackfillManifestName,
  isPlaceholderName,
  MAX_GEN_DISCORD_ZIP,
  MAX_GEN_DISCORD_ZIP_LABEL,
  EmbedBuilder,
  HeadObjectCommand,
} = require('./hosted-bot-gen');
const { buildBrandedLinkOAuthUrl, buildCustomLinkOAuthUrl } = require('./hosted-bot-oauth');
const { validateHostedGuildLink } = require('./hosted-bot-guild');
const {
  canLinkBrandedHostedBot,
  getBrandedLinkPlanError,
  isPurchaserPlanValid,
} = require('./hosted-bot-plans');
const { getGenAppIdFromInteraction } = require('./steam-app-id.js');

const REQUESTS_CHANNEL_ID = '1484100666023477308';

const BRANDED_HOSTED_COMMANDS = [
  { name: 'link', description: 'Link this server to your OpenSteam REGULAR/PREMIUM subscription' },
  { name: 'gen', description: 'Generate a manifest for a Steam App ID', options: [{ name: 'appid', description: 'Numeric Steam App ID (e.g. 730)', type: 4, required: true, min_value: 1 }] },
  { name: 'ask', description: 'Ask Atis AI about manifests (.lua), verification, or API keys', options: [{ name: 'query', description: 'Your question', type: 3, required: true }] },
  { name: 'request', description: 'Request a game be added to the library', options: [
    { name: 'appid', description: 'Steam App ID', type: 3, required: true },
    { name: 'comment', description: 'Optional comment', type: 3, required: false },
  ]},
  { name: 'onlinefixes', description: 'Search the OnlineFix database', options: [{ name: 'query', description: 'Game name to search', type: 3, required: true }] },
  { name: 'status', description: 'View your OpenSteam account status and daily usage' },
];

const CUSTOM_HOSTED_COMMANDS = [
  { name: 'link', description: 'Link this server to your OpenSteam custom bot (RESELLER/BUSINESS)' },
  { name: 'gen', description: 'Generate a manifest for a Steam App ID', options: [{ name: 'appid', description: 'Numeric Steam App ID (e.g. 730)', type: 4, required: true, min_value: 1 }] },
  { name: 'ask', description: 'Ask Atis AI about manifests (.lua), verification, or API keys', options: [{ name: 'query', description: 'Your question', type: 3, required: true }] },
  { name: 'request', description: 'Request a game be added to the library', options: [
    { name: 'appid', description: 'Steam App ID', type: 3, required: true },
    { name: 'comment', description: 'Optional comment', type: 3, required: false },
  ]},
  { name: 'onlinefixes', description: 'Search the OnlineFix database', options: [{ name: 'query', description: 'Game name to search', type: 3, required: true }] },
  { name: 'status', description: 'View your OpenSteam account status and daily usage' },
];

async function registerHostedCommands(botToken, clientId, botType = 'BRANDED') {
  const commands = botType === 'CUSTOM' ? CUSTOM_HOSTED_COMMANDS : BRANDED_HOSTED_COMMANDS;
  const rest = new REST({ version: '10' }).setToken(botToken);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
}

function isBusinessPlanActive(user) {
  if (user.plan !== 'BUSINESS') return true;
  if (user.planIsCanceled) return false;
  if (user.planExpiry && new Date(user.planExpiry) < new Date()) return false;
  return true;
}

async function resolveHostedInstance(prisma, guildId, type) {
  if (!guildId) return null;
  const instance = await prisma.hostedBotInstance.findFirst({
    where: {
      guildId,
      type,
      status: 'ACTIVE',
      lockedByOwner: false,
    },
    include: { user: true },
  });
  if (!instance || !instance.guildId || instance.guildId !== guildId) return null;
  return instance;
}

async function handleLinkCommand(interaction, prisma, options = {}) {
  const linkType = options.type === 'CUSTOM' ? 'CUSTOM' : 'BRANDED';

  if (!interaction.guildId) {
    return interaction.reply({
      content: '❌ Run `/link` inside the Discord server you want to connect to OpenSteam.',
      ephemeral: true,
    });
  }

  const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  if (!user) {
    return interaction.reply({
      content: '❌ **Account Not Linked**: Sign in to http://127.0.0.1:3000 once with this Discord account, then run `/link` again.',
      ephemeral: true,
    });
  }

  if (linkType === 'BRANDED') {
    if (!canLinkBrandedHostedBot(user)) {
      return interaction.reply({
        content: `❌ ${getBrandedLinkPlanError(user)}`,
        ephemeral: true,
      });
    }
  } else {
    if (!['RESELLER', 'BUSINESS'].includes(user.plan)) {
      return interaction.reply({
        content: '❌ Custom bot linking requires a **RESELLER** or **BUSINESS** OpenSteam plan.',
        ephemeral: true,
      });
    }
    if (!isPurchaserPlanValid({ type: 'CUSTOM' }, user)) {
      return interaction.reply({
        content: '❌ Your OpenSteam subscription is inactive. Renew on http://127.0.0.1:3000 first.',
        ephemeral: true,
      });
    }
  }

  const perms = interaction.memberPermissions;
  if (
    !perms?.has(PermissionFlagsBits.Administrator) &&
    !perms?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return interaction.reply({
      content: '❌ You need **Manage Server** permission in this server to link it.',
      ephemeral: true,
    });
  }

  let instance = await prisma.hostedBotInstance.findUnique({ where: { userId: user.id } });

  if (linkType === 'CUSTOM') {
    if (options.instanceId && instance && instance.id !== options.instanceId) {
      return interaction.reply({
        content: '❌ This bot does not belong to your OpenSteam account.',
        ephemeral: true,
      });
    }
    if (!instance?.botClientId || !instance?.botSecretEnc) {
      return interaction.reply({
        content: '❌ Save your bot credentials on the OpenSteam dashboard first (**Custom Bot** tab), then run `/link` again.',
        ephemeral: true,
      });
    }
  }

  if (instance?.lockedByOwner) {
    return interaction.reply({
      content: '❌ Your hosted bot has been locked by the platform owner. Contact support.',
      ephemeral: true,
    });
  }

  const linkCheck = await validateHostedGuildLink(prisma, {
    actingUserId: user.id,
    targetGuildId: interaction.guildId,
    linkType,
    instance,
  });
  if (!linkCheck.ok) {
    return interaction.reply({ content: linkCheck.error, ephemeral: true });
  }

  if (instance?.guildId === interaction.guildId && instance.status === 'ACTIVE') {
    return interaction.reply({
      content: '✅ This server is already linked to your OpenSteam subscription. Try `/gen` or `/status`.',
      ephemeral: true,
    });
  }

  let oauthUrl;
  try {
    if (linkType === 'BRANDED') {
      const configs = await prisma.systemConfig.findMany({
        where: { key: { in: ['HOSTED_BRANDED_CLIENT_ID', 'HOSTED_BRANDED_CLIENT_SECRET'] } },
      });
      const map = Object.fromEntries(configs.map((c) => [c.key, c.value]));
      if (!map.HOSTED_BRANDED_CLIENT_ID || !map.HOSTED_BRANDED_CLIENT_SECRET) {
        return interaction.reply({
          content: '❌ Branded bot OAuth is not configured yet. Ask the platform owner to finish setup.',
          ephemeral: true,
        });
      }
      oauthUrl = buildBrandedLinkOAuthUrl({
        clientId: map.HOSTED_BRANDED_CLIENT_ID,
        guildId: interaction.guildId,
        discordId: interaction.user.id,
      });
    } else {
      oauthUrl = buildCustomLinkOAuthUrl({
        clientId: instance.botClientId,
        guildId: interaction.guildId,
        discordId: interaction.user.id,
      });
    }
  } catch (e) {
    return interaction.reply({
      content: `❌ Could not start OAuth link: ${e.message}`,
      ephemeral: true,
    });
  }

  return interaction.reply({
    content:
      '**Link this server to OpenSteam**\n\n' +
      '1. Click **Authorize & Link Server** below.\n' +
      '2. Sign in with the **same Discord account** you use on opensteam.lol.\n' +
      '3. After success, `/gen`, `/request`, and `/status` will work in this server.',
    ephemeral: true,
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Authorize & Link Server',
            url: oauthUrl,
          },
        ],
      },
    ],
  });
}

async function getHostedQuota(prisma, instance, purchaser, useApiLimit, genSource) {
  const dailyLimit = useApiLimit
    ? getApiDailyLimit(purchaser.plan, purchaser.customDailyLimit)
    : getWebDailyLimit(purchaser.plan, purchaser.customWebDailyLimit);
  const todayCount = useApiLimit
    ? await countUserApiUsageToday(prisma, purchaser.id)
    : await countHostedGenerationsToday(prisma, instance.id, genSource);
  return { todayCount, dailyLimit };
}

async function handleHostedInteraction(interaction, prisma, botS3Client, options = {}) {
  const { useApiLimit = false } = options;
  const genSource = useApiLimit ? 'discord-hosted-api' : 'discord-hosted';

  if (interaction.commandName === 'link') {
    return handleLinkCommand(interaction, prisma, options);
  }

  if (!interaction.guildId) {
    return interaction.reply({ content: '❌ Hosted bot commands only work in a server.', ephemeral: true });
  }

  const instance = await resolveHostedInstance(prisma, interaction.guildId, options.type);
  if (!instance) {
    return interaction.reply({
      content:
        '❌ This server is not linked to an active OpenSteam hosted bot subscription.\n\n' +
        'Run **`/link`** in this server to connect your subscription (or link from the dashboard).\n' +
        'Make sure the bot was invited to this server first.',
      ephemeral: true,
    });
  }

  if (!isPurchaserPlanValid(instance, instance.user)) {
    return interaction.reply({
      content: '❌ The subscription for this server is inactive. Renew your plan on opensteam.lol.',
      ephemeral: true,
    });
  }

  const purchaser = instance.user;
  const modules = instance.modules || ['gen', 'request', 'status', 'link', 'onlinefixes'];

  if (['gen', 'request', 'onlinefixes'].includes(interaction.commandName)) {
    if (!modules.includes(interaction.commandName)) {
      return interaction.reply({
        content: `❌ The \`${interaction.commandName}\` command module is disabled on this bot.`,
        ephemeral: true,
      });
    }
  }

  if (interaction.commandName === 'status') {
    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });

    await interaction.deferReply({ ephemeral: true });
    const { todayCount, dailyLimit } = await getHostedQuota(
      prisma,
      instance,
      purchaser,
      useApiLimit,
      genSource
    );

    const embed = new EmbedBuilder()
      .setTitle(`👤 Server Bot Status`)
      .setColor(0x6366f1)
      .addFields(
        { name: 'Server Plan', value: `**${purchaser.plan}**`, inline: true },
        {
          name: useApiLimit ? 'API Usage Today' : 'This Server Usage',
          value: `\`${todayCount}/${dailyLimit}\``,
          inline: true,
        },
        { name: 'Linked Account', value: `<@${purchaser.discordId}>`, inline: true },
        { name: 'Your Account', value: user ? user.username : interaction.user.username, inline: true },
      )
      .setFooter({ text: 'OpenSteam Hosted Bot' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === 'request') {
    const appId = interaction.options.getString('appid');
    const comment = interaction.options.getString('comment') || '';

    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });

    await interaction.deferReply({ ephemeral: true });

    try {
      const gameInfo = await getCachedSteamInfo(appId);
      const gameName = gameInfo?.name || `App ${appId}`;

      const existingManifest = await prisma.manifest.findUnique({
        where: { steamAppId: String(appId) },
        select: { steamAppId: true, name: true },
      });
      if (existingManifest) {
        return interaction.editReply(
          `❌ **Already Available**: **${existingManifest.name}** is already in our library.`
        );
      }

      const newRequest = await prisma.gameRequest.create({
        data: {
          appId: String(appId),
          name: gameName,
          userId: user ? user.id : purchaser.id,
          status: 'PENDING',
          reason: `[Hosted Discord] ${comment}`,
        },
      });

      const embed = new EmbedBuilder()
        .setTitle('📫 Game Request Submitted')
        .setDescription(`Your request for **${gameName}** has been sent to the OpenSteam indexing team.`)
        .setColor(0x00aaff)
        .addFields({ name: 'App ID', value: `\`${appId}\``, inline: true })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      const tokenCfg = await prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } });
      const botToken = tokenCfg?.value || options.botToken;
      if (botToken) {
        const steamUrl = appId ? `https://store.steampowered.com/app/${appId}` : null;
        const mgmtEmbed = {
          title: `🎮 New Game Request: ${gameName}`,
          url: steamUrl || undefined,
          description: comment || 'No additional details provided.',
          color: 0x6366f1,
          fields: [
            { name: 'App ID', value: appId ? `\`${appId}\`` : 'N/A', inline: true },
            { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Server', value: `\`${interaction.guildId}\``, inline: true },
            { name: 'Status', value: '⏳ PENDING', inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'OpenSteam Hosted Bot Request' },
        };

        const response = await fetch(`https://discord.com/api/v10/channels/${REQUESTS_CHANNEL_ID}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: `📫 **Hosted Bot Request** from <@${interaction.user.id}> (server \`${interaction.guildId}\`)`,
            embeds: [mgmtEmbed],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          await prisma.gameRequest.update({
            where: { id: newRequest.id },
            data: { discordMessageId: data.id, discordChannelId: REQUESTS_CHANNEL_ID },
          });
        }
      }
    } catch (e) {
      console.error('[Hosted Bot Request Error]', e);
      await interaction.editReply('❌ Error submitting request.');
    }
    return;
  }

  if (interaction.commandName === 'gen') {
    const parsedAppId = getGenAppIdFromInteraction(interaction);
    if (!parsedAppId.ok) {
      return interaction.reply({
        content: `❌ **Invalid App ID**: ${parsedAppId.message}`,
        ephemeral: true,
      });
    }
    const appId = parsedAppId.appId;

    const genConfig = await prisma.systemConfig.findUnique({ where: { key: 'GENERATION_ENABLED' } });
    if (genConfig && genConfig.value === 'false') {
      return interaction.reply({
        content: '🔒 **Generation Locked**: Manifest generation is currently suspended.',
        ephemeral: true,
      });
    }

    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
    if (user?.isBanned) {
      return interaction.reply({ content: '❌ **Account Banned**', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const { todayCount, dailyLimit } = await getHostedQuota(
        prisma,
        instance,
        purchaser,
        useApiLimit,
        genSource
      );

      if (useApiLimit) {
        const hasKey = await prisma.apiKey.findFirst({
          where: { userId: purchaser.id, enabled: true },
          select: { id: true },
        });
        if (!hasKey) {
          return interaction.editReply(
            '❌ **No API Keys**: Create at least one enabled API key on the OpenSteam dashboard before using `/gen`.'
          );
        }
      }

      if (todayCount >= dailyLimit) {
        const label = useApiLimit ? 'API limit' : 'Daily limit';
        return interaction.editReply(
          `❌ **${label} reached**: **${todayCount}/${dailyLimit}** used today (UTC).`
        );
      }

      const gameInfo = await getCachedSteamInfo(appId);
      const gameName = gameInfo?.name || `App ${appId}`;

      const nsfwKeywords = ['nudity', 'sexual content', 'nsfw', 'hentai', 'sexual violence'];
      const isNsfw = gameInfo?.genres?.some((g) => nsfwKeywords.includes(g.description?.toLowerCase()));
      if (isNsfw) {
        return interaction.editReply('❌ **NSFW content is not permitted.**');
      }

      let manifestData = await prisma.manifest.findUnique({ where: { steamAppId: String(appId) } });
      let isFileInStorage = false;
      const s3Key = `manifests/${appId}/${appId}.zip`;

      if (!manifestData && botS3Client && process.env.AWS_S3_BUCKET_NAME) {
        try {
          await botS3Client.send(new HeadObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: s3Key }));
          isFileInStorage = true;
        } catch (e) { /* local */ }
      }

      if (!manifestData && !isFileInStorage) {
        const path = require('path');
        const fs = require('fs');
        const storagePath = process.env.STORAGE_PATH || path.join(__dirname, '../../data');
        if (fs.existsSync(path.join(storagePath, 'manifests', appId, `${appId}.zip`))) {
          isFileInStorage = true;
        }
      }

      if (manifestData || isFileInStorage) {
        const dbName = manifestData?.name;
        const steamName = gameInfo?.name;
        const resolvedName = (steamName && (!dbName || isPlaceholderName(dbName))) ? steamName : (dbName || steamName || `App ${appId}`);
        if (steamName && dbName && isPlaceholderName(dbName)) {
          void passiveBackfillManifestName(prisma, appId, steamName);
        }

        await recordHostedBotGeneration(prisma, {
          purchaserUserId: purchaser.id,
          hostedBotInstanceId: instance.id,
          guildId: interaction.guildId,
          appId,
          gameName: resolvedName,
          source: genSource,
        });
        if (useApiLimit) {
          await consumeUserApiQuota(prisma, purchaser.id, '/discord/hosted-bot/gen', appId);
        }

        const usageLabel = useApiLimit ? 'API usage' : 'Server usage';
        const zipBuffer = await loadCachedManifestZip(appId);
        const embed = new EmbedBuilder()
          .setTitle('✅ Manifest Found (Cached)')
          .setDescription(gameInfo?.short_description || `**${resolvedName}** is available.`)
          .setColor(0x10b981)
          .addFields(
            { name: 'App ID', value: `\`${appId}\``, inline: true },
            { name: 'Source', value: 'Internal Cloud', inline: true },
          )
          .setFooter({ text: `${usageLabel}: ${todayCount + 1}/${dailyLimit}` })
          .setTimestamp();

        if (gameInfo?.header_image) embed.setThumbnail(gameInfo.header_image);
        await interaction.editReply({ embeds: [embed] });

        if (zipBuffer) {
          const delivery = await sendGenZipToRequester(interaction, {
            gameName: resolvedName,
            appId,
            zipBuffer,
            sourceLabel: 'Internal Cloud',
          });
          if (!delivery.sent) {
            await interaction.followUp({
              content: `⚠️ Could not send ZIP. Download via ${getGenAppUrl()}.`,
              flags: require('discord.js').MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        } else {
          await interaction.followUp({
            content: `⚠️ **${resolvedName}** (\`${appId}\`) is over Discord's ${MAX_GEN_DISCORD_ZIP_LABEL} limit. Sign in at ${getGenAppUrl()} to download it.`,
            flags: require('discord.js').MessageFlags.Ephemeral,
          }).catch(() => {});
        }
        return;
      }

      await interaction.editReply(`⏳ **Searching...** Checking upstream providers for \`${appId}\`...`);
      const result = await fetchExternalManifest(appId);
      if (!result.success) {
        return interaction.editReply(`❌ **Game Not Found**: App ID \`${appId}\` was not found.`);
      }

      await recordHostedBotGeneration(prisma, {
        purchaserUserId: purchaser.id,
        hostedBotInstanceId: instance.id,
        guildId: interaction.guildId,
        appId,
        gameName,
        source: genSource,
      });
      if (useApiLimit) {
        await consumeUserApiQuota(prisma, purchaser.id, '/discord/hosted-bot/gen', appId);
      }

      try {
        await upsertGenManifestRecord(prisma, appId, gameName, result.zipBuffer, purchaser.id);
      } catch (e) {
        console.warn('[Hosted Bot Gen] persist failed:', e.message);
      }

      const usageLabel = useApiLimit ? 'API usage' : 'Server usage';
      const zipTooLarge = result.zipBuffer.length > MAX_GEN_DISCORD_ZIP;
      const embed = new EmbedBuilder()
        .setTitle('✅ Manifest Found')
        .setDescription(gameInfo?.short_description || `**${gameName}** was found via upstream.`)
        .setColor(0x6366f1)
        .addFields(
          { name: 'App ID', value: `\`${appId}\``, inline: true },
          { name: 'Source', value: result.source || 'External', inline: true },
        )
        .setFooter({ text: `${usageLabel}: ${todayCount + 1}/${dailyLimit}` })
        .setTimestamp();

      if (gameInfo?.header_image) embed.setThumbnail(gameInfo.header_image);
      await interaction.editReply({ embeds: [embed] });

      if (!zipTooLarge) {
        const delivery = await sendGenZipToRequester(interaction, {
          gameName,
          appId,
          zipBuffer: result.zipBuffer,
          sourceLabel: result.source || 'External',
        });
        if (!delivery.sent) {
          await interaction.followUp({
            content: `⚠️ Could not send ZIP. Download via ${getGenAppUrl()}.`,
            flags: require('discord.js').MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      } else {
        await interaction.followUp({
          content: `⚠️ **${gameName}** (\`${appId}\`) is over Discord's ${MAX_GEN_DISCORD_ZIP_LABEL} limit. Sign in at ${getGenAppUrl()} to download it.`,
          flags: require('discord.js').MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[Hosted Bot Gen Error]', e);
      await interaction.editReply('❌ **System Error** while processing your request.');
    }
  }

  if (interaction.commandName === 'onlinefixes') {
    const gameName = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      const { AttachmentBuilder } = require('discord.js');
      const {
        searchOnlineFixViaApi,
        downloadOnlineFixArchive,
      } = require('./onlinefix-api');
      const axios = require('axios');

      const gamesToShow = await searchOnlineFixViaApi(gameName, {
        limit: 5,
        orderBySearch: true,
      }, { prismaClient: prisma });

      if (gamesToShow.length > 0) {
        const topGame = gamesToShow[0];
        let steamInfo = null;
        try {
          const { searchSteamStoreByName } = require('./steam-app-list');
          const searchRes = await searchSteamStoreByName(topGame.name);
          if (searchRes.length > 0) {
            const appId = searchRes[0].appid;
            const detailsRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
              timeout: 5000,
              validateStatus: () => true,
            });
            if (detailsRes.data?.[appId]?.success) steamInfo = detailsRes.data[appId].data;
          }
        } catch (e) {}

        const embed = new EmbedBuilder()
          .setTitle(`🎮 ${steamInfo ? steamInfo.name : topGame.name} (OnlineFix)`)
          .setColor(0x6366f1)
          .setTimestamp()
          .setFooter({ text: 'OpenSteam Hosted Bot OnlineFix Lookup' });

        if (steamInfo?.header_image) embed.setImage(steamInfo.header_image);

        let description = steamInfo?.short_description ? `${steamInfo.short_description}\n\n` : '';
        description += `**Found ${gamesToShow.length} Download(s):**\n`;
        gamesToShow.forEach((game, index) => {
          description += `> **${index + 1}.** ${game.name} — \`${game.fileSize || 'Unknown'}\`\n`;
        });

        const MAX_ONLINEFIX_DISCORD_FILE = 25 * 1024 * 1024;
        let s3FileAttachment = null;
        try {
          const archive = await downloadOnlineFixArchive(topGame.name, {
            maxBytes: MAX_ONLINEFIX_DISCORD_FILE,
          });
          if (archive?.buffer) {
            s3FileAttachment = new AttachmentBuilder(archive.buffer, { name: archive.fileName });
          } else {
            description += `\n⚠️ *The file for **${topGame.name}** exceeds Discord's 25 MB upload limit or is unavailable.*`;
          }
        } catch (e) {
          description += `\n⚠️ *Could not retrieve the file via the OnlineFix API.*`;
        }

        embed.setDescription(description.slice(0, 4096));
        const replyPayload = { embeds: [embed] };
        if (s3FileAttachment) {
          replyPayload.content = `📦 Here's your file — **${topGame.name}** attached below:`;
          replyPayload.files = [s3FileAttachment];
        } else {
          replyPayload.content = '🔍 Results found — see details below:';
        }
        await interaction.editReply(replyPayload);
      } else {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ No Games Found')
              .setDescription(`No OnlineFix games found for "${gameName}"`)
              .setColor(0xef4444)
              .setTimestamp(),
          ],
        });
      }
    } catch (e) {
      console.error('[Hosted Bot OnlineFix Error]', e);
      await interaction.editReply('❌ **System Error** while searching OnlineFix.');
    }
  }
}

module.exports = {
  BRANDED_HOSTED_COMMANDS,
  CUSTOM_HOSTED_COMMANDS,
  registerHostedCommands,
  handleHostedInteraction,
  initS3,
};
