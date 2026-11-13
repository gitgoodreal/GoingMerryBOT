
const { handleActionMessage } = require("./actions");
const {
  getDailyMission,
  recordMissionMessage,
  grantBaseCharacterChatXp
} = require("./db");
const {
  getMentionedCharacters,
  getCharacterGifPath
} = require("./character-replies");
const { createHeroLevelUpMessage } = require("./hero-levelup-card");
const lastReplyAt = new Map();

const USER_COOLDOWN_MS = 10_000;
const RANDOM_REPLY_CHANCE = 0.04;
const MAX_COOLDOWN_ENTRIES = 5000;
const COOLDOWN_CLEANUP_AGE_MS = 60_000;

const keywordReplies = [
  {
    pattern: /\b(one piece|the one piece)\b/i,
    replies: [
      "THE ONE PIECE IS REAL 🗣️🏴‍☠️",
      "Maybe the real treasure was the friends who stole our loot.",
      "Roger laughed. The server is still trying to understand the lore."
    ]
  },
  {
    pattern: /\b(marine|marines|navy|admiral)\b/i,
    replies: [
      "🚨 MARINE DETECTED. EVERY PIRATE ACT NORMAL.",
      "The World Government has entered the chat. Delete your search history.",
      "Buster Call? Bro, we haven't even finished the group project."
    ]
  },
  {
    pattern: /\b(bounty|berries|berry)\b/i,
    replies: [
      "💰 BOUNTY UPDATE: this message is worth at least 3 Berries.",
      "The World Government is reviewing your financial crimes.",
      "Bro is one mission away from financial freedom."
    ]
  },
  {
    pattern: /\b(cooked|cooking|let him cook)\b/i,
    replies: [
      "LET HIM COOK 🔥🔥🔥",
      "Kitchen temperature: 9000 degrees. Common sense: missing.",
      "Michelin stars? Nah, Grand Line stars."
    ]
  },
  {
    pattern: /\b(rizz|skibidi|brainrot)\b/i,
    replies: [
      "The brainrot levels are exceeding safe server limits 💀",
      "Mods, we have lost another one to the algorithm.",
      "This message just lowered the server's collective IQ by 2."
    ]
  }
];

const randomReplies = [
  "Bro really typed that and pressed Enter with confidence 💀",
  "Den Den Mushi is listening... and judging. 🐌",
  "This server needs a filler arc.",
  "Canon event. I will not interfere. 🍿",
  "The lore implications are catastrophic.",
  "Chat, are we witnessing peak fiction?",
  "Roger's crew did NOT sail the seas for this.",
  "Bro has negative plot armor 😭",
  "The Marines have been notified. (They are also confused.)",
  "This is why the ship has a no-refund policy."
];

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function cleanCooldowns(now = Date.now()) {
  for (const [key, timestamp] of lastReplyAt) {
    if (now - timestamp > COOLDOWN_CLEANUP_AGE_MS) {
      lastReplyAt.delete(key);
    }
  }
}

async function recordMissionActivity(message) {
  if (
    message.author.bot ||
    message.webhookId ||
    !message.guild ||
    !message.content.trim()
  ) {
    return false;
  }

  let result;

  try {
    const mission = getDailyMission(message.guild.id);
    result = recordMissionMessage(
      message.guild.id,
      message.author.id,
      mission.id,
      mission.message_goal
    );
  } catch (error) {
    console.error("Failed to record daily mission activity:", error);

    try {
      await message.reply({
        content: "I couldn't record your mission progress. Please try again later.",
        allowedMentions: { repliedUser: false }
      });
    } catch (replyError) {
      console.error("Couldn't send mission progress error reply:", replyError);
    }

    return true;
  }

  if (!result.success) {
    console.error("Daily mission activity was rejected:", result.message);

    try {
      await message.reply({
        content: "I couldn't record your mission progress. Please try again later.",
        allowedMentions: { repliedUser: false }
      });
    } catch (replyError) {
      console.error("Couldn't send mission progress error reply:", replyError);
    }

    return true;
  }

  try {
    const xpResult = grantBaseCharacterChatXp(message.author.id, message.guild.id);
    if (xpResult?.success && xpResult.levelsGained > 0) {
      const payload = await createHeroLevelUpMessage(
        xpResult,
        message.member?.displayName || message.author.username
      );
      if (payload) {
        await message.channel.send(payload);
      }
    }
  } catch (error) {
    console.error("Failed to announce hero chat XP level-up:", error);
  }

  if (!result.newlyCompleted) return false;

  try {
    await message.reply({
      content:
        `🎉 Daily mission complete! You sent **${result.goal} messages**. ` +
        "Use `/mission claim` to collect your reward.",
      allowedMentions: { repliedUser: false }
    });
  } catch (error) {
    console.error("Couldn't send mission completion reply:", error);
  }

  return true;
}

async function handleMessage(message) {
  // Never respond to bots or webhooks.
  if (message.author.bot || message.webhookId) {
    return;
  }

  const content = message.content.trim();

  if (!content) return;

  // DMs: allow ONLY the One Piece action commands.
  // Do not run keyword replies or random replies in DMs.
  if (!message.guild) {
    await handleActionMessage(message);
    return;
  }

  // Servers: handle actions before ordinary automatic replies.
  const handledByAction = await handleActionMessage(message);

  if (handledByAction) {
    return;
  }

  const now = Date.now();
  const cooldownKey = `${message.guild.id}:${message.author.id}`;
  const lastReply = lastReplyAt.get(cooldownKey) || 0;

  // Keep replies from becoming spam.
  if (now - lastReply < USER_COOLDOWN_MS) {
    return;
  }

  let reply;
  let reactionGifPath = null;
  const mentionedCharacters = getMentionedCharacters(content);

  if (mentionedCharacters.length > 0) {
    const character = pickRandom(mentionedCharacters);
    reply = pickRandom(character.phrases);
    reactionGifPath = getCharacterGifPath(character);
  } else {
    const match = keywordReplies.find(entry => entry.pattern.test(content));
    if (match) {
    // Keyword replies always win over random replies.
      reply = pickRandom(match.replies);
    } else if (Math.random() < RANDOM_REPLY_CHANCE) {
      // Only a 4% chance of a random reply to an ordinary message.
      reply = pickRandom(randomReplies);
    } else {
      return;
    }
  }

  // Clean stale entries before adding more cooldowns.
  if (lastReplyAt.size >= MAX_COOLDOWN_ENTRIES) {
    cleanCooldowns(now);
  }

  // Avoid growing the cooldown map without a limit.
  if (lastReplyAt.size >= MAX_COOLDOWN_ENTRIES) {
    return;
  }

  // Start cooldown only when we're actually going to reply.
  lastReplyAt.set(cooldownKey, now);

  try {
    const response = {
      content: reply,
      allowedMentions: { repliedUser: false }
    };

    if (reactionGifPath) {
      response.files = [{ attachment: reactionGifPath }];
    }

    await message.reply(response);
  } catch (error) {
    console.error("Failed to send an automatic message reply:", error);

    // Allow another attempt if sending failed.
    if (lastReplyAt.get(cooldownKey) === now) {
      lastReplyAt.delete(cooldownKey);
    }
  }
}

module.exports = {
  handleMessage,
  recordMissionActivity,
  keywordReplies,
  randomReplies
};
