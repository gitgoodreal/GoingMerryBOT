
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");

const db = require("./db");

const WIDTH = 900;
const HEIGHT = 1200;

const COLORS = {
  paper: "#ead8a8",
  paperLight: "#f5e8c5",
  paperDark: "#c5a66b",
  ink: "#292016",
  fadedInk: "#66513a",
  red: "#8e2420",
  gold: "#b38a3b",
};

function getBountyRank(bounty) {
  if (bounty >= 3_000_000_000) {
    return {
      title: "LEGENDARY PIRATE",
      recognition: "A NAME THAT SHAKES THE WORLD",
    };
  }

  if (bounty >= 1_000_000_000) {
    return {
      title: "YONKO-LEVEL THREAT",
      recognition: "A MAJOR THREAT TO THE WORLD",
    };
  }

  if (bounty >= 500_000_000) {
    return {
      title: "ELITE PIRATE",
      recognition: "A DANGEROUS FORCE",
    };
  }

  if (bounty >= 100_000_000) {
    return {
      title: "NOTORIOUS PIRATE",
      recognition: "HIGH PRIORITY TARGET",
    };
  }

  if (bounty >= 10_000_000) {
    return {
      title: "RISING PIRATE",
      recognition: "THREAT LEVEL: ELEVATED",
    };
  }

  return {
    title: "WANTED PIRATE",
    recognition: "CAPTURE OR REPORT",
  };
}

function formatBerries(amount) {
  const value = Math.max(0, Number(amount) || 0);

  return `${value.toLocaleString("en-US")} BERRIES`;
}

function shortenText(text, maxLength = 28) {
  const value = String(text || "Unknown");

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function drawCenteredText(ctx, text, x, y) {
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;

    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) {
    ctx.fillText(line, x, currentY);
  }

  return currentY;
}

function drawDivider(ctx, x1, y, x2) {
  ctx.strokeStyle = COLORS.paperDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function drawStar(ctx, x, y, outerRadius, innerRadius) {
  ctx.beginPath();

  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.closePath();
  ctx.fill();
}

function getAchievementName(achievement) {
  if (typeof achievement === "string") {
    return achievement;
  }

  return (
    achievement?.title ||
    achievement?.name ||
    achievement?.achievement_name ||
    achievement?.achievement_id ||
    "Achievement unlocked"
  );
}

async function getPosterMetadata(user, suppliedMetadata = {}) {
  const metadata = {
    crew: null,
    battleStats: null,
    achievements: [],
    ...suppliedMetadata,
  };

  if (
    !metadata.crew &&
    metadata.guildId &&
    typeof db.getCrewForUser === "function"
  ) {
    try {
      metadata.crew = db.getCrewForUser(metadata.guildId, user.id);
    } catch (error) {
      console.error("Could not load wanted poster crew:", error.message);
    }
  }

  if (!metadata.battleStats && typeof db.getBattleStats === "function") {
    try {
      metadata.battleStats = db.getBattleStats(user.id);
    } catch (error) {
      console.error("Could not load wanted poster battle stats:", error.message);
    }
  }

  if (
    (!Array.isArray(metadata.achievements) ||
      metadata.achievements.length === 0) &&
    typeof db.getAchievements === "function"
  ) {
    try {
      metadata.achievements = db.getAchievements(user.id) || [];
    } catch (error) {
      console.error("Could not load wanted poster achievements:", error.message);
    }
  }

  return metadata;
}

async function generateWantedPoster(user, bounty, suppliedMetadata = {}) {
  if (!user || !user.id) {
    throw new Error("A valid Discord user is required to generate a wanted poster.");
  }

  const safeBounty = Math.max(0, Number(bounty) || 0);
  const metadata = await getPosterMetadata(user, suppliedMetadata);
  const rank = getBountyRank(safeBounty);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background paper
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle paper grain
  let seed = 48271;

  function random() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = 0; i < 6500; i++) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const size = random() * 2 + 0.5;

    ctx.fillStyle = random() > 0.5
      ? "rgba(91, 62, 28, 0.07)"
      : "rgba(255, 247, 220, 0.12)";

    ctx.fillRect(x, y, size, size);
  }

  // Outer frame
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 12;
  ctx.strokeRect(22, 22, WIDTH - 44, HEIGHT - 44);

  ctx.strokeStyle = COLORS.red;
  ctx.lineWidth = 3;
  ctx.strokeRect(39, 39, WIDTH - 78, HEIGHT - 78);

  // Decorative corner stars
  ctx.fillStyle = COLORS.red;

  for (const [x, y] of [
    [62, 62],
    [WIDTH - 62, 62],
    [62, HEIGHT - 62],
    [WIDTH - 62, HEIGHT - 62],
  ]) {
    drawStar(ctx, x, y, 12, 5);
  }

  // Header
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = "center";
  ctx.font = "bold 76px Georgia";
  drawCenteredText(ctx, "WANTED", WIDTH / 2, 125);

  ctx.fillStyle = COLORS.red;
  ctx.font = "bold 24px Georgia";
  drawCenteredText(ctx, "DEAD OR ALIVE", WIDTH / 2, 164);

  drawDivider(ctx, 100, 190, WIDTH - 100);

  // Character portrait frame
  const portraitX = 190;
  const portraitY = 215;
  const portraitSize = 520;

  ctx.fillStyle = COLORS.paperDark;
  ctx.fillRect(
    portraitX - 9,
    portraitY - 9,
    portraitSize + 18,
    portraitSize + 18
  );

  ctx.fillStyle = COLORS.paperLight;
  ctx.fillRect(portraitX, portraitY, portraitSize, portraitSize);

  let avatarLoaded = false;

  try {
    const avatarUrl =
      typeof user.displayAvatarURL === "function"
        ? user.displayAvatarURL({
            extension: "png",
            size: 512,
            forceStatic: true,
          })
        : null;

    if (avatarUrl) {
      const avatar = await loadImage(avatarUrl);

      ctx.save();
      ctx.beginPath();
      ctx.rect(portraitX, portraitY, portraitSize, portraitSize);
      ctx.clip();

      const scale = Math.max(
        portraitSize / avatar.width,
        portraitSize / avatar.height
      );

      const drawWidth = avatar.width * scale;
      const drawHeight = avatar.height * scale;

      ctx.drawImage(
        avatar,
        portraitX + (portraitSize - drawWidth) / 2,
        portraitY + (portraitSize - drawHeight) / 2,
        drawWidth,
        drawHeight
      );

      ctx.restore();
      avatarLoaded = true;
    }
  } catch (error) {
    console.warn("Could not load wanted poster avatar:", error.message);
  }

  // Fallback portrait if the avatar cannot be loaded
  if (!avatarLoaded) {
    ctx.fillStyle = "#d4bd8b";
    ctx.fillRect(portraitX, portraitY, portraitSize, portraitSize);

    ctx.fillStyle = COLORS.ink;
    ctx.font = "bold 180px Georgia";

    const initial = String(user.username || "?").charAt(0).toUpperCase();

    drawCenteredText(
      ctx,
      initial,
      WIDTH / 2,
      portraitY + portraitSize / 2 + 60
    );
  }

  // Portrait border
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 5;
  ctx.strokeRect(portraitX, portraitY, portraitSize, portraitSize);

  // Pirate name
  const displayName = shortenText(
    user.globalName || user.username || "Unknown Pirate",
    30
  );

  ctx.fillStyle = COLORS.ink;
  ctx.font = "bold 42px Georgia";

  if (ctx.measureText(displayName).width > 760) {
    ctx.font = "bold 34px Georgia";
  }

  drawCenteredText(ctx, displayName.toUpperCase(), WIDTH / 2, 795);

  // Rank
  ctx.fillStyle = COLORS.red;
  ctx.font = "bold 24px Georgia";
  drawCenteredText(ctx, rank.title, WIDTH / 2, 836);

  // Crew affiliation
  const crewName = metadata.crew?.name || "Independent Pirate";

  ctx.fillStyle = COLORS.ink;
  ctx.font = "22px Georgia";
  drawCenteredText(
    ctx,
    `CREW: ${shortenText(crewName, 32)}`,
    WIDTH / 2,
    875
  );

  drawDivider(ctx, 100, 905, WIDTH - 100);

  // Bounty section
  ctx.fillStyle = COLORS.fadedInk;
  ctx.font = "bold 24px Georgia";
  drawCenteredText(ctx, "CURRENT BOUNTY", WIDTH / 2, 947);

  ctx.fillStyle = COLORS.red;
  ctx.font = "bold 49px Georgia";

  const bountyText = formatBerries(safeBounty);

  if (ctx.measureText(bountyText).width > 760) {
    ctx.font = "bold 38px Georgia";
  }

  drawCenteredText(ctx, bountyText, WIDTH / 2, 1002);

  // Battle stats
  const stats = metadata.battleStats || {};
  const wins = Number(stats.wins ?? stats.battle_wins ?? 0);
  const losses = Number(stats.losses ?? stats.battle_losses ?? 0);

  ctx.fillStyle = COLORS.ink;
  ctx.font = "bold 20px Georgia";

  drawCenteredText(
    ctx,
    `BATTLE RECORD: ${wins} WINS  /  ${losses} LOSSES`,
    WIDTH / 2,
    1045
  );

  // Achievements and recognition
  const achievements = Array.isArray(metadata.achievements)
    ? metadata.achievements
    : [];

  const achievementNames = achievements
    .slice(0, 2)
    .map(getAchievementName);

  ctx.fillStyle = COLORS.red;
  ctx.font = "bold 17px Georgia";

  drawCenteredText(
    ctx,
    achievementNames.length
      ? `RECOGNITION: ${shortenText(achievementNames.join(" • "), 55)}`
      : rank.recognition,
    WIDTH / 2,
    1080
  );

  // Footer
  drawDivider(ctx, 100, 1100, WIDTH - 100);

  ctx.fillStyle = COLORS.fadedInk;
  ctx.font = "italic 17px Georgia";

  drawCenteredText(ctx, "ISSUED BY THE DEN DEN MUSHI PIRATE NETWORK", WIDTH / 2, 1132);

  ctx.fillStyle = COLORS.ink;
  ctx.font = "bold 16px Georgia";

  drawCenteredText(ctx, "THE GRAND LINE NEVER FORGETS.", WIDTH / 2, 1160);

  ctx.textAlign = "left";

  const buffer = canvas.toBuffer("image/png");

  return new AttachmentBuilder(buffer, {
    name: `wanted-${user.id}.png`,
  });
}

module.exports = {
  generateWantedPoster,
  getBountyRank,
};
