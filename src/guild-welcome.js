const {
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");

const serverWelcome =
  "Thanks for adding **Den Den Mushi**! 🐌\n\n" +
  "A server admin can run `/setup` and choose a **Player and economy commands** channel " +
  "to get started. Other feature channels are optional and can be configured later.\n\n" +
  "Once set up, players can use `/start`, `/daily`, and `/profile`. " +
  "Use `/help` to explore more.";

const ownerWelcome =
  "Thanks for adding **Den Den Mushi** to your server! 🐌\n\n" +
  "**Quick setup**\n" +
  "1. Run `/setup` and choose a channel for **Player and economy commands**. " +
  "You need the **Manage Server** permission to configure it.\n" +
  "2. Make sure the bot can view and send messages in that channel.\n" +
  "3. Optionally, return to `/setup` to configure battles, crews, raids, Trivia, or Prompt of the Day.\n\n" +
  "Players can then use `/start`, `/daily`, and `/profile`. " +
  "Global slash commands may take up to an hour to appear after the bot is added.";

function canSendWelcome(channel, botMember) {
  if (
    !channel ||
    ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
  ) {
    return false;
  }

  const permissions = channel.permissionsFor(botMember);
  return Boolean(
    permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages
    ])
  );
}

function getWelcomeChannel(guild) {
  const botMember = guild.members.me;
  if (!botMember) return null;

  if (canSendWelcome(guild.systemChannel, botMember)) {
    return guild.systemChannel;
  }

  return guild.channels.cache
    .filter(channel => canSendWelcome(channel, botMember))
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .first() || null;
}

async function sendGuildWelcome(guild) {
  const channel = getWelcomeChannel(guild);
  if (channel) {
    try {
      await channel.send({ content: serverWelcome });
    } catch (error) {
      console.error(`Couldn't send the welcome message in ${guild.name}:`, error);
    }
  } else {
    console.warn(
      `Couldn't find a channel where the bot can post a welcome message in ${guild.name}.`
    );
  }

  try {
    const owner = await guild.fetchOwner();
    await owner.send({ content: ownerWelcome });
  } catch (error) {
    console.warn(`Couldn't DM the owner of ${guild.name}:`, error);
  }
}

module.exports = {
  sendGuildWelcome
};
