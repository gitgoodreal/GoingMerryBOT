const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { getGuildChannel, setGuildChannel } = require("./db");

const channelProvisioning = new Map();

async function provisionCrewLogChannel(guild) {
  const savedChannelId = getGuildChannel(guild.id, "crew_logs");

  if (savedChannelId) {
    const savedChannel = await guild.channels.fetch(savedChannelId);
    if (savedChannel?.isTextBased()) return savedChannel;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    throw new Error("The bot's server member is unavailable.");
  }

  const botPermissions = botMember.permissions;
  if (
    !botPermissions.has(PermissionFlagsBits.ManageChannels) ||
    !botPermissions.has(PermissionFlagsBits.ManageRoles)
  ) {
    throw new Error(
      "The bot needs Manage Channels and Manage Roles to create a private crew log."
    );
  }

  const moderatorRoles = [...guild.roles.cache.values()]
    .filter(role =>
      role.id !== guild.id &&
      (
        role.permissions.has(PermissionFlagsBits.ManageGuild) ||
        role.permissions.has(PermissionFlagsBits.Administrator) ||
        role.permissions.has(PermissionFlagsBits.ManageChannels) ||
        role.permissions.has(PermissionFlagsBits.ManageRoles) ||
        role.permissions.has(PermissionFlagsBits.ManageMessages) ||
        role.permissions.has(PermissionFlagsBits.KickMembers) ||
        role.permissions.has(PermissionFlagsBits.BanMembers) ||
        role.permissions.has(PermissionFlagsBits.ModerateMembers)
      )
    );

  if (moderatorRoles.length > 98) {
    throw new Error(
      "This server has too many moderator roles to safely configure a private crew log channel."
    );
  }

  const channel = await guild.channels.create({
    name: "crew-logs",
    type: ChannelType.GuildText,
    topic: "Private activity history for pirate crews.",
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      ...moderatorRoles.map(role => ({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory
        ]
      })),
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ],
    reason: "Create a private crew activity log"
  });

  if (!setGuildChannel(guild.id, "crew_logs", channel.id)) {
    throw new Error("Couldn't save the new crew log channel.");
  }

  return channel;
}

async function ensureCrewLogChannel(guild) {
  const pending = channelProvisioning.get(guild.id);
  if (pending) return pending;

  const provisioning = provisionCrewLogChannel(guild);
  channelProvisioning.set(guild.id, provisioning);
  try {
    return await provisioning;
  } finally {
    if (channelProvisioning.get(guild.id) === provisioning) {
      channelProvisioning.delete(guild.id);
    }
  }
}

async function logCrewActivity(guild, crew, title, description, options = {}) {
  const channel = await ensureCrewLogChannel(guild);
  const imageData = options.bannerImage
    ? Buffer.from(options.bannerImage)
    : null;
  const bannerFilename = "crew-banner-log.jpg";
  const guildIcon = guild.iconURL?.();
  const embed = new EmbedBuilder()
    .setColor(0xd8a33e)
    .setAuthor({
      name: "DEN DEN MUSHI  •  CREW ACTIVITY",
      ...(guildIcon ? { iconURL: guildIcon } : {})
    })
    .setTitle(title)
    .setDescription(description.slice(0, 4000))
    .addFields({
      name: "Crew",
      value: `${crew.name} [${crew.abbreviation}]`,
      inline: true
    })
    .addFields(...(options.fields || []))
    .setFooter({
      text: `${guild.name || "Server"}  •  Private crew log`
    })
    .setTimestamp();

  if (imageData) {
    embed.setImage(`attachment://${bannerFilename}`);
  }

  await channel.send({
    embeds: [embed],
    ...(imageData
      ? {
          files: [{
            attachment: imageData,
            name: bannerFilename,
            description: `${crew.name} crew banner`
          }]
        }
      : {}),
    allowedMentions: { parse: [] }
  });
}

module.exports = {
  ensureCrewLogChannel,
  logCrewActivity
};
