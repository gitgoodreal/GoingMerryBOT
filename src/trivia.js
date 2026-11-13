
"use strict";

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const { randomUUID } = require("node:crypto");
const {
  generateLeaderboardCard,
  resolveLeaderboardNames
} = require("./stats-card");
const {
  db,
  ensureUser,
  claimUniqueReward,
  setGuildChannel
} = require("./db");

const WIN_REWARD = 250;
const PARTICIPATION_REWARD = 50;
const ROUND_DURATION_MS = 15_000;
const MIN_QUESTION_GAP_MS = 10 * 60_000;
const QUIET_PERIOD_MS = 5 * 60_000;

const timers = new Map();
const roundTimers = new Map();
const activeRounds = new Map();
let attachedClient = null;

const QUESTIONS = [
  {
    question: "Who is the captain of the Straw Hat Pirates?",
    options: ["Roronoa Zoro", "Monkey D. Luffy", "Sanji", "Usopp"],
    answer: 1
  },
  {
    question: "What is the name of Zoro's three-sword fighting style?",
    options: ["Santoryu", "Nitoryu", "Gomu Gomu", "Rokushiki"],
    answer: 0
  },
  {
    question: "Who was the first Straw Hat to join Luffy?",
    options: ["Nami", "Sanji", "Zoro", "Usopp"],
    answer: 2
  },
  {
    question: "What is the name of Luffy's signature attack?",
    options: ["Diable Jambe", "Gum-Gum Pistol", "Onigiri", "Impact Dial"],
    answer: 1
  },
  {
    question: "Which sea is Luffy originally from?",
    options: ["North Blue", "West Blue", "South Blue", "East Blue"],
    answer: 3
  },
  {
    question: "Who is the Straw Hat Pirates' navigator?",
    options: ["Robin", "Nami", "Vivi", "Hancock"],
    answer: 1
  },
  {
    question: "What is Sanji's role aboard the ship?",
    options: ["Doctor", "Shipwright", "Cook", "Musician"],
    answer: 2
  },
  {
    question: "What is the name of the Straw Hats' first ship?",
    options: ["Thousand Sunny", "Oro Jackson", "Going Merry", "Red Force"],
    answer: 2
  },
  {
    question: "Which character wants to become the world's greatest swordsman?",
    options: ["Franky", "Brook", "Zoro", "Jinbe"],
    answer: 2
  },
  {
    question: "Who is the Straw Hat Pirates' doctor?",
    options: ["Chopper", "Law", "Marco", "Kureha"],
    answer: 0
  },
  {
    question: "What is Nico Robin's dream?",
    options: [
      "Find the All Blue",
      "Map the whole world",
      "Discover the true history",
      "Become Pirate King"
    ],
    answer: 2
  },
  {
    question: "What is the name of Luffy's brother who uses fire powers?",
    options: ["Sabo", "Ace", "Both Sabo and Ace", "Shanks"],
    answer: 2
  },
  {
    question: "What is Franky's role aboard the Thousand Sunny?",
    options: ["Cook", "Shipwright", "Navigator", "Doctor"],
    answer: 1
  },
  {
    question: "What is Brook's role in the Straw Hat crew?",
    options: ["Musician", "Archaeologist", "Helmsman", "Sniper"],
    answer: 0
  },
  {
    question: "What is Jinbe's role aboard the Thousand Sunny?",
    options: ["Cook", "Swordsman", "Helmsman", "Shipwright"],
    answer: 2
  },
  {
    question: "What is Usopp's long-held dream?",
    options: [
      "To find the All Blue",
      "To become a brave warrior of the sea",
      "To map every island",
      "To become the world's greatest swordsman"
    ],
    answer: 1
  },
  {
    question: "Who gave Luffy the straw hat he wears?",
    options: ["Gol D. Roger", "Shanks", "Ace", "Rayleigh"],
    answer: 1
  },
  {
    question: "What animal is the Thousand Sunny's figurehead?",
    options: ["A reindeer", "A lion", "A dragon", "A seahorse"],
    answer: 1
  },
  {
    question: "Who gave the Going Merry to the Straw Hats?",
    options: ["Kaya", "Dr. Kureha", "Vivi", "Nojiko"],
    answer: 0
  },
  {
    question: "Who trained Sanji at the Baratie?",
    options: ["Tom", "Zeff", "Dracule Mihawk", "Silvers Rayleigh"],
    answer: 1
  },
  {
    question: "What does a Log Pose help pirates do in the Grand Line?",
    options: [
      "Track a person's heartbeat",
      "Find the nearest Marine base",
      "Point toward the next island",
      "Predict the weather"
    ],
    answer: 2
  },
  {
    question: "Where do the Straw Hats enter the Grand Line?",
    options: ["Reverse Mountain", "Marineford", "Water 7", "Loguetown"],
    answer: 0
  },
  {
    question: "Which landmark is a massive continent that circles the One Piece world?",
    options: ["Calm Belt", "Red Line", "Reverse Mountain", "All Blue"],
    answer: 1
  },
  {
    question: "What makes the Calm Belt especially dangerous for sailing ships?",
    options: [
      "It has no wind and is home to Sea Kings",
      "It is covered in ice",
      "It has constant whirlpools",
      "It is filled with volcanic islands"
    ],
    answer: 0
  },
  {
    question: "Which kingdom is Princess Vivi from?",
    options: ["Dressrosa", "Drum Island", "Alabasta", "Water 7"],
    answer: 2
  },
  {
    question: "What kind of animal was Tony Tony Chopper before eating a Devil Fruit?",
    options: ["Fox", "Reindeer", "Polar bear", "Wolf"],
    answer: 1
  },
  {
    question: "Who inspired Chopper to become a doctor?",
    options: ["Dr. Hiriluk", "Dr. Vegapunk", "Dr. Kureha", "Dr. Hogback"],
    answer: 0
  },
  {
    question: "What is Nico Robin's profession?",
    options: ["Archaeologist", "Shipwright", "Navigator", "Musician"],
    answer: 0
  },
  {
    question: "Which island was Nico Robin born on?",
    options: ["Ohara", "Sabaody", "Skypiea", "Zou"],
    answer: 0
  },
  {
    question: "What do the Poneglyphs contain clues about?",
    options: [
      "The recipes for Sanji's cooking",
      "The true history of the world",
      "The location of every Devil Fruit",
      "The names of all Marines"
    ],
    answer: 1
  },
  {
    question: "What did the Straw Hats ring in Skypiea?",
    options: ["A golden bell", "A giant gong", "A ship's bell", "A temple alarm"],
    answer: 0
  },
  {
    question: "Which Devil Fruit power does Enel use?",
    options: ["Lightning", "Sand", "Ice", "Smoke"],
    answer: 0
  },
  {
    question: "Which city is famous for its shipwrights and docks?",
    options: ["Water 7", "Alabasta", "Dressrosa", "Loguetown"],
    answer: 0
  },
  {
    question: "What was Franky's original name?",
    options: ["Cutty Flam", "Tom D. Sail", "Iceburg", "Paulie"],
    answer: 0
  },
  {
    question: "What does Robin ask the Straw Hats to help her do at Enies Lobby?",
    options: [
      "Find the All Blue",
      "Help her live",
      "Return to Ohara",
      "Become a Marine"
    ],
    answer: 1
  },
  {
    question: "What is a Buster Call?",
    options: [
      "A Marine military attack on an island",
      "A pirate crew's recruitment ceremony",
      "A type of Log Pose",
      "A shipwright's repair technique"
    ],
    answer: 0
  },
  {
    question: "Who is the main antagonist ruling Thriller Bark?",
    options: ["Gecko Moria", "Crocodile", "Don Krieg", "Caesar Clown"],
    answer: 0
  },
  {
    question: "Which Devil Fruit brought Brook back to life?",
    options: ["Revive-Revive Fruit", "Shadow-Shadow Fruit", "Soul-Soul Fruit", "Hollow-Hollow Fruit"],
    answer: 0
  },
  {
    question: "What must ships receive to safely travel underwater to Fish-Man Island?",
    options: ["A special coating", "A second Log Pose", "A sky island sail", "A Sea King escort"],
    answer: 0
  },
  {
    question: "Who is the ruler of Amazon Lily?",
    options: ["Boa Hancock", "Nefertari Vivi", "Charlotte Linlin", "Jewelry Bonney"],
    answer: 0
  },
  {
    question: "What is Impel Down?",
    options: ["A high-security prison", "A shipyard", "A sky island", "A Marine training school"],
    answer: 0
  },
  {
    question: "What was the main reason for the battle at Marineford?",
    options: [
      "To rescue Portgas D. Ace",
      "To find the One Piece",
      "To capture Nico Robin",
      "To protect Water 7"
    ],
    answer: 0
  },
  {
    question: "What is the name of Fish-Man Island's princess?",
    options: ["Shirahoshi", "Rebecca", "Vivi", "Mansherry"],
    answer: 0
  },
  {
    question: "Who was the oppressive ruler of Dressrosa?",
    options: ["Donquixote Doflamingo", "Kaido", "Gecko Moria", "Crocodile"],
    answer: 0
  },
  {
    question: "Which tribe lives on the back of the giant elephant Zunesha?",
    options: ["Minks", "Tontatta", "Shandians", "Kuja"],
    answer: 0
  },
  {
    question: "Which Emperor rules Totto Land, where Whole Cake Island is located?",
    options: ["Charlotte Linlin", "Shanks", "Kaido", "Edward Newgate"],
    answer: 0
  },
  {
    question: "What is Wano Country especially known for?",
    options: ["Its samurai", "Its sky islands", "Its giant forests", "Its shipwright schools"],
    answer: 0
  },
  {
    question: "Who is Usopp's father?",
    options: ["Yasopp", "Benn Beckman", "Lucky Roux", "Shanks"],
    answer: 0
  },
  {
    question: "Who was Zoro's childhood friend and rival?",
    options: ["Kuina", "Tashigi", "Perona", "Hiyori"],
    answer: 0
  },
  {
    question: "What is the name of Nami's weather-manipulating weapon?",
    options: ["Clima-Tact", "Perfect Pose", "Weather Dial", "Thunder Lance"],
    answer: 0
  },
  {
    question: "Which sword did Zoro inherit from Kuina?",
    options: ["Wado Ichimonji", "Sandai Kitetsu", "Shusui", "Yubashiri"],
    answer: 0
  },
  {
    question: "What is the name of Luffy's home village?",
    options: ["Foosha Village", "Shimotsuki Village", "Cocoyasi Village", "Goa Harbor"],
    answer: 0
  },
  {
    question: "What is the name of Shanks's pirate crew?",
    options: ["Red Hair Pirates", "Whitebeard Pirates", "Roger Pirates", "Heart Pirates"],
    answer: 0
  },
  {
    question: "What was the name of Gol D. Roger's ship?",
    options: ["Oro Jackson", "Thousand Sunny", "Going Merry", "Red Force"],
    answer: 0
  },
  {
    question: "What is the name of the final island reached by the Roger Pirates?",
    options: ["Laugh Tale", "Raftel Bay", "God Valley", "Eternal Pose"],
    answer: 0
  },
  {
    question: "What was Luffy's first known bounty?",
    options: ["30 million Berries", "50 million Berries", "100 million Berries", "10 million Berries"],
    answer: 0
  },
  {
    question: "What is Monkey D. Garp to Luffy?",
    options: ["His grandfather", "His uncle", "His teacher", "His shipwright"],
    answer: 0
  },
  {
    question: "Which Devil Fruit lets Buggy split his body apart?",
    options: ["Chop-Chop Fruit", "Bomb-Bomb Fruit", "Float-Float Fruit", "Spring-Spring Fruit"],
    answer: 0
  },
  {
    question: "Which Devil Fruit is Trafalgar Law known for?",
    options: ["Op-Op Fruit", "Paw-Paw Fruit", "Door-Door Fruit", "Shadow-Shadow Fruit"],
    answer: 0
  },
  {
    question: "Which Devil Fruit power did Portgas D. Ace use?",
    options: ["Flame-Flame Fruit", "Rumble-Rumble Fruit", "Ice-Ice Fruit", "Sand-Sand Fruit"],
    answer: 0
  },
  {
    question: "What title is Dracule Mihawk known by?",
    options: ["The World's Greatest Swordsman", "The Dark King", "The Pirate Hunter", "The Heavenly Demon"],
    answer: 0
  },
  {
    question: "In which town was Gol D. Roger executed?",
    options: ["Loguetown", "Water 7", "Shells Town", "Mock Town"],
    answer: 0
  },
  {
    question: "What are Den Den Mushi commonly used for?",
    options: ["Communication", "Navigation", "Cooking", "Healing"],
    answer: 0
  },
  {
    question: "What does a Vivre Card help its owner locate?",
    options: ["The person it is connected to", "The nearest island", "A Devil Fruit", "The next Marine base"],
    answer: 0
  },
  {
    question: "Which type of Haki helps a user sense presences and anticipate movements?",
    options: ["Observation Haki", "Armament Haki", "Conqueror's Haki", "Sea Haki"],
    answer: 0
  },
  {
    question: "Which type of Haki can be used to harden the body for offense and defense?",
    options: ["Armament Haki", "Observation Haki", "Conqueror's Haki", "Voice Haki"],
    answer: 0
  },
  {
    question: "Which type of Haki can overwhelm people with a user's willpower?",
    options: ["Conqueror's Haki", "Observation Haki", "Armament Haki", "Navigation Haki"],
    answer: 0
  }
];

function getTriviaSettings(guildId) {
  return db.prepare(`
    SELECT guild_id, channel_id, enabled
    FROM trivia_settings
    WHERE guild_id = ?
  `).get(guildId);
}

function setTriviaChannel(guildId, channelId) {
  db.prepare(`
    INSERT INTO trivia_settings (guild_id, channel_id, enabled)
    VALUES (?, ?, 0)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(guildId, channelId);
  setGuildChannel(guildId, "trivia", channelId);
  db.prepare(`
    INSERT INTO trivia_activity (guild_id, channel_id, last_message_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      last_message_at = excluded.last_message_at
  `).run(guildId, channelId, Date.now());
}

function ensureActivityBaseline(guildId) {
  const settings = getTriviaSettings(guildId);
  if (!settings) return;

  db.prepare(`
    INSERT OR IGNORE INTO trivia_activity (guild_id, channel_id, last_message_at)
    VALUES (?, ?, ?)
  `).run(guildId, settings.channel_id, Date.now());
}

function recordTriviaChannelActivity(message) {
  if (
    !message.guild ||
    !message.channelId ||
    message.author?.bot ||
    message.webhookId
  ) {
    return false;
  }

  const settings = getTriviaSettings(message.guild.id);
  if (!settings || settings.channel_id !== message.channelId) return false;

  const timestamp = Number.isFinite(message.createdTimestamp)
    ? message.createdTimestamp
    : Date.now();

  db.prepare(`
    INSERT INTO trivia_activity (guild_id, channel_id, last_message_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      last_message_at = MAX(trivia_activity.last_message_at, excluded.last_message_at)
  `).run(message.guild.id, message.channelId, timestamp);

  if (settings.enabled) scheduleNext(message.guild.id);
  return true;
}

function getTriviaWaitTime(guildId, now = Date.now()) {
  const settings = getTriviaSettings(guildId);
  if (!settings) return null;

  const activityRow = db.prepare(`
    SELECT channel_id, last_message_at
    FROM trivia_activity
    WHERE guild_id = ?
  `).get(guildId);
  const lastMessageAt =
    activityRow?.channel_id === settings.channel_id
      ? activityRow.last_message_at
      : now;
  const quietWait = Math.max(
    0,
    lastMessageAt + QUIET_PERIOD_MS - now
  );

  const lastRound = db.prepare(`
    SELECT COALESCE(closed_at, opened_at + ?) AS finished_at
    FROM trivia_rounds
    WHERE guild_id = ?
    ORDER BY opened_at DESC
    LIMIT 1
  `).get(ROUND_DURATION_MS, guildId);
  const gapWait = lastRound
    ? Math.max(
        0,
        lastRound.finished_at + MIN_QUESTION_GAP_MS - now
      )
    : 0;

  return Math.max(quietWait, gapWait);
}

function getQuestion() {
  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const options = question.options.map((text, index) => ({
    text,
    correct: index === question.answer
  }));

  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
  }

  return {
    question: question.question,
    options: options.map(option => option.text),
    answer: options.findIndex(option => option.correct)
  };
}

function makeAnswerRow(roundId, options, disabled = false) {
  const row = new ActionRowBuilder();

  options.forEach((option, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`trivia:${roundId}:${index}`)
        .setLabel(`${index + 1}. ${option}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
  });

  return row;
}

function clearRoundTimer(guildId, roundId) {
  const activeTimer = roundTimers.get(guildId);
  if (!activeTimer || (roundId && activeTimer.roundId !== roundId)) return;

  clearTimeout(activeTimer.timer);
  roundTimers.delete(guildId);
}

function scheduleNext(guildId, delayOverride) {
  clearTimeout(timers.get(guildId));
  timers.delete(guildId);

  const settings = getTriviaSettings(guildId);
  if (!settings?.enabled || !attachedClient) return;
  if (activeRounds.has(guildId)) return;

  ensureActivityBaseline(guildId);
  const waitTime = getTriviaWaitTime(guildId);
  const delay = Math.max(delayOverride ?? 0, waitTime ?? 0);

  const timer = setTimeout(() => {
    timers.delete(guildId);
    void openQuestion(guildId);
  }, delay);

  timers.set(guildId, timer);
}

async function openQuestion(guildId) {
  const settings = getTriviaSettings(guildId);
  if (!settings?.enabled || !attachedClient) return;
  if (activeRounds.has(guildId)) return;

  ensureActivityBaseline(guildId);
  const waitTime = getTriviaWaitTime(guildId);
  if (waitTime > 0) {
    scheduleNext(guildId);
    return;
  }

  const guild = attachedClient.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(settings.channel_id);

  if (!channel?.isTextBased() || !channel.isSendable()) {
    console.error(`Trivia channel unavailable in guild ${guildId}.`);
    scheduleNext(guildId);
    return;
  }

  const question = getQuestion();
  const roundId = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO trivia_rounds (
      round_id, guild_id, question, options_json,
      correct_index, status, opened_at
    )
    VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(
    roundId,
    guildId,
    question.question,
    JSON.stringify(question.options),
    question.answer,
    now
  );

  activeRounds.set(guildId, roundId);

  const embed = new EmbedBuilder()
    .setColor(0xD8A33E)
    .setTitle("🐌 Den Den Mushi Trivia!")
    .setDescription(
      `**${question.question}**\n\n` +
      "Choose your answer below!\n" +
      `⏱️ You have **15 seconds**.\n\n` +
      `🏆 First correct answer: **${WIN_REWARD} ฿**\n` +
      `🎯 Other participants: **${PARTICIPATION_REWARD} ฿**`
    )
    .setFooter({ text: "One answer per pirate • Good luck!" });

  try {
    const message = await channel.send({
      embeds: [embed],
      components: [makeAnswerRow(roundId, question.options)]
    });

    db.prepare(`
      UPDATE trivia_rounds SET message_id = ?
      WHERE round_id = ?
    `).run(message.id, roundId);

    clearRoundTimer(guildId);
    const timer = setTimeout(() => {
      roundTimers.delete(guildId);
      void closeQuestion(guildId, roundId, message).catch(error => {
        console.error(`Couldn't close trivia round ${roundId}:`, error);
      });
    }, ROUND_DURATION_MS);
    roundTimers.set(guildId, { roundId, timer });
  } catch (error) {
    console.error("Couldn't post trivia question:", error);
    db.prepare(`
      UPDATE trivia_rounds
      SET status = 'closed', closed_at = ?
      WHERE round_id = ? AND status = 'open'
    `).run(Date.now(), roundId);

    activeRounds.delete(guildId);
    scheduleNext(guildId);
  }
}

async function closeQuestion(
  guildId,
  roundId,
  message = null,
  { schedule = true } = {}
) {
  const round = db.prepare(`
    SELECT * FROM trivia_rounds
    WHERE round_id = ? AND guild_id = ?
  `).get(roundId, guildId);

  if (!round || round.status !== "open") return;

  clearRoundTimer(guildId, roundId);
  db.prepare(`
    UPDATE trivia_rounds
    SET status = 'closed', closed_at = ?
    WHERE round_id = ? AND status = 'open'
  `).run(Date.now(), roundId);

  activeRounds.delete(guildId);

  const participants = db.prepare(`
    SELECT user_id, reward
    FROM trivia_answers
    WHERE guild_id = ? AND round_id = ?
  `).all(guildId, roundId);

  for (const participant of participants) {
    if (participant.user_id === round.winner_id) continue;

    try {
      const rewardKey = `trivia:${roundId}:participant:${participant.user_id}`;
      const paid = claimUniqueReward(
        rewardKey,
        participant.user_id,
        PARTICIPATION_REWARD,
        "Trivia participation reward"
      );

      if (paid) {
        db.prepare(`
          UPDATE trivia_answers SET reward = ?
          WHERE guild_id = ? AND round_id = ? AND user_id = ?
        `).run(
          PARTICIPATION_REWARD,
          guildId,
          roundId,
          participant.user_id
        );

        db.prepare(`
          UPDATE trivia_stats
          SET berries_earned = berries_earned + ?
          WHERE guild_id = ? AND user_id = ?
        `).run(PARTICIPATION_REWARD, guildId, participant.user_id);
      }
    } catch (error) {
      console.error(
        `Couldn't grant Trivia participation reward for ${participant.user_id} in round ${roundId}:`,
        error
      );
    }
  }

  const winnerText = round.winner_id
    ? `🏆 Winner: <@${round.winner_id}> — **${WIN_REWARD} ฿**`
    : "No one got the answer correct this time!";

  const options = JSON.parse(round.options_json);
  const resultEmbed = new EmbedBuilder()
    .setColor(0xD8A33E)
    .setTitle("📣 Trivia Results")
    .setDescription(
      `**Question:** ${round.question}\n\n` +
      `✅ **Correct answer:** ${options[round.correct_index]}\n\n` +
      `${winnerText}\n` +
      `🎯 Other participants earned **${PARTICIPATION_REWARD} ฿**.`
    );

  if (!message && round.message_id && attachedClient) {
    const guild = attachedClient.guilds.cache.get(guildId);
    const channelId = getTriviaSettings(guildId)?.channel_id;
    const channel = guild?.channels.cache.get(channelId);

    if (channel?.messages) {
      try {
        message = await channel.messages.fetch(round.message_id);
      } catch (error) {
        console.error(
          `Couldn't fetch Trivia message ${round.message_id} for round ${roundId}:`,
          error
        );
      }
    }
  }

  let published = false;
  if (message) {
    try {
      await message.edit({
        embeds: [resultEmbed],
        components: [makeAnswerRow(roundId, options, true)]
      });
      published = true;
    } catch (error) {
      console.error(`Couldn't update Trivia message for round ${roundId}:`, error);
    }
  }

  if (!published && attachedClient) {
    const guild = attachedClient.guilds.cache.get(guildId);
    const channelId = getTriviaSettings(guildId)?.channel_id;
    const channel = guild?.channels.cache.get(channelId);

    if (channel?.isTextBased() && channel.isSendable()) {
      try {
        await channel.send({ embeds: [resultEmbed] });
        published = true;
      } catch (error) {
        console.error(`Couldn't post Trivia results for round ${roundId}:`, error);
      }
    }
  }

  if (!published) {
    console.error(
      `Trivia results for round ${roundId} were closed but could not be published.`
    );
  }

  // If trivia was stopped while the round was open, don't restart it.
  if (schedule && getTriviaSettings(guildId)?.enabled) {
    scheduleNext(guildId);
  }
}


function getTriviaLeaderboard(guildId, limit = 10, offset = 0) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);

  return db.prepare(`
    SELECT trivia_stats.user_id, trivia_stats.wins,
      trivia_stats.correct_answers, trivia_stats.participations,
      trivia_stats.berries_earned
    FROM trivia_stats
    JOIN users ON users.user_id = trivia_stats.user_id
    WHERE trivia_stats.guild_id = ?
      AND users.leaderboard_joined_at IS NOT NULL
    ORDER BY trivia_stats.wins DESC, trivia_stats.correct_answers DESC,
      trivia_stats.berries_earned DESC, trivia_stats.user_id ASC
    LIMIT ? OFFSET ?
  `).all(guildId, safeLimit, safeOffset);
}

function getTriviaLeaderboardComponents(page, hasNext) {
  const buttons = [];
  if (page > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`leaderboard:page:trivia:${page - 1}`)
        .setLabel("Previous 10")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (hasNext) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`leaderboard:page:trivia:${page + 1}`)
        .setLabel("Next 10")
        .setStyle(ButtonStyle.Primary)
    );
  }
  return buttons.length
    ? [new ActionRowBuilder().addComponents(buttons)]
    : [];
}

async function renderTriviaLeaderboard(interaction, page = 0, update = false) {
  if (update) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply();
  }

  const rows = getTriviaLeaderboard(interaction.guildId, 11, page * 10);
  const pageRows = rows.slice(0, 10);
  const hasNext = rows.length > 10;
  const description = pageRows.length
    ? pageRows.map((row, index) =>
        `**${page * 10 + index + 1}.** <@${row.user_id}> — ` +
        `🏆 ${row.wins} wins · ✅ ${row.correct_answers} correct · ` +
        `🎯 ${row.participations} played · 💰 ${row.berries_earned} Berries`
      ).join("\n")
    : "No trivia scores yet. Start trivia and make history!";
  const fallbackEmbed = new EmbedBuilder()
    .setColor(0xD8A33E)
    .setTitle("🏆 Trivia Leaderboard")
    .setDescription(description);
  const namedRows = await resolveLeaderboardNames(
    interaction.client,
    interaction.guild,
    pageRows.map(row => ({
      userId: row.user_id,
      score: row.wins,
      value: `${row.wins} wins`,
      meta: `${row.correct_answers} correct · ${row.participations} played · ${row.berries_earned} Berries`
    }))
  );
  const components = getTriviaLeaderboardComponents(page, hasNext);

  try {
    const card = await generateLeaderboardCard({
      title: "Trivia Champions",
      subtitle: `${interaction.guild?.name || "Server"} · One Piece Trivia`,
      metricLabel: "Wins",
      accent: "#b69df5",
      rows: namedRows,
      page
    });
    await interaction.editReply({
      files: [card],
      attachments: update ? [] : undefined,
      components
    });
  } catch (error) {
    console.error("Could not create Trivia leaderboard card:", error);
    await interaction.editReply({
      content: "I couldn't render the image leaderboard, so here are the rankings instead.",
      embeds: [fallbackEmbed],
      attachments: update ? [] : undefined,
      components
    });
  }
}

async function handleTriviaCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  // Only members with Manage Server can configure or control Trivia.
  // The leaderboard remains public.
  const managerCommands = ["setup", "start", "stop"];

  if (
    managerCommands.includes(subcommand) &&
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return interaction.reply({
      content: "⛔ You need the Manage Server permission to use this command.",
      ephemeral: true
    });
  }

  if (subcommand === "setup") {
    const channel = interaction.options.getChannel("channel", true);

    if (!channel.isTextBased() || !channel.isSendable()) {
      return interaction.reply({
        content: "Please select a sendable text channel.",
        ephemeral: true
      });
    }

    setTriviaChannel(interaction.guildId, channel.id);

    return interaction.reply({
      content: `✅ Trivia channel set to ${channel}. Use \`/trivia-admin start\` to begin.`,
      ephemeral: true
    });
  }

  if (subcommand === "start") {
    const settings = getTriviaSettings(interaction.guildId);

    if (!settings) {
      return interaction.reply({
        content: "Run `/trivia-admin setup` first to choose the trivia channel.",
        ephemeral: true
      });
    }

    db.prepare(`
      UPDATE trivia_settings SET enabled = 1
      WHERE guild_id = ?
    `).run(interaction.guildId);

    ensureActivityBaseline(interaction.guildId);
    scheduleNext(interaction.guildId);

    return interaction.reply({
      content:
        "🏴‍☠️ Trivia is now enabled! Questions will wait for five quiet minutes in the selected channel, with at least ten minutes between rounds.",
      ephemeral: true
    });
  }

  if (subcommand === "stop") {
    db.prepare(`
      UPDATE trivia_settings SET enabled = 0
      WHERE guild_id = ?
    `).run(interaction.guildId);

    clearTimeout(timers.get(interaction.guildId));
    timers.delete(interaction.guildId);

    const roundId = activeRounds.get(interaction.guildId);

    if (roundId) {
      const round = db.prepare(`
        SELECT * FROM trivia_rounds WHERE round_id = ?
      `).get(roundId);

      if (round) {
        const guild = interaction.guild;
        const channel = guild.channels.cache.get(
          settingsChannelId(interaction.guildId)
        );

        const message = channel?.messages
          ? await channel.messages.fetch(round.message_id).catch(() => null)
          : null;

        await closeQuestion(interaction.guildId, roundId, message);
      }
    }

    return interaction.reply({
      content: "⏹️ Trivia has been stopped.",
      ephemeral: true
    });
  }

  if (subcommand === "leaderboard") {
    await renderTriviaLeaderboard(interaction);
    return;
  }

  return interaction.reply({
    content: "Unknown trivia command.",
    ephemeral: true
  });
}

function settingsChannelId(guildId) {
  return getTriviaSettings(guildId)?.channel_id;
}

async function recoverOpenTriviaRounds(client = attachedClient) {
  if (client) attachedClient = client;

  const openRounds = db.prepare(`
    SELECT guild_id, round_id
    FROM trivia_rounds
    WHERE status = 'open'
    ORDER BY opened_at ASC
  `).all();

  for (const round of openRounds) {
    try {
      await closeQuestion(round.guild_id, round.round_id, null, {
        schedule: false
      });
    } catch (error) {
      console.error(
        `Couldn't recover interrupted Trivia round ${round.round_id}:`,
        error
      );
    }
  }
}

async function handleTriviaComponent(interaction) {
  const leaderboardPage = interaction.customId?.match(
    /^leaderboard:page:trivia:(\d+)$/
  );
  if (leaderboardPage) {
    const page = Number(leaderboardPage[1]);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100_000) {
      await interaction.reply({
        content: "That leaderboard page is invalid.",
        ephemeral: true
      });
      return true;
    }
    await renderTriviaLeaderboard(interaction, page, true);
    return true;
  }

  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith("trivia:")) return false;

  const [, roundId, selectedText] = interaction.customId.split(":");
  const selectedIndex = Number(selectedText);

  const round = db.prepare(`
    SELECT * FROM trivia_rounds
    WHERE round_id = ? AND guild_id = ?
  `).get(roundId, interaction.guildId);

  if (!round || round.status !== "open") {
    await interaction.reply({
      content: "⏰ This trivia round has ended.",
      ephemeral: true
    });
    return true;
  }

  const options = JSON.parse(round.options_json);

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= options.length
  ) {
    await interaction.reply({
      content: "That answer button is invalid.",
      ephemeral: true
    });
    return true;
  }

  const userId = interaction.user.id;

  if (interaction.user.bot) {
    await interaction.reply({
      content: "Bots can't participate in trivia.",
      ephemeral: true
    });
    return true;
  }

  const alreadyAnswered = db.prepare(`
    SELECT 1 FROM trivia_answers
    WHERE guild_id = ? AND round_id = ? AND user_id = ?
  `).get(interaction.guildId, roundId, userId);

  if (alreadyAnswered) {
    await interaction.reply({
      content: "You've already answered this question!",
      ephemeral: true
    });
    return true;
  }

  const isCorrect = selectedIndex === round.correct_index;
  const now = Date.now();

  const recordAnswer = db.prepare(`
    INSERT OR IGNORE INTO trivia_answers (
      guild_id, round_id, user_id, selected_index,
      is_correct, reward, answered_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(
    interaction.guildId,
    roundId,
    userId,
    selectedIndex,
    isCorrect ? 1 : 0,
    now
  );

  if (recordAnswer.changes !== 1) {
    await interaction.reply({
      content: "You've already answered this question!",
      ephemeral: true
    });
    return true;
  }

  ensureUser(userId);

  db.prepare(`
    INSERT INTO trivia_stats (
      guild_id, user_id, participations, correct_answers
    ) VALUES (?, ?, 1, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      participations = participations + 1,
      correct_answers = correct_answers + excluded.correct_answers
  `).run(interaction.guildId, userId, isCorrect ? 1 : 0);

  let message = "Answer recorded! The result will be revealed when the round ends.";

  if (isCorrect && !round.winner_id) {
    const claimed = claimUniqueReward(
      `trivia:${roundId}:winner`,
      userId,
      WIN_REWARD,
      "Trivia first-correct-answer reward"
    );

    if (claimed) {
      db.prepare(`
        UPDATE trivia_rounds
        SET winner_id = ?
        WHERE round_id = ? AND winner_id IS NULL AND status = 'open'
      `).run(userId, roundId);

      db.prepare(`
        UPDATE trivia_answers SET reward = ?
        WHERE guild_id = ? AND round_id = ? AND user_id = ?
      `).run(WIN_REWARD, interaction.guildId, roundId, userId);

      db.prepare(`
        UPDATE trivia_stats
        SET wins = wins + 1, berries_earned = berries_earned + ?
        WHERE guild_id = ? AND user_id = ?
      `).run(WIN_REWARD, interaction.guildId, userId);

      message = `🎉 Correct! You're currently the first winner and earned **${WIN_REWARD} ฿**!`;
    } else {
      message = "Correct answer! The winner has already been decided.";
    }
  } else if (isCorrect) {
    message = "✅ Correct answer! The first winner has already been decided.";
  } else {
    message = "❌ Not quite! Your participation reward will be processed when the round ends.";
  }

  await interaction.reply({ content: message, ephemeral: true });
  return true;
}

function startTriviaScheduler(client) {
  attachedClient = client;

  if (!client.__triviaActivityListener) {
    client.on("messageCreate", message => {
      recordTriviaChannelActivity(message);
    });

    client.__triviaActivityListener = true;
  }

  activeRounds.clear();

  void recoverOpenTriviaRounds(client)
    .then(() => {
      const enabledGuilds = db.prepare(`
        SELECT guild_id FROM trivia_settings WHERE enabled = 1
      `).all();

      for (const row of enabledGuilds) {
        ensureActivityBaseline(row.guild_id);
        scheduleNext(row.guild_id);
      }
    })
    .catch(error => {
      console.error("Trivia startup recovery failed:", error);
    });
}

const triviaCommands = [
  new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Play One Piece trivia.")
    .addSubcommand(subcommand =>
      subcommand
        .setName("leaderboard")
        .setDescription("View the Trivia leaderboard card.")
    ),

  new SlashCommandBuilder()
    .setName("trivia-admin")
    .setDescription("Configure and control server Trivia.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName("setup")
        .setDescription("Choose the channel for trivia.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Text channel where trivia is posted.")
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("start")
        .setDescription("Start automatic trivia.")
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("stop")
        .setDescription("Stop automatic trivia.")
    )
];

module.exports = {
  QUESTIONS,
  getQuestion,
  getTriviaLeaderboard,
  triviaCommands,
  handleTriviaCommand,
  handleTriviaComponent,
  startTriviaScheduler,
  setTriviaChannel,
  recordTriviaChannelActivity,
  getTriviaWaitTime,
  closeQuestion,
  recoverOpenTriviaRounds,
  MIN_QUESTION_GAP_MS,
  QUIET_PERIOD_MS
};
