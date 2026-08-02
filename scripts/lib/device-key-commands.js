const { v4: uuidv4 } = require('uuid')
const { EmbedBuilder } = require('discord.js')

function planRateLimit(plan) {
  switch (plan) {
    case 'REGULAR':
      return 500
    case 'PREMIUM':
      return 5000
    case 'RESELLER':
    case 'CUSTOM':
      return 20000
    case 'BUSINESS':
      return 20000
    default:
      return 15
  }
}

function assertDiscordGuildAccess(user) {
  if (user?.discordGuildBannedAt) {
    return {
      ok: false,
      error: 'You are banned from the OpenSteam Discord server. API keys are disabled.',
    }
  }
  if (user?.discordMemberStatus === 'left' && !['ADMIN', 'OWNER'].includes(user?.role || '')) {
    return {
      ok: false,
      error: 'Rejoin the OpenSteam Discord server to get an API key.',
    }
  }
  return { ok: true }
}

async function handleKeyPair(interaction, prisma) {
  const code = (interaction.options.getString('code') || '').trim().toUpperCase()
  if (!code || code.length < 6) {
    return interaction.reply({ content: '❌ Enter the pairing code shown in OpenSteam App (Settings → Get API key).', ephemeral: true })
  }

  const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } })
  if (!user) {
    return interaction.reply({
      content: '❌ Link your Discord account first — complete verification in the server, then try again.',
      ephemeral: true,
    })
  }

  const guildAccess = assertDiscordGuildAccess(user)
  if (!guildAccess.ok) {
    return interaction.reply({ content: `❌ ${guildAccess.error}`, ephemeral: true })
  }

  await interaction.deferReply({ ephemeral: true })

  const pairing = await prisma.devicePairing.findUnique({ where: { code } })
  if (!pairing) {
    return interaction.editReply('❌ Invalid pairing code. Generate a new one in OpenSteam App → Settings.')
  }
  if (pairing.expiresAt < new Date()) {
    return interaction.editReply('❌ Pairing code expired. Generate a new code in the app and run `/key pair` again.')
  }
  if (pairing.apiKeyId) {
    return interaction.editReply('❌ This code was already used. Generate a new code in the app if you need another device.')
  }

  const existingForDevice = await prisma.apiKey.findFirst({
    where: { machineId: pairing.machineId, enabled: true },
  })
  if (existingForDevice && existingForDevice.userId !== user.id) {
    return interaction.editReply('❌ This device is already linked to another account.')
  }

  const existingForUserDevice = await prisma.apiKey.findFirst({
    where: { userId: user.id, machineId: pairing.machineId },
  })
  if (existingForUserDevice) {
    await prisma.devicePairing.update({
      where: { id: pairing.id },
      data: { apiKeyId: existingForUserDevice.id },
    })
    try {
      await interaction.user.send(
        `🔑 **OpenSteam API key** (existing device)\n\`${existingForUserDevice.key}\`\n\nPaste this in OpenSteam App if prompted, or restart the app — it should pick it up automatically.`
      )
    } catch {
      return interaction.editReply(`Your key: \`${existingForUserDevice.key}\` (enable DMs to receive it privately)`)
    }
    return interaction.editReply('✅ This device already had a key — sent to your DMs.')
  }

  const keyValue = `mg_${uuidv4().replace(/-/g, '')}`
  const apiKey = await prisma.apiKey.create({
    data: {
      key: keyValue,
      name: `Desktop · ${pairing.machineId.slice(0, 8)}`,
      userId: user.id,
      machineId: pairing.machineId,
      createdVia: 'DISCORD',
      rateLimit: planRateLimit(user.plan),
      rateWindow: 3600,
    },
  })

  await prisma.devicePairing.update({
    where: { id: pairing.id },
    data: { apiKeyId: apiKey.id },
  })

  await prisma.keyAudit.create({
    data: { apiKeyId: apiKey.id, action: 'CREATED', details: { source: 'discord_key_pair' } },
  }).catch(() => {})

  try {
    await interaction.user.send(
      `🔑 **OpenSteam API key** (one per device)\n\`${keyValue}\`\n\nThis key is bound to your PC. Open OpenSteam App — it will detect the key automatically, or paste it in Settings.\n\n**Do not share this key.**`
    )
    return interaction.editReply('✅ API key created and sent to your DMs. Return to OpenSteam App to finish setup.')
  } catch {
    return interaction.editReply(
      `✅ Key created:\n\`${keyValue}\`\n\nEnable DMs from server members to receive keys privately next time.`
    )
  }
}

async function handleKeyStatus(interaction, prisma) {
  const user = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
    include: { apiKeys: { where: { enabled: true }, orderBy: { createdAt: 'desc' } } },
  })

  if (!user) {
    return interaction.reply({ content: '❌ No OpenSteam account found for your Discord.', ephemeral: true })
  }

  const keys = user.apiKeys
  if (!keys.length) {
    return interaction.reply({
      content: 'ℹ️ No API keys yet. Open **OpenSteam App** → Settings → **Get API key**, then run `/key pair`.',
      ephemeral: true,
    })
  }

  const embed = new EmbedBuilder()
    .setTitle('🔑 Your OpenSteam API keys')
    .setColor(0x22d3ee)
    .setDescription('One key per device. Keys are issued via Discord only.')
    .setFooter({ text: 'OpenSteam · Device-bound keys' })

  for (const k of keys.slice(0, 5)) {
    const device = k.machineId ? `\`${k.machineId.slice(0, 12)}…\`` : 'Unknown device'
    embed.addFields({
      name: k.name,
      value: `Device: ${device}\nCreated: <t:${Math.floor(new Date(k.createdAt).getTime() / 1000)}:R>`,
      inline: false,
    })
  }

  return interaction.reply({ embeds: [embed], ephemeral: true })
}

async function handleKeyShow(interaction, prisma) {
  const user = await prisma.user.findUnique({
    where: { discordId: interaction.user.id },
    include: { apiKeys: { where: { enabled: true }, orderBy: { createdAt: 'desc' } } },
  })

  if (!user) {
    return interaction.reply({ content: '❌ No OpenSteam account found for your Discord.', ephemeral: true })
  }

  const guildAccess = assertDiscordGuildAccess(user)
  if (!guildAccess.ok) {
    return interaction.reply({ content: `❌ ${guildAccess.error}`, ephemeral: true })
  }

  const keys = user.apiKeys
  if (!keys.length) {
    return interaction.reply({
      content: 'ℹ️ No API keys yet.\n\n1. Open **OpenSteam App** on that PC → Settings → **Get API key**\n2. Run `/key pair code:YOURCODE`\n\nEach device gets its own key.',
      ephemeral: true,
    })
  }

  await interaction.deferReply({ ephemeral: true })

  const lines = keys.map((k, i) => {
    const device = k.machineId ? `Device \`${k.machineId.slice(0, 12)}…\`` : k.name
    return `**${device}**\n\`${k.key}\``
  })

  const body = `🔑 **Your OpenSteam API keys** (one per device)\n\n${lines.join('\n\n')}\n\n**Do not share these keys.**`

  try {
    await interaction.user.send(body)
    return interaction.editReply(`✅ Sent ${keys.length} key${keys.length === 1 ? '' : 's'} to your DMs (one per device).`)
  } catch {
    return interaction.editReply(`${body}\n\n_Enable DMs from server members to receive keys privately next time._`)
  }
}

async function resolvePlatformUser(prisma, raw) {
  const id = (raw || '').replace(/[<@!>]/g, '').trim()
  if (!id) return null
  return prisma.user.findFirst({
    where: { OR: [{ id }, { discordId: id }] },
  })
}

async function handleAdminCreateKey(interaction, prisma, adminUser) {
  const targetRaw = interaction.options.getString('user')
  const force = interaction.options.getBoolean('force') === true

  await interaction.deferReply({ ephemeral: true })

  const user = await resolvePlatformUser(prisma, targetRaw)
  if (!user) {
    return interaction.editReply('❌ User not found.')
  }

  const existing = await prisma.apiKey.findMany({
    where: { userId: user.id, enabled: true },
    orderBy: { createdAt: 'desc' },
  })

  if (existing.length && force) {
    for (const k of existing) {
      await prisma.apiKey.update({
        where: { id: k.id },
        data: { enabled: false },
      })
      await prisma.keyAudit.create({
        data: { apiKeyId: k.id, action: 'REVOKED', details: { source: 'admin_create_key_force', by: adminUser.id } },
      }).catch(() => {})
    }
  }

  const keyValue = `mg_${uuidv4().replace(/-/g, '')}`
  const apiKey = await prisma.apiKey.create({
    data: {
      key: keyValue,
      name: `Admin issued · ${user.username}`,
      userId: user.id,
      createdVia: 'ADMIN',
      rateLimit: planRateLimit(user.plan),
      rateWindow: 3600,
    },
  })

  await prisma.keyAudit.create({
    data: { apiKeyId: apiKey.id, action: 'CREATED', details: { source: 'admin_create_key', by: adminUser.id } },
  }).catch(() => {})

  await prisma.auditLog.create({
    data: {
      userId: adminUser.id,
      action: 'ADMIN_CREATE_KEY',
      targetId: user.id,
      details: `Issued API key via Discord bot${force ? ' (forced)' : ''}`,
      ip: 'DiscordBot',
    },
  }).catch(() => {})

  if (user.discordId) {
    try {
      const member = await interaction.client.users.fetch(user.discordId)
      await member.send(
        `🔑 **OpenSteam API key** (issued by staff)\n\`${keyValue}\`\n\nPaste this in OpenSteam App → Settings.\n**Do not share this key.**`
      )
    } catch {
      /* DM failed — admin still gets the key below */
    }
  }

  return interaction.editReply(
    `✅ Created API key for **${user.username}**${user.discordId ? ' (DM attempted)' : ''}:\n\`${keyValue}\``
  )
}

async function handleAdminListKeys(interaction, prisma) {
  const targetRaw = interaction.options.getString('user')

  await interaction.deferReply({ ephemeral: true })

  const user = await resolvePlatformUser(prisma, targetRaw)
  if (!user) {
    return interaction.editReply('❌ User not found.')
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (!keys.length) {
    return interaction.editReply(`ℹ️ **${user.username}** has no API keys.`)
  }

  const embed = new EmbedBuilder()
    .setTitle(`🔑 API keys · ${user.username}`)
    .setColor(0x6366f1)
    .setDescription(`Discord: ${user.discordId ? `<@${user.discordId}>` : 'none'} · User ID: \`${user.id}\``)

  for (const k of keys) {
    const device = k.machineId ? `\`${k.machineId.slice(0, 12)}…\`` : 'Unbound'
    embed.addFields({
      name: `${k.enabled ? '🟢' : '🔴'} ${k.name}`,
      value: `Key: \`${k.key}\`\nDevice: ${device} · Via: ${k.createdVia}\nCreated: <t:${Math.floor(new Date(k.createdAt).getTime() / 1000)}:R>`,
      inline: false,
    })
  }

  return interaction.editReply({ embeds: [embed] })
}

module.exports = {
  handleKeyPair,
  handleKeyStatus,
  handleKeyShow,
  handleAdminCreateKey,
  handleAdminListKeys,
  planRateLimit,
}
