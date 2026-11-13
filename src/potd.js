"use strict";

require("dotenv").config();

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const { setGuildChannel } = require("./db");

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

const databasePath =
  process.env.DATABASE_PATH ||
  path.join(__dirname, "..", "data", "den-den-mushi.sqlite");

fs.mkdirSync(path.dirname(path.resolve(databasePath)), {
  recursive: true
});

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS potd_settings (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    post_time TEXT NOT NULL DEFAULT '19:00',
    role_id TEXT
  );

  CREATE TABLE IF NOT EXISTS potd_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    post_date TEXT NOT NULL,
    prompt_id TEXT NOT NULL,
    prompt_category TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'posting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, post_date)
  );
`);

db.exec(`
  INSERT OR IGNORE INTO guild_channel_settings (guild_id, feature, channel_id)
  SELECT guild_id, 'potd', channel_id
  FROM potd_settings;
`);

// Migrate existing databases without deleting saved settings.
const settingsColumns = db.prepare(`
  PRAGMA table_info(potd_settings)
`).all();

if (!settingsColumns.some(column => column.name === "role_id")) {
  db.exec(`
    ALTER TABLE potd_settings ADD COLUMN role_id TEXT
  `);
}

// --------------------------------------------------
// PREWRITTEN PROMPT BANK
// --------------------------------------------------

const PROMPTS = [
  {
    id: "op001",
    category: "One Piece",
    question: "Which Straw Hat has had the most underrated character development, and why?"
  },
  {
    id: "op002",
    category: "One Piece",
    question: "If you could eat any Devil Fruit, which would you choose?"
  },
  {
    id: "op003",
    category: "One Piece",
    question: "Which One Piece villain had the most convincing motivations?"
  },
  {
    id: "op004",
    category: "One Piece",
    question: "Which island in the One Piece world would you actually want to visit?"
  },
  {
    id: "op005",
    category: "One Piece",
    question: "Who would win a cooking competition: Sanji, Pudding, or Zeff?"
  },
  {
    id: "op006",
    category: "One Piece",
    question: "Which fight had the best emotional payoff?"
  },
  {
    id: "op007",
    category: "One Piece",
    question: "If you could change one decision made by a Straw Hat, what would it be?"
  },
  {
    id: "op008",
    category: "One Piece",
    question: "Which character deserves a longer backstory?"
  },
  {
    id: "op009",
    category: "One Piece",
    question: "Would you rather have Observation Haki or Armament Haki?"
  },
  {
    id: "op010",
    category: "One Piece",
    question: "Which crew outside the Straw Hats would you join?"
  },
  {
    id: "op011",
    category: "One Piece",
    question: "What is your most controversial One Piece opinion?"
  },
  {
    id: "op012",
    category: "One Piece",
    question: "Which character would be the worst person to share a room with?"
  },
  {
    id: "op013",
    category: "One Piece",
    question: "If you could revive one character, who would it be?"
  },
  {
    id: "op014",
    category: "One Piece",
    question: "Which Straw Hat would survive longest without the others?"
  },
  {
    id: "op015",
    category: "One Piece",
    question: "What moment made you realize One Piece was special?"
  },
  {
    id: "com001",
    category: "Community",
    question: "What is one completely useless skill you are weirdly proud of?"
  },
  {
    id: "com002",
    category: "Community",
    question: "What is the funniest thing that happened to you recently?"
  },
  {
    id: "com003",
    category: "Community",
    question: "If our server were a pirate crew, what role would you have?"
  },
  {
    id: "com004",
    category: "Community",
    question: "What is a food combination you love that other people judge?"
  },
  {
    id: "com005",
    category: "Community",
    question: "What fictional world would you absolutely refuse to live in?"
  },
  {
    id: "com006",
    category: "Community",
    question: "What is your most harmless hot take?"
  },
  {
    id: "com007",
    category: "Community",
    question: "If you could instantly master one skill, what would it be?"
  },
  {
    id: "com008",
    category: "Community",
    question: "What is the most ridiculous thing you believed as a kid?"
  },
  {
    id: "com009",
    category: "Community",
    question: "You get one million Berries, but a random member chooses your new nickname for a week. Deal?"
  },
  {
    id: "com010",
    category: "Community",
    question: "Which fictional character would be the funniest person to have in this server?"
  },
  {
    id: "com011",
    category: "Community",
    question: "What is your biggest green flag in a friendship?"
  },
  {
    id: "com012",
    category: "Community",
    question: "Describe your current mood using only a movie title."
  },
  {
    id: "com013",
    category: "Community",
    question: "What is a small thing that instantly improves your day?"
  },
  {
    id: "com014",
    category: "Community",
    question: "If the server had a mascot, what should it be?"
  },
  {
    id: "com015",
    category: "Community",
    question: "What is the most chaotic but harmless challenge we could run in this server?"
  }
];

// --------------------------------------------------
// TIMEZONE OPTIONS
// --------------------------------------------------

const TIMEZONES = [
  { label: "India — Kolkata", value: "Asia/Kolkata" },
  { label: "UTC", value: "Etc/UTC" },
  { label: "Japan — Tokyo", value: "Asia/Tokyo" },
  { label: "Singapore", value: "Asia/Singapore" },
  { label: "Dubai", value: "Asia/Dubai" },
  { label: "Bangladesh — Dhaka", value: "Asia/Dhaka" },
  { label: "Nepal — Kathmandu", value: "Asia/Kathmandu" },
  { label: "China — Shanghai", value: "Asia/Shanghai" },
  { label: "South Korea — Seoul", value: "Asia/Seoul" },
  { label: "Thailand — Bangkok", value: "Asia/Bangkok" },
  { label: "United Kingdom — London", value: "Europe/London" },
  { label: "France — Paris", value: "Europe/Paris" },
  { label: "Germany — Berlin", value: "Europe/Berlin" },
  { label: "Moscow", value: "Europe/Moscow" },
  { label: "US Eastern — New York", value: "America/New_York" },
  { label: "US Central — Chicago", value: "America/Chicago" },
  { label: "US Mountain — Denver", value: "America/Denver" },
  { label: "US Pacific — Los Angeles", value: "America/Los_Angeles" },
  { label: "Canada — Toronto", value: "America/Toronto" },
  { label: "Brazil — São Paulo", value: "America/Sao_Paulo" },
  { label: "South Africa — Johannesburg", value: "Africa/Johannesburg" },
  { label: "Australia — Sydney", value: "Australia/Sydney" },
  { label: "New Zealand — Auckland", value: "Pacific/Auckland" },
  { label: "Hong Kong", value: "Asia/Hong_Kong" }
];

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  label: `${String(hour).padStart(2, "0")}:00 hour`,
  value: String(hour).padStart(2, "0")
}));

const MINUTES = Array.from({ length: 12 }, (_, index) => {
  const minute = String(index * 5).padStart(2, "0");

  return {
    label: `${minute} minutes`,
    value: minute
  };
});

// Setup sessions are temporary; saved settings are stored in SQLite.
const setupSessions = new Map();

function getSessionKey(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone
    }).format(new Date());

    return true;
  } catch {
    return false;
  }
}

function canManagePotd(interaction) {
  return Boolean(
    interaction.inGuild() &&
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function getSettings(guildId) {
  return db.prepare(`
    SELECT * FROM potd_settings WHERE guild_id = ?
  `).get(guildId);
}

function setPotdChannel(guildId, channelId) {
  db.prepare(`
    INSERT INTO potd_settings (guild_id, channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id
  `).run(guildId, channelId);
  setGuildChannel(guildId, "potd", channelId);
}

function getPostForDate(guildId, date) {
  return db.prepare(`
    SELECT * FROM potd_posts
    WHERE guild_id = ? AND post_date = ?
  `).get(guildId, date);
}

// --------------------------------------------------
// SLASH COMMANDS
// --------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("potd")
    .setDescription("View the latest Prompt of the Day."),

  new SlashCommandBuilder()
    .setName("potd-admin")
    .setDescription("Configure and manage the daily prompt.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName("setup")
        .setDescription("Configure the POTD channel, timezone, schedule and ping role.")
        .addChannelOption(option =>
          option.setName("channel")
            .setDescription("Channel where daily prompts will be posted.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("preview")
        .setDescription("Preview a prompt without posting it.")
    )
    .addSubcommand(sub =>
      sub.setName("post")
        .setDescription("Post a prompt immediately.")
    )
    .addSubcommand(sub =>
      sub.setName("skip")
        .setDescription("Skip today's scheduled prompt.")
    )
];

// --------------------------------------------------
// DATE AND PROMPT HELPERS
// --------------------------------------------------

function getLocalParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const result = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return {
    date: `${result.year}-${result.month}-${result.day}`,
    time: `${result.hour}:${result.minute}`
  };
}

function choosePrompt(guildId, date) {
  const previous = db.prepare(`
    SELECT prompt_id FROM potd_posts
    WHERE guild_id = ?
    ORDER BY id DESC
    LIMIT 40
  `).all(guildId);

  const used = new Set(previous.map(row => row.prompt_id));

  let available = PROMPTS.filter(prompt => !used.has(prompt.id));

  if (!available.length) {
    available = PROMPTS.slice();
  }

  const dayNumber = Math.floor(
    Date.parse(`${date}T00:00:00Z`) / 86400000
  );

  const preferredCategory =
    dayNumber % 2 === 0 ? "One Piece" : "Community";

  const preferred = available.filter(
    prompt => prompt.category === preferredCategory
  );

  const pool = preferred.length ? preferred : available;

  const seed = `${guildId}:${date}`;
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return pool[hash % pool.length];
}

// --------------------------------------------------
// INTERACTIVE ADMIN SETUP UI
// --------------------------------------------------

function buildSetupMessage(session) {
  const time = `${session.hour}:${session.minute}`;

  const timezoneLabel =
    TIMEZONES.find(item => item.value === session.timezone)?.label ||
    session.timezone;

  const selectedRoleText = session.roleId
    ? `<@&${session.roleId}>`
    : "No role selected — POTD will not ping a role.";

  const timezoneMenu = new StringSelectMenuBuilder()
    .setCustomId("potd:timezone")
    .setPlaceholder("Choose a timezone")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      TIMEZONES.map(item => ({
        label: item.label,
        value: item.value,
        default: item.value === session.timezone
      }))
    );

  const hourMenu = new StringSelectMenuBuilder()
    .setCustomId("potd:hour")
    .setPlaceholder("Select hour")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      HOURS.map(item => ({
        ...item,
        default: item.value === session.hour
      }))
    );

  const minuteMenu = new StringSelectMenuBuilder()
    .setCustomId("potd:minute")
    .setPlaceholder("Select minute")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      MINUTES.map(item => ({
        ...item,
        default: item.value === session.minute
      }))
    );

  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId("potd:role")
    .setPlaceholder("Choose any server role to ping")
    .setMinValues(0)
    .setMaxValues(1);

  const timezoneRow = new ActionRowBuilder()
    .addComponents(timezoneMenu);

  const hourRow = new ActionRowBuilder()
    .addComponents(hourMenu);

  const minuteRow = new ActionRowBuilder()
    .addComponents(minuteMenu);

  const roleRow = new ActionRowBuilder()
    .addComponents(roleMenu);

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("potd:custom-timezone")
      .setLabel("Custom timezone")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("potd:save")
      .setLabel("Save settings")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("potd:cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  return {
    content:
      "**🐌 Den Den Mushi — POTD Setup**\n\n" +
      `**Posting channel:** <#${session.channelId}>\n` +
      `**Timezone:** \`${session.timezone}\` (${timezoneLabel})\n` +
      `**Daily posting time:** \`${time}\`\n` +
      `**Role to ping:** ${selectedRoleText}\n\n` +
      "1. Choose your server's timezone.\n" +
      "2. Select the hour and minute for the daily post.\n" +
      "3. Choose a role using the role selector below. This role will be pinged whenever POTD is posted.\n" +
      "4. Leave the role unselected if you don't want POTD to ping anyone. Select a role again to change it.\n" +
      "5. Use **Custom timezone** if your timezone isn't listed.\n" +
      "6. Press **Save settings** when you're ready.\n\n" +
      "_Times use the selected timezone. Minute options are in five-minute increments._",
    components: [
      timezoneRow,
      hourRow,
      minuteRow,
      roleRow,
      buttonRow
    ]
  };
}

// --------------------------------------------------
// POTD COMPONENT HANDLER
// --------------------------------------------------

async function handlePotdComponent(interaction) {
  const isPotdComponent =
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isRoleSelectMenu() ||
    interaction.isModalSubmit();

  if (!isPotdComponent) return false;

  const customId = interaction.customId || "";

  if (!customId.startsWith("potd:")) return false;

  if (!canManagePotd(interaction)) {
    await interaction.reply({
      content: "You need Manage Server permission to manage POTD.",
      ephemeral: true
    });

    return true;
  }

  const key = getSessionKey(interaction);
  const session = setupSessions.get(key);

  if (!session) {
    await interaction.reply({
      content: "This setup session has expired. Run `/potd-admin setup` again.",
      ephemeral: true
    });

    return true;
  }

  // Timezone, hour and minute dropdowns.
  if (interaction.isStringSelectMenu()) {
    const selected = interaction.values[0];

    if (customId === "potd:timezone") {
      session.timezone = selected;
    } else if (customId === "potd:hour") {
      session.hour = selected;
    } else if (customId === "potd:minute") {
      session.minute = selected;
    } else {
      return false;
    }

    await interaction.update(buildSetupMessage(session));
    return true;
  }

  // Native Discord role selector.
  if (
    interaction.isRoleSelectMenu() &&
    customId === "potd:role"
  ) {
    // No selected value means the admin cleared the role selection.
    session.roleId = interaction.values?.[0] || null;

    await interaction.update(buildSetupMessage(session));
    return true;
  }

  // Open the custom timezone modal.
  if (
    interaction.isButton() &&
    customId === "potd:custom-timezone"
  ) {
    const modal = new ModalBuilder()
      .setCustomId("potd:custom-timezone-modal")
      .setTitle("Set a custom timezone");

    const timezoneInput = new TextInputBuilder()
      .setCustomId("timezone")
      .setLabel("IANA timezone")
      .setPlaceholder("Example: America/New_York")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100)
      .setValue(session.timezone);

    modal.addComponents(
      new ActionRowBuilder().addComponents(timezoneInput)
    );

    await interaction.showModal(modal);
    return true;
  }

  // Save a timezone submitted through the modal.
  if (
    interaction.isModalSubmit() &&
    customId === "potd:custom-timezone-modal"
  ) {
    const timezone = interaction.fields
      .getTextInputValue("timezone")
      .trim();

    if (!isValidTimezone(timezone)) {
      await interaction.reply({
        content:
          "That timezone wasn't recognized. Use an IANA timezone such as `Asia/Kolkata`, `Europe/London`, or `America/New_York`, then try again.",
        ephemeral: true
      });

      return true;
    }

    session.timezone = timezone;

    await interaction.reply({
      ...buildSetupMessage(session),
      ephemeral: true
    });

    return true;
  }

  // Save all settings, including the selected role.
  if (
    interaction.isButton() &&
    customId === "potd:save"
  ) {
    if (!isValidTimezone(session.timezone)) {
      await interaction.reply({
        content: "The selected timezone is invalid. Please choose it again.",
        ephemeral: true
      });

      return true;
    }

    const time = `${session.hour}:${session.minute}`;

    db.prepare(`
      INSERT INTO potd_settings
        (guild_id, channel_id, timezone, post_time, role_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        timezone = excluded.timezone,
        post_time = excluded.post_time,
        role_id = excluded.role_id
    `).run(
      interaction.guildId,
      session.channelId,
      session.timezone,
      time,
      session.roleId
    );
    setGuildChannel(interaction.guildId, "potd", session.channelId);

    setupSessions.delete(key);

    await interaction.update({
      content:
        "**✅ POTD settings saved!**\n\n" +
        `**Channel:** <#${session.channelId}>\n` +
        `**Timezone:** \`${session.timezone}\`\n` +
        `**Daily posting time:** \`${time}\`\n` +
        `**Role to ping:** ${
          session.roleId
            ? `<@&${session.roleId}>`
            : "None"
        }\n\n` +
        "Your settings are saved in the database and will survive bot restarts.\n" +
        "The scheduler will use these settings for future daily prompts.",
      components: []
    });

    return true;
  }

  // Cancel setup without changing saved settings.
  if (
    interaction.isButton() &&
    customId === "potd:cancel"
  ) {
    setupSessions.delete(key);

    await interaction.update({
      content: "POTD setup cancelled. Your saved settings have not been changed.",
      components: []
    });

    return true;
  }

  return false;
}

// --------------------------------------------------
// POST A PROMPT
// --------------------------------------------------

async function postPrompt(client, guildId, date, options = {}) {
  const settings = getSettings(guildId);

  if (!settings) {
    return {
      success: false,
      message: "POTD isn't configured. Use `/potd-admin setup` first."
    };
  }

  let localDate;

  try {
    localDate = getLocalParts(
      new Date(),
      settings.timezone
    ).date;
  } catch {
    return {
      success: false,
      message: "The saved timezone is invalid. Run `/potd-admin setup` again."
    };
  }

  const postDate = date || options.date || localDate;
  const existing = getPostForDate(guildId, postDate);

  if (!options.force && existing) {
    return {
      success: false,
      message: "A prompt has already been recorded for today."
    };
  }

  const prompt = choosePrompt(guildId, postDate);

  try {
    db.prepare(`
      INSERT INTO potd_posts
        (guild_id, post_date, prompt_id, prompt_category, channel_id, status)
      VALUES (?, ?, ?, ?, ?, 'posting')
    `).run(
      guildId,
      postDate,
      prompt.id,
      prompt.category,
      settings.channel_id
    );
  } catch (error) {
    if (String(error.code).includes("SQLITE_CONSTRAINT")) {
      return {
        success: false,
        message: "A prompt has already been scheduled or posted for this date."
      };
    }

    throw error;
  }

  try {
    const channel = await client.channels.fetch(settings.channel_id);

    if (!channel || !channel.isTextBased() || !channel.threads) {
      throw new Error(
        "Configured channel is unavailable or cannot create threads."
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("🐌 Prompt of the Day")
      .setDescription(`**${prompt.question}**`)
      .addFields(
        {
          name: "Category",
          value: prompt.category,
          inline: true
        },
        {
          name: "Date",
          value: postDate,
          inline: true
        }
      )
      .setFooter({
        text: "Den Den Mushi • Join the discussion below!"
      })
      .setTimestamp();

    // The selected role mention is sent OUTSIDE the embed.
    // allowedMentions ensures only the configured role can be pinged.
    const roleId = settings.role_id || null;

    const message = await channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [embed],
      allowedMentions: {
        parse: [],
        roles: roleId ? [roleId] : [],
        users: [],
        repliedUser: false
      }
    });

    let thread = null;

    try {
      thread = await message.startThread({
        name: `POTD · ${postDate}`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: "Daily Prompt of the Day discussion"
      });
    } catch (error) {
      console.error("POTD thread creation failed:", error);
    }

    db.prepare(`
      UPDATE potd_posts
      SET message_id = ?, thread_id = ?, status = 'posted'
      WHERE guild_id = ? AND post_date = ?
    `).run(
      message.id,
      thread?.id || null,
      guildId,
      postDate
    );

    return {
      success: true,
      message:
        `Posted today's prompt in <#${settings.channel_id}>` +
        `${thread ? ` with a discussion thread: <#${thread.id}>` : ""}.` +
        `${roleId ? ` Pinged <@&${roleId}>.` : ""}`,
      prompt
    };
  } catch (error) {
    db.prepare(`
      DELETE FROM potd_posts
      WHERE guild_id = ? AND post_date = ? AND status = 'posting'
    `).run(guildId, postDate);

    throw error;
  }
}

function getLatestPost(guildId) {
  return db.prepare(`
    SELECT * FROM potd_posts
    WHERE guild_id = ? AND status = 'posted'
    ORDER BY id DESC
    LIMIT 1
  `).get(guildId) || null;
}

// --------------------------------------------------
// SLASH COMMAND HANDLER
// --------------------------------------------------

async function handlePotdCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "potd") {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "POTD is available inside a server.",
        ephemeral: true
      });

      return true;
    }

    const post = getLatestPost(interaction.guildId);

    if (!post) {
      await interaction.reply({
        content:
          "No prompt has been posted yet. Ask a moderator to configure POTD with `/potd-admin setup`.",
        ephemeral: true
      });

      return true;
    }

    await interaction.reply({
      content:
        `**Latest Prompt of the Day**\n` +
        `Category: **${post.prompt_category}**\n` +
        `Date: **${post.post_date}**\n` +
        `Original post: ${
          post.message_id
            ? `https://discord.com/channels/${interaction.guildId}/${post.channel_id}/${post.message_id}`
            : "Unavailable"
        }`
    });

    return true;
  }

  if (interaction.commandName !== "potd-admin") {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "POTD administration is only available inside a server.",
      ephemeral: true
    });

    return true;
  }

  if (!canManagePotd(interaction)) {
    await interaction.reply({
      content: "You need Manage Server permission to manage POTD.",
      ephemeral: true
    });

    return true;
  }

  const subcommand = interaction.options.getSubcommand();

  // ----------------------------------------------
  // SETUP
  // ----------------------------------------------

  if (subcommand === "setup") {
    const channel = interaction.options.getChannel("channel", true);
    const existing = getSettings(interaction.guildId);
    const savedTime = existing?.post_time || "19:00";
    const [savedHour, savedMinute] = savedTime.split(":");

    const session = {
      guildId: interaction.guildId,
      channelId: channel.id,
      timezone: existing?.timezone || "Asia/Kolkata",
      hour: savedHour,
      minute: savedMinute,
      roleId: existing?.role_id || null
    };

    setupSessions.set(getSessionKey(interaction), session);

    await interaction.reply({
      ...buildSetupMessage(session),
      ephemeral: true
    });

    return true;
  }

  // ----------------------------------------------
  // PREVIEW
  // ----------------------------------------------

  if (subcommand === "preview") {
    const settings = getSettings(interaction.guildId);

    if (!settings) {
      await interaction.reply({
        content: "Run `/potd-admin setup` first.",
        ephemeral: true
      });

      return true;
    }

    const today = getLocalParts(
      new Date(),
      settings.timezone
    ).date;

    const prompt = choosePrompt(interaction.guildId, today);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("🔎 POTD Preview")
          .setDescription(`**${prompt.question}**`)
          .addFields({
            name: "Category",
            value: prompt.category
          })
      ],
      ephemeral: true
    });

    return true;
  }

  // ----------------------------------------------
  // MANUAL POST
  // ----------------------------------------------

  if (subcommand === "post") {
    await interaction.deferReply({
      ephemeral: true
    });

    try {
      const settings = getSettings(interaction.guildId);

      if (!settings) {
        await interaction.editReply(
          "POTD isn't configured. Use `/potd-admin setup` first."
        );

        return true;
      }

      const manualDate =
        `${getLocalParts(new Date(), settings.timezone).date}` +
        `-manual-${Date.now()}`;

      const result = await postPrompt(
        interaction.client,
        interaction.guildId,
        manualDate,
        { force: true }
      );

      await interaction.editReply(result.message);
    } catch (error) {
      console.error("Manual POTD post failed:", error);

      await interaction.editReply(
        "Couldn't post POTD. Check the bot logs and channel permissions."
      );
    }

    return true;
  }

  // ----------------------------------------------
  // SKIP
  // ----------------------------------------------

  if (subcommand === "skip") {
    const settings = getSettings(interaction.guildId);

    if (!settings) {
      await interaction.reply({
        content: "Run `/potd-admin setup` first.",
        ephemeral: true
      });

      return true;
    }

    const today = getLocalParts(
      new Date(),
      settings.timezone
    ).date;

    const existing = getPostForDate(
      interaction.guildId,
      today
    );

    if (existing) {
      await interaction.reply({
        content:
          "Today's prompt has already been reserved or posted, so it can't be skipped now.",
        ephemeral: true
      });

      return true;
    }

    db.prepare(`
      INSERT INTO potd_posts
        (guild_id, post_date, prompt_id, prompt_category, channel_id, status)
      VALUES (?, ?, 'skipped', 'Skipped', ?, 'skipped')
    `).run(
      interaction.guildId,
      today,
      settings.channel_id
    );

    await interaction.reply({
      content: "Today's POTD has been skipped. The scheduler will resume tomorrow.",
      ephemeral: true
    });

    return true;
  }

  return false;
}

// --------------------------------------------------
// DAILY SCHEDULER
// --------------------------------------------------

let schedulerStarted = false;

async function checkDailyPrompts(client) {
  const settings = db.prepare(`
    SELECT * FROM potd_settings
  `).all();

  for (const setting of settings) {
    try {
      const local = getLocalParts(
        new Date(),
        setting.timezone
      );

      if (local.time < setting.post_time) {
        continue;
      }

      const existing = getPostForDate(
        setting.guild_id,
        local.date
      );

      if (existing) {
        continue;
      }

      await postPrompt(
        client,
        setting.guild_id,
        local.date
      );
    } catch (error) {
      console.error(
        `POTD scheduler failed for server ${setting.guild_id}:`,
        error
      );
    }
  }
}

function startPotdScheduler(client) {
  if (schedulerStarted) return;

  schedulerStarted = true;

  checkDailyPrompts(client).catch(error => {
    console.error("Initial POTD check failed:", error);
  });

  setInterval(() => {
    checkDailyPrompts(client).catch(error => {
      console.error("POTD scheduler check failed:", error);
    });
  }, 60_000).unref();
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
  commands,
  handlePotdCommand,
  handlePotdComponent,
  startPotdScheduler,
  setPotdChannel
};