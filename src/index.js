
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  Partials
} = require("discord.js");
const { handleInteraction } = require("./commands");
const {
  handleMessage,
  recordMissionActivity
} = require("./message-replies");
const { startPotdScheduler } = require("./potd");
const { startTriviaScheduler } = require("./trivia");
const { handleActionMessage } = require("./actions");
const { sendGuildWelcome } = require("./guild-welcome");

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error(
    "Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token."
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel
  ]
});

client.once(Events.ClientReady, readyClient => {
  console.log(`Den Den Mushi is online as ${readyClient.user.tag}`);

  // Start the Prompt of the Day scheduler.
  startPotdScheduler(readyClient);

  // Start the automatic Trivia scheduler.
  startTriviaScheduler(readyClient);
});

client.on(Events.GuildCreate, guild => {
  sendGuildWelcome(guild).catch(error => {
    console.error(`Couldn't welcome the bot to ${guild.name}:`, error);
  });
});

// Handle slash commands, autocomplete, buttons and other interactions.
client.on(Events.InteractionCreate, async interaction => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.isRepliable()) return;

    const message =
      "Something went wrong. Please try again, and tell a moderator if it keeps happening.";

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: message,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: message,
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error("Couldn't send interaction error reply:", replyError);
    }
  }
});

// Handle social actions in DMs and servers.
// Handle ordinary message replies only in servers.
client.on(Events.MessageCreate, async message => {
  try {
    const missionFeedbackSent = await recordMissionActivity(message);

    if (missionFeedbackSent) return;

    const handled = await handleActionMessage(message);

    if (handled) return;

    // Never run ordinary server/game message handling in DMs.
    if (!message.guild) return;

    await handleMessage(message);
  } catch (error) {
    console.error("Message handling error:", error);
  }
});


// Log unexpected client errors instead of leaving them unnoticed.
client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

client.login(token).catch(error => {
  console.error("Failed to log in to Discord:", error);
  process.exitCode = 1;
});