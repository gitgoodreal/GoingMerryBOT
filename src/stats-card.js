"use strict";

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");

const WIDTH = 1200;
const PADDING = 64;

const COLORS = {
  panel: "#141f32",
  panelLight: "#1c2b42",
  text: "#f5f2e9",
  muted: "#a9b5c8",
  gold: "#f3c45d",
  blue: "#62b9e8",
  green: "#6bd4a1",
  track: "#29364b"
};

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fitText(ctx, value, maxWidth) {
  const text = String(value ?? "");
  if (ctx.measureText(text).width <= maxWidth) return text;

  let shortened = text;
  while (shortened.length && ctx.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function drawText(ctx, value, x, y, maxWidth, font, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(fitText(ctx, value, maxWidth), x, y);
}

function getCardHeight(metrics, sections) {
  const metricRows = metrics.length ? 192 : 0;
  const sectionsHeight = sections.reduce(
    (height, section) => height + 66 + section.rows.length * 74 + 22,
    0
  );
  return Math.max(480, 314 + metricRows + sectionsHeight + 44);
}

async function loadAvatar(user) {
  try {
    const avatarUrl = typeof user?.displayAvatarURL === "function"
      ? user.displayAvatarURL({
          extension: "png",
          size: 128,
          forceStatic: true
        })
      : user?.avatarUrl;
    if (!avatarUrl) return null;
    return await loadImage(avatarUrl);
  } catch (error) {
    console.warn(`Could not load ${user.username || "pirate"}'s stats-card avatar:`, error.message);
    return null;
  }
}

function drawProgressBar(ctx, x, y, width, progress, color) {
  roundedRect(ctx, x, y, width, 10, 5);
  ctx.fillStyle = COLORS.track;
  ctx.fill();

  const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
  if (ratio > 0) {
    roundedRect(ctx, x, y, Math.max(10, width * ratio), 10, 5);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

async function generateStatsCard({
  user,
  category,
  subtitle,
  primary,
  metrics = [],
  sections = [],
  accent = COLORS.gold
}) {
  if (!user || typeof user.username !== "string") {
    throw new Error("A valid Discord user is required to generate a stats card.");
  }

  const height = getCardHeight(metrics, sections);
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");
  const avatar = await loadAvatar(user);

  const background = ctx.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, "#0b1322");
  background.addColorStop(0.55, "#111d30");
  background.addColorStop(1, "#18263a");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);

  const glow = ctx.createRadialGradient(1020, 30, 0, 1020, 30, 560);
  glow.addColorStop(0, `${accent}35`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, 450);

  roundedRect(ctx, 22, 22, WIDTH - 44, height - 44, 30);
  ctx.strokeStyle = `${accent}88`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = accent;
  roundedRect(ctx, PADDING, 64, 10, 184, 5);
  ctx.fill();

  const avatarX = 102;
  const avatarY = 76;
  const avatarSize = 152;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    const scale = Math.max(avatarSize / avatar.width, avatarSize / avatar.height);
    const drawWidth = avatar.width * scale;
    const drawHeight = avatar.height * scale;
    ctx.drawImage(
      avatar,
      avatarX + (avatarSize - drawWidth) / 2,
      avatarY + (avatarSize - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
  } else {
    ctx.fillStyle = COLORS.panelLight;
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = accent;
    ctx.font = "bold 84px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(user.username).charAt(0).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  drawText(ctx, "DEN DEN MUSHI  /  PIRATE RECORD", 286, 91, 660, "bold 20px Arial", accent);
  drawText(ctx, user.username, 286, 145, 700, "bold 44px Arial", COLORS.text);
  drawText(ctx, subtitle, 286, 184, 700, "24px Arial", COLORS.muted);
  drawText(ctx, category.toUpperCase(), 286, 225, 700, "bold 18px Arial", accent);

  if (primary) {
    ctx.textAlign = "right";
    drawText(ctx, primary.label.toUpperCase(), WIDTH - PADDING, 92, 320, "bold 17px Arial", COLORS.muted);
    drawText(ctx, primary.value, WIDTH - PADDING, 151, 420, "bold 38px Arial", COLORS.text);
    if (primary.detail) {
      drawText(ctx, primary.detail, WIDTH - PADDING, 190, 420, "20px Arial", accent);
    }
    ctx.textAlign = "left";
  }

  let y = 286;
  if (metrics.length) {
    const gap = 16;
    const tileWidth = (WIDTH - PADDING * 2 - gap * (metrics.length - 1)) / metrics.length;
    for (let index = 0; index < metrics.length; index += 1) {
      const metric = metrics[index];
      const x = PADDING + index * (tileWidth + gap);
      roundedRect(ctx, x, y, tileWidth, 142, 18);
      ctx.fillStyle = COLORS.panel;
      ctx.fill();
      drawText(ctx, metric.label.toUpperCase(), x + 22, y + 38, tileWidth - 44, "bold 16px Arial", COLORS.muted);
      drawText(ctx, metric.value, x + 22, y + 91, tileWidth - 44, "bold 34px Arial", metric.color || COLORS.text);
      if (metric.detail) {
        drawText(ctx, metric.detail, x + 22, y + 120, tileWidth - 44, "16px Arial", COLORS.muted);
      }
    }
    y += 174;
  }

  for (const section of sections) {
    roundedRect(ctx, PADDING, y, WIDTH - PADDING * 2, 52 + section.rows.length * 74, 18);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    drawText(ctx, section.title.toUpperCase(), PADDING + 24, y + 34, WIDTH - PADDING * 2 - 48, "bold 17px Arial", accent);

    let rowY = y + 75;
    for (const row of section.rows) {
      drawText(ctx, row.label, PADDING + 24, rowY, 460, "bold 20px Arial", COLORS.text);
      if (row.meta) {
        drawText(ctx, row.meta, PADDING + 24, rowY + 27, 540, "16px Arial", COLORS.muted);
      }
      ctx.textAlign = "right";
      drawText(ctx, row.value, WIDTH - PADDING - 24, rowY, 500, "bold 20px Arial", row.color || COLORS.text);
      ctx.textAlign = "left";
      if (row.progress !== undefined) {
        drawProgressBar(ctx, PADDING + 24, rowY + 39, WIDTH - PADDING * 2 - 48, row.progress, row.progressColor || accent);
      }
      rowY += 74;
    }
    y += 74 + section.rows.length * 74;
  }

  ctx.textAlign = "center";
  drawText(ctx, "A PIRATE'S JOURNEY IS WRITTEN BY THEIR CREW", WIDTH / 2, height - 35, WIDTH - 2 * PADDING, "bold 15px Arial", COLORS.muted);

  return new AttachmentBuilder(await canvas.encode("png"), {
    name: "pirate-stats.png"
  });
}

async function resolveLeaderboardNames(client, guild, rows) {
  return Promise.all(rows.map(async row => {
    const userId = String(row.userId);
    let member = guild?.members?.cache?.get(userId);
    const cachedUser = client?.users?.cache?.get(userId);
    let user = member?.user || cachedUser;

    if (!member && typeof guild?.members?.fetch === "function") {
      try {
        member = await guild.members.fetch(userId);
        user = member.user;
      } catch (error) {
        if (error.code !== 10007 && error.code !== 10013) {
          console.warn(`Could not resolve leaderboard member ${userId}:`, error.message);
        }
      }
    }

    if (!user && typeof client?.users?.fetch === "function") {
      try {
        user = await client.users.fetch(userId);
      } catch (error) {
        if (error.code !== 10013) {
          console.warn(`Could not resolve leaderboard user ${userId}:`, error.message);
        }
      }
    }

    const displayAvatarURL = user?.displayAvatarURL?.bind(user);
    return {
      ...row,
      label: member?.displayName || user?.globalName || user?.username || `Pirate ${userId.slice(-4)}`,
      avatar: displayAvatarURL ? { displayAvatarURL, username: user.username } : null
    };
  }));
}

async function generateLeaderboardCard({
  title,
  subtitle,
  rows,
  metricLabel,
  accent = COLORS.gold,
  page = 0
}) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, 10) : [];
  const height = 300 + 10 * 92;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, "#0b1322");
  background.addColorStop(0.55, "#111d30");
  background.addColorStop(1, "#18263a");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);

  const glow = ctx.createRadialGradient(1020, 30, 0, 1020, 30, 560);
  glow.addColorStop(0, `${accent}35`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, 300);

  roundedRect(ctx, 22, 22, WIDTH - 44, height - 44, 30);
  ctx.strokeStyle = `${accent}88`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = accent;
  roundedRect(ctx, PADDING, 64, 10, 142, 5);
  ctx.fill();

  drawText(ctx, "GRAND LINE  /  RANKINGS", PADDING + 32, 90, 800, "bold 20px Arial", accent);
  drawText(ctx, title, PADDING + 32, 150, WIDTH - PADDING * 2 - 64, "bold 42px Arial", COLORS.text);
  drawText(
    ctx,
    subtitle || `${safeRows.length} pirates on the board`,
    PADDING + 32,
    190,
    WIDTH - PADDING * 2 - 64,
    "22px Arial",
    COLORS.muted
  );

  const maxScore = Math.max(1, ...safeRows.map(row => Number(row.score) || 0));
  const avatars = await Promise.all(
    safeRows.map(row => row.avatar ? loadAvatar(row.avatar) : null)
  );
  const medalColors = ["#f3c45d", "#c5d0df", "#d99a66"];
  const startY = 232;

  for (let index = 0; index < 10; index += 1) {
    const row = safeRows[index];
    const rowY = startY + index * 92;
    roundedRect(ctx, PADDING, rowY, WIDTH - PADDING * 2, 78, 16);
    ctx.fillStyle = index < 3 ? "#18263a" : COLORS.panel;
    ctx.fill();

    const badgeColor = medalColors[index] || COLORS.blue;
    ctx.beginPath();
    ctx.arc(PADDING + 38, rowY + 39, 23, 0, Math.PI * 2);
    ctx.fillStyle = `${badgeColor}26`;
    ctx.fill();
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = "center";
    const rank = page * 10 + index + 1;
    drawText(ctx, String(rank).padStart(2, "0"), PADDING + 38, rowY + 46, 42, "bold 17px Arial", badgeColor);
    ctx.textAlign = "left";

    const avatarX = PADDING + 72;
    const avatarY = rowY + 11;
    const avatarSize = 56;
    const avatar = avatars[index];
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) {
      const scale = Math.max(avatarSize / avatar.width, avatarSize / avatar.height);
      const drawWidth = avatar.width * scale;
      const drawHeight = avatar.height * scale;
      ctx.drawImage(
        avatar,
        avatarX + (avatarSize - drawWidth) / 2,
        avatarY + (avatarSize - drawHeight) / 2,
        drawWidth,
        drawHeight
      );
    } else {
      ctx.fillStyle = COLORS.panelLight;
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
      ctx.fillStyle = COLORS.muted;
      ctx.font = "bold 24px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(row?.label?.charAt(0)?.toUpperCase() || "·", avatarX + avatarSize / 2, avatarY + avatarSize / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();

    drawText(ctx, row?.label || "Open slot", PADDING + 142, rowY + 34, 540, "bold 21px Arial", row ? COLORS.text : COLORS.muted);
    if (row?.meta) {
      drawText(ctx, row.meta, PADDING + 142, rowY + 59, 540, "16px Arial", COLORS.muted);
    }

    ctx.textAlign = "right";
    if (row) {
      drawText(ctx, row.value, WIDTH - PADDING - 22, rowY + 34, 390, "bold 21px Arial", index === 0 ? accent : COLORS.text);
    }
    ctx.textAlign = "left";

    const barX = PADDING + 142;
    const barY = rowY + 67;
    const barWidth = WIDTH - PADDING * 2 - 172;
    roundedRect(ctx, barX, barY, barWidth, 5, 3);
    ctx.fillStyle = COLORS.track;
    ctx.fill();
    const ratio = row
      ? Math.max(0, Math.min(1, (Number(row.score) || 0) / maxScore))
      : 0;
    if (ratio > 0) {
      roundedRect(ctx, barX, barY, Math.max(5, barWidth * ratio), 5, 3);
      ctx.fillStyle = index === 0 ? accent : `${accent}a8`;
      ctx.fill();
    }
  }

  ctx.textAlign = "center";
  drawText(
    ctx,
    metricLabel ? `RANKED BY ${metricLabel.toUpperCase()}` : "THE GRAND LINE'S TOP PIRATES",
    WIDTH / 2,
    height - 34,
    WIDTH - 2 * PADDING,
    "bold 15px Arial",
    COLORS.muted
  );

  return new AttachmentBuilder(await canvas.encode("png"), {
    name: "pirate-leaderboard.png"
  });
}

module.exports = {
  generateStatsCard,
  generateLeaderboardCard,
  resolveLeaderboardNames
};
