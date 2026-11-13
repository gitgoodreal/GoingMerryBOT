const {
  AttachmentBuilder,
  EmbedBuilder
} = require("discord.js");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { characters } = require("./characters");
const { getCharacterImage } = require("./battle-characters");

async function createHeroLevelUpMessage(result, playerName = "A pirate") {
  if (
    !result?.success ||
    !Number.isSafeInteger(result.levelsGained) ||
    result.levelsGained <= 0 ||
    !characters[result.characterId]
  ) {
    return null;
  }

  const character = characters[result.characterId];
  const image = await loadImage(getCharacterImage(result.characterId));
  const width = 960;
  const height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#111827");
  background.addColorStop(0.58, "#20243a");
  background.addColorStop(1, "#493016");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 270, height);
  ctx.clip();
  const scale = Math.max(270 / image.width, height / image.height);
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;
  ctx.drawImage(
    image,
    (270 - imageWidth) / 2,
    (height - imageHeight) / 2,
    imageWidth,
    imageHeight
  );
  ctx.restore();

  const shade = ctx.createLinearGradient(190, 0, 320, 0);
  shade.addColorStop(0, "rgba(17, 24, 39, 0)");
  shade.addColorStop(1, "#111827");
  ctx.fillStyle = shade;
  ctx.fillRect(190, 0, 150, height);

  ctx.strokeStyle = "#d8a33e";
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = "#efbd58";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(`${playerName}'s HERO LEVEL UP`, 322, 74, 590);

  ctx.fillStyle = "#fff4d6";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(character.name, 322, 132, 590);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 76px sans-serif";
  ctx.fillText(`LEVEL ${result.level}`, 322, 232);

  ctx.fillStyle = "#c8cad3";
  ctx.font = "24px sans-serif";
  ctx.fillText(
    result.levelsGained > 1
      ? `Hero levelled up ${result.levelsGained} levels!`
      : "Hero levelled up!",
    326,
    278,
    590
  );

  const attachmentName = "hero-level-up.png";
  const embed = new EmbedBuilder()
    .setColor(0xd8a33e)
    .setTitle(`⭐ ${playerName}'s ${character.name} levelled up to Level ${result.level}!`)
    .setImage(`attachment://${attachmentName}`);

  return {
    embeds: [embed],
    files: [
      new AttachmentBuilder(canvas.toBuffer("image/png"), {
        name: attachmentName
      })
    ],
    allowedMentions: { parse: [] }
  };
}

module.exports = {
  createHeroLevelUpMessage
};
