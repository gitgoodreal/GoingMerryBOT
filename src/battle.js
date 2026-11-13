const {
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const {
  ensureUser,
  getOwnedCharacters,
  getCharacterProgress,
  ownsCharacter,
  grantCharacterXp,
  recordBattleResult,
  recordBattleDraw,
  getBattleStats,
  getBounty,
  getCrewForUser,
  getCrewWar,
  hasCrewWarMatchParticipant,
  startCrewWarMatch,
  finishCrewWarMatch,
  cancelCrewWarMatch
} = require("./db");

const { characters, getCharacterStats } = require("./characters");
const { getCharacterImage } = require("./battle-characters");
const { logCrewActivity } = require("./crew-logs");
const { createHeroLevelUpMessage } = require("./hero-levelup-card");

const CHALLENGE_TIMEOUT = 60_000;
const BATTLE_TIMEOUT = 10 * 60_000;
const TURN_TIMEOUT = 90_000;
const BATTLE_IMAGE_NAME = "battle-versus.png";
const BATTLE_IMAGE_WIDTH = 1200;
const BATTLE_IMAGE_HEIGHT = 480;

const activeChallenges = new Map();
const activeBattles = new Map();

const COLORS = {
  default: 0x5865f2,
  victory: 0xf1c40f,
  defeat: 0xe74c3c,
  draw: 0x95a5a6
};

const CHARACTER_PASSIVES = {
  luffy: {
    name: "Never Gives Up",
    description: "Once per battle, recover 10 HP after falling below half health."
  },
  zoro: {
    name: "Three-Sword Pressure",
    description: "Deal 2 extra damage with every attack."
  },
  nami: {
    name: "Weather Tactician",
    description: "Deal 6 extra damage with your special."
  },
  chopper: {
    name: "Emergency Medicine",
    description: "Recover 32 HP instead of 20."
  },
  franky: {
    name: "Cyborg Plating",
    description: "Reduce each incoming hit by 3 damage."
  }
};

function getCharacterPassive(characterId) {
  return CHARACTER_PASSIVES[characterId] ?? {
    name: "No passive",
    description: "This fighter has no passive ability."
  };
}

function selectFirstTurn(playerIds, random = Math.random) {
  if (!Array.isArray(playerIds) || playerIds.length !== 2) {
    throw new Error("A battle requires exactly two players.");
  }

  return playerIds[Math.floor(random() * playerIds.length)];
}

function getCharacterIds(userId) {
  return getOwnedCharacters(userId)
    .map((entry) =>
      typeof entry === "string" ? entry : entry.character_id
    )
    .filter((id) => Boolean(characters[id]));
}

function getCharacter(id) {
  return characters[id] ?? null;
}

function getBattleCharacter(player) {
  return player?.characterStats ?? getCharacter(player?.characterId);
}

function getBattleById(id) {
  return activeBattles.get(String(id)) ?? null;
}

function playerName(battle, userId) {
  return battle.players[userId]?.username ?? "Unknown Pirate";
}

function makeEmbed(title, description, color = COLORS.default) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function getChallengeButtons(challengeId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ddm_challenge_accept:${challengeId}`)
      .setLabel("Accept Challenge")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ddm_challenge_decline:${challengeId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getCharacterMenu(battle, userId) {
  const ids = getCharacterIds(userId);

  const options = ids.slice(0, 25).map((id) => {
    const progress = getCharacterProgress(userId, id);
    const character = getCharacterStats(getCharacter(id), progress?.level);

    return {
      label: `${character.name} (Lv. ${character.level})`.slice(0, 100),
      value: id,
      description:
        `HP ${character.hp} • ATK ${character.attack} • DEF ${character.defense}`
          .slice(0, 100),
      emoji: character.emoji
    };
  });

  if (options.length === 0) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ddm_battle_pick:${battle.id}`)
      .setPlaceholder("Choose your fighter...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options)
  );
}

function getActionRows(battle) {
  const activePlayer = battle.players[battle.currentTurn];
  const character = getBattleCharacter(activePlayer);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ddm_battle_action:${battle.id}:attack`)
        .setLabel("Attack")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ddm_battle_action:${battle.id}:special`)
        .setLabel(activePlayer?.specialUsed ? "Special Used" : "Special")
        .setEmoji("💥")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(Boolean(activePlayer?.specialUsed)),
      new ButtonBuilder()
        .setCustomId(`ddm_battle_action:${battle.id}:defend`)
        .setLabel(activePlayer?.defending ? "Defending" : "Defend")
        .setEmoji("🛡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(Boolean(activePlayer?.defending)),
      new ButtonBuilder()
        .setCustomId(`ddm_battle_action:${battle.id}:recover`)
        .setLabel(activePlayer?.recoverUsed ? "Recover Used" : "Recover")
        .setEmoji("❤️")
        .setStyle(ButtonStyle.Success)
        .setDisabled(Boolean(
          activePlayer?.recoverUsed ||
          (character && activePlayer.hp >= character.hp)
        ))
    )
  ];
}

function getHealthBar(hp, maxHp) {
  const total = 10;
  const ratio =
    maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const filled = Math.round(ratio * total);

  return `${"🟩".repeat(filled)}${"⬛".repeat(total - filled)} ${hp}/${maxHp}`;
}

async function createBattleVersusImage(battle) {
  const [oneId, twoId] = battle.playerIds;
  const one = battle.players[oneId];
  const two = battle.players[twoId];
  const oneCharacter = getBattleCharacter(one);
  const twoCharacter = getBattleCharacter(two);

  if (!oneCharacter || !twoCharacter) {
    throw new Error("Cannot create battle artwork without both selected characters.");
  }

  const [oneImage, twoImage] = await Promise.all([
    loadImage(getCharacterImage(one.characterId)),
    loadImage(getCharacterImage(two.characterId))
  ]);
  const canvas = createCanvas(BATTLE_IMAGE_WIDTH, BATTLE_IMAGE_HEIGHT);
  const context = canvas.getContext("2d");
  const centerWidth = 160;
  const panelWidth = (BATTLE_IMAGE_WIDTH - centerWidth) / 2;

  context.fillStyle = "#101522";
  context.fillRect(0, 0, BATTLE_IMAGE_WIDTH, BATTLE_IMAGE_HEIGHT);

  const drawFighter = (image, x, character, username) => {
    context.save();
    context.beginPath();
    context.rect(x, 0, panelWidth, BATTLE_IMAGE_HEIGHT);
    context.clip();

    const scale = Math.max(
      panelWidth / image.width,
      BATTLE_IMAGE_HEIGHT / image.height
    );
    const width = image.width * scale;
    const height = image.height * scale;
    const imageX = x + (panelWidth - width) / 2;
    const imageY = (BATTLE_IMAGE_HEIGHT - height) / 2;

    context.drawImage(image, imageX, imageY, width, height);
    context.restore();

    const gradient = context.createLinearGradient(
      0,
      BATTLE_IMAGE_HEIGHT - 150,
      0,
      BATTLE_IMAGE_HEIGHT
    );
    gradient.addColorStop(0, "rgba(10, 14, 24, 0)");
    gradient.addColorStop(1, "rgba(10, 14, 24, 0.96)");
    context.fillStyle = gradient;
    context.fillRect(x, BATTLE_IMAGE_HEIGHT - 150, panelWidth, 150);

    context.textAlign = "left";
    context.fillStyle = "#ffffff";
    context.font = "bold 28px sans-serif";
    context.fillText(username, x + 30, BATTLE_IMAGE_HEIGHT - 76, panelWidth - 60);
    context.font = "bold 36px sans-serif";
    context.fillText(character.name, x + 30, BATTLE_IMAGE_HEIGHT - 30, panelWidth - 60);
  };

  drawFighter(oneImage, 0, oneCharacter, one.username);
  drawFighter(twoImage, panelWidth + centerWidth, twoCharacter, two.username);

  const centerX = panelWidth + centerWidth / 2;
  context.beginPath();
  context.arc(centerX, BATTLE_IMAGE_HEIGHT / 2, 66, 0, Math.PI * 2);
  context.fillStyle = "#d8a33e";
  context.fill();
  context.strokeStyle = "#fff2cc";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#101522";
  context.font = "bold 50px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("VS", centerX, BATTLE_IMAGE_HEIGHT / 2);

  return canvas.toBuffer("image/png");
}

function getBattleImageFiles(battle) {
  return battle.imageBuffer
    ? [new AttachmentBuilder(battle.imageBuffer, { name: BATTLE_IMAGE_NAME })]
    : [];
}

function withBattleImage(embed, battle) {
  if (battle.imageBuffer) {
    embed.setImage(`attachment://${BATTLE_IMAGE_NAME}`);
  }

  return embed;
}

function buildBattleEmbed(battle, description = "") {
  const one = battle.players[battle.playerIds[0]];
  const two = battle.players[battle.playerIds[1]];

  const oneCharacter = getBattleCharacter(one);
  const twoCharacter = getBattleCharacter(two);

  if (!oneCharacter || !twoCharacter) {
    return makeEmbed(
      "🏴‍☠️ PIRATE BATTLE",
      description || "The battle is underway!",
      COLORS.default
    );
  }

  const fighterStatus = (player, character) => {
    const passive = getCharacterPassive(player.characterId);
    const guard = player.defending ? "🛡️ Guard active" : "Guard ready";
    const special = player.specialUsed ? "Special used" : "Special ready";
    const recover = player.recoverUsed ? "Recover used" : "Recover ready";
    let passiveState = "Passive active";
    if (player.characterId === "luffy") {
      passiveState = player.passiveUsed ? "Passive used" : "Passive ready";
    } else if (player.characterId === "chopper") {
      passiveState = player.recoverUsed ? "Passive used" : "Passive ready";
    } else if (!CHARACTER_PASSIVES[player.characterId]) {
      passiveState = "No passive";
    }

    return (
      `**${character.name} · Lv. ${character.level || 1}**\n` +
      `${getHealthBar(player.hp, character.hp)}\n` +
      `ATK: ${character.attack} • DEF: ${character.defense}\n` +
      `✨ **${passive.name}:** ${passive.description}\n` +
      `${passiveState} • ${special} • ${recover} • ${guard}`
    );
  };

  return withBattleImage(new EmbedBuilder()
    .setColor(COLORS.default)
    .setTitle(`🏴‍☠️ PIRATE BATTLE • ROUND ${battle.round || 1}`)
    .setDescription(description || "The fight is underway!")
    .addFields(
      {
        name: `${oneCharacter.emoji} ${one.username}`,
        value: fighterStatus(one, oneCharacter),
        inline: true
      },
      {
        name: `${twoCharacter.emoji} ${two.username}`,
        value: fighterStatus(two, twoCharacter),
        inline: true
      },
      {
        name: "⏳ Battle status",
        value: `Round **${battle.round || 1}** • **${playerName(battle, battle.currentTurn)}** is up!`
      }
    )
    .setFooter({ text: "Choose Attack, Special, Defend, or Recover • Each turn has 90 seconds." })
    .setTimestamp(), battle);
}

function disableActionRows(rows) {
  return rows.map((row) => {
    const disabledRow = ActionRowBuilder.from(row);

    disabledRow.components.forEach((component) => {
      component.setDisabled(true);
    });

    return disabledRow;
  });
}

function clearBattleTimers(battle) {
  if (battle.turnTimer) clearTimeout(battle.turnTimer);
  if (battle.battleTimer) clearTimeout(battle.battleTimer);

  battle.turnTimer = null;
  battle.battleTimer = null;
}

function removeBattle(battle) {
  clearBattleTimers(battle);
  activeBattles.delete(String(battle.id));
}

function scheduleTurnTimeout(battle) {
  if (battle.turnTimer) clearTimeout(battle.turnTimer);

  const expectedPhase = battle.phase;
  const expectedPlayerId =
    expectedPhase === "selecting"
      ? battle.selectingPlayerId
      : battle.currentTurn;

  battle.turnTimer = setTimeout(async () => {
    if (battle.finished || battle.phase !== expectedPhase) return;

    const currentPlayerId =
      battle.phase === "selecting"
        ? battle.selectingPlayerId
        : battle.currentTurn;

    if (currentPlayerId !== expectedPlayerId) return;

    battle.timeoutPlayerId = currentPlayerId;

    await finishBattle(battle, null, null, "turn_timeout");
  }, TURN_TIMEOUT);
}

function scheduleBattleTimeout(battle) {
  if (battle.battleTimer) clearTimeout(battle.battleTimer);

  battle.battleTimer = setTimeout(async () => {
    if (battle.finished) return;

    await finishBattle(battle, null, null, "timeout");
  }, BATTLE_TIMEOUT);
}

function getUserBattle(userId) {
  for (const battle of activeBattles.values()) {
    if (battle.playerIds.includes(String(userId)) && !battle.finished) {
      return battle;
    }
  }

  return null;
}

function isUserInChallenge(userId) {
  for (const challenge of activeChallenges.values()) {
    if (
      !challenge.finished &&
      [challenge.challengerId, challenge.targetId].includes(String(userId))
    ) {
      return true;
    }
  }

  return false;
}

async function safeInteractionReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.followUp(payload);
    }

    return await interaction.reply(payload);
  } catch {
    return null;
  }
}

async function handleBattleCommand(interaction, options = {}) {
  const target = options.target ??
    interaction.options.getUser("member") ??
    interaction.options.getUser("opponent") ??
    interaction.options.getUser("target");

  if (!target) {
    return safeInteractionReply(interaction, {
      content: "Choose a pirate to challenge!",
      ephemeral: true
    });
  }

  const challenger = interaction.user;

  if (target.bot) {
    return safeInteractionReply(interaction, {
      content: "You can't challenge a bot to this battle.",
      ephemeral: true
    });
  }

  if (target.id === challenger.id) {
    return safeInteractionReply(interaction, {
      content: "You can't challenge yourself, Captain.",
      ephemeral: true
    });
  }

  if (!interaction.guildId) {
    return safeInteractionReply(interaction, {
      content: "Battles can only take place inside a server.",
      ephemeral: true
    });
  }

  if (options.crewWarId) {
    const war = getCrewWar(interaction.guildId, options.crewWarId);
    const challengerCrew = getCrewForUser(interaction.guildId, challenger.id);
    const targetCrew = getCrewForUser(interaction.guildId, target.id);

    if (
      !war ||
      war.status !== "active" ||
      !challengerCrew ||
      !targetCrew ||
      challengerCrew.id === targetCrew.id ||
      ![war.crew_one_id, war.crew_two_id].includes(challengerCrew.id) ||
      ![war.crew_one_id, war.crew_two_id].includes(targetCrew.id)
    ) {
      return safeInteractionReply(interaction, {
        content: "Choose an opponent from the other crew in the active war.",
        ephemeral: true
      });
    }

    if (
      hasCrewWarMatchParticipant(war.guild_id, war.id, challenger.id) ||
      hasCrewWarMatchParticipant(war.guild_id, war.id, target.id)
    ) {
      return safeInteractionReply(interaction, {
        content: "You or that opponent has already completed a duel in this war.",
        ephemeral: true
      });
    }
  }

  if (getUserBattle(challenger.id) || isUserInChallenge(challenger.id)) {
    return safeInteractionReply(interaction, {
      content: "You're already in a battle or have a pending challenge.",
      ephemeral: true
    });
  }

  if (getUserBattle(target.id) || isUserInChallenge(target.id)) {
    return safeInteractionReply(interaction, {
      content: "That pirate is already in a battle or has a pending challenge.",
      ephemeral: true
    });
  }

  ensureUser(challenger.id);
  ensureUser(target.id);

  if (getCharacterIds(challenger.id).length === 0) {
    return safeInteractionReply(interaction, {
      content: "You don't have any usable characters yet.",
      ephemeral: true
    });
  }

  if (getCharacterIds(target.id).length === 0) {
    return safeInteractionReply(interaction, {
      content: "That player doesn't have any usable characters yet.",
      ephemeral: true
    });
  }

  const challengeId = String(interaction.id);

  const challenge = {
    id: challengeId,
    guildId: interaction.guildId,
    challengerId: challenger.id,
    targetId: target.id,
    challengerUsername: challenger.username,
    targetUsername: target.username,
    crewWarId: options.crewWarId ?? null,
    channelId: interaction.channelId,
    message: null,
    finished: false,
    timer: null
  };

  activeChallenges.set(challengeId, challenge);

  const embed = makeEmbed(
    "🏴‍☠️ A Pirate Challenge!",
    `${challenger} has challenged ${target} to a battle!\n\n` +
      "The challenged pirate has 60 seconds to accept.\n" +
      "May the strongest pirate win!",
    COLORS.default
  );

  try {
    await interaction.reply({
      content: `${target}`,
      embeds: [embed],
      components: [getChallengeButtons(challengeId)],
      allowedMentions: { users: [target.id] }
    });

    challenge.message = await interaction.fetchReply();

    challenge.timer = setTimeout(async () => {
      if (challenge.finished) return;

      challenge.finished = true;
      activeChallenges.delete(challengeId);

      await challenge.message.edit({
        embeds: [
          makeEmbed(
            "⌛ Challenge Expired",
            "The challenge expired because it wasn't accepted in time.",
            COLORS.draw
          )
        ],
        components: []
      }).catch(() => {});
    }, CHALLENGE_TIMEOUT);
  } catch (error) {
    activeChallenges.delete(challengeId);
    console.error("Failed to create battle challenge:", error);

    await safeInteractionReply(interaction, {
      content: "I couldn't create the challenge. Please try again.",
      ephemeral: true
    });
  }
}

async function handleCrewWarBattleCommand(interaction, target, warId) {
  return handleBattleCommand(interaction, {
    target,
    crewWarId: warId
  });
}

async function handleChallengeInteraction(interaction, action, challengeId) {
  const challenge = activeChallenges.get(challengeId);

  if (!challenge || challenge.finished) {
    return safeInteractionReply(interaction, {
      content: "This challenge has expired or already been handled.",
      ephemeral: true
    });
  }

  if (interaction.user.id !== challenge.targetId) {
    return safeInteractionReply(interaction, {
      content: "Only the challenged pirate can respond to this challenge.",
      ephemeral: true
    });
  }

  if (action === "decline") {
    challenge.finished = true;

    if (challenge.timer) clearTimeout(challenge.timer);

    activeChallenges.delete(challengeId);

    return interaction.update({
      embeds: [
        makeEmbed(
          "🏳️ Challenge Declined",
          `${challenge.targetUsername} declined the battle challenge.`,
          COLORS.draw
        )
      ],
      components: []
    });
  }

  if (action !== "accept") return;

  if (getUserBattle(challenge.challengerId) || getUserBattle(challenge.targetId)) {
    challenge.finished = true;

    if (challenge.timer) clearTimeout(challenge.timer);

    activeChallenges.delete(challengeId);

    return interaction.update({
      embeds: [
        makeEmbed(
          "Battle Unavailable",
          "One of the pirates is already in another battle.",
          COLORS.draw
        )
      ],
      components: []
    });
  }

  if (challenge.crewWarId) {
    let match;
    try {
      match = startCrewWarMatch(
        challenge.guildId,
        challenge.crewWarId,
        challenge.id,
        challenge.challengerId,
        challenge.targetId
      );
    } catch (error) {
      console.error("Could not start crew war duel:", error);
      challenge.finished = true;
      if (challenge.timer) clearTimeout(challenge.timer);
      activeChallenges.delete(challengeId);

      return interaction.update({
        embeds: [
          makeEmbed(
            "Duel Error",
            "The duel couldn't start because of a database error. Please try again.",
            COLORS.draw
          )
        ],
        components: []
      });
    }

    if (!match.success) {
      challenge.finished = true;
      if (challenge.timer) clearTimeout(challenge.timer);
      activeChallenges.delete(challengeId);

      return interaction.update({
        embeds: [
          makeEmbed("Duel Unavailable", match.message, COLORS.draw)
        ],
        components: []
      });
    }
  }

  const battle = {
    id: challengeId,
    guildId: challenge.guildId,
    channelId: challenge.channelId,
    message: challenge.message,
    crewWarId: challenge.crewWarId,
    playerIds: [challenge.challengerId, challenge.targetId],
    players: {
      [challenge.challengerId]: {
        username: challenge.challengerUsername,
        characterId: null,
        hp: 0,
        defending: false,
        specialUsed: false,
        recoverUsed: false,
        passiveUsed: false
      },
      [challenge.targetId]: {
        username: challenge.targetUsername,
        characterId: null,
        hp: 0,
        defending: false,
        specialUsed: false,
        recoverUsed: false,
        passiveUsed: false
      }
    },
    currentTurn: challenge.challengerId,
    round: 1,
    turnCount: 0,
    selectingPlayerId: challenge.challengerId,
    phase: "selecting",
    finished: false,
    turnTimer: null,
    battleTimer: null,
    timeoutPlayerId: null
  };

  challenge.finished = true;

  if (challenge.timer) clearTimeout(challenge.timer);

  activeChallenges.delete(challengeId);
  activeBattles.set(challengeId, battle);

  const menu = getCharacterMenu(battle, challenge.challengerId);

  if (!menu) {
    battle.finished = true;
    if (battle.crewWarId) cancelCrewWarMatch(battle.guildId, battle.id);
    removeBattle(battle);

    return interaction.update({
      embeds: [
        makeEmbed(
          "No Characters Available",
          "The challenger no longer has any available characters.",
          COLORS.draw
        )
      ],
      components: []
    });
  }

  try {
    await interaction.update({
      embeds: [
        makeEmbed(
          "⚔️ Choose Your Fighters",
          `<@${challenge.challengerId}>, select your character first.\n` +
            `<@${challenge.targetId}> will select after that.\n\n` +
            "Only characters you own can be selected.",
          COLORS.default
        )
      ],
      components: [menu]
    });

    battle.message = await interaction.fetchReply().catch(() => challenge.message);

    scheduleTurnTimeout(battle);
    scheduleBattleTimeout(battle);
  } catch (error) {
    console.error("Failed to start battle:", error);
    battle.finished = true;
    if (battle.crewWarId) cancelCrewWarMatch(battle.guildId, battle.id);
    removeBattle(battle);
  }
}

async function handleCharacterPick(interaction, battleId) {
  const battle = getBattleById(battleId);

  if (!battle || battle.finished || battle.phase !== "selecting") {
    return safeInteractionReply(interaction, {
      content: "This character selection is no longer active.",
      ephemeral: true
    });
  }

  const userId = interaction.user.id;

  if (!battle.playerIds.includes(userId)) {
    return safeInteractionReply(interaction, {
      content: "You're not a participant in this battle.",
      ephemeral: true
    });
  }

  if (userId !== battle.selectingPlayerId) {
    return safeInteractionReply(interaction, {
      content: "Wait for your turn to choose a fighter.",
      ephemeral: true
    });
  }

  if (battle.players[userId].characterId) {
    return safeInteractionReply(interaction, {
      content: "You've already selected your fighter.",
      ephemeral: true
    });
  }

  const characterId = interaction.values?.[0];

  if (
    !characterId ||
    !getCharacter(characterId) ||
    !ownsCharacter(userId, characterId)
  ) {
    return safeInteractionReply(interaction, {
      content: "You don't own that character. Select one from your collection.",
      ephemeral: true
    });
  }

  const progress = getCharacterProgress(userId, characterId);
  const character = getCharacterStats(getCharacter(characterId), progress?.level);

  battle.players[userId].characterId = characterId;
  battle.players[userId].characterStats = character;
  battle.players[userId].hp = character.hp;

  const bothSelected = battle.playerIds.every(
    (id) => Boolean(battle.players[id].characterId)
  );

  if (!bothSelected) {
    const nextPlayer = battle.playerIds.find(
      (id) => !battle.players[id].characterId
    );

    battle.selectingPlayerId = nextPlayer;

    const menu = getCharacterMenu(battle, nextPlayer);

    if (!menu) {
      battle.finished = true;
      if (battle.crewWarId) cancelCrewWarMatch(battle.guildId, battle.id);
      removeBattle(battle);

      return interaction.update({
        embeds: [
          makeEmbed(
            "Battle Cancelled",
            "The remaining player has no available characters.",
            COLORS.draw
          )
        ],
        components: []
      });
    }

    await interaction.update({
      embeds: [
        makeEmbed(
          "Fighter Selected!",
          `${interaction.user} selected **${character.name}** ${character.emoji}.\n\n` +
            `<@${nextPlayer}>, choose your fighter next!`,
          COLORS.default
        )
      ],
      components: [menu]
    });

    battle.message = await interaction.fetchReply().catch(() => battle.message);

    scheduleTurnTimeout(battle);
    return;
  }

  battle.selectingPlayerId = null;
  battle.phase = "fighting";
  battle.currentTurn = selectFirstTurn(battle.playerIds);
  battle.imageBuffer = await createBattleVersusImage(battle);

  const embed = buildBattleEmbed(
    battle,
    `Both pirates are ready!\n\n${playerName(battle, battle.currentTurn)} goes first.`
  );

  await interaction.update({
    embeds: [embed],
    files: getBattleImageFiles(battle),
    components: getActionRows(battle)
  });

  battle.message = await interaction.fetchReply().catch(() => battle.message);

  scheduleTurnTimeout(battle);
  scheduleBattleTimeout(battle);
}

function calculateDamage(
  attacker,
  defender,
  isSpecial = false,
  random = Math.random
) {
  const attackerCharacter = getBattleCharacter(attacker);
  const defenderCharacter = getBattleCharacter(defender);

  if (!attackerCharacter || !defenderCharacter) return 1;

  const variance = Math.floor(random() * 9);
  const specialBonus = isSpecial ? 12 : 0;
  const attackerPassiveBonus =
    attacker.characterId === "zoro"
      ? 2
      : attacker.characterId === "nami" && isSpecial
        ? 6
        : 0;
  const defenderPassiveReduction =
    defender.characterId === "franky" ? 3 : 0;

  let damage = Math.max(
    1,
    attackerCharacter.attack +
      variance +
      specialBonus +
      attackerPassiveBonus -
      defenderCharacter.defense -
      defenderPassiveReduction
  );

  if (defender.defending) {
    damage = Math.max(1, Math.floor(damage / 2));
    defender.defending = false;
  }

  return damage;
}

function triggerLowHealthPassive(player) {
  if (
    player.characterId !== "luffy" ||
    player.passiveUsed ||
    player.hp <= 0
  ) {
    return 0;
  }

  const character = getBattleCharacter(player);
  if (!character || player.hp > character.hp / 2) return 0;

  const recovered = Math.min(10, character.hp - player.hp);
  player.hp += recovered;
  player.passiveUsed = true;
  return recovered;
}

function getRecoveryAmount(characterId) {
  return characterId === "chopper" ? 32 : 20;
}

async function finishBattle(battle, winnerId, loserId, reason = "victory") {
  if (battle.finished) return;

  const previousPhase = battle.phase;

  battle.finished = true;
  battle.phase = "finished";

  clearBattleTimers(battle);

  let rewardResult = null;
  let crewWarResult = null;
  const heroXp = {};

  if (battle.crewWarId) {
    try {
      crewWarResult = winnerId
        ? finishCrewWarMatch(battle.guildId, battle.id, winnerId)
        : { success: cancelCrewWarMatch(battle.guildId, battle.id) };
    } catch (error) {
      console.error("Crew war match result error:", error);
      crewWarResult = { success: false, message: "Crew war score could not be updated." };
    }
  }

  if (winnerId && loserId) {
    try {
      rewardResult = recordBattleResult(winnerId, loserId, {
        idempotencyKey: battle.id
      });
    } catch (error) {
      console.error("Battle reward error:", error);
      rewardResult = { success: false, reason: "reward_error" };
    }

    for (const [userId, amount] of [[winnerId, 30], [loserId, 15]]) {
      try {
        const characterId = battle.players[userId]?.characterId;
        if (characterId) {
          heroXp[userId] = grantCharacterXp(userId, characterId, amount);
        }
      } catch (error) {
        console.error("Battle hero XP award error:", error);
      }
    }
  } else {
    try {
      rewardResult = recordBattleDraw(
        battle.playerIds[0],
        battle.playerIds[1],
        { idempotencyKey: battle.id }
      );
    } catch (error) {
      console.error("Battle draw recording error:", error);
    }
  }

  removeBattle(battle);

  let embed;

  if (!winnerId) {
    let description;

    if (reason === "turn_timeout" && battle.timeoutPlayerId) {
      description =
        `**${playerName(battle, battle.timeoutPlayerId)}** ran out of time.\n\n` +
        "The battle ended in a draw. No victory rewards were awarded.";
    } else if (reason === "timeout") {
      description =
        "The battle lasted too long and ended in a draw. No victory rewards were awarded.";
    } else {
      description =
        "Both pirates fought hard, but neither claimed victory.";
    }

    embed = makeEmbed("🤝 Battle Draw", description, COLORS.draw);
  } else if (rewardResult?.success) {
    const winnerName = playerName(battle, winnerId);
    const loserName = playerName(battle, loserId);

    let stats = null;
    let currentBounty = null;

    try {
      stats = getBattleStats(winnerId);
    } catch (error) {
      console.error("Could not read winner battle stats:", error);
    }

    try {
      currentBounty = getBounty(winnerId);
    } catch (error) {
      console.error("Could not read winner bounty:", error);
    }

    const berriesReward = Number.isFinite(rewardResult.berries)
      ? rewardResult.berries
      : 100;

    const bountyReward = Number.isFinite(rewardResult.bounty)
      ? rewardResult.bounty
      : 1000;

    const lines = [
      `🏆 **${winnerName}** defeated **${loserName}**!`,
      "",
      "💰 **Rewards**",
      `• ${berriesReward.toLocaleString("en-US")} Berries`,
      `• ${bountyReward.toLocaleString("en-US")} bounty`
    ];

    if (currentBounty !== null && currentBounty !== undefined) {
      const bountyValue = Number(currentBounty);

      if (Number.isFinite(bountyValue)) {
        lines.push(
          `• New bounty: **${bountyValue.toLocaleString("en-US")}**`
        );
      }
    }

    for (const [userId, result] of Object.entries(heroXp)) {
      if (result?.success && result.awarded) {
        lines.push(
          `⭐ ${playerName(battle, userId)}'s **${battle.players[userId].characterStats.name}** gained **${result.awarded} XP**` +
          (result.levelsGained
            ? ` and reached **Level ${result.level}**!`
            : ".")
        );
      }
    }

    if (stats && Number.isFinite(Number(stats.wins))) {
      lines.push("", `Total wins: **${stats.wins}**`);
    }

    if (battle.crewWarId) {
      lines.push(
        "",
        crewWarResult?.success
          ? crewWarResult.autoFinished
            ? `⚔️ **Crew war complete!** Final score: ${crewWarResult.war.score_one}–${crewWarResult.war.score_two}.`
            : crewWarResult.warFinishing
              ? crewWarResult.pointAwarded
                ? "⚔️ **Your crew reached the 10-win goal and clinched the war!** Other ongoing duels will finish without changing the result."
                : "⚔️ The war is already clinched; this duel won't change its score."
              : "⚔️ **Your crew earns 1 crew-war point!**"
          : `⚠️ The duel finished, but no war point was recorded: ${
              crewWarResult?.message || "the war may have ended."
            }`
      );
    }

    embed = makeEmbed("🏴‍☠️ VICTORY!", lines.join("\n"), COLORS.victory);
  } else {
    embed = makeEmbed(
      "Battle Finished",
      "The battle ended, but the database did not confirm a new reward. No extra rewards were issued.",
      COLORS.draw
    );
  }

  withBattleImage(embed, battle);

  try {
    await battle.message.edit({
      embeds: [embed],
      files: getBattleImageFiles(battle),
      components:
        previousPhase === "selecting"
          ? []
          : disableActionRows(getActionRows(battle))
    });
  } catch (error) {
    console.error("Could not update finished battle message:", error);
  }

  if (
    battle.crewWarId &&
    crewWarResult?.success &&
    battle.channel?.guild
  ) {
    const winnerCrew = winnerId
      ? getCrewForUser(battle.guildId, winnerId)
      : null;
    const opponentId = winnerId
      ? battle.playerIds.find(playerId => playerId !== winnerId)
      : null;
    const opponentCrew = opponentId
      ? getCrewForUser(battle.guildId, opponentId)
      : null;
    const score = crewWarResult.war
      ? `${crewWarResult.war.score_one}–${crewWarResult.war.score_two}`
      : "updated";

    for (const crew of [winnerCrew, opponentCrew]) {
      if (!crew) continue;
      try {
        await logCrewActivity(
          battle.channel.guild,
          crew,
          "Crew-war duel completed",
          winnerId
            ? `<@${winnerId}> defeated <@${opponentId}>. War score: ${score}.`
            : "The duel ended in a draw and did not add a crew-war point."
        );
      } catch (error) {
        console.error(`Crew-war activity log failed for ${crew.name}:`, error);
      }
    }

    if (crewWarResult.autoFinished) {
      const winnerCrewName = crewWarResult.winnerCrewId === winnerCrew?.id
        ? winnerCrew.name
        : crewWarResult.winnerCrewId === opponentCrew?.id
          ? opponentCrew.name
          : null;
      for (const crew of [winnerCrew, opponentCrew]) {
        if (!crew) continue;
        try {
          await logCrewActivity(
            battle.channel.guild,
            crew,
            "Crew war finished",
            winnerCrewName
              ? `**${winnerCrewName}** won the war. The winning crew received 10 crew points.`
              : "The crew war finished without a winner."
          );
        } catch (error) {
          console.error(`Crew-war completion log failed for ${crew.name}:`, error);
        }
      }
    }
  }

  for (const [userId, result] of Object.entries(heroXp)) {
    if (!result?.success || result.levelsGained <= 0) continue;

    try {
      const payload = await createHeroLevelUpMessage(
        result,
        playerName(battle, userId)
      );
      if (payload) {
        await battle.channel.send(payload);
      }
    } catch (error) {
      console.error(`Battle hero level-up announcement failed for ${userId}:`, error);
    }
  }
}

async function handleBattleAction(interaction, battleId, action) {
  const battle = getBattleById(battleId);

  if (!battle || battle.finished || battle.phase !== "fighting") {
    return safeInteractionReply(interaction, {
      content: "This battle is no longer active.",
      ephemeral: true
    });
  }

  const userId = interaction.user.id;

  if (!battle.playerIds.includes(userId)) {
    return safeInteractionReply(interaction, {
      content: "You're not part of this battle.",
      ephemeral: true
    });
  }

  if (battle.currentTurn !== userId) {
    return safeInteractionReply(interaction, {
      content: "It's not your turn yet!",
      ephemeral: true
    });
  }

  const attacker = battle.players[userId];
  const opponentId = battle.playerIds.find((id) => id !== userId);
  const defender = battle.players[opponentId];
  const attackerCharacter = getBattleCharacter(attacker);

  if (!attackerCharacter || !getBattleCharacter(defender)) {
    return safeInteractionReply(interaction, {
      content: "A fighter could not be loaded. Please contact a moderator.",
      ephemeral: true
    });
  }

  let description = "";
  let tookDamage = false;

  if (action === "attack") {
    const damage = calculateDamage(attacker, defender);

    defender.hp = Math.max(0, defender.hp - damage);
    tookDamage = true;

    description =
      `⚔️ **${attacker.username}** attacked **${defender.username}** for **${damage} damage**!`;
  } else if (action === "special") {
    if (attacker.specialUsed) {
      return safeInteractionReply(interaction, {
        content: "You've already used your special attack this battle.",
        ephemeral: true
      });
    }

    attacker.specialUsed = true;

    const damage = calculateDamage(attacker, defender, true);

    defender.hp = Math.max(0, defender.hp - damage);
    tookDamage = true;

    description =
      `💥 **${attacker.username}** used **${attackerCharacter.special}** for **${damage} damage**!`;
  } else if (action === "defend") {
    if (attacker.defending) {
      return safeInteractionReply(interaction, {
        content: "You're already defending against the next attack.",
        ephemeral: true
      });
    }

    attacker.defending = true;

    description =
      `🛡️ **${attacker.username}** is defending and will reduce the next incoming hit!`;
  } else if (action === "recover") {
    if (attacker.recoverUsed) {
      return safeInteractionReply(interaction, {
        content: "You've already recovered once this battle.",
        ephemeral: true
      });
    }

    if (attacker.hp >= attackerCharacter.hp) {
      return safeInteractionReply(interaction, {
        content: "Your fighter is already at full HP.",
        ephemeral: true
      });
    }

    attacker.recoverUsed = true;

    const before = attacker.hp;
    attacker.hp = Math.min(
      attackerCharacter.hp,
      attacker.hp + getRecoveryAmount(attacker.characterId)
    );
    const healed = attacker.hp - before;

    description = `❤️ **${attacker.username}** recovered **${healed} HP**!`;
  } else {
    return safeInteractionReply(interaction, {
      content: "Unknown battle action.",
      ephemeral: true
    });
  }

  const passiveRecovery = tookDamage
    ? triggerLowHealthPassive(defender)
    : 0;
  if (passiveRecovery > 0) {
    description +=
      `\n✨ **${defender.username}**'s Never Gives Up passive restored **${passiveRecovery} HP**!`;
  }

  if (defender.hp <= 0) {
    await interaction.deferUpdate().catch(() => {});
    return finishBattle(battle, userId, opponentId);
  }

  battle.currentTurn = opponentId;
  battle.turnCount = (battle.turnCount || 0) + 1;
  battle.round = Math.floor(battle.turnCount / 2) + 1;

  const embed = buildBattleEmbed(battle, description);

  await interaction.update({
    embeds: [embed],
    files: getBattleImageFiles(battle),
    components: getActionRows(battle)
  });

  battle.message = await interaction.fetchReply().catch(() => battle.message);

  scheduleTurnTimeout(battle);
}

async function handleBattleInteraction(interaction) {
  const customId = interaction.customId ?? "";

  let match = customId.match(/^ddm_challenge_(accept|decline):(.+)$/);

  if (match && interaction.isButton()) {
    return handleChallengeInteraction(interaction, match[1], match[2]);
  }

  match = customId.match(/^ddm_battle_pick:(.+)$/);

  if (match && interaction.isStringSelectMenu()) {
    return handleCharacterPick(interaction, match[1]);
  }

  match = customId.match(
    /^ddm_battle_action:([^:]+):(attack|special|defend|recover)$/
  );

  if (match && interaction.isButton()) {
    return handleBattleAction(interaction, match[1], match[2]);
  }

  return null;
}

function getBattleFeatureForInteraction(interaction) {
  const customId = interaction.customId ?? "";
  const challengeMatch = customId.match(/^ddm_challenge_(?:accept|decline):(.+)$/);
  if (challengeMatch) {
    const challenge = activeChallenges.get(challengeMatch[1]);
    return challenge?.crewWarId ? "crews_wars" : "battles";
  }

  const battleMatch = customId.match(
    /^ddm_battle_(?:pick|action):([^:]+)/
  );
  if (battleMatch) {
    const battle = getBattleById(battleMatch[1]);
    return battle?.crewWarId ? "crews_wars" : "battles";
  }

  return null;
}

module.exports = {
  handleBattleCommand,
  handleCrewWarBattleCommand,
  handleBattleInteraction,
  getBattleFeatureForInteraction,
  getCharacterPassive,
  selectFirstTurn,
  calculateDamage,
  triggerLowHealthPassive,
  getRecoveryAmount,
  buildBattleEmbed,
  getActionRows
};