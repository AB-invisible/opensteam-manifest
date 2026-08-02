/**
 * Assigns the Discord donator role only — never changes platform staff role.
 */
async function assignDonatorDiscordRole(prisma, discordId) {
  const normalizedId = String(discordId || '').trim();
  if (!/^\d{17,20}$/.test(normalizedId)) return false;

  try {
    const [guildConfig, tokenConfig, roleIdConfig] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_DONATOR_ROLE_ID' } }),
    ]);

    const guildId = guildConfig?.value || process.env.DISCORD_GUILD_ID;
    const botToken = tokenConfig?.value || process.env.DISCORD_BOT_TOKEN;
    if (!guildId || !botToken) return false;

    let roleId = roleIdConfig?.value || process.env.DISCORD_DONATOR_ROLE_ID || null;

    if (!roleId) {
      const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (!rolesRes.ok) return false;
      const roles = await rolesRes.json();
      const donatorRole = roles.find((role) => role.name.toLowerCase().includes('donator'));
      roleId = donatorRole?.id || null;
    }

    if (!roleId) return false;

    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${normalizedId}/roles/${roleId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bot ${botToken}` },
      }
    );

    return res.ok || res.status === 204;
  } catch (error) {
    console.error('[Assign Donator Role Error]', error);
    return false;
  }
}

module.exports = { assignDonatorDiscordRole };
