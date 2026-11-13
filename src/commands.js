const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  ApplicationIntegrationType,
  InteractionContextType
} = require("discord.js");

const {
  createCanvas,
  loadImage
} = require("@napi-rs/canvas");

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const db = require("./db");

const {
  characters,
  MAX_CHARACTER_LEVEL,
  getCharacterStats
} = require("./characters");

const {
  handleBattleCommand,
  handleCrewWarBattleCommand,
  handleBattleInteraction,
  getBattleFeatureForInteraction
} = require("./battle");

const {
  generateWantedPoster
} = require("./wanted-poster");
const {
  generateStatsCard,
  generateLeaderboardCard,
  resolveLeaderboardNames
} = require("./stats-card");
const { createHeroLevelUpMessage } = require("./hero-levelup-card");

const {
  commands: potdCommands,
  handlePotdCommand,
  handlePotdComponent,
  setPotdChannel
} = require("./potd");

const {
  triviaCommands,
  handleTriviaCommand,
  handleTriviaComponent,
  setTriviaChannel,
  startTriviaScheduler
} = require("./trivia");

const {
  handleActionCommand,
  getActionHelp
} = require("./actions");


const {
  db: database,
  ensureUser,
  startPirateJourney,
  grantStarterCharacters,
  getUser,
  getGuildChannel,
  getGuildChannelSettings,
  setGuildChannel,
  addBerries,
  transferBerries,
  getTransactionHistory,
  getBerryLeaderboard,
  purchaseCharacter,
  getOwnedCharacters,
  getCharacterProgress,
  getBaseCharacter,
  setBaseCharacter,
  grantCharacterXp,
  upgradeCharacterEnergy,
  ownsCharacter,
  claimDailyReward,
  getDailyStatus,
  claimMission,
  getBounty,
  awardBounty,
  increaseBounty,
  getBountyHistory,
  getTopBounties,
  unlockAchievement,
  getAchievements,
  getBattleStats,
  getCrewForUser,
  getCrewByName,
  getCrewBanner,
  setCrewBanner,
  deleteCrewBanner,
  updateCrewDetails,
  getAllCrews,
  getCrewMembers,
  getTopCrews,
  disbandCrew,
  getDailyMission,
  getMissionProgress,
  configureMission,
  createRaid,
  getRaidById,
  getActiveRaid,
  getRaidPlayerState,
  setRaidFighter,
  recordRaidAction,
  getRaidLeaderboardParticipants,
  distributeRaidRewards,
  endRaid,
  createCrewWar,
  challengeCrewWar,
  respondToCrewWarChallenge,
  cancelPendingCrewWar,
  CREW_WAR_WIN_TARGET,
  getCrewWar,
  getActiveCrewWar,
  finishCrewWar,
  getUserItems,
  addUserItem
} = db;

const { ensureCrewLogChannel, logCrewActivity } = require("./crew-logs");

const crewBannerCrops = new Map();
const BERRY = "฿";
const STAT_COLORS = {
  gold: "#f3c45d",
  green: "#6bd4a1",
  blue: "#62b9e8"
};
const setupFeatures = [
  {
    value: "player_economy",
    label: "Player and economy commands",
    description: "Profiles, Berries, bounties, characters, and leaderboards"
  },
  {
    value: "battles",
    label: "Player battles",
    description: "Challenges and battle interactions"
  },
  {
    value: "crews_wars",
    label: "Crews and crew wars",
    description: "Crew management, rankings, and war duels"
  },
  {
    value: "raids",
    label: "Raids",
    description: "Raid commands and battle interactions"
  },
  {
    value: "trivia",
    label: "Trivia",
    description: "Trivia questions, controls, and rankings"
  },
  {
    value: "potd",
    label: "Prompt of the Day",
    description: "POTD commands and scheduled prompt posts"
  }
];

// Local raid artwork.
const BOSS_IMAGE_PATHS = {
  kaido: path.join(__dirname, "assets", "bosses", "kaido.png"),
  "big-mom": path.join(__dirname, "assets", "bosses", "big-mom.png"),
  akainu: path.join(__dirname, "assets", "bosses", "akainu.png"),
  blackbeard: path.join(__dirname, "assets", "bosses", "blackbeard.png")
};

const BOSS_TITLES = {
  kaido: "KING OF THE BEASTS",
  "big-mom": "EMPRESS OF THE SEA",
  akainu: "FLEET ADMIRAL",
  blackbeard: "THE DARKNESS OF THE SEA"
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function pirateEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0xD8A33E)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

async function replyWithStatsCard(interaction, card, fallbackPayload, ephemeral = false) {
  if (ephemeral) {
    await interaction.deferReply({ ephemeral: true });
  } else {
    await interaction.deferReply();
  }

  try {
    const image = await generateStatsCard(card);
    await interaction.editReply({ files: [image] });
  } catch (error) {
    console.error(`Could not create ${card.category} stats card:`, error);
    await interaction.editReply({
      content: "I couldn't render the image card, so here are the stats instead.",
      ...fallbackPayload
    });
  }
}

function getLeaderboardComponents(type, page, hasNext, raidId) {
  const buttons = [];
  const customIdForPage = targetPage =>
    `leaderboard:page:${type}:${targetPage}${type === "raid" ? `:${raidId}` : ""}`;

  if (page > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(customIdForPage(page - 1))
        .setLabel("Previous 10")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (hasNext) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(customIdForPage(page + 1))
        .setLabel("Next 10")
        .setStyle(ButtonStyle.Primary)
    );
  }

  return buttons.length
    ? [new ActionRowBuilder().addComponents(buttons)]
    : [];
}

async function replyWithLeaderboardCard(
  interaction,
  card,
  fallbackEmbed,
  { type, page = 0, hasNext = false, raidId, update = false, deferred = false } = {}
) {
  if (!deferred) {
    if (update) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply();
    }
  }

  try {
    const image = await generateLeaderboardCard(card);
    await interaction.editReply({
      files: [image],
      attachments: update ? [] : undefined,
      components: type ? getLeaderboardComponents(type, page, hasNext, raidId) : []
    });
  } catch (error) {
    console.error(`Could not create ${card.title} leaderboard card:`, error);
    await interaction.editReply({
      content: "I couldn't render the image leaderboard, so here are the rankings instead.",
      embeds: [fallbackEmbed],
      attachments: update ? [] : undefined,
      components: type ? getLeaderboardComponents(type, page, hasNext, raidId) : []
    });
  }
}

async function showLeaderboardPage(interaction, type, page = 0, raidId, update = false) {
  const offset = page * 10;
  let rows;
  let title;
  let subtitle;
  let metricLabel;
  let accent;
  let fallbackTitle;
  let descriptionForRow;
  let mapRow;

  if (type === "berry") {
    rows = getBerryLeaderboard(11, offset);
    title = "Lifetime Berries";
    subtitle = "The pirates who've earned the most";
    metricLabel = "Lifetime Berries earned";
    fallbackTitle = "💰 Lifetime Berries Leaderboard";
    descriptionForRow = row => `**${formatNumber(row.lifetime_berries)} ${BERRY}** earned`;
    mapRow = row => ({
      userId: row.user_id,
      score: row.lifetime_berries,
      value: `${formatNumber(row.lifetime_berries)} Berries`,
      meta: "Lifetime Berries earned"
    });
  } else if (type === "bounty") {
    rows = getTopBounties(11, offset);
    title = "Most Wanted Pirates";
    subtitle = "The highest bounties across the seas";
    metricLabel = "Bounty";
    accent = "#e76f51";
    fallbackTitle = "☠️ Most Wanted Pirates";
    descriptionForRow = row => `**${formatNumber(row.bounty)} ฿**`;
    mapRow = row => ({
      userId: row.user_id,
      score: row.bounty,
      value: `${formatNumber(row.bounty)} Berries`,
      meta: getBountyRank(row.bounty)
    });
  } else if (type === "crew") {
    rows = getTopCrews(interaction.guildId, 11, offset);
    title = "Crew Rankings";
    subtitle = `${interaction.guild?.name || "This server"} · Top crews`;
    metricLabel = "Crew points";
    accent = STAT_COLORS.blue;
    fallbackTitle = "🏴‍☠️ Crew Rankings";
    descriptionForRow = row => `**${formatNumber(row.points)} points**`;
    mapRow = row => ({
      label: row.name,
      score: row.points,
      value: `${formatNumber(row.points)} points`,
      meta: row.abbreviation ? `[${row.abbreviation}]` : "Pirate crew"
    });
  } else if (type === "raid") {
    const raid = getRaidById(raidId);
    if (!raid) {
      await interaction.reply({
        content: "That raid leaderboard is no longer available.",
        ephemeral: true
      });
      return;
    }
    rows = getRaidLeaderboardParticipants(raid.id, 11, offset);
    title = `${raid.boss_name} Raid`;
    subtitle = `${interaction.guild?.name || "Server"} · Damage contributors`;
    metricLabel = "Damage dealt";
    accent = "#e76f51";
    fallbackTitle = `🏅 Raid Damage Rankings: ${raid.boss_name}`;
    descriptionForRow = row => `${formatNumber(row.damage)} damage (${row.attacks} attacks)`;
    mapRow = row => ({
      userId: row.user_id,
      score: row.damage,
      value: `${formatNumber(row.damage)} damage`,
      meta: `${formatNumber(row.attacks)} attacks`
    });
  } else {
    return false;
  }

  const hasNext = rows.length > 10;
  const pageRows = rows.slice(0, 10);
  const description = pageRows.length
    ? pageRows.map((row, index) =>
        `**${page * 10 + index + 1}.** ${
          type === "crew" ? row.name : `<@${row.user_id}>`
        } — ${descriptionForRow(row)}`
      ).join("\n")
    : type === "crew"
      ? "No crews have been founded yet."
      : type === "raid"
        ? "No attacks yet."
        : "No rankings to show yet.";
  const fallbackEmbed = pirateEmbed(fallbackTitle, description);
  const mappedRows = pageRows.map(mapRow);
  if (update) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply();
  }
  const namedRows = type === "crew"
    ? mappedRows
    : await resolveLeaderboardNames(interaction.client, interaction.guild, mappedRows);

  await replyWithLeaderboardCard(interaction, {
    title,
    subtitle,
    metricLabel,
    accent,
    rows: namedRows,
    page
  }, fallbackEmbed, {
    type,
    page,
    hasNext,
    raidId,
    update,
    deferred: true
  });
  return true;
}

async function handleLeaderboardPage(interaction) {
  const match = interaction.customId?.match(
    /^leaderboard:page:(berry|bounty|crew|raid):(\d+)(?::(\d+))?$/
  );
  if (!match) return false;

  const page = Number(match[2]);
  const raidId = match[3] ? Number(match[3]) : undefined;
  if (!Number.isSafeInteger(page) || page < 0 || page > 100_000) {
    await interaction.reply({
      content: "That leaderboard page is invalid.",
      ephemeral: true
    });
    return true;
  }

  return showLeaderboardPage(interaction, match[1], page, raidId, true);
}

function getTarget(interaction, option = "member") {
  return interaction.options.getUser(option) || interaction.user;
}

function getCharacter(id) {
  return characters[id] || null;
}

function getCharacterPrice(character) {
  return Number(character.price ?? character.cost ?? 0);
}

function getCharacterEntries() {
  return Object.entries(characters);
}

// Normalize database rows to character IDs.
function getOwnedCharacterIds(userId) {
  return getOwnedCharacters(userId).map(character =>
    typeof character === "string"
      ? character
      : character.character_id
  ).filter(Boolean);
}

// Ensure the player exists and receives starter characters.
function preparePirate(userId) {
  ensureUser(userId);
  grantStarterCharacters(userId);
}

function getBountyRank(bounty) {
  if (bounty >= 1_000_000_000) return "Emperor of the Sea";
  if (bounty >= 500_000_000) return "Yonko Commander";
  if (bounty >= 100_000_000) return "Supernova";
  if (bounty >= 50_000_000) return "Rookie Pirate";
  if (bounty > 0) return "Rising Pirate";
  return "Unlisted Pirate";
}

function safeReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

function formatDiscordTimestamp(value) {
  if (!value) return "Unknown date";

  const stringValue = String(value);

  const normalized = stringValue.includes("T")
    ? stringValue
    : `${stringValue.replace(" ", "T")}Z`;

  const timestamp = Math.floor(
    new Date(normalized).getTime() / 1000
  );

  return Number.isFinite(timestamp)
    ? `<t:${timestamp}:R>`
    : "Unknown date";
}

// ============================================================
// RAID BATTLE CARD
// ============================================================

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - r,
    y + height
  );
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getBossImageKey(bossName) {
  const normalized = String(bossName || "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-");

  if (normalized.includes("kaido")) return "kaido";
  if (normalized.includes("big-mom")) return "big-mom";
  if (normalized.includes("akainu")) return "akainu";
  if (normalized.includes("blackbeard")) return "blackbeard";

  return "kaido";
}

// Draw an image using a cover fit, so the image fills its panel.
function drawImageCover(ctx, image, x, y, width, height) {
  const scale = Math.max(
    width / image.width,
    height / image.height
  );

  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
}

function getUploadedImageDimensions(buffer) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(pngSignature)
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let offset = 2;

  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];

    if (marker === 0xd9 || marker === 0xda) break;
    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += segmentLength;
  }

  return null;
}

async function downloadCrewBannerImage(attachment) {
  const maxBytes = 8 * 1024 * 1024;
  if (
    !attachment ||
    attachment.size > maxBytes ||
    !["image/png", "image/jpeg"].includes(attachment.contentType)
  ) {
    throw new Error("Upload a PNG or JPEG image smaller than 8 MB.");
  }

  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error("Discord's image upload couldn't be downloaded.");
  }

  const contentLength = Number(response.headers?.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("The uploaded image exceeds the 8 MB limit.");
  }

  let imageData;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("The uploaded image exceeds the 8 MB limit.");
      }
      chunks.push(Buffer.from(value));
    }
    imageData = Buffer.concat(chunks, totalBytes);
  } else {
    imageData = Buffer.from(await response.arrayBuffer());
  }

  if (imageData.length === 0 || imageData.length > maxBytes) {
    throw new Error("The uploaded image is empty or exceeds the 8 MB limit.");
  }

  const dimensions = getUploadedImageDimensions(imageData);
  if (
    !dimensions ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > 4096 ||
    dimensions.height > 4096 ||
    dimensions.width * dimensions.height > 8_000_000
  ) {
    throw new Error("Use a valid PNG or JPEG image no larger than 4096×4096 or 8 megapixels.");
  }

  const image = await loadImage(imageData);
  if (image.width !== dimensions.width || image.height !== dimensions.height) {
    throw new Error("The uploaded image dimensions could not be verified.");
  }

  return imageData;
}

async function renderCrewBannerImage(imageData, crew, crop = {}) {
  const image = await loadImage(imageData);
  const canvas = createCanvas(1200, 400);
  const ctx = canvas.getContext("2d");
  const zoom = Math.max(1, Math.min(3, Number(crop.zoom) || 1));
  const scale = Math.max(
    canvas.width / image.width,
    canvas.height / image.height
  ) * zoom;
  const sourceWidth = canvas.width / scale;
  const sourceHeight = canvas.height / scale;
  const cropX = Number.isFinite(Number(crop.x)) ? Number(crop.x) : 0.5;
  const cropY = Number.isFinite(Number(crop.y)) ? Number(crop.y) : 0.5;
  const centerX = Math.max(0, Math.min(1, cropX)) * image.width;
  const centerY = Math.max(0, Math.min(1, cropY)) * image.height;
  const sourceX = Math.max(0, Math.min(image.width - sourceWidth, centerX - sourceWidth / 2));
  const sourceY = Math.max(0, Math.min(image.height - sourceHeight, centerY - sourceHeight / 2));

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
  overlay.addColorStop(0, "rgba(0, 0, 0, 0.05)");
  overlay.addColorStop(1, "rgba(0, 0, 0, 0.78)");
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff4d6";
  ctx.font = "bold 46px sans-serif";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 8;
  ctx.fillText(`${crew.name} [${crew.abbreviation}]`, 48, 340, 1080);

  return canvas.toBuffer("image/jpeg", 0.88);
}

async function createCrewBannerImage(attachment, crew, crop = {}) {
  const imageData = await downloadCrewBannerImage(attachment);
  return renderCrewBannerImage(imageData, crew, crop);
}

// Generate the raid card using the selected boss's local artwork.
async function generateRaidCard(raid, options = {}) {
  const width = 1200;
  const height = 675;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const maxHp = Math.max(1, Number(raid.max_hp) || 1);
  const currentHp = Math.max(
    0,
    Math.min(maxHp, Number(raid.current_hp) || 0)
  );

  const hpRatio = currentHp / maxHp;
  const bossName = String(raid.boss_name || "KAIDO").toUpperCase();
  const state = options.state || "active";

  const bossKey = getBossImageKey(raid.boss_name);
  const imagePath = BOSS_IMAGE_PATHS[bossKey];

  // Background.
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#080d1b");
  background.addColorStop(0.48, "#17172b");
  background.addColorStop(1, "#300d18");

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Atmospheric glow.
  const glow = ctx.createRadialGradient(850, 260, 20, 850, 260, 520);
  glow.addColorStop(0, "rgba(210, 54, 47, 0.32)");
  glow.addColorStop(0.5, "rgba(113, 25, 44, 0.13)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Diagonal background streaks.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#efb84c";
  ctx.lineWidth = 2;

  for (let i = -height; i < width; i += 72) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }

  ctx.restore();

  // Draw the selected boss artwork.
  const imageX = 620;
  const imageY = 65;
  const imageWidth = 510;
  const imageHeight = 535;

  if (fs.existsSync(imagePath)) {
    try {
      const bossImage = await loadImage(imagePath);

      ctx.save();

      drawRoundedRect(
        ctx,
        imageX,
        imageY,
        imageWidth,
        imageHeight,
        16
      );
      ctx.clip();

      drawImageCover(
        ctx,
        bossImage,
        imageX,
        imageY,
        imageWidth,
        imageHeight
      );

      ctx.restore();

      // Subtle dark tint helps the artwork blend into the card.
      const imageTint = ctx.createLinearGradient(
        imageX,
        imageY,
        imageX + imageWidth,
        imageY + imageHeight
      );

      imageTint.addColorStop(0, "rgba(8, 13, 27, 0.10)");
      imageTint.addColorStop(1, "rgba(8, 13, 27, 0.32)");

      ctx.save();
      drawRoundedRect(
        ctx,
        imageX,
        imageY,
        imageWidth,
        imageHeight,
        16
      );
      ctx.clip();
      ctx.fillStyle = imageTint;
      ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
      ctx.restore();
    } catch (error) {
      console.error(
        `Could not load raid artwork for ${bossName}:`,
        error
      );

      drawRoundedRect(
        ctx,
        imageX,
        imageY,
        imageWidth,
        imageHeight,
        16
      );
      ctx.fillStyle = "#101522";
      ctx.fill();

      ctx.fillStyle = "#d8a33e";
      ctx.font = "bold 24px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ARTWORK UNAVAILABLE", imageX + imageWidth / 2, 320);
      ctx.textAlign = "left";
    }
  } else {
    console.error(`Raid artwork file not found: ${imagePath}`);

    drawRoundedRect(
      ctx,
      imageX,
      imageY,
      imageWidth,
      imageHeight,
      16
    );
    ctx.fillStyle = "#101522";
    ctx.fill();

    ctx.fillStyle = "#d8a33e";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ARTWORK UNAVAILABLE", imageX + imageWidth / 2, 320);
    ctx.textAlign = "left";
  }

  // Dark overlay to keep the text area readable.
  const overlay = ctx.createLinearGradient(0, 0, 740, 0);
  overlay.addColorStop(0, "rgba(5, 8, 18, 0.98)");
  overlay.addColorStop(0.7, "rgba(5, 8, 18, 0.88)");
  overlay.addColorStop(1, "rgba(5, 8, 18, 0)");

  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, 820, height);

  // Outer gold frame.
  ctx.strokeStyle = "#d8a33e";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  ctx.strokeStyle = "rgba(216, 163, 62, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(29, 29, width - 58, height - 58);

  // Top label.
  ctx.fillStyle = "#d8a33e";
  ctx.font = "bold 17px sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillText("DEN DEN MUSHI  //  RAID TRANSMISSION", 58, 72);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#f1e9d7";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("COOPERATIVE SERVER BOSS", 58, 119);

  // Boss name.
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 70px sans-serif";
  ctx.fillText(bossName, 54, 202, 650);

  ctx.fillStyle = "#d8a33e";
  ctx.font = "bold 23px sans-serif";
  ctx.fillText(BOSS_TITLES[bossKey] || "GRAND LINE THREAT", 60, 242);

  // Divider.
  ctx.fillStyle = "#d8a33e";
  ctx.fillRect(58, 270, 475, 2);

  // HP section.
  ctx.fillStyle = "#f6f1e8";
  ctx.font = "bold 19px sans-serif";
  ctx.fillText("BOSS VITALS", 60, 310);

  ctx.textAlign = "right";
  ctx.fillStyle = "#f6f1e8";
  ctx.font = "bold 21px sans-serif";
  ctx.fillText(
    `${formatNumber(currentHp)} / ${formatNumber(maxHp)} HP`,
    560,
    310
  );
  ctx.textAlign = "left";

  const barX = 60;
  const barY = 330;
  const barWidth = 500;
  const barHeight = 25;

  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 8);
  ctx.fillStyle = "#272b36";
  ctx.fill();

  const hpColor = hpRatio > 0.5
    ? "#54d68b"
    : hpRatio > 0.25
      ? "#e8b84d"
      : "#ed4c55";

  if (hpRatio > 0) {
    drawRoundedRect(
      ctx,
      barX,
      barY,
      Math.max(10, barWidth * hpRatio),
      barHeight,
      8
    );

    ctx.fillStyle = hpColor;
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 8);
  ctx.stroke();

  ctx.fillStyle = "#d4d8e1";
  ctx.font = "16px sans-serif";
  ctx.fillText(`${Math.round(hpRatio * 100)}% HP REMAINING`, 60, 384);

  // Reward pool.
  ctx.fillStyle = "#d8a33e";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("TOTAL REWARD POOL", 60, 443);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 31px sans-serif";
  ctx.fillText(`${formatNumber(raid.reward)} ${BERRY}`, 60, 481);

  // Current state.
  const stateLabels = {
    active: "RAID IN PROGRESS",
    defeated: "BOSS DEFEATED",
    cancelled: "RAID CANCELLED"
  };

  const stateColors = {
    active: "#54d68b",
    defeated: "#d8a33e",
    cancelled: "#ed4c55"
  };

  const stateLabel = stateLabels[state] || "RAID STATUS";
  const stateColor = stateColors[state] || "#ffffff";

  drawRoundedRect(ctx, 60, 516, 260, 42, 9);
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  ctx.fill();

  ctx.strokeStyle = stateColor;
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 60, 516, 260, 42, 9);
  ctx.stroke();

  ctx.fillStyle = stateColor;
  ctx.font = "bold 17px sans-serif";
  ctx.fillText(stateLabel, 78, 543);

  // Optional latest attacker information.
  if (options.attacker) {
    ctx.fillStyle = "#f6f1e8";
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(
      `LAST STRIKE: ${String(options.attacker).toUpperCase()}`.slice(0, 48),
      60,
      594,
      540
    );

    if (options.damage != null) {
      ctx.fillStyle = "#d8a33e";
      ctx.font = "bold 17px sans-serif";
      ctx.fillText(
        `DAMAGE DEALT: ${formatNumber(options.damage)}`,
        60,
        623
      );
    }
  }

  // Small visual marker on the right side.
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#d8a33e";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("GRAND LINE // RAID SYSTEM", 1140, 632);
  ctx.textAlign = "left";
  ctx.restore();

  return new AttachmentBuilder(
    canvas.toBuffer("image/png"),
    { name: "raid-boss.png" }
  );
}

// ============================================================
// SLASH COMMAND DEFINITIONS
// ============================================================

const actionCommand = new SlashCommandBuilder()
  .setName("action")
  .setDescription("Send a One Piece-style action to a nakama.")
  .setIntegrationTypes(
    ApplicationIntegrationType.GuildInstall,
    ApplicationIntegrationType.UserInstall
  )
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
  )
  .addStringOption(option =>
    option
      .setName("name")
      .setDescription("The action to perform.")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addUserOption(option =>
    option
      .setName("target")
      .setDescription("The nakama receiving your action.")
      .setRequired(false)
  );

const commands = [
  actionCommand,

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Choose channels for the bot's features.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Browse command topics and social actions."),

  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Open the interactive pirate's guide.")
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a pirate's profile card and stats.")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("The pirate whose profile you want to view.")
        .setRequired(false)
    ),

    new SlashCommandBuilder()
    .setName("av")
    .setDescription("Show your Discord avatar or someone else's.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Whose avatar do you want to see?")
        .setRequired(false)
    )
    .setIntegrationTypes(
  ApplicationIntegrationType.GuildInstall,
  ApplicationIntegrationType.UserInstall
)
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    ),  

  new SlashCommandBuilder()
    .setName("bounty")
    .setDescription("View a pirate's bounty card.")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("The pirate to check.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("wanted")
    .setDescription("Generate a pirate wanted poster.")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("The pirate on the poster.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("bounty-top")
    .setDescription("View the most wanted pirates leaderboard card."),

  new SlashCommandBuilder()
    .setName("bounty-award")
    .setDescription("Award bounty to a pirate.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("The pirate receiving bounty.")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount")
        .setDescription("Bounty to award.")
        .setMinValue(1)
        .setMaxValue(1_000_000_000)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Why the bounty is being awarded.")
        .setMaxLength(200)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the lifetime Berries leaderboard card."),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily Berries and build a streak."),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("View a pirate's wallet card.")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("The pirate to check.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Transfer Berries to another pirate.")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Who receives the Berries.")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount")
        .setDescription("Amount to transfer.")
        .setMinValue(1)
        .setMaxValue(1_000_000_000)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("transactions")
    .setDescription("View your recent Berries transactions.")
    .addIntegerOption(option =>
      option.setName("limit")
        .setDescription("Number of entries to show.")
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("achievements")
    .setDescription("View a pirate's achievement card.")
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Whose achievements to view.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("battle")
    .setDescription("Challenge another pirate to a battle.")
    .addSubcommand(subcommand =>
      subcommand.setName("challenge")
        .setDescription("Challenge a pirate.")
        .addUserOption(option =>
          option.setName("member")
            .setDescription("The pirate you want to challenge.")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("crew")
    .setDescription("Create and manage pirate crews.")
    .addSubcommand(subcommand =>
      subcommand.setName("create")
        .setDescription("Create your pirate crew.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("Crew name.")
            .setMinLength(3)
            .setMaxLength(40)
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName("abbreviation")
            .setDescription("Short crew tag.")
            .setMinLength(2)
            .setMaxLength(6)
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName("description")
            .setDescription("Describe your crew.")
            .setMaxLength(200)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("info")
        .setDescription("View a crew.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("Crew name or abbreviation.")
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("edit")
        .setDescription("Edit your crew's name, tag, or description.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("New crew name.")
            .setMinLength(3)
            .setMaxLength(40)
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName("abbreviation")
            .setDescription("New crew tag.")
            .setMinLength(2)
            .setMaxLength(6)
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName("description")
            .setDescription("New description; use - to clear it.")
            .setMaxLength(200)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("banner")
        .setDescription("Set your crew's banner using an image upload.")
        .addAttachmentOption(option =>
          option.setName("image")
            .setDescription("PNG or JPEG image, up to 8 MB.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("banner-reset")
        .setDescription("Remove your crew's custom banner.")
    )
    .addSubcommand(subcommand =>
      subcommand.setName("join")
        .setDescription("Join a crew.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("Crew name or abbreviation.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("invite")
        .setDescription("Invite a pirate to your crew.")
        .addUserOption(option =>
          option.setName("member")
            .setDescription("The pirate to invite.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("accept")
        .setDescription("Accept a crew invitation.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("Crew name or abbreviation.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("leave")
        .setDescription("Leave your current crew.")
    )
    .addSubcommand(subcommand =>
      subcommand.setName("kick")
        .setDescription("Remove a member from your crew.")
        .addUserOption(option =>
          option.setName("member")
            .setDescription("Member to remove.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("promote")
        .setDescription("Promote a crew member to officer.")
        .addUserOption(option =>
          option.setName("member")
            .setDescription("Member to promote.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("disband")
        .setDescription("Disband your crew permanently.")
        .addStringOption(option =>
          option.setName("confirm")
            .setDescription("Type the exact crew name to confirm.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("leaderboard")
        .setDescription("View the crew leaderboard card.")
    ),

  new SlashCommandBuilder()
    .setName("mission")
    .setDescription("View or claim your daily mission.")
    .addSubcommand(subcommand =>
      subcommand.setName("current")
        .setDescription("View today's mission.")
    )
    .addSubcommand(subcommand =>
      subcommand.setName("claim")
        .setDescription("Claim today's mission reward.")
    ),

  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your character and item card."),

  new SlashCommandBuilder()
    .setName("hero")
    .setDescription("Train your heroes and upgrade raid energy.")
    .addSubcommand(subcommand =>
      subcommand.setName("set-base")
        .setDescription("Choose the hero who gains your server chat XP.")
        .addStringOption(option =>
          option.setName("character")
            .setDescription("An owned character.")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("upgrade-energy")
        .setDescription("Spend Berries to increase a hero's raid energy.")
        .addStringOption(option =>
          option.setName("character")
            .setDescription("An owned character.")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse characters available for purchase."),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Purchase a character.")
    .addStringOption(option =>
      option.setName("character")
        .setDescription("Character ID from /shop.")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  // RAID COMMANDS
  new SlashCommandBuilder()
    .setName("raid")
    .setDescription("Fight a cooperative server boss.")
    .addSubcommand(subcommand =>
      subcommand.setName("status")
        .setDescription("View the active raid.")
    )
    .addSubcommand(subcommand =>
      subcommand.setName("leaderboard")
        .setDescription("View the raid damage leaderboard card.")
    )
    .addSubcommand(subcommand =>
      subcommand.setName("rewards")
        .setDescription("View your individual raid earnings.")
    ),

  new SlashCommandBuilder()
    .setName("raid-admin")
    .setDescription("Start or end a server raid.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand.setName("start")
        .setDescription("Start a preset boss raid.")
        .addStringOption(option =>
          option.setName("boss")
            .setDescription("Choose the raid boss.")
            .setRequired(true)
            .addChoices(
              { name: "Kaido — 15,000 HP", value: "kaido" },
              { name: "Big Mom — 15,000 HP", value: "big-mom" },
              { name: "Akainu — 15,000 HP", value: "akainu" },
              { name: "Blackbeard — 15,000 HP", value: "blackbeard" }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("end")
        .setDescription("End an active raid without victory.")
    ),

  new SlashCommandBuilder()
    .setName("crew-war")
    .setDescription("Compete against another pirate crew.")
    .addSubcommand(subcommand =>
      subcommand.setName("challenge")
        .setDescription("Challenge another crew to a war.")
        .addStringOption(option =>
          option.setName("crew")
            .setDescription("The crew you want to challenge.")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("score")
        .setDescription("View the active crew war score.")
    )
    .addSubcommand(subcommand =>
      subcommand.setName("fight")
        .setDescription("Challenge a member of the opposing crew to a duel.")
        .addUserOption(option =>
          option.setName("opponent")
            .setDescription("The opposing crew member you want to fight.")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("crew-war-admin")
    .setDescription("Moderation overrides for crew wars.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand.setName("start")
        .setDescription("Force-start a crew war without a challenge.")
        .addStringOption(option =>
          option.setName("crew_one")
            .setDescription("First crew name or abbreviation.")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option.setName("crew_two")
            .setDescription("Second crew name or abbreviation.")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("finish")
        .setDescription("Force-finish the active crew war.")
    ),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Server administration tools.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand.setName("crew-points")
        .setDescription("Adjust a crew's points.")
        .addStringOption(option =>
          option.setName("crew")
            .setDescription("Crew name or abbreviation.")
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName("points")
            .setDescription("Points to add or remove.")
            .setMinValue(-100000)
            .setMaxValue(100000)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("mission")
        .setDescription("Configure a daily chat mission by UTC day.")
        .addStringOption(option =>
          option.setName("day")
            .setDescription("Which UTC day's mission to configure.")
            .setRequired(true)
            .addChoices(
              { name: "Today", value: "today" },
              { name: "Tomorrow", value: "tomorrow" },
              { name: "Day after tomorrow", value: "day-after" }
            )
        )
        .addIntegerOption(option =>
          option.setName("messages")
            .setDescription("Messages required to complete the mission.")
            .setMinValue(1)
            .setMaxValue(1000)
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName("reward")
            .setDescription("Berries awarded when the mission is claimed.")
            .setMinValue(0)
            .setMaxValue(1000000)
            .setRequired(true)
        )
    ),

  ...potdCommands,
  ...triviaCommands
];

// ============================================================
// PROFILE AND BOUNTY COMMANDS
// ============================================================

async function handleHelp(interaction) {
  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  ) ?? false;
  await interaction.reply({
    ...getHelpPayload(interaction.user.id, "welcome", isAdmin),
    ephemeral: true
  });
}

function getHelpSections(isAdmin) {
  const actionList = getActionHelp()
    .map(({ name, emoji }) => `${emoji} \`${name}\``)
    .join("  •  ");
  const sections = [
    {
      value: "welcome",
      label: "Quick start",
      description: "The easiest way to begin",
      title: "🏴‍☠️ Den Den Mushi Help",
      intro: "Your guide to life on the Grand Line. Choose a topic below to explore.",
      fields: [
        {
          name: "🚀 Your first voyage",
          value: "`/daily`  →  `/profile`  →  `/shop` + `/buy`",
          inline: false
        },
        {
          name: "🧭 Find your way",
          value: "Browse **Pirate & Berries**, **Characters & battles**, **Crews & missions**, or **Server activities** from the menu.",
          inline: false
        },
        {
          name: "💡 Pro tip",
          value: "This guide is private to you. Choose another topic anytime; your menu stays open.",
          inline: false
        }
      ]
    },
    {
      value: "pirate",
      label: "Pirate & Berries",
      description: "Profiles, rewards, and reputation",
      title: "🏴‍☠️ Pirate profile and Berries",
      intro: "Build your reputation, stack Berries, and track your pirate's journey.",
      fields: [
        {
          name: "🧑‍✈️ Your pirate",
          value: "`/profile [member]` — View a pirate profile card.\n`/av [user]` — Show a Discord avatar.\n`/achievements [member]` — View achievement milestones.",
          inline: true
        },
        {
          name: "💰 Berries",
          value: "`/daily` — Claim your daily reward.\n`/balance [member]` — View a wallet card.\n`/pay member:<member> amount:<amount>` — Send Berries.\n`/transactions [limit:<count>]` — Review transfers.",
          inline: true
        },
        {
          name: "🏆 Bounty board",
          value: "`/bounty [member]` — View a bounty card.\n`/wanted [member]` — Make a poster.\n`/bounty-top` — View a most-wanted ranking card.\n`/leaderboard` — View lifetime Berries rankings.",
          inline: false
        }
      ]
    },
    {
      value: "characters",
      label: "Characters & battles",
      description: "Collect fighters and challenge pirates",
      title: "⚔️ Characters and battles",
      intro: "Recruit your favorite fighters, then put your collection to the test.",
      fields: [
        {
          name: "🛍️ Build your crew",
          value: "`/shop` — Browse characters.\n`/buy character:<character>` — Recruit one.\n`/inventory` — See your character and item cards.\n`/hero set-base character:<character>` — Choose this server's chat-trained hero.\n`/hero upgrade-energy character:<character>` — Spend Berries for more raid energy.",
          inline: true
        },
        {
          name: "🥊 Take on a rival",
          value: "`/battle challenge member:<member>` — Challenge another pirate. Both choose a fighter; some have unique passives, and the first turn is randomized.",
          inline: true
        }
      ]
    },
    {
      value: "crews",
      label: "Crews & missions",
      description: "Team up and complete server goals",
      title: "🏴‍☠️ Crews and missions",
      intro: "Find your nakama and take on server-specific challenges together.",
      fields: [
        {
          name: "⛵ Crew life",
          value: "`/crew create|info|edit|join|invite|accept|leave|kick|promote|disband|leaderboard`\nCaptains can use `/crew edit` to update the name, tag, or description; use `-` to clear the description. Captains can also upload and crop a banner with `/crew banner image:<image>` or remove it with `/crew banner-reset`. Activity is recorded in the private moderator log.",
          inline: false
        },
        {
          name: "⚔️ Crew wars",
          value: "Crew captains use `/crew-war challenge crew:<crew>`; the opposing captain accepts or declines. The first crew to 10 duel wins takes the war. Members use `/crew-war fight opponent:<member>` to battle, and `/crew-war score` shows the score.",
          inline: true
        },
        {
          name: "📜 Daily mission",
          value: "`/mission current` — Check today's server goal.\n`/mission claim` — Collect its reward.",
          inline: true
        }
      ]
    },
    {
      value: "activities",
      label: "Server activities",
      description: "Raids, Trivia, and daily prompts",
      title: "🌊 Server activities",
      intro: "Join the adventures your server has enabled.",
      fields: [
        {
          name: "🐉 Cooperative raids",
          value: "Choose a fighter and use the raid panel's **Attack** and **Special** buttons.\n`/raid status` — See the active boss.\n`/raid leaderboard` — View the damage ranking card.\n`/raid rewards` — Check earnings.",
          inline: true
        },
        {
          name: "🧠 Trivia",
          value: "`/trivia leaderboard` — View the server ranking card. Questions appear automatically when Trivia is enabled.",
          inline: true
        },
        {
          name: "💬 Prompt of the Day",
          value: "`/potd` — View the latest prompt and join the conversation.",
          inline: true
        }
      ],
      note: "Activities may be limited to a channel selected by a server admin."
    },
    {
      value: "actions",
      label: "Actions",
      description: "Send an action to yourself or a member",
      title: "🎭 Actions",
      intro: "Celebrate, tease, or cheer on your nakama.",
      fields: [
        {
          name: "✨ How to use",
          value: "`/action name:<action> [target:<member>]`\nChoose an action and optionally tag who it's for.",
          inline: true
        },
        {
          name: "💬 In chat",
          value: "Type `nakama <action> [@member]` to send an action without opening a command.",
          inline: true
        }
      ],
      note: "Choose **Emotes** from the menu to see all available actions."
    },
    {
      value: "emotes",
      label: "Emotes",
      description: "See the available chat actions and emotes",
      title: "✨ Actions and emotes",
      intro: "Pick a move and bring a little anime energy to the chat.",
      fields: [
        {
          name: "🎬 Available actions",
          value: actionList,
          inline: false
        }
      ],
      note: "Use `/action name:<action>` or type `nakama <action>` in chat."
    }
  ];

  if (isAdmin) {
    sections.push({
      value: "admin",
      label: "Admin tools",
      description: "Configure channels and server activities",
      title: "🛠️ Admin commands",
      intro: "Configure the features your server wants to run.",
      fields: [
        {
          name: "⚙️ Server setup",
          value: "`/setup` — Assign feature channels.\n`/admin mission day:<day> messages:<count> reward:<berries>` — Configure a mission.\n`/admin crew-points crew:<crew> points:<amount>` — Adjust crew points.",
          inline: false
        },
        {
          name: "📣 Community features",
          value: "`/trivia-admin setup|start|stop` — Configure Trivia.\n`/potd-admin setup|preview|post|skip` — Manage POTD.",
          inline: true
        },
        {
          name: "🏴‍☠️ Game moderation",
          value: "`/bounty-award member:<member> amount:<amount> reason:<reason>` — Award a bounty.\n`/raid-admin start|end` — Manage raids.\n`/crew-war-admin start|finish` — Force-start or force-finish a crew war.",
          inline: true
        }
      ]
    });
  }

  return sections;
}

function getHelpPayload(userId, sectionId = "welcome", isAdmin = false) {
  const sections = getHelpSections(isAdmin);
  const section = sections.find(item => item.value === sectionId);
  if (!section) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`help:guide:${userId}`)
    .setPlaceholder("Choose a help topic")
    .addOptions(sections.map(item => ({
      label: item.label,
      description: item.description,
      value: item.value,
      default: item.value === sectionId
    })));

  const embed = new EmbedBuilder()
    .setColor(0xD8A33E)
    .setAuthor({
      name: "DEN DEN MUSHI  •  GRAND LINE GUIDE"
    })
    .setTitle(section.title)
    .setDescription(section.intro)
    .addFields(section.fields)
    .setFooter({
      text: section.note
        ? `${section.note}  •  Select a topic below to explore`
        : "Select a topic below to explore  •  /help to return here"
    });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

async function handleHelpComponent(interaction) {
  if (!interaction.customId?.startsWith("help:guide:")) return false;

  const ownerId = interaction.customId.slice("help:guide:".length);
  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "This help menu belongs to the pirate who opened it. Run `/help` to open your own.",
      ephemeral: true
    });
    return true;
  }

  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  ) ?? false;
  const payload = getHelpPayload(interaction.user.id, interaction.values[0], isAdmin);
  if (!payload) {
    await interaction.reply({
      content: "That help topic isn't available. Run `/help` to reopen the guide.",
      ephemeral: true
    });
    return true;
  }

  await interaction.update(payload);
  return true;
}

async function handleProfile(interaction) {
  // In DMs, show only the requesting user's Discord avatar.
  if (!interaction.inGuild()) {
    const avatarUrl = interaction.user.displayAvatarURL({
      size: 1024,
      extension: "png"
    });

    const avatarEmbed = new EmbedBuilder()
      .setColor(0xD8A33E)
      .setTitle(`${interaction.user.username}'s Avatar`)
      .setImage(avatarUrl);

    return interaction.reply({
      embeds: [avatarEmbed]
    });
  }

  const target = getTarget(interaction);

  preparePirate(target.id);

  const user = getUser(target.id);
  const bounty = user.bounty || 0;
  const crew = getCrewForUser(interaction.guildId, target.id);
  const stats = getBattleStats(target.id);
  const daily = getDailyStatus(target.id);
  const achievementList = getAchievements(target.id);
  const baseCharacter = getBaseCharacter(target.id, interaction.guildId);
  const baseData = baseCharacter
    ? characters[baseCharacter.character_id]
    : null;
  const xpProgress = baseCharacter
    ? baseCharacter.level >= MAX_CHARACTER_LEVEL
      ? "MAX LEVEL"
      : `${formatNumber(baseCharacter.xp)} / ${formatNumber(baseCharacter.level * 100)} XP`
    : "Not selected";
  const embed = pirateEmbed(
    `🏴‍☠️ ${target.username}'s Pirate Profile`,
    [
      `**Rank:** ${getBountyRank(bounty)}`,
      `**Bounty:** ${formatNumber(bounty)} ฿`,
      `**Wallet:** ${formatNumber(user.berries)} ฿`,
      `**Lifetime earned:** ${formatNumber(user.lifetime_berries)} ฿`,
      `**Crew:** ${crew ? crew.name : "Independent pirate"}`,
      "",
      `**Battle wins:** ${stats.wins}`,
      `**Battle losses:** ${stats.losses}`,
      `**Daily streak:** ${daily.streak} day(s)`,
      `**Achievements:** ${achievementList.length}`,
      baseData ? `**Base hero:** ${baseData.name} · Level ${baseCharacter.level} · ${xpProgress}` : ""
    ].filter(Boolean).join("\n")
  ).setThumbnail(target.displayAvatarURL({ size: 256 }));

  await replyWithStatsCard(interaction, {
    user: target,
    category: "Pirate profile",
    subtitle: crew ? crew.name : "Independent pirate",
    primary: {
      label: "Current bounty · Berries",
      value: formatNumber(bounty),
      detail: getBountyRank(bounty)
    },
    metrics: [
      { label: "Wallet · Berries", value: formatNumber(user.berries), color: STAT_COLORS.gold },
      { label: "Battle wins", value: formatNumber(stats.wins), color: STAT_COLORS.green },
      { label: "Battle losses", value: formatNumber(stats.losses) },
      { label: "Achievements", value: formatNumber(achievementList.length), color: STAT_COLORS.blue }
    ],
    sections: [
      {
        title: "Pirate record",
        rows: [
          { label: "Lifetime earned", value: `${formatNumber(user.lifetime_berries)} Berries` },
          { label: "Daily streak", value: `${formatNumber(daily.streak)} day(s)` },
          { label: "Battle draws", value: formatNumber(stats.draws) }
        ]
      },
      ...(baseData
        ? [{
            title: "Base hero",
            rows: [{
              label: baseData.name,
              value: `Level ${baseCharacter.level}`,
              meta: xpProgress,
              progress: baseCharacter.level >= MAX_CHARACTER_LEVEL
                ? 1
                : baseCharacter.xp / (baseCharacter.level * 100),
              progressColor: STAT_COLORS.blue
            }]
          }]
        : [])
    ]
  }, {
    embeds: [embed]
  });
}


async function handleBounty(interaction) {
  const target = getTarget(interaction);
  preparePirate(target.id);

  const bounty = getBounty(target.id);
  const rank = getBountyRank(bounty);
  const embed = pirateEmbed(
    `☠️ ${target.username}'s Bounty`,
    `**${formatNumber(bounty)} ฿**\n${rank}`
  ).setThumbnail(target.displayAvatarURL({ size: 256 }));

  await replyWithStatsCard(interaction, {
    user: target,
    category: "Bounty board",
    subtitle: rank,
    primary: {
      label: "Current bounty · Berries",
      value: formatNumber(bounty),
      detail: rank
    },
    metrics: [
      { label: "Bounty tier", value: rank },
      { label: "Wallet · Berries", value: formatNumber(getUser(target.id).berries) }
    ],
    sections: [{
      title: "Pirate standing",
      rows: [
        { label: "Public record", value: "Capture or report" },
        { label: "Issued by", value: "World Government" }
      ]
    }],
    accent: "#e76f51"
  }, {
    embeds: [embed]
  });
}

async function handleWanted(interaction) {
  const target = getTarget(interaction);
  preparePirate(target.id);

  const bounty = getBounty(target.id);

  await interaction.deferReply();

  try {
    const poster = await generateWantedPoster(target, bounty, {
      guildId: interaction.guildId
    });

    await interaction.editReply({
      content: `☠️ **WANTED: ${target.username}**`,
      files: [poster]
    });
  } catch (error) {
    console.error("Wanted poster generation failed:", error);

    await interaction.editReply({
      content: "Couldn't generate that wanted poster. Check the bot logs."
    });
  }
}

async function handleBountyTop(interaction) {
  return showLeaderboardPage(interaction, "bounty");
}

async function handleBountyAward(interaction) {
  const target = interaction.options.getUser("member", true);
  const amount = interaction.options.getInteger("amount", true);
  const reason = interaction.options.getString("reason", true);

  preparePirate(target.id);

  const newBounty = awardBounty(target.id, amount, reason);

  await interaction.reply({
    embeds: [
      pirateEmbed(
        "☠️ Bounty Awarded",
        `**Pirate:** ${target}\n` +
        `**Increase:** +${formatNumber(amount)} ฿\n` +
        `**New bounty:** ${formatNumber(newBounty)} ฿\n` +
        `**Reason:** ${reason}`
      )
    ]
  });
}

// ============================================================
// BERRIES ECONOMY COMMANDS
// ============================================================

async function handleBalance(interaction) {
  const target = getTarget(interaction);

  preparePirate(target.id);

  const user = getUser(target.id);

  const embed = pirateEmbed(
    `💰 ${target.username}'s Wallet`,
    `**Available:** ${formatNumber(user.berries)} ${BERRY}\n` +
    `**Lifetime earned:** ${formatNumber(user.lifetime_berries)} ${BERRY}`
  ).setThumbnail(target.displayAvatarURL({ size: 256 }));

  await replyWithStatsCard(interaction, {
    user: target,
    category: "Berries wallet",
    subtitle: "Your pirate's spending pouch",
    primary: {
      label: "Available balance · Berries",
      value: formatNumber(user.berries),
      detail: "Ready to spend"
    },
    metrics: [
      { label: "Lifetime earned · Berries", value: formatNumber(user.lifetime_berries), color: STAT_COLORS.gold },
      { label: "Current bounty · Berries", value: formatNumber(user.bounty), color: "#e76f51" }
    ],
    sections: [{
      title: "Account",
      rows: [
        { label: "Balance", value: `${formatNumber(user.berries)} Berries` },
        { label: "Total earned", value: `${formatNumber(user.lifetime_berries)} Berries` }
      ]
    }],
    accent: STAT_COLORS.gold
  }, {
    embeds: [embed]
  });
}

async function handleDaily(interaction) {
  const result = claimDailyReward(interaction.user.id);

  if (!result.success) {
    const status = getDailyStatus(interaction.user.id);

    return interaction.reply({
      embeds: [
        pirateEmbed(
          "🌞 Daily Reward Already Claimed",
          `You've already claimed today's reward.\n` +
          `**Current streak:** ${status.streak} day(s)\n` +
          "Come back after the UTC date changes!"
        )
      ],
      ephemeral: true
    });
  }

  await interaction.reply({
    embeds: [
      pirateEmbed(
        "💰 Daily Berries Claimed!",
        `You received **${formatNumber(result.reward)} ${BERRY}**!\n` +
        `🔥 **Streak:** ${result.streak} day(s)\n` +
        "Keep your streak alive tomorrow!"
      )
    ]
  });
}

async function handlePay(interaction) {
  const target = interaction.options.getUser("member", true);
  const amount = interaction.options.getInteger("amount", true);

  if (target.bot) {
    return interaction.reply({
      content: "You can't transfer Berries to a bot.",
      ephemeral: true
    });
  }

  const result = transferBerries(
    interaction.user.id,
    target.id,
    amount
  );

  if (!result.success) {
    const messages = {
      self_transfer: "You can't transfer Berries to yourself.",
      insufficient: "You don't have enough Berries for that transfer."
    };

    return interaction.reply({
      content: messages[result.reason] || "Transfer failed.",
      ephemeral: true
    });
  }

  await interaction.reply({
    embeds: [
      pirateEmbed(
        "💸 Transfer Complete",
        `${interaction.user} sent **${formatNumber(amount)} ${BERRY}** to ${target}.\n` +
        "Both wallets have been updated."
      )
    ]
  });
}

async function handleTransactions(interaction) {
  const limit = interaction.options.getInteger("limit") || 10;
  const history = getTransactionHistory(interaction.user.id, limit);

  const description = history.length
    ? history.map(entry => {
        const sign = entry.amount > 0 ? "+" : "";

        return `**${sign}${formatNumber(entry.amount)} ${BERRY}** — ` +
          `${entry.reason}\n${formatDiscordTimestamp(entry.created_at)}`;
      }).join("\n\n")
    : "No transactions recorded yet.";

  await interaction.reply({
    embeds: [pirateEmbed("📜 Transaction History", description)],
    ephemeral: true
  });
}

async function handleLeaderboard(interaction) {
  return showLeaderboardPage(interaction, "berry");
}

async function handleAchievements(interaction) {
  const target = getTarget(interaction);

  preparePirate(target.id);

  const achievements = getAchievements(target.id);
  const stats = getBattleStats(target.id);

  const labels = {
    first_battle_win: "🏆 First Battle Victory",
    battle_wins_5: "⭐ Seasoned Fighter",
    battle_wins_10: "🔥 Battle Veteran"
  };

  const list = achievements.length
    ? achievements.map(item =>
        `• ${labels[item.achievement_key || item.achievement_id] || item.achievement_key || item.achievement_id}`
      ).join("\n")
    : "No achievements unlocked yet. Start battling!";

  const embed = pirateEmbed(
    `🏅 ${target.username}'s Achievements`,
    `${list}\n\n**Total wins:** ${stats.wins}`
  );
  const cardLabels = {
    first_battle_win: "First Battle Victory",
    battle_wins_5: "Seasoned Fighter",
    battle_wins_10: "Battle Veteran"
  };
  const achievementRows = achievements.map(item => {
    const key = item.achievement_key || item.achievement_id;
    const unlockedAt = item.unlocked_at
      ? new Date(item.unlocked_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric"
        })
      : "Unlocked";
    return {
      label: cardLabels[key] || key,
      value: unlockedAt,
      meta: "Achievement unlocked"
    };
  });

  await replyWithStatsCard(interaction, {
    user: target,
    category: "Achievement log",
    subtitle: "Milestones earned on your voyage",
    primary: {
      label: "Achievements",
      value: formatNumber(achievements.length),
      detail: "unlocked"
    },
    metrics: [
      { label: "Total wins", value: formatNumber(stats.wins), color: STAT_COLORS.green },
      { label: "Battle losses", value: formatNumber(stats.losses) },
      { label: "Battle draws", value: formatNumber(stats.draws) }
    ],
    sections: [{
      title: "Milestones",
      rows: achievementRows.length
        ? achievementRows
        : [{ label: "No achievements yet", value: "Start battling", meta: "Your first milestone is waiting" }]
    }],
    accent: "#b69df5"
  }, {
    embeds: [embed]
  });
}

// ============================================================
// CREW COMMANDS
// ============================================================

async function attemptCrewLog(guild, crew, title, description, options = {}) {
  try {
    await logCrewActivity(guild, crew, title, description, options);
    return true;
  } catch (error) {
    console.error(`Crew activity log failed for ${crew.name}:`, error);
    return false;
  }
}

function getCrewBannerCropRows(token) {
  const button = (action, label, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(`crew-banner-crop:${token}:${action}`)
      .setLabel(label)
      .setStyle(style);

  return [
    new ActionRowBuilder().addComponents(
      button("up", "↑"),
      button("left", "←"),
      button("down", "↓"),
      button("right", "→"),
      button("zoom-in", "Zoom +")
    ),
    new ActionRowBuilder().addComponents(
      button("zoom-out", "Zoom −"),
      button("save", "Save banner", ButtonStyle.Success),
      button("cancel", "Cancel", ButtonStyle.Danger)
    )
  ];
}

function getCrewBannerCropPayload(token, preview, status) {
  const embed = pirateEmbed(
    "Crop your crew banner",
    `${status}\nUse the arrows to reposition the image and Zoom buttons to adjust framing. ` +
    "The preview includes the crew name and tag."
  );
  embed.setImage("attachment://crew-banner-preview.jpg");

  return {
    embeds: [embed],
    components: getCrewBannerCropRows(token),
    attachments: [],
    files: [
      new AttachmentBuilder(preview, { name: "crew-banner-preview.jpg" })
    ]
  };
}

async function handleCrewBannerCropComponent(interaction) {
  const match = interaction.customId?.match(
    /^crew-banner-crop:([0-9a-f-]{36}):(up|down|left|right|zoom-in|zoom-out|save|cancel)$/
  );
  if (!match) return false;

  const [, token, action] = match;
  const session = crewBannerCrops.get(token);
  if (!session) {
    await interaction.reply({
      content: "This banner editor expired. Run `/crew banner` again to start over.",
      ephemeral: true
    });
    return true;
  }

  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: "Only the captain who opened this banner editor can use these controls.",
      ephemeral: true
    });
    return true;
  }

  if (action === "cancel") {
    clearTimeout(session.timeout);
    crewBannerCrops.delete(token);
    await interaction.update({
      content: "Banner editing cancelled.",
      embeds: [],
      components: [],
      attachments: []
    });
    return true;
  }

  if (action === "save") {
    const crew = getCrewForUser(session.guildId, session.userId);
    if (!crew || crew.id !== session.crewId || crew.role !== "captain") {
      clearTimeout(session.timeout);
      crewBannerCrops.delete(token);
      await interaction.update({
        content: "You must still be this crew's captain to save its banner.",
        embeds: [],
        components: [],
        attachments: []
      });
      return true;
    }

    const result = setCrewBanner(session.guildId, session.crewId, session.preview);
    if (!result.success) {
      await interaction.reply({
        content: result.message,
        ephemeral: true
      });
      return true;
    }

    clearTimeout(session.timeout);
    crewBannerCrops.delete(token);
    await interaction.deferUpdate();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Crew banner changed",
      `Updated by <@${session.userId}>.`,
      { bannerImage: session.preview }
    );
    await interaction.editReply({
      content: `🏴‍☠️ **${crew.name}**'s cropped banner has been saved.` +
        (logged ? "" : "\n⚠️ The banner was saved, but its activity could not be written to the private crew log."),
      embeds: [],
      components: [],
      attachments: [],
      files: [
        new AttachmentBuilder(Buffer.from(session.preview), {
          name: "crew-banner.jpg"
        })
      ]
    });
    return true;
  }

  const step = 0.08;
  if (action === "up") session.crop.y -= step;
  if (action === "down") session.crop.y += step;
  if (action === "left") session.crop.x -= step;
  if (action === "right") session.crop.x += step;
  if (action === "zoom-in") session.crop.zoom = Math.min(3, session.crop.zoom * 1.15);
  if (action === "zoom-out") session.crop.zoom = Math.max(1, session.crop.zoom / 1.15);
  session.crop.x = Math.max(0, Math.min(1, session.crop.x));
  session.crop.y = Math.max(0, Math.min(1, session.crop.y));
  await interaction.deferUpdate();
  session.preview = await renderCrewBannerImage(
    session.sourceImage,
    session.crew,
    session.crop
  );
  await interaction.editReply(
    getCrewBannerCropPayload(
      token,
      session.preview,
      `Zoom: **${Math.round(session.crop.zoom * 100)}%**`
    )
  );
  return true;
}

async function handleCrew(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  preparePirate(userId);

  if (subcommand === "create") {
    if (getCrewForUser(guildId, userId)) {
      return interaction.reply({
        content: "You're already in a crew. Leave it before creating another.",
        ephemeral: true
      });
    }

    const name = interaction.options.getString("name", true).trim();
    const abbreviation = interaction.options
      .getString("abbreviation", true)
      .trim()
      .toUpperCase();

    const description = interaction.options.getString("description") || "";

    if (getCrewByName(guildId, name) || getCrewByName(guildId, abbreviation)) {
      return interaction.reply({
        content: "That crew name or abbreviation is already taken.",
        ephemeral: true
      });
    }

    await interaction.deferReply();
    try {
      await ensureCrewLogChannel(interaction.guild);
    } catch (error) {
      console.error("Crew log channel setup failed:", error);
      return interaction.editReply({
        content: `Couldn't create the private crew log channel: ${error.message}`
      });
    }

    const create = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO crews
          (guild_id, name, abbreviation, description, captain_id, leader_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(guildId, name, abbreviation, description, userId, userId);

      const crewId = Number(result.lastInsertRowid);

      database.prepare(`
        INSERT INTO crew_members (crew_id, guild_id, user_id, role)
        VALUES (?, ?, ?, 'captain')
      `).run(crewId, guildId, userId);

      return crewId;
    });

    try {
      create();
      const crew = getCrewByName(guildId, name);
      const logged = await attemptCrewLog(
        interaction.guild,
        crew,
        "Crew founded",
        `Created by <@${userId}>.`
      );

      await interaction.editReply({
        embeds: [
          pirateEmbed(
            "🏴‍☠️ Crew Founded!",
            `**${name} [${abbreviation}]** has been founded!\n` +
            `${description || "A new crew sets sail."}\n\n` +
            `Captain: ${interaction.user}`
          )
        ],
        content: logged ? undefined : "⚠️ The crew was created, but its activity could not be written to the private crew log."
      });
    } catch (error) {
      console.error("Crew creation failed:", error);

      await interaction.editReply({
        content: "Couldn't create that crew. Check that its name and tag are unique.",
      });
    }

    return;
  }

  if (subcommand === "info") {
    const name = interaction.options.getString("name");
    const crew = name
      ? getCrewByName(guildId, name)
      : getCrewForUser(guildId, userId);

    if (!crew) {
      return interaction.reply({
        content: "Crew not found. Try `/crew create` or provide a crew name.",
        ephemeral: true
      });
    }

    const members = getCrewMembers(guildId, crew.id);

    const banner = getCrewBanner(guildId, crew.id);
    const embed = pirateEmbed(
      `🏴‍☠️ ${crew.name} [${crew.abbreviation}]`,
      `${crew.description || "No description set."}\n\n` +
      `**Captain:** <@${crew.captain_id}>\n` +
      `**Points:** ${formatNumber(crew.points)}\n` +
      `**Members (${members.length}):**\n` +
      (members.map(member =>
        `${member.role === "captain" ? "👑" :
          member.role === "officer" ? "⭐" : "•"} <@${member.user_id}>`
      ).join("\n") || "No members")
    );
    const reply = { embeds: [embed] };

    if (banner) {
      embed.setImage("attachment://crew-banner.jpg");
      reply.files = [
        new AttachmentBuilder(Buffer.from(banner.image_data), {
          name: "crew-banner.jpg"
        })
      ];
    }

    await interaction.reply({
      ...reply
    });

    return;
  }

  if (subcommand === "edit") {
    const crew = getCrewForUser(guildId, userId);
    if (!crew || crew.role !== "captain") {
      return interaction.reply({
        content: "Only a crew captain can edit crew details.",
        ephemeral: true
      });
    }

    const changes = {};
    for (const field of ["name", "abbreviation", "description"]) {
      const value = interaction.options.getString(field);
      if (value !== null) {
        changes[field] = field === "description" && value.trim() === "-"
          ? ""
          : value;
      }
    }

    if (Object.keys(changes).length === 0) {
      return interaction.reply({
        content: "Choose at least one detail to edit: name, abbreviation, or description.",
        ephemeral: true
      });
    }

    const result = updateCrewDetails(guildId, crew.id, changes);
    if (!result.success) {
      return interaction.reply({
        content: result.message,
        ephemeral: true
      });
    }

    const fieldLabels = {
      name: "Crew name",
      abbreviation: "Crew tag",
      description: "Description"
    };
    const logFields = result.changedFields.map(field => ({
      name: fieldLabels[field],
      value: `**Before:** ${result.previous[field] || "—"}\n` +
        `**After:** ${result.crew[field] || "—"}`,
      inline: false
    }));
    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      result.crew,
      "Crew details updated",
      `Captain <@${userId}> updated the crew's public details.`,
      { fields: logFields }
    );
    const changedNames = result.changedFields.map(field => fieldLabels[field]);

    await interaction.editReply({
      embeds: [
        pirateEmbed(
          "Crew details updated",
          `**${result.crew.name} [${result.crew.abbreviation}]**\n` +
          `${result.crew.description || "No description set."}\n\n` +
          `Updated: ${changedNames.join(", ")}`
        )
      ],
      content: logged
        ? undefined
        : "⚠️ Details were updated, but the activity could not be written to the private crew log."
    });
    return;
  }

  if (subcommand === "banner") {
    const crew = getCrewForUser(guildId, userId);
    if (!crew || crew.role !== "captain") {
      return interaction.reply({
        content: "Only a crew captain can change the crew banner.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    let sourceImage;
    let preview;
    try {
      sourceImage = await downloadCrewBannerImage(
        interaction.options.getAttachment("image", true),
      );
      preview = await renderCrewBannerImage(sourceImage, crew);
    } catch (error) {
      return interaction.editReply({
        content: error.message,
        embeds: [],
        components: []
      });
    }

    const token = randomUUID();
    const session = {
      userId,
      guildId,
      crewId: crew.id,
      crew,
      sourceImage,
      crop: { x: 0.5, y: 0.5, zoom: 1 },
      preview
    };
    session.timeout = setTimeout(() => crewBannerCrops.delete(token), 5 * 60 * 1000);
    session.timeout.unref?.();
    crewBannerCrops.set(token, session);

    await interaction.editReply(
      getCrewBannerCropPayload(
        token,
        preview,
        "Adjust the crop to your liking, then save it."
      )
    );
    return;
  }

  if (subcommand === "banner-reset") {
    const crew = getCrewForUser(guildId, userId);
    if (!crew || crew.role !== "captain") {
      return interaction.reply({
        content: "Only a crew captain can remove the crew banner.",
        ephemeral: true
      });
    }

    const existingBanner = getCrewBanner(guildId, crew.id);
    if (!deleteCrewBanner(guildId, crew.id)) {
      return interaction.reply({
        content: "Your crew doesn't have a custom banner.",
        ephemeral: true
      });
    }

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Crew banner removed",
      `Removed by <@${userId}>.`,
      { bannerImage: existingBanner?.image_data }
    );
    return interaction.editReply({
      content: `Removed **${crew.name}**'s custom banner.` +
        (logged ? "" : "\n⚠️ The banner was removed, but its activity could not be written to the private crew log.")
    });
  }

  if (subcommand === "join") {
    const name = interaction.options.getString("name", true);
    const crew = getCrewByName(guildId, name);

    if (!crew) {
      return interaction.reply({
        content: "I couldn't find that crew.",
        ephemeral: true
      });
    }

    if (getCrewForUser(guildId, userId)) {
      return interaction.reply({
        content: "Leave your current crew before joining another.",
        ephemeral: true
      });
    }

    await interaction.reply({
      content: "Crews require an invitation. Ask a captain or officer to invite you.",
      ephemeral: true
    });

    return;
  }

  if (subcommand === "invite") {
    const target = interaction.options.getUser("member", true);
    const crew = getCrewForUser(guildId, userId);

    if (!crew || !["captain", "officer"].includes(crew.role)) {
      return interaction.reply({
        content: "Only a crew captain or officer can invite members.",
        ephemeral: true
      });
    }

    if (target.bot || getCrewForUser(guildId, target.id)) {
      return interaction.reply({
        content: "That pirate can't be invited right now.",
        ephemeral: true
      });
    }

    database.transaction(() => {
      database.prepare(`
        DELETE FROM crew_invites
        WHERE crew_id = ?
          AND (invitee_id = ? OR invited_user_id = ?)
          AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
      `).run(crew.id, target.id, target.id, guildId);
      database.prepare(`
        INSERT INTO crew_invites
          (crew_id, inviter_id, invitee_id, invited_by, invited_user_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(crew.id, userId, target.id, userId, target.id);
    })();

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Member invited",
      `<@${userId}> invited <@${target.id}>.`
    );
    await interaction.editReply({
      content: `${target} has been invited to **${crew.name}**. They can use \`/crew accept\`.` +
        (logged ? "" : "\n⚠️ The invitation was sent, but its activity could not be written to the private crew log.")
    });

    return;
  }

  if (subcommand === "accept") {
    const name = interaction.options.getString("name", true);
    const crew = getCrewByName(guildId, name);

    if (!crew) {
      return interaction.reply({
        content: "I couldn't find that crew.",
        ephemeral: true
      });
    }

    if (getCrewForUser(guildId, userId)) {
      return interaction.reply({
        content: "Leave your current crew first.",
        ephemeral: true
      });
    }

    const invite = database.prepare(`
      SELECT 1 FROM crew_invites
      WHERE crew_id = ?
        AND (invitee_id = ? OR invited_user_id = ?)
        AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
    `).get(crew.id, userId, userId, guildId);

    if (!invite) {
      return interaction.reply({
        content: "You don't have an invitation to that crew.",
        ephemeral: true
      });
    }

    const accept = database.transaction(() => {
      database.prepare(`
        INSERT INTO crew_members (crew_id, guild_id, user_id, role)
        VALUES (?, ?, ?, 'member')
      `).run(crew.id, guildId, userId);

      database.prepare(`
        DELETE FROM crew_invites
        WHERE crew_id = ?
          AND (invitee_id = ? OR invited_user_id = ?)
          AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
      `).run(crew.id, userId, userId, guildId);
    });

    try {
      accept();

      await interaction.deferReply();
      const logged = await attemptCrewLog(
        interaction.guild,
        crew,
        "Member joined",
        `<@${userId}> accepted an invitation.`
      );
      await interaction.editReply({
        content: `Welcome aboard **${crew.name}**! 🏴‍☠️` +
          (logged ? "" : "\n⚠️ You joined, but the activity could not be written to the private crew log.")
      });
    } catch (error) {
      console.error("Crew invite acceptance failed:", error);

      if (interaction.deferred) {
        await interaction.editReply({
          content: "Couldn't accept that invitation."
        });
      } else {
        await interaction.reply({
          content: "Couldn't accept that invitation.",
          ephemeral: true
        });
      }
    }

    return;
  }

  if (subcommand === "leave") {
    const crew = getCrewForUser(guildId, userId);

    if (!crew) {
      return interaction.reply({
        content: "You're not in a crew.",
        ephemeral: true
      });
    }

    if (crew.role === "captain") {
      const members = getCrewMembers(guildId, crew.id);

      if (members.length > 1) {
        return interaction.reply({
          content: "A captain must promote another member or remove the crew before leaving.",
          ephemeral: true
        });
      }

      database.prepare("DELETE FROM crews WHERE id = ? AND guild_id = ?")
        .run(crew.id, guildId);
    } else {
      database.prepare(`
        DELETE FROM crew_members WHERE guild_id = ? AND user_id = ?
      `).run(guildId, userId);
    }

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Member left",
      `<@${userId}> left the crew.`
    );
    await interaction.editReply({
      content: `You've left **${crew.name}**.` +
        (logged ? "" : "\n⚠️ You left, but the activity could not be written to the private crew log.")
    });

    return;
  }

  if (subcommand === "kick") {
    const target = interaction.options.getUser("member", true);
    const crew = getCrewForUser(guildId, userId);

    if (!crew || !["captain", "officer"].includes(crew.role)) {
      return interaction.reply({
        content: "Only a captain or officer can remove members.",
        ephemeral: true
      });
    }

    const targetCrew = getCrewForUser(guildId, target.id);

    if (!targetCrew || targetCrew.id !== crew.id) {
      return interaction.reply({
        content: "That pirate isn't in your crew.",
        ephemeral: true
      });
    }

    if (targetCrew.role === "captain") {
      return interaction.reply({
        content: "The captain can't be removed using this command.",
        ephemeral: true
      });
    }

    if (crew.role === "officer" && targetCrew.role === "officer") {
      return interaction.reply({
        content: "Officers can't remove other officers.",
        ephemeral: true
      });
    }

    database.prepare(`
      DELETE FROM crew_members
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).run(crew.id, guildId, target.id);

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Member removed",
      `<@${target.id}> was removed by <@${userId}>.`
    );
    await interaction.editReply({
      content: `${target} has been removed from **${crew.name}**.` +
        (logged ? "" : "\n⚠️ The member was removed, but the activity could not be written to the private crew log.")
    });

    return;
  }

  if (subcommand === "promote") {
    const target = interaction.options.getUser("member", true);
    const crew = getCrewForUser(guildId, userId);
    const targetCrew = getCrewForUser(guildId, target.id);

    if (!crew || crew.role !== "captain") {
      return interaction.reply({
        content: "Only the captain can promote crew members.",
        ephemeral: true
      });
    }

    if (!targetCrew || targetCrew.id !== crew.id || target.id === userId) {
      return interaction.reply({
        content: "Choose another member of your crew.",
        ephemeral: true
      });
    }

    database.prepare(`
      UPDATE crew_members
      SET role = 'officer'
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).run(crew.id, guildId, target.id);

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Member promoted",
      `<@${target.id}> was promoted to officer by <@${userId}>.`
    );
    await interaction.editReply({
      content: `${target} is now an officer of **${crew.name}**! ⭐` +
        (logged ? "" : "\n⚠️ The promotion was saved, but the activity could not be written to the private crew log.")
    });

    return;
  }

  if (subcommand === "disband") {
    const crew = getCrewForUser(guildId, userId);

    if (!crew || crew.role !== "captain") {
      return interaction.reply({
        content: "Only a crew captain can disband a crew.",
        ephemeral: true
      });
    }

    const confirmation = interaction.options.getString("confirm", true).trim();
    if (confirmation.toLowerCase() !== crew.name.toLowerCase()) {
      return interaction.reply({
        content: `Confirmation didn't match. Type the exact crew name: **${crew.name}**.`,
        ephemeral: true
      });
    }

    const result = disbandCrew(guildId, crew.id, userId);
    if (!result.success) {
      return interaction.reply({
        content: result.message,
        ephemeral: true
      });
    }

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Crew disbanded",
      `Disbanded by former captain <@${userId}>.`
    );
    await interaction.editReply({
      content: `**${crew.name}** has been disbanded. Its members and invitations have been removed.` +
        (logged ? "" : "\n⚠️ The crew was disbanded, but the activity could not be written to the private crew log.")
    });
    return;
  }

  if (subcommand === "leaderboard") {
    await showLeaderboardPage(interaction, "crew");
  }
}

// ============================================================
// MISSION COMMANDS
// ============================================================

function hasClaimedMission(guildId, userId, missionId) {
  return Boolean(
    database.prepare(`
      SELECT 1
      FROM guild_mission_claims
      WHERE guild_id = ? AND user_id = ? AND mission_id = ?
      LIMIT 1
    `).get(guildId, userId, missionId)
  );
}

async function handleMission(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const mission = getDailyMission(guildId);
  const missionId = mission.id;

  preparePirate(userId);

  if (subcommand === "current") {
    const claimed = hasClaimedMission(guildId, userId, missionId);
    const progress = getMissionProgress(guildId, userId, missionId);
    const completed = progress >= mission.message_goal;

    await interaction.reply({
      embeds: [
        pirateEmbed(
          "📜 Daily Mission",
          `**Mission:** ${mission.title}.\n` +
          `**Progress:** ${progress}/${mission.message_goal} messages\n` +
          `**Reward:** ${formatNumber(mission.reward)} ${BERRY} and 1 crew point.\n` +
          `**Status:** ${claimed ? "Claimed" : completed ? "Complete — claim it now!" : "In progress"}`
        )
      ],
      ephemeral: true
    });

    return;
  }

  if (subcommand === "claim") {
    const result = claimMission(
      guildId,
      userId,
      missionId,
      mission.reward,
      1,
      mission.message_goal
    );

    if (!result.success) {
      return interaction.reply({
        content: result.message === "Mission already claimed."
          ? "You've already claimed today's mission reward."
          : `Mission not complete yet: ${result.progress}/${result.requiredProgress} messages. Chat in a server channel, then try again.`,
        ephemeral: true
      });
    }

    await interaction.deferReply();
    let xpResult = null;
    let xpAwardFailed = false;
    try {
      const baseCharacter = getBaseCharacter(userId, guildId);
      xpResult = baseCharacter
        ? grantCharacterXp(userId, baseCharacter.character_id, 25)
        : null;
    } catch (error) {
      console.error("Mission hero XP award error:", error);
      xpAwardFailed = true;
    }

    let levelUpPayload = null;
    if (xpResult?.success && xpResult.levelsGained > 0) {
      try {
        levelUpPayload = await createHeroLevelUpMessage(
          xpResult,
          interaction.member?.displayName || interaction.user.username
        );
      } catch (error) {
        console.error("Mission hero level-up card error:", error);
      }
    }

    let crewLogWarning = "";
    if (result.crewPoints) {
      const crew = getCrewForUser(guildId, userId);
      if (crew) {
        const logged = await attemptCrewLog(
          interaction.guild,
          crew,
          "Crew point earned",
          `<@${userId}> completed a daily mission. The crew gained 1 point.`
        );
        if (!logged) {
          crewLogWarning = "\n⚠️ The crew point was awarded, but its activity could not be written to the private crew log.";
        }
      }
    }

    const missionEmbeds = [
        pirateEmbed(
          "✅ Mission Complete!",
          `You earned **${formatNumber(result.reward ?? mission.reward)} ${BERRY}**!` +
          (result.crewPoints ? "\nYour crew also gained 1 point." : "") +
          (xpResult?.success && xpResult.awarded
            ? `\n⭐ Your base hero gained **${xpResult.awarded} XP**` +
              (xpResult.levelsGained
                ? ` and reached **Level ${xpResult.level}**!`
                : ".")
            : "") +
          (xpAwardFailed
            ? "\n⚠️ Your mission reward was collected, but hero XP could not be recorded. Please tell a moderator."
            : "") +
          crewLogWarning
        )
      ];
    await interaction.editReply({
      embeds: [
        ...missionEmbeds,
        ...(levelUpPayload?.embeds || [])
      ],
      ...(levelUpPayload ? { files: levelUpPayload.files } : {})
    });
  }
}

// ============================================================
// CHARACTER SHOP AND INVENTORY
// ============================================================

async function handleShop(interaction) {
  preparePirate(interaction.user.id);

  const owned = new Set(getOwnedCharacterIds(interaction.user.id));

  const available = getCharacterEntries()
    .filter(([id]) => !owned.has(id))
    .slice(0, 20);

  const description = available.length
    ? available.map(([id, character]) => {
        const price = getCharacterPrice(character);

        return `**${character.name}** (\`${id}\`) — ` +
          `${formatNumber(price)} ${BERRY}`;
      }).join("\n")
    : "You've unlocked every character currently listed!";

  await interaction.reply({
    embeds: [
      pirateEmbed(
        "🛒 Character Shop",
        `${description}\n\nUse \`/buy character:<id>\` to purchase a character.`
      )
    ],
    ephemeral: true
  });
}

async function handleBuy(interaction) {
  preparePirate(interaction.user.id);

  const id = interaction.options.getString("character", true);
  const character = getCharacter(id);

  if (!character) {
    return interaction.reply({
      content: "That character doesn't exist. Check `/shop` for available IDs.",
      ephemeral: true
    });
  }

  const price = getCharacterPrice(character);

  if (!Number.isSafeInteger(price) || price < 0) {
    return interaction.reply({
      content: "That character's shop price is invalid. Please tell a moderator.",
      ephemeral: true
    });
  }

  const result = purchaseCharacter(
    interaction.user.id,
    id,
    price,
    `Character purchase: ${character.name}`
  );

  if (!result.success) {
    const messages = {
      owned: "You already own that character!",
      insufficient: "You don't have enough Berries for that character.",
      invalid: "That character can't be purchased right now."
    };

    return interaction.reply({
      content: messages[result.reason] || "Purchase failed.",
      ephemeral: true
    });
  }

  await interaction.reply({
    embeds: [
      pirateEmbed(
        "🎉 Character Unlocked!",
        `You've unlocked **${character.name}**!\n` +
        `**Price:** ${formatNumber(price)} ${BERRY}`
      )
    ]
  });
}

async function handleInventory(interaction) {
  preparePirate(interaction.user.id);

  const owned = getOwnedCharacters(interaction.user.id);
  const items = getUserItems(interaction.user.id);
  const baseCharacter = interaction.guildId
    ? getBaseCharacter(interaction.user.id, interaction.guildId)
    : null;

  const characterList = owned.length
    ? owned.map(entry => {
        const character = getCharacter(entry.character_id);
        const name = character?.name || entry.character_id;
        const xpStatus = entry.level >= MAX_CHARACTER_LEVEL
          ? "MAX LEVEL"
          : `${entry.xp}/${entry.level * 100} XP`;
        const energy = 100 + entry.energy_level * 10;
        const baseMarker = baseCharacter?.character_id === entry.character_id
          ? " ⭐ **Base Hero**"
          : "";
        return `• ${character?.emoji || ""} **${name}** — Lv. ${entry.level} (${xpStatus}) · Max raid energy ${energy}${baseMarker}`;
      }).join("\n")
    : "No characters unlocked.";

  const itemList = items.length
    ? items.map(item => `• ${item.item_key} × ${item.quantity}`).join("\n")
    : "No items collected yet.";

  const fallbackEmbed = pirateEmbed(
    "🎒 Pirate Inventory",
    `**Characters (${owned.length})**\n${characterList}\n\n` +
    (interaction.guildId
      ? "Use `/hero set-base` to choose which hero gains chat XP here, and `/hero upgrade-energy` to expand raid energy.\n\n"
      : "") +
    `**Items**\n${itemList}`
  );
  const characterRows = owned.map(entry => {
    const character = getCharacter(entry.character_id);
    const isMaxLevel = entry.level >= MAX_CHARACTER_LEVEL;
    const xpStatus = isMaxLevel
      ? "MAX LEVEL"
      : `${formatNumber(entry.xp)} / ${formatNumber(entry.level * 100)} XP`;
    const isBase = baseCharacter?.character_id === entry.character_id;
    return {
      label: character?.name || entry.character_id,
      value: `Level ${entry.level} · ${100 + entry.energy_level * 10} max energy`,
      meta: `${isBase ? "Base hero · " : ""}${xpStatus}`,
      progress: isMaxLevel ? 1 : entry.xp / (entry.level * 100),
      progressColor: isBase ? STAT_COLORS.gold : STAT_COLORS.blue
    };
  });
  const itemRows = items.map(item => ({
    label: item.item_key,
    value: `x ${formatNumber(item.quantity)}`,
    meta: "Collected item"
  }));
  const inventorySections = [];
  if (characterRows.length) {
    inventorySections.push({ title: "Character roster", rows: characterRows });
  } else {
    inventorySections.push({
      title: "Character roster",
      rows: [{ label: "No characters unlocked", value: "Visit /shop", meta: "Build your crew" }]
    });
  }
  if (itemRows.length) {
    inventorySections.push({ title: "Items", rows: itemRows });
  }

  await replyWithStatsCard(interaction, {
    user: interaction.user,
    category: "Pirate inventory",
    subtitle: interaction.guild?.name || "Your collection",
    primary: {
      label: "Characters",
      value: formatNumber(owned.length),
      detail: `${formatNumber(items.length)} item types`
    },
    metrics: [
      { label: "Characters", value: formatNumber(owned.length), color: STAT_COLORS.gold },
      { label: "Item types", value: formatNumber(items.length), color: STAT_COLORS.blue }
    ],
    sections: inventorySections
  }, {
    embeds: [fallbackEmbed]
  }, true);
}

async function handleHero(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "Hero training choices are made inside a server.",
      ephemeral: true
    });
  }

  preparePirate(interaction.user.id);
  const subcommand = interaction.options.getSubcommand();
  const characterId = interaction.options.getString("character", true);
  const character = characters[characterId];

  if (!character || !ownsCharacter(interaction.user.id, characterId)) {
    return interaction.reply({
      content: "Choose a character from your owned roster.",
      ephemeral: true
    });
  }

  if (subcommand === "set-base") {
    const result = setBaseCharacter(
      interaction.user.id,
      interaction.guildId,
      characterId
    );
    if (!result.success) {
      return interaction.reply({ content: result.message, ephemeral: true });
    }

    const progress = getCharacterProgress(interaction.user.id, characterId);
    return interaction.reply({
      embeds: [
        pirateEmbed(
          "⭐ Base Hero Selected",
          `**${character.name}** is now your base hero in this server.\n` +
          `Eligible chat here earns this hero XP. Its level is shared across servers.\n` +
          `**Level:** ${progress.level} · **XP:** ${
            progress.level >= MAX_CHARACTER_LEVEL
              ? "MAX LEVEL"
              : `${progress.xp}/${progress.level * 100}`
          }`
        )
      ],
      ephemeral: true
    });
  }

  if (subcommand === "upgrade-energy") {
    const result = upgradeCharacterEnergy(interaction.user.id, characterId);
    if (!result.success) {
      return interaction.reply({ content: result.message, ephemeral: true });
    }

    const nextPrice = result.energyLevel < 10
      ? (result.energyLevel + 1) * 1000
      : null;
    return interaction.reply({
      embeds: [
        pirateEmbed(
          "⚡ Raid Energy Upgraded",
          `**${character.name}** now has **${result.maxEnergy} max energy** ` +
          `(upgrade ${result.energyLevel}/10).\n` +
          `**Cost:** ${formatNumber(result.price)} ${BERRY}` +
          (nextPrice
            ? `\n**Next upgrade:** ${formatNumber(nextPrice)} ${BERRY}`
            : "\nThis hero's raid energy is fully upgraded.")
        )
      ],
      ephemeral: true
    });
  }
}

// ============================================================
// BOSS RAID COMMANDS
// ============================================================

const RAID_ATTACK_ENERGY = 20;
const RAID_SPECIAL_ENERGY = 40;
const RAID_ENERGY_COOLDOWN_MS = 60_000;

function getRaidActionComponents(raidId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`raid:choose:${raidId}`)
        .setLabel("Choose Fighter")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`raid:attack:${raidId}`)
        .setLabel(`Attack (${RAID_ATTACK_ENERGY} energy)`)
        .setEmoji("👊")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`raid:special:${raidId}`)
        .setLabel(`Special (${RAID_SPECIAL_ENERGY} energy)`)
        .setEmoji("💥")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function getRaidEnergyDisplay(state) {
  const maxEnergy = Number(state.energy_capacity) || 100;
  const energy = Math.max(0, Math.min(maxEnergy, Number(state.energy) || 0));
  const bars = Math.round(energy / maxEnergy * 10);
  const cooldown = state.cooldown_until
    ? `\n⏳ Recharging: <t:${Math.ceil(state.cooldown_until / 1000)}:R>`
    : "";
  return `**Energy:** ${"🟦".repeat(bars)}${"⬛".repeat(10 - bars)} ${energy}/${maxEnergy}${cooldown}`;
}

function getRaidOwnedFighterOptions(userId) {
  preparePirate(userId);
  return getOwnedCharacters(userId)
    .map(entry => {
      const characterId = typeof entry === "string"
        ? entry
        : entry.character_id;
      const character = characters[characterId];
      if (!character) return null;
      const progress = typeof entry === "string"
        ? getCharacterProgress(userId, characterId)
        : entry;
      const stats = getCharacterStats(character, progress?.level);
      return {
        label: `${character.name} (Lv. ${stats.level})`.slice(0, 100),
        value: characterId,
        description:
          `HP ${stats.hp} • ATK ${stats.attack} • DEF ${stats.defense} • Energy ${100 + (progress?.energy_level || 0) * 10}`
            .slice(0, 100),
        emoji: character.emoji
      };
    })
    .filter(Boolean)
    .slice(0, 25);
}

async function getRaidPanelPayload(raid, description, options = {}) {
  const card = await generateRaidCard(raid, {
    state: options.defeated ? "defeated" : "active",
    attacker: options.attacker,
    damage: options.damage
  });
  const embed = pirateEmbed(
    options.defeated
      ? `🏆 Boss Defeated: ${raid.boss_name}`
      : `🐉 Boss Raid: ${raid.boss_name}`,
    description
  ).setImage("attachment://raid-boss.png");

  return {
    embeds: [embed],
    files: [card],
    components: options.defeated ? [] : getRaidActionComponents(raid.id)
  };
}

async function handleRaid(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "Boss raids can only be used inside a server.",
      ephemeral: true
    });
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (subcommand === "start") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "Only server moderators can start a raid.",
        ephemeral: true
      });
    }

    const active = getActiveRaid(guildId);

    if (active) {
      return interaction.reply({
        content: `A raid against **${active.boss_name}** is already active.`,
        ephemeral: true
      });
    }

    const bossPreset = interaction.options.getString("boss", true);

    const bossPresets = {
      kaido: {
        name: "Kaido",
        maxHp: 15000,
        reward: 50000
      },
      "big-mom": {
        name: "Big Mom",
        maxHp: 15000,
        reward: 50000
      },
      akainu: {
        name: "Akainu",
        maxHp: 15000,
        reward: 50000
      },
      blackbeard: {
        name: "Blackbeard",
        maxHp: 15000,
        reward: 50000
      }
    };

    const preset = bossPresets[bossPreset];

    if (!preset) {
      return interaction.reply({
        content: "That boss preset doesn't exist.",
        ephemeral: true
      });
    }

    const bossName = preset.name;
    const hp = preset.maxHp;
    const reward = preset.reward;

    let raid;

    try {
      raid = createRaid({
        guildId,
        bossName,
        maxHp: hp,
        reward,
        startedBy: interaction.user.id
      });
    } catch (error) {
      console.error("Raid creation failed:", error);

      return interaction.reply({
        content: "Couldn't start the raid. Another raid may have just started.",
        ephemeral: true
      });
    }

    if (!raid || raid.success === false) {
      return interaction.reply({
        content: "Couldn't start the raid. Another raid may have just started.",
        ephemeral: true
      });
    }

    await interaction.reply({
      ...(await getRaidPanelPayload(
        raid,
        `A server boss has appeared!\n\n` +
        `**Boss HP:** ${formatNumber(raid.current_hp)} / ${formatNumber(raid.max_hp)}\n` +
        `**Reward pool:** ${formatNumber(raid.reward)} ${BERRY}\n\n` +
        "Choose a fighter once for this raid, then use Attack or Special. " +
        "Attacks cost 20 energy; specials cost 40. Your energy refills after a 60-second cooldown when empty.\n\n" +
        "Use `/raid status` to check the fight and `/raid rewards` after a victory."
      ))
    });

    return;
  }

  if (subcommand === "status") {
    const raid = getActiveRaid(guildId);

    if (!raid) {
      return interaction.reply({
        content: "There isn't an active raid right now.",
        ephemeral: true
      });
    }

    const participants = getRaidLeaderboardParticipants(raid.id, 5);
    const playerState = getRaidPlayerState(raid.id, interaction.user.id);
    const ownFighter = playerState
      ? characters[playerState.character_id]
      : null;

    await interaction.reply({
      ...(await getRaidPanelPayload(
        raid,
        `**Boss HP:** ${formatNumber(raid.current_hp)} / ${formatNumber(raid.max_hp)}\n` +
        `**Reward pool:** ${formatNumber(raid.reward)} ${BERRY}\n` +
        (playerState
          ? `\n**Your fighter:** ${ownFighter?.emoji || ""} ${ownFighter?.name || playerState.character_id}\n${getRaidEnergyDisplay(playerState)}\n`
          : "\nChoose a fighter to join the raid.\n") +
        `\n**Top contributors**\n` +
        (participants.slice(0, 5).map((row, index) =>
          `${index + 1}. <@${row.user_id}> — ${formatNumber(row.damage)} damage`
        ).join("\n") || "No damage dealt yet.")
      ))
    });

    return;
  }

  if (subcommand === "leaderboard") {
    const raid = getActiveRaid(guildId);

    if (!raid) {
      return interaction.reply({
        content: "There's no active raid leaderboard.",
        ephemeral: true
      });
    }

    await showLeaderboardPage(interaction, "raid", 0, raid.id);

    return;
  }

  if (subcommand === "rewards") {
    const history = database.prepare(`
      SELECT
        r.id AS raid_id,
        r.name AS boss_name,
        r.reward AS reward_pool,
        r.ended_at AS ended_at,
        rp.damage AS damage,
        rp.attacks AS attacks,
        COALESCE(rp.reward, 0) AS earned
      FROM raid_participants AS rp
      INNER JOIN raids AS r ON r.id = rp.raid_id
      WHERE rp.user_id = ?
        AND r.guild_id = ?
        AND r.status = 'defeated'
      ORDER BY r.id DESC
      LIMIT 10
    `).all(interaction.user.id, guildId);

    if (!history.length) {
      return interaction.reply({
        embeds: [
          pirateEmbed(
            "💰 Your Raid Earnings",
            "You don't have any completed raid earnings recorded in this server yet.\n\n" +
            "Attack a boss and help your crew defeat it to earn Berries!"
          )
        ],
        ephemeral: true
      });
    }

    const totalEarned = history.reduce(
      (total, raid) => total + Number(raid.earned || 0),
      0
    );

    const description = history.map(raid =>
      `**${raid.boss_name}** · Raid #${raid.raid_id}\n` +
      `Earned: **${formatNumber(raid.earned)} ${BERRY}**\n` +
      `Damage: ${formatNumber(raid.damage)} · Attacks: ${formatNumber(raid.attacks)}\n` +
      `Reward pool: ${formatNumber(raid.reward_pool)} ${BERRY}`
    ).join("\n\n");

    await interaction.reply({
      embeds: [
        pirateEmbed(
          "💰 Your Raid Earnings",
          `**Total earned across these ${history.length} completed raid(s): ${formatNumber(totalEarned)} ${BERRY}**\n\n` +
          description
        )
      ],
      ephemeral: true
    });

    return;
  }

  if (subcommand === "end") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "Only server moderators can end a raid.",
        ephemeral: true
      });
    }

    const raid = getActiveRaid(guildId);

    if (!raid) {
      return interaction.reply({
        content: "There's no active raid to end.",
        ephemeral: true
      });
    }

    endRaid(raid.id, "cancelled");

    await interaction.reply({
      content: `The raid against **${raid.boss_name}** has been cancelled. No rewards were paid.`
    });
  }
}

async function handleRaidComponent(interaction) {
  const match = interaction.customId?.match(
    /^raid:(choose|select|attack|special):(\d+)$/
  );
  if (!match) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Raids can only be joined inside a server.",
      ephemeral: true
    });
    return true;
  }

  const [, action, raidId] = match;
  const raid = getRaidById(raidId);
  if (
    !raid ||
    raid.status !== "active" ||
    raid.guild_id !== interaction.guildId
  ) {
    await interaction.reply({
      content: "This raid is no longer active.",
      ephemeral: true
    });
    return true;
  }

  if (action === "choose" && interaction.isButton()) {
    const existing = getRaidPlayerState(raidId, interaction.user.id);
    if (existing) {
      const character = characters[existing.character_id];
      await interaction.reply({
        content:
          `You've already chosen ${character?.emoji || ""} **${character?.name || existing.character_id}** for this raid.\n` +
          getRaidEnergyDisplay(existing),
        ephemeral: true
      });
      return true;
    }

    const options = getRaidOwnedFighterOptions(interaction.user.id);
    if (!options.length) {
      await interaction.reply({
        content: "You don't have any usable characters yet. Open `/profile` first to receive your starter fighters.",
        ephemeral: true
      });
      return true;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`raid:select:${raidId}`)
      .setPlaceholder("Choose your raid fighter")
      .addOptions(options);

    await interaction.reply({
      content: "Choose a fighter for this raid. Your selection stays locked for this boss fight.",
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
    return true;
  }

  if (action === "select" && interaction.isStringSelectMenu()) {
    const characterId = interaction.values?.[0];
    if (
      !characterId ||
      !characters[characterId] ||
      !ownsCharacter(interaction.user.id, characterId)
    ) {
      await interaction.reply({
        content: "You don't own that fighter. Choose a character from your collection.",
        ephemeral: true
      });
      return true;
    }

    const result = setRaidFighter(raidId, interaction.user.id, characterId);
    if (!result.success) {
      await interaction.update({
        content: result.message,
        components: []
      });
      return true;
    }

    const character = characters[characterId];
    await interaction.update({
      content:
        `You chose ${character.emoji} **${character.name}** for this raid!\n` +
        `${getRaidEnergyDisplay(result.state)}\n\nUse the raid's Attack and Special buttons to fight.`,
      components: []
    });
    return true;
  }

  if (
    ["attack", "special"].includes(action) &&
    interaction.isButton()
  ) {
    const state = getRaidPlayerState(raidId, interaction.user.id);
    if (!state) {
      await interaction.reply({
        content: "Choose your fighter on the raid panel before attacking.",
        ephemeral: true
      });
      return true;
    }

    const baseCharacter = characters[state.character_id];
    const progress = getCharacterProgress(interaction.user.id, state.character_id);
    const character = getCharacterStats(baseCharacter, progress?.level);
    if (!character) {
      await interaction.reply({
        content: "Your selected fighter is unavailable. Please contact a server admin.",
        ephemeral: true
      });
      return true;
    }

    const special = action === "special";
    const energyCost = special ? RAID_SPECIAL_ENERGY : RAID_ATTACK_ENERGY;
    const damage = special
      ? character.attack * 50 + 150 + Math.floor(Math.random() * 301)
      : character.attack * 25 + 100 + Math.floor(Math.random() * 201);
    const result = recordRaidAction(
      raidId,
      interaction.user.id,
      damage,
      energyCost,
      { cooldownMs: RAID_ENERGY_COOLDOWN_MS }
    );

    if (!result.success) {
      const energyText = result.state
        ? `\n${getRaidEnergyDisplay(result.state)}`
        : "";
      await interaction.reply({
        content: `${result.message}${result.cooldown ? ` Try again in ${result.cooldown}s.` : ""}${energyText}`,
        ephemeral: true
      });
      return true;
    }

    await interaction.deferUpdate();
    let updatedRaid = result.raid;
    const xpLine = result.xpResult?.awarded
      ? `\n⭐ Your fighter gained **${result.xpResult.awarded} XP**` +
        (result.xpResult.levelsGained
          ? ` and reached **Level ${result.xpResult.level}**!`
          : "!")
      : "";
    let description =
      `${interaction.user} ${special ? `used **${character.special}**` : "struck the boss"} for **${formatNumber(result.damage)} damage**!\n\n` +
      `**Boss HP:** ${formatNumber(updatedRaid.current_hp)} / ${formatNumber(updatedRaid.max_hp)}\n` +
      `${interaction.user} energy: ${getRaidEnergyDisplay(result.state)}${xpLine}`;

    let rewards;
    if (result.defeated) {
      rewards = distributeRaidRewards(raidId);
      const rewardLines = rewards.success && Array.isArray(rewards.rewards)
        ? rewards.rewards.slice(0, 10).map(item =>
            `<@${item.userId}> — **${formatNumber(item.reward)} ${BERRY}**`
          ).join("\n")
        : "";
      description =
        `**${interaction.user.username}** landed the finishing blow with **${special ? character.special : "a powerful strike"}**!\n\n` +
        `**${updatedRaid.boss_name}** has been defeated!\n` +
        (rewards.success
          ? `Rewards distributed to ${rewards.distributed} participant(s) based on damage dealt.` +
            (rewardLines ? `\n\n**Individual rewards**\n${rewardLines}` : "")
          : "The boss is defeated, but the reward distribution needs moderator attention.") +
        xpLine;
    }

    await interaction.editReply(
      await getRaidPanelPayload(updatedRaid, description, {
        defeated: result.defeated,
        attacker: interaction.user.username,
        damage: result.damage
      })
    );

    if (result.xpResult?.success && result.xpResult.levelsGained > 0) {
      try {
        const levelUpPayload = await createHeroLevelUpMessage(
          result.xpResult,
          interaction.member?.displayName || interaction.user.username
        );
        if (levelUpPayload) {
          await interaction.followUp({
            ...levelUpPayload
          });
        }
      } catch (error) {
        console.error("Raid hero level-up announcement failed:", error);
      }
    }

    return true;
  }

  return false;
}

// ============================================================
// CREW WAR COMMANDS
// ============================================================

async function handleCrewWar(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "Crew wars can only be used inside a server.",
      ephemeral: true
    });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "challenge") {
    const challengerCrew = getCrewForUser(
      interaction.guildId,
      interaction.user.id
    );
    if (!challengerCrew) {
      return interaction.reply({
        content: "Join or create a crew before challenging another crew.",
        ephemeral: true
      });
    }

    const captainId = challengerCrew.captain_id || challengerCrew.leader_id;
    if (captainId !== interaction.user.id) {
      return interaction.reply({
        content: "Only your crew captain can challenge another crew.",
        ephemeral: true
      });
    }

    const targetCrewName = interaction.options.getString("crew", true);
    const targetCrew = getCrewByName(interaction.guildId, targetCrewName);
    if (!targetCrew || targetCrew.id === challengerCrew.id) {
      return interaction.reply({
        content: "Choose a different existing crew in this server.",
        ephemeral: true
      });
    }

    const challenge = challengeCrewWar(
      interaction.guildId,
      challengerCrew.id,
      targetCrew.id,
      interaction.user.id
    );
    if (!challenge.success) {
      return interaction.reply({
        content: challenge.message,
        ephemeral: true
      });
    }

    await interaction.deferReply();
    const challengeLogs = await Promise.all([
      attemptCrewLog(
        interaction.guild,
        challengerCrew,
        "Crew war challenged",
        `Challenged **${targetCrew.name} [${targetCrew.abbreviation}]**.`
      ),
      attemptCrewLog(
        interaction.guild,
        targetCrew,
        "Crew war challenge received",
        `Challenged by **${challengerCrew.name} [${challengerCrew.abbreviation}]**.`
      )
    ]);

    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`crew-war:accept:${challenge.war.id}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`crew-war:decline:${challenge.war.id}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`crew-war:cancel:${challenge.war.id}`)
        .setLabel("Cancel challenge")
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.editReply({
      embeds: [
        pirateEmbed(
          "⚔️ Crew War Challenge",
          `**${challengerCrew.name}** challenged **${targetCrew.name}**!\n` +
          `<@${targetCrew.captain_id || targetCrew.leader_id}>\n\n` +
          `Only the captain of **${targetCrew.name}** can accept or decline. ` +
          `The first crew to **${CREW_WAR_WIN_TARGET} duel wins** takes the war.` +
          (challengeLogs.every(Boolean)
            ? ""
            : "\n\n⚠️ The challenge was sent, but its activity could not be written to the private crew log.")
        )
      ],
      components: [controls],
      allowedMentions: { users: [targetCrew.captain_id || targetCrew.leader_id] }
    });
  }

  if (subcommand === "start") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "Only server moderators can start a crew war.",
        ephemeral: true
      });
    }

    if (getActiveCrewWar(interaction.guildId)) {
      return interaction.reply({
        content: "A crew war is already active. Finish it before starting another.",
        ephemeral: true
      });
    }

    const oneName = interaction.options.getString("crew_one", true);
    const twoName = interaction.options.getString("crew_two", true);

    const crewOne = getCrewByName(interaction.guildId, oneName);
    const crewTwo = getCrewByName(interaction.guildId, twoName);

    if (!crewOne || !crewTwo || crewOne.id === crewTwo.id) {
      return interaction.reply({
        content: "Choose two different existing crews.",
        ephemeral: true
      });
    }

    try {
      const war = createCrewWar(
        interaction.guildId,
        crewOne.id,
        crewTwo.id
      );

      if (!war || war.success === false) {
        return interaction.reply({
          content: war?.message || "Couldn't start the crew war. Another war may have just started.",
          ephemeral: true
        });
      }

      await interaction.deferReply();
      const logResults = await Promise.all([
        attemptCrewLog(
          interaction.guild,
          crewOne,
          "Crew war started",
          `War started against **${crewTwo.name} [${crewTwo.abbreviation}]**.`
        ),
        attemptCrewLog(
          interaction.guild,
          crewTwo,
          "Crew war started",
          `War started against **${crewOne.name} [${crewOne.abbreviation}]**.`
        )
      ]);
      await interaction.editReply({
        embeds: [
          pirateEmbed(
            "⚔️ Crew War Started!",
            `**${crewOne.name}** vs **${crewTwo.name}**\n\n` +
            `The first crew to ${CREW_WAR_WIN_TARGET} duel wins takes the war. ` +
            "Challenge an opponent with `/crew-war fight`, accept the duel, and choose a fighter.\n" +
            `War ID: ${war.war.id}` +
            (logResults.every(Boolean)
              ? ""
              : "\n\n⚠️ The war started, but its activity could not be written to the private crew log.")
          )
        ]
      });
    } catch (error) {
      console.error("Crew war creation failed:", error);

      await (interaction.deferred
        ? interaction.editReply({
            content: "Couldn't start the crew war."
          })
        : interaction.reply({
            content: "Couldn't start the crew war.",
            ephemeral: true
          }));
    }

    return;
  }

  if (subcommand === "score") {
    const crew = getCrewForUser(interaction.guildId, interaction.user.id);
    const war = crew
      ? getActiveCrewWar(interaction.guildId, crew.id)
      : getActiveCrewWar(interaction.guildId);

    if (!war) {
      return interaction.reply({
        content: "There isn't an active crew war.",
        ephemeral: true
      });
    }

    const crewOne = database.prepare(
      "SELECT name FROM crews WHERE id = ? AND guild_id = ?"
    ).get(war.crew_one_id, interaction.guildId);

    const crewTwo = database.prepare(
      "SELECT name FROM crews WHERE id = ? AND guild_id = ?"
    ).get(war.crew_two_id, interaction.guildId);

    const matches = database.prepare(`
      SELECT player_one_id, player_two_id, winner_id
      FROM crew_war_matches
      WHERE guild_id = ? AND war_id = ? AND status = 'finished'
      ORDER BY ended_at DESC
      LIMIT 10
    `).all(interaction.guildId, war.id);

    const recentMatches = matches.length
      ? "\n\n**Recent duels**\n" + matches.map(match =>
          `<@${match.winner_id}> defeated <@${
            match.winner_id === match.player_one_id
              ? match.player_two_id
              : match.player_one_id
          }>`
        ).join("\n")
      : "\n\nNo duels have been completed yet.";

    await interaction.reply({
      embeds: [
        pirateEmbed(
          "⚔️ Crew War Score",
          `**${crewOne?.name || "Crew One"}:** ${war.score_one}\n` +
          `**${crewTwo?.name || "Crew Two"}:** ${war.score_two}\n` +
          `First to ${CREW_WAR_WIN_TARGET} wins${war.status === "finishing" ? " · Settling remaining duels" : ""}` +
          recentMatches
        )
      ]
    });

    return;
  }

  if (subcommand === "fight") {
    const challengerCrew = getCrewForUser(
      interaction.guildId,
      interaction.user.id
    );
    const war = challengerCrew
      ? getActiveCrewWar(interaction.guildId, challengerCrew.id)
      : null;

    if (!war) {
      return interaction.reply({
        content: "There's no active crew war.",
        ephemeral: true
      });
    }

    const opponent = interaction.options.getUser("opponent", true);

    const opponentCrew = getCrewForUser(interaction.guildId, opponent.id);

    if (
      !challengerCrew ||
      !opponentCrew ||
      challengerCrew.id === opponentCrew.id ||
      ![war.crew_one_id, war.crew_two_id].includes(challengerCrew.id) ||
      ![war.crew_one_id, war.crew_two_id].includes(opponentCrew.id)
    ) {
      return interaction.reply({
        content: "You and your opponent must belong to opposite crews in the active war.",
        ephemeral: true
      });
    }

    await handleCrewWarBattleCommand(interaction, opponent, war.id);
    return;
  }

  if (subcommand === "finish") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "Only server moderators can finish a crew war.",
        ephemeral: true
      });
    }

    const war = getActiveCrewWar(interaction.guildId);

    if (!war) {
      const pendingWar = database.prepare(`
        SELECT * FROM crew_wars
        WHERE guild_id = ? AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
      `).get(interaction.guildId);
      if (pendingWar && cancelPendingCrewWar(interaction.guildId, pendingWar.id)) {
        const crews = [pendingWar.crew_one_id, pendingWar.crew_two_id]
          .map(crewId => database.prepare(
            "SELECT * FROM crews WHERE id = ? AND guild_id = ?"
          ).get(crewId, interaction.guildId))
          .filter(Boolean);
        await interaction.deferReply();
        const logs = await Promise.all(crews.map(crew =>
          attemptCrewLog(
            interaction.guild,
            crew,
            "Crew war challenge cancelled",
            `The pending challenge was cancelled by moderator <@${interaction.user.id}>.`
          )
        ));
        return interaction.editReply({
          content: "The pending crew war challenge was cancelled." +
            (logs.every(Boolean)
              ? ""
              : "\n⚠️ The challenge was cancelled, but its activity could not be written to the private crew log.")
        });
      }
      return interaction.reply({
        content: "There isn't an active crew war.",
        ephemeral: true
      });
    }

    const result = finishCrewWar(interaction.guildId, war.id);
    if (!result.success) {
      return interaction.reply({
        content: result.message || "Couldn't finish the crew war.",
        ephemeral: true
      });
    }

    await interaction.deferReply();
    const winner = result.winnerCrewId
      ? database.prepare(
          "SELECT * FROM crews WHERE id = ? AND guild_id = ?"
        ).get(result.winnerCrewId, interaction.guildId)
      : null;

    const crewOne = database.prepare(
      "SELECT * FROM crews WHERE id = ? AND guild_id = ?"
    ).get(war.crew_one_id, interaction.guildId);
    const crewTwo = database.prepare(
      "SELECT * FROM crews WHERE id = ? AND guild_id = ?"
    ).get(war.crew_two_id, interaction.guildId);
    const finishLogs = await Promise.all(
      [crewOne, crewTwo].filter(Boolean).map(crew =>
        attemptCrewLog(
          interaction.guild,
          crew,
          "Crew war finished",
          result.draw
            ? `War ended in a draw. Final score: ${result.war.score_one}–${result.war.score_two}.`
            : `**${winner?.name || "The opposing crew"}** won. Final score: ${result.war.score_one}–${result.war.score_two}.`
        )
      )
    );

    const finishDescription = result.draw
      ? `The war ended in a draw!\nFinal score: ${result.war.score_one} – ${result.war.score_two}`
      : `**${winner?.name || "The winning crew"}** wins!\nFinal score: ${result.war.score_one} – ${result.war.score_two}\n\nThe winning crew receives 10 crew points.`;

    await interaction.editReply({
      embeds: [
        pirateEmbed(
          result.draw ? "🤝 Crew War Draw!" : "🏆 Crew War Finished!",
          finishDescription +
            (finishLogs.every(Boolean)
              ? ""
              : "\n\n⚠️ The war finished, but its activity could not be written to the private crew log.")
        )
      ]
    });
  }
}

async function handleCrewWarComponent(interaction) {
  const match = interaction.customId?.match(
    /^crew-war:(accept|decline|cancel):(\d+)$/
  );
  if (!match) return false;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Crew war challenges can only be handled inside a server.",
      ephemeral: true
    });
    return true;
  }

  const [, action, warId] = match;
  const result = respondToCrewWarChallenge(
    interaction.guildId,
    Number(warId),
    interaction.user.id,
    action
  );
  if (!result.success) {
    await interaction.reply({
      content: result.message,
      ephemeral: true
    });
    return true;
  }

  const war = result.war;
  const crewOne = database.prepare(
    "SELECT * FROM crews WHERE id = ? AND guild_id = ?"
  ).get(war.crew_one_id, interaction.guildId);
  const crewTwo = database.prepare(
    "SELECT * FROM crews WHERE id = ? AND guild_id = ?"
  ).get(war.crew_two_id, interaction.guildId);

  const title = result.accepted
    ? "⚔️ Crew War Accepted!"
    : action === "decline"
      ? "🏳️ Crew War Declined"
      : "✖️ Crew War Challenge Cancelled";
  const description = result.accepted
    ? `**${crewOne?.name || "Crew One"}** vs **${crewTwo?.name || "Crew Two"}**\n\n` +
      `The first crew to **${CREW_WAR_WIN_TARGET} duel wins** claims victory. ` +
      "Use `/crew-war fight` to challenge an opposing crew member."
    : `The challenge between **${crewOne?.name || "Crew One"}** and ` +
      `**${crewTwo?.name || "Crew Two"}** was ${action === "decline" ? "declined" : "cancelled"}.`;

  await interaction.deferUpdate();
  const logResults = await Promise.all(
    [crewOne, crewTwo].filter(Boolean).map(crew =>
      attemptCrewLog(
        interaction.guild,
        crew,
        title.replace(/^[^\w]+/, ""),
        `${description}\nAction by <@${interaction.user.id}>.`
      )
    )
  );
  await interaction.editReply({
    embeds: [
      pirateEmbed(
        title,
        description +
          (logResults.every(Boolean)
            ? ""
            : "\n\n⚠️ The challenge changed state, but its activity could not be written to the private crew log.")
      )
    ],
    components: []
  });
  return true;
}

// ============================================================
// ADMIN COMMANDS
// ============================================================

async function handleAdmin(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "mission") {
    const day = interaction.options.getString("day", true);
    const messages = interaction.options.getInteger("messages", true);
    const reward = interaction.options.getInteger("reward", true);
    const dayOffsets = {
      today: 0,
      tomorrow: 1,
      "day-after": 2
    };
    const dayOffset = dayOffsets[day];

    if (dayOffset === undefined) {
      return interaction.reply({
        content: "Choose today, tomorrow, or the day after tomorrow.",
        ephemeral: true
      });
    }

    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + dayOffset);
    const mission = getDailyMission(
      interaction.guildId,
      targetDate.toISOString().slice(0, 10)
    );
    const result = configureMission(
      interaction.guildId,
      mission.mission_key,
      messages,
      reward
    );

    if (!result.success) {
      return interaction.reply({
        content: result.message,
        ephemeral: true
      });
    }

    await interaction.reply({
      content:
        `Updated **${day}’s** mission for **${mission.date} UTC**: ` +
        `players must send **${messages}** messages and can claim **${formatNumber(reward)} ${BERRY}**.`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "crew-points") {
    const name = interaction.options.getString("crew", true);
    const points = interaction.options.getInteger("points", true);
    const crew = getCrewByName(interaction.guildId, name);

    if (!crew) {
      return interaction.reply({
        content: "Crew not found.",
        ephemeral: true
      });
    }

    database.prepare(`
      UPDATE crews
      SET points = MAX(0, points + ?)
      WHERE id = ? AND guild_id = ?
    `).run(points, crew.id, interaction.guildId);

    const updated = database.prepare(
      "SELECT points FROM crews WHERE id = ? AND guild_id = ?"
    ).get(crew.id, interaction.guildId);

    await interaction.deferReply();
    const logged = await attemptCrewLog(
      interaction.guild,
      crew,
      "Crew points adjusted",
      `<@${interaction.user.id}> changed the crew score by ${points}. New total: ${updated.points}.`
    );
    await interaction.editReply({
      content: `Updated **${crew.name}**. New total: **${formatNumber(updated.points)} points**.` +
        (logged ? "" : "\n⚠️ The points were adjusted, but the activity could not be written to the private crew log.")
    });
  }
}

// ============================================================
// MAIN COMMAND ROUTER
// ============================================================

const startGuideSections = [
  {
    value: "welcome",
    label: "Welcome aboard",
    description: "Your first three steps",
    title: "Your first voyage 🏴‍☠️",
    body:
      "No need to learn every command today. Start with these three:\n\n" +
      "1. `/start` — Begin your pirate journey and join the leaderboards.\n" +
      "2. `/daily` — Claim your Berries.\n" +
      "3. `/profile` — See your pirate profile; it is created automatically.\n\n" +
      "If these commands aren't available, ask a server admin to set the Player and economy channel with `/setup`. Other features are optional. " +
      "Use the menu to explore when you're ready, or `/help` for the full command list.\n\n" +
      "Your player account and Berries are shared across servers. Using `/start` makes you eligible for global Berries and bounty leaderboards, and server activity leaderboards. Crews and server activities belong to each server."
  },
  {
    value: "progress",
    label: "Pirate progress",
    description: "Berries, characters, and missions",
    title: "Build your pirate",
    body:
      "`/daily` — Claim Berries and grow your streak.\n" +
      "`/balance` — Check your wallet.\n" +
      "`/mission current` and `/mission claim` — Complete and collect the daily chat mission.\n" +
      "`/shop` and `/buy` — Browse and recruit characters.\n" +
      "`/inventory` — View your characters, levels, and raid energy.\n" +
      "`/hero set-base` — Choose which hero gains chat XP in this server.\n" +
      "`/hero upgrade-energy` — Spend Berries to increase one hero's raid energy.\n" +
      "`/bounty` and `/achievements` — Check your reputation and milestones."
  },
  {
    value: "crew",
    label: "Crews and battles",
    description: "Team up, fight, and sail together",
    title: "Find your nakama",
    body:
      "`/crew create` — Found a server-specific crew.\n" +
      "`/crew edit` — Update the crew's name, tag, or description (captain only).\n" +
    "`/crew banner image:<image>` — Upload and crop a PNG/JPEG banner (captain only).\n" +
    "`/crew banner-reset` — Remove your custom banner.\n" +
      "`/crew invite` and `/crew accept` — Bring members aboard.\n" +
      "`/crew leaderboard` — See the server's top crews.\n" +
      "`/battle challenge` — Challenge another pirate; both players choose fighters.\n" +
      "`/crew-war challenge crew:<crew>` — As captain, challenge another crew; its captain can accept or decline. First to 10 duel wins takes the war.\n" +
      "`/crew-war fight` — Duel a member of the opposing crew during an active war.\n" +
      "Try `/raid status` to see whether a server raid is underway."
  },
  {
    value: "events",
    label: "Server activities",
    description: "Trivia, prompts, and community events",
    title: "Join the server's adventures",
    body:
  "`/trivia leaderboard` — Check the server's Trivia rankings.\n" +
  "`/potd` — View the latest Prompt of the Day.\n" +
      "Trivia and POTD post in their configured channels. Daily missions count eligible messages anywhere in the server.\n" +
  "Ask a server admin to configure or manage these activities."
  }
];

function getStartGuidePayload(userId, sectionId = "welcome") {
  const section = startGuideSections.find(item => item.value === sectionId);
  if (!section) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`start:guide:${userId}`)
    .setPlaceholder("Explore the guide")
    .addOptions(startGuideSections.map(item => ({
      label: item.label,
      description: item.description,
      value: item.value,
      default: item.value === sectionId
    })));

  return {
    embeds: [pirateEmbed(section.title, section.body)],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

async function handleStartCommand(interaction) {
  startPirateJourney(interaction.user.id);
  await interaction.reply({
    ...getStartGuidePayload(interaction.user.id),
    ephemeral: true
  });
  return true;
}

async function handleStartComponent(interaction) {
  if (!interaction.customId?.startsWith("start:guide:")) return false;

  const ownerId = interaction.customId.slice("start:guide:".length);
  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "This guide menu belongs to the pirate who opened it. Run `/start` to open your own.",
      ephemeral: true
    });
    return true;
  }

  const payload = getStartGuidePayload(interaction.user.id, interaction.values[0]);
  if (!payload) {
    await interaction.reply({
      content: "That guide section isn't available. Run `/start` to reopen the guide.",
      ephemeral: true
    });
    return true;
  }

  await interaction.update(payload);
  return true;
}

function getSetupDashboard(guildId, userId) {
  const configuredChannels = getGuildChannelSettings(guildId);
  const description = setupFeatures.map(feature => {
    const channelId = configuredChannels[feature.value];
    return `**${feature.label}:** ${
      channelId
        ? `<#${channelId}>`
          : "Not configured (optional until you enable this feature)."
    }`;
  }).join("\n");
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`setup:feature:${userId}`)
    .setPlaceholder("Choose a feature to configure")
    .addOptions(setupFeatures.map(feature => ({
      label: feature.label,
      description: feature.description,
      value: feature.value
    })));

  return {
    embeds: [
      pirateEmbed(
        "Server channel setup",
        `${description}\n\nStart with Player and economy commands. Configure only the other features your server plans to use; you can return here and add or change channels later. Commands in a configured feature group work only in its selected channel.`
      )
    ],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

function getSetupChannelPrompt(feature, userId) {
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`setup:channel:${userId}:${feature.value}`)
    .setPlaceholder(`Choose ${feature.label.toLowerCase()} channel`)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  return {
    embeds: [
      pirateEmbed(
        `Choose a channel: ${feature.label}`,
        `${feature.description} will be restricted to the channel you select.`
      )
    ],
    components: [new ActionRowBuilder().addComponents(channelMenu)]
  };
}

function getCommandChannelFeature(interaction) {
  const featureByCommand = {
    profile: "player_economy",
    bounty: "player_economy",
    wanted: "player_economy",
    "bounty-top": "player_economy",
    "bounty-award": "player_economy",
    leaderboard: "player_economy",
    daily: "player_economy",
    balance: "player_economy",
    pay: "player_economy",
    transactions: "player_economy",
    achievements: "player_economy",
    inventory: "player_economy",
    hero: "player_economy",
    shop: "player_economy",
    buy: "player_economy",
    battle: "battles",
    crew: "crews_wars",
    "crew-war": "crews_wars",
    "crew-war-admin": "crews_wars",
    raid: "raids",
    "raid-admin": "raids",
    trivia: "trivia",
    "trivia-admin": "trivia",
    potd: "potd",
    "potd-admin": "potd"
  };

  if (interaction.commandName === "admin") {
    return interaction.options.getSubcommand(false) === "crew-points"
      ? "crews_wars"
      : null;
  }

  return featureByCommand[interaction.commandName] ?? null;
}

async function blockOutsideConfiguredChannel(interaction, feature) {
  if (!feature || !interaction.guildId) return false;

  const channelId = getGuildChannel(interaction.guildId, feature);
  if (!channelId) {
    await interaction.reply({
      content: `This feature hasn't been set up yet. A server admin can run \`/setup\` and choose a channel for it.`,
      ephemeral: true
    });
    return true;
  }

  if (interaction.channelId !== channelId) {
    await interaction.reply({
      content: `Use this feature in <#${channelId}>.`,
      ephemeral: true
    });
    return true;
  }

  return false;
}

async function handleSetupCommand(interaction) {
  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "Only server members with Manage Server permission can configure channels.",
      ephemeral: true
    });
    return true;
  }

  await interaction.reply({
    ...getSetupDashboard(interaction.guildId, interaction.user.id),
    ephemeral: true
  });
  return true;
}

async function handleSetupComponent(interaction) {
  const customId = interaction.customId || "";
  if (!customId.startsWith("setup:")) return false;

  const parts = customId.split(":");
  const ownerId = parts[2];
  if (
    !interaction.inGuild() ||
    ownerId !== interaction.user.id ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "Only the admin who opened this setup menu can use it.",
      ephemeral: true
    });
    return true;
  }

  if (parts[1] === "feature" && interaction.isStringSelectMenu()) {
    const feature = setupFeatures.find(item => item.value === interaction.values[0]);
    if (!feature) {
      await interaction.reply({
        content: "That setup option is not valid. Run `/setup` again.",
        ephemeral: true
      });
      return true;
    }

    await interaction.update(getSetupChannelPrompt(feature, ownerId));
    return true;
  }

  if (parts[1] === "channel" && interaction.isChannelSelectMenu()) {
    const featureId = parts[3];
    const feature = setupFeatures.find(item => item.value === featureId);
    const channelId = interaction.values[0];
    const channel = await interaction.guild.channels.fetch(channelId);

    if (
      !feature ||
      !channel?.isTextBased() ||
      !channel.isSendable()
    ) {
      await interaction.reply({
        content: "Choose a text channel where the bot can send messages.",
        ephemeral: true
      });
      return true;
    }

    if (featureId === "trivia") {
      setTriviaChannel(interaction.guildId, channel.id);
    } else if (featureId === "potd") {
      setPotdChannel(interaction.guildId, channel.id);
    } else if (!setGuildChannel(interaction.guildId, featureId, channel.id)) {
      throw new Error(`Could not save channel setup for ${featureId}.`);
    }

    await interaction.update(
      getSetupDashboard(interaction.guildId, interaction.user.id)
    );
    return true;
  }

  return false;
}

async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  // DMs: only /av is allowed. Game commands remain server-only.
if (
  !interaction.inGuild() &&
  !["av", "action"].includes(interaction.commandName)
) {
  return interaction.reply({
    content: "Only `/av` and `/action` are available in DMs, nakama! 🏴‍☠️",
    ephemeral: true
  });
}

  try {
    if (interaction.commandName === "setup") {
      return handleSetupCommand(interaction);
    }

    if (interaction.commandName === "start") {
      return handleStartCommand(interaction);
    }

    if (
      await blockOutsideConfiguredChannel(
        interaction,
        getCommandChannelFeature(interaction)
      )
    ) {
      return true;
    }

    // Don't initialize game data for a DM avatar request.
    if (interaction.inGuild() && interaction.commandName !== "setup") {
      preparePirate(interaction.user.id);
    }

    
switch (interaction.commandName) {
  case "help":
    await handleHelp(interaction);
    return true;

  case "av": {
    const target =
      interaction.options.getUser("user") || interaction.user;

    const embed = new EmbedBuilder()
      .setColor(0xD8A33E)
      .setTitle(`${target.username}'s Avatar`)
      .setImage(
        target.displayAvatarURL({
          size: 1024,
          extension: "png"
        })
      )
      .setFooter({
        text: "Den Den Mushi • Grand Line"
      });

    await interaction.reply({
      embeds: [embed]
    });

    return true;
  }
  case "action":
    await handleActionCommand(interaction);
    return true;

  case "profile":


        await handleProfile(interaction);
        return true;

      case "bounty":
        await handleBounty(interaction);
        return true;

      case "wanted":
        await handleWanted(interaction);
        return true;

      case "bounty-top":
        await handleBountyTop(interaction);
        return true;

      case "bounty-award":
        await handleBountyAward(interaction);
        return true;

      case "leaderboard":
        await handleLeaderboard(interaction);
        return true;

      case "daily":
        await handleDaily(interaction);
        return true;

      case "balance":
        await handleBalance(interaction);
        return true;

      case "pay":
        await handlePay(interaction);
        return true;

      case "transactions":
        await handleTransactions(interaction);
        return true;

      case "achievements":
        await handleAchievements(interaction);
        return true;

      case "battle":
        if (interaction.options.getSubcommand() === "challenge") {
          await handleBattleCommand(interaction);
          return true;
        }
        return false;

      case "crew":
        await handleCrew(interaction);
        return true;

      case "mission":
        await handleMission(interaction);
        return true;

      case "inventory":
        await handleInventory(interaction);
        return true;

      case "hero":
        await handleHero(interaction);
        return true;

      case "shop":
        await handleShop(interaction);
        return true;

      case "buy":
        await handleBuy(interaction);
        return true;

      case "raid":
      case "raid-admin":
        await handleRaid(interaction);
        return true;

      case "crew-war":
      case "crew-war-admin":
        await handleCrewWar(interaction);
        return true;

      case "admin":
        await handleAdmin(interaction);
        return true;

      case "trivia":
      case "trivia-admin":
        await handleTriviaCommand(interaction);
        return true;

      default:
        return await handlePotdCommand(interaction);
    }

  } catch (error) {
    console.error(
      `Command /${interaction.commandName} failed:`,
      error
    );

    const payload = {
      content: "Something went wrong while running that command. Check the bot logs.",
      ephemeral: true
    };

    try {
      await safeReply(interaction, payload);
    } catch (replyError) {
      console.error("Couldn't send command error reply:", replyError);
    }

    return true;
  }
}

// ============================================================
// AUTOCOMPLETE AND COMPONENT ROUTING
// ============================================================


async function handleAutocomplete(interaction) {
  if (["crew-war", "crew-war-admin"].includes(interaction.commandName)) {
    const subcommand = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused(true);

    if (interaction.commandName === "crew-war" && subcommand === "challenge" &&
        focused.name === "crew") {
      const currentCrew = getCrewForUser(interaction.guildId, interaction.user.id);
      const search = String(focused.value).toLowerCase();
      const choices = getAllCrews(interaction.guildId)
        .filter(crew => !currentCrew || crew.id !== currentCrew.id)
        .filter(crew =>
          crew.name.toLowerCase().includes(search) ||
          String(crew.abbreviation || "").toLowerCase().includes(search)
        )
        .slice(0, 25)
        .map(crew => ({
          name: `${crew.name}${crew.abbreviation ? ` [${crew.abbreviation}]` : ""}`
            .slice(0, 100),
          value: crew.name
        }));

      await interaction.respond(choices);
      return true;
    }

    if (
      interaction.commandName === "crew-war-admin" &&
      subcommand === "start" &&
      (focused.name === "crew_one" || focused.name === "crew_two")
    ) {
      const search = String(focused.value).toLowerCase();
      const choices = getAllCrews(interaction.guildId)
        .filter(crew =>
          crew.name.toLowerCase().includes(search) ||
          String(crew.abbreviation || "").toLowerCase().includes(search)
        )
        .slice(0, 25)
        .map(crew => ({
          name: `${crew.name}${crew.abbreviation ? ` [${crew.abbreviation}]` : ""}`
            .slice(0, 100),
          value: crew.name
        }));

      await interaction.respond(choices);
      return true;
    }
  }

  // /action autocomplete
  if (
    interaction.commandName === "action" &&
    interaction.options.getFocused(true).name === "name"
  ) {
    const actions = [
      "hug", "cuddle", "pat", "poke", "boop",
      "highfive", "wave", "handshake", "cheer",
      "bonk", "slap", "bite", "stare", "throw",
      "cry", "laugh", "blush", "facepalm",
      "comfort", "sigh", "wink", "sleep",
      "celebrate", "pout", "shrug", "salute",
      "dance"
    ];

    const focused = interaction.options
      .getFocused()
      .toLowerCase();

    const choices = actions
      .filter(name => name.includes(focused))
      .slice(0, 25)
      .map(name => ({
        name,
        value: name
      }));

    await interaction.respond(choices);
    return true;
  }

  const focusedOption = interaction.options.getFocused(true);
  if (
    !["buy", "hero"].includes(interaction.commandName) ||
    focusedOption.name !== "character"
  ) {
    return false;
  }

  preparePirate(interaction.user.id);

  const focused = interaction.options.getFocused().toLowerCase();
  if (interaction.commandName === "hero") {
    const choices = getOwnedCharacters(interaction.user.id)
      .map(entry => {
        const character = characters[entry.character_id];
        if (!character) return null;
        return {
          name: `${character.name} — Lv. ${entry.level}`.slice(0, 100),
          value: entry.character_id
        };
      })
      .filter(choice =>
        choice &&
        (choice.value.toLowerCase().includes(focused) ||
         choice.name.toLowerCase().includes(focused))
      )
      .slice(0, 25);

    await interaction.respond(choices);
    return true;
  }

  const owned = new Set(getOwnedCharacterIds(interaction.user.id));

  const choices = getCharacterEntries()
    .filter(([id, character]) =>
      !owned.has(id) &&
      (id.toLowerCase().includes(focused) ||
       character.name.toLowerCase().includes(focused))
    )
    .slice(0, 25)
    .map(([id, character]) => ({
      name: `${character.name} — ${formatNumber(getCharacterPrice(character))} ${BERRY}`.slice(0, 100),
      value: id
    }));

  await interaction.respond(choices);
  return true;
}


async function handleInteraction(interaction) {
  // Autocomplete interactions 
  if (interaction.isAutocomplete()) {
    return handleAutocomplete(interaction);
  }

  // Slash commands
  if (interaction.isChatInputCommand()) {
    return handleCommand(interaction);
  }

  if (
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isRoleSelectMenu() ||
    interaction.isModalSubmit() ||
    interaction.isChannelSelectMenu()
  ) {
    if (interaction.customId?.startsWith("help:guide:")) {
      return handleHelpComponent(interaction);
    }

    if (interaction.customId?.startsWith("start:guide:")) {
      return handleStartComponent(interaction);
    }

    if (interaction.customId?.startsWith("setup:")) {
      return handleSetupComponent(interaction);
    }

    let feature = null;
    if (interaction.customId?.startsWith("leaderboard:page:")) {
      const type = interaction.customId.split(":")[2];
      feature = {
        berry: "player_economy",
        bounty: "player_economy",
        crew: "crews_wars",
        raid: "raids",
        trivia: "trivia"
      }[type] || null;
    } else if (interaction.customId?.startsWith("raid:")) {
      feature = "raids";
    } else if (interaction.customId?.startsWith("crew-war:")) {
      feature = "crews_wars";
    } else if (interaction.customId?.startsWith("crew-banner-crop:")) {
      feature = "crews_wars";
    } else if (interaction.customId?.startsWith("trivia:")) {
      feature = "trivia";
    } else if (interaction.customId?.startsWith("potd:")) {
      feature = "potd";
    } else if (interaction.customId?.startsWith("ddm_")) {
      feature = getBattleFeatureForInteraction(interaction);
    }

    if (await blockOutsideConfiguredChannel(interaction, feature)) {
      return true;
    }

    if (interaction.customId?.startsWith("crew-banner-crop:")) {
      return handleCrewBannerCropComponent(interaction);
    }

    if (interaction.customId?.startsWith("leaderboard:page:trivia:")) {
      return handleTriviaComponent(interaction);
    }
    if (interaction.customId?.startsWith("leaderboard:page:")) {
      return handleLeaderboardPage(interaction);
    }
    if (interaction.customId?.startsWith("crew-war:")) {
      return handleCrewWarComponent(interaction);
    }
  }

  // POTD buttons, dropdowns, role selector and custom-timezone modal
  if (
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isRoleSelectMenu() ||
    interaction.isModalSubmit() ||
    interaction.isChannelSelectMenu()
  ) {
    const handledByPotd = await handlePotdComponent(interaction);

    if (handledByPotd) {
      return true;
    }

    const handledByTrivia = await handleTriviaComponent(interaction);

if (handledByTrivia) {
  return true;
}

const handledByRaid = await handleRaidComponent(interaction);
if (handledByRaid) {
  return true;
}

    // Preserve the existing battle button and dropdown handling.
    if (
      interaction.isButton() ||
      interaction.isStringSelectMenu()
    ) {
      return handleBattleInteraction(interaction);
    }
  }

  return false;
}


module.exports = {
  commands,
  actionCommand,
  handleCommand,
  handleInteraction,
  handleAutocomplete,
  createCrewBannerImage
};
