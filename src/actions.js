
"use strict";

const COOLDOWN_MS = 2500;
const cooldowns = new Map();

// Dedicated One Piece celebration GIF collection.
// Separate from the general action GIF API.


const CELEBRATE_GIFS = [
  // Funimation — One Piece celebration
  "https://media.giphy.com/media/7dCNeb6F4qS3u/giphy.gif",

  // Netflix — One Piece cheering
  "https://media.giphy.com/media/huFnhMUn5fT7m07rKr/giphy.gif",

  // Netflix — Straw Hats crew
  "https://media.giphy.com/media/sY4vdK2z8dlocLW7uB/giphy.gif",

  // Netflix — Straw Hats crew
  "https://media.giphy.com/media/RuDjWSwnNbRzOLaAXS/giphy.gif"
];


const ACTIONS = {
  hug: {
    emoji: "🫂",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} a huge Straw Hat crew hug! 🏴‍☠️`,
      (actor, target) =>
        `${actor} hugs ${target}. Even pirates need their nakama!`,
      (actor, target) =>
        `${actor} gives ${target} a legendary hug. Friendship Haki activated!`
    ],
    solo: [
      actor => `${actor} opens their arms for a nakama hug! 🫂`,
      actor => `${actor} practices the legendary Straw Hat crew hug!`
    ]
  },

  cuddle: {
    emoji: "💛",
    targeted: [
      (actor, target) =>
        `${actor} cuddles up with ${target}. Cozy times aboard the Sunny!`,
      (actor, target) =>
        `${actor} and ${target} take a peaceful break from the Grand Line.`
    ],
    solo: [
      actor => `${actor} curls up for a cozy break aboard the Sunny.`
    ]
  },

  pat: {
    emoji: "🐾",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} some wholesome headpats!`,
      (actor, target) =>
        `${actor} pats ${target}'s head. Certified nakama behaviour!`
    ],
    solo: [
      actor => `${actor} gives themselves an encouraging headpat.`
    ]
  },

  poke: {
    emoji: "👉",
    targeted: [
      (actor, target) =>
        `${actor} pokes ${target}. "Oi! Pay attention!"`,
      (actor, target) =>
        `${actor} pokes ${target}. Is there a Devil Fruit power in there?`
    ],
    solo: [
      actor => `${actor} pokes the air. Anyone there?`
    ]
  },

  boop: {
    emoji: "👉",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} a gentle nose boop. Boop!`,
      (actor, target) =>
        `${actor} delivers a legendary boop to ${target}.`
    ],
    solo: [
      actor => `${actor} boops the air. Boop!`
    ]
  },

  highfive: {
    emoji: "🙌",
    targeted: [
      (actor, target) =>
        `${actor} high-fives ${target}! The sound echoes across the Grand Line!`,
      (actor, target) =>
        `${actor} and ${target} exchange a legendary pirate high-five!`
    ],
    solo: [
      actor => `${actor} raises a hand for a legendary high-five!`
    ]
  },

  wave: {
    emoji: "👋",
    targeted: [
      (actor, target) =>
        `${actor} waves enthusiastically at ${target}!`,
      (actor, target) =>
        `${actor} spots ${target} on the horizon and waves hello!`
    ],
    solo: [
      actor => `${actor} waves at everyone aboard the Sunny! 👋`
    ]
  },

  handshake: {
    emoji: "🤝",
    targeted: [
      (actor, target) =>
        `${actor} shakes ${target}'s hand. A new pirate alliance begins!`,
      (actor, target) =>
        `${actor} and ${target} seal their deal with a firm handshake.`
    ],
    solo: [
      actor => `${actor} offers a handshake to the next fellow pirate!`
    ]
  },

  cheer: {
    emoji: "🎉",
    targeted: [
      (actor, target) =>
        `${actor} cheers for ${target}! You've got this, nakama!`,
      (actor, target) =>
        `${actor} rallies behind ${target}. Never give up on your dream!`
    ],
    solo: [
      actor => `${actor} cheers for the whole crew! YOU CAN DO IT! 🎉`
    ]
  },

  bonk: {
    emoji: "🔨",
    targeted: [
      (actor, target) =>
        `${actor} bonks ${target} with a cartoon squeaky hammer. BONK!`,
      (actor, target) =>
        `${actor} delivers a harmless cartoon bonk to ${target}.`
    ],
    solo: [
      actor => `${actor} bonks the air with a squeaky hammer. BONK!`
    ]
  },

  slap: {
    emoji: "👋",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} a dramatic, harmless anime-style cartoon slap!`,
      (actor, target) =>
        `${actor} slaps ${target} with the force of a thousand reaction memes!`
    ],
    solo: [
      actor => `${actor} performs a dramatic anime reaction to absolutely nothing.`
    ]
  },

  bite: {
    emoji: "🦈",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} a tiny, silly cartoon chomp!`,
      (actor, target) =>
        `${actor} pretends to be a hungry Sea King and playfully chomps at ${target}!`
    ],
    solo: [
      actor => `${actor} pretends to be a Sea King and chomps at the air!`
    ]
  },

  stare: {
    emoji: "👀",
    targeted: [
      (actor, target) =>
        `${actor} stares intensely at ${target}. Observation Haki activated.`,
      (actor, target) =>
        `${actor} stares at ${target} in complete Zoro-level confusion.`
    ],
    solo: [
      actor => `${actor} stares into the distance. Something is definitely suspicious...`
    ]
  },

  throw: {
    emoji: "💨",
    targeted: [
      (actor, target) =>
        `${actor} launches ${target} into a ridiculous cartoon spin across the deck!`,
      (actor, target) =>
        `${actor} sends ${target} flying in a harmless anime gag!`
    ],
    solo: [
      actor => `${actor} dramatically throws an imaginary object across the Sunny!`
    ]
  },

  cry: {
    emoji: "😭",
    targeted: [
      (actor, target) =>
        `${actor} cries dramatically in front of ${target}. Even the Going Merry feels the pain! 😭`,
      (actor, target) =>
        `${actor} starts sobbing on ${target}'s shoulder. The Grand Line is cruel...`,
      (actor, target) =>
        `${actor} cries so hard that ${target} needs a boat just to escape the tears!`
    ],
    solo: [
      actor => `${actor} cries dramatically. WHO CUT THE ONIONS?! 😭`,
      actor => `${actor} is having a Brook-level emotional breakdown. YOHOHOHO...`,
      actor => `${actor} watches the Going Merry farewell scene again. Emotional damage: MAXIMUM.`
    ]
  },

  laugh: {
    emoji: "😂",
    targeted: [
      (actor, target) =>
        `${actor} laughs so hard at ${target} that they nearly fall off the Thousand Sunny! 😂`,
      (actor, target) =>
        `${actor} points at ${target} and bursts into uncontrollable laughter. 💀`,
      (actor, target) =>
        `${actor} and ${target} are laughing like Luffy and Usopp after a successful prank!`
    ],
    solo: [
      actor =>
        `${actor} is laughing like they just discovered Buggy's secret treasure map. 😂`,
      actor =>
        `${actor} has officially lost it. Someone call Chopper! 💀`
    ]
  },

  blush: {
    emoji: "😊",
    targeted: [
      (actor, target) =>
        `${actor} blushes furiously when looking at ${target}. 👀`,
      (actor, target) =>
        `${actor} turns bright red around ${target}. Sanji would understand. 😊`,
      (actor, target) =>
        `${actor} tries to hide their blush from ${target}, but fails spectacularly!`
    ],
    solo: [
      actor =>
        `${actor} is blushing for absolutely no reason. Suspicious. 👀`,
      actor =>
        `${actor} turns redder than a Marine's warning flag. 😊`
    ]
  },

  facepalm: {
    emoji: "🤦",
    targeted: [
      (actor, target) =>
        `${actor} facepalms at ${target}'s latest decision. Even Zoro is disappointed. 🤦`,
      (actor, target) =>
        `${actor} looks at ${target} and slowly covers their face with one hand. 💀`,
      (actor, target) =>
        `${actor} facepalms so hard that Robin starts taking notes.`
    ],
    solo: [
      actor =>
        `${actor} facepalms at the state of this server. 🤦`,
      actor =>
        `${actor} has witnessed another moment of legendary stupidity.`
    ]
  },

  comfort: {
    emoji: "🫂",
    targeted: [
      (actor, target) =>
        `${actor} sits beside ${target} and offers some comfort. You're not alone, nakama. 🫂`,
      (actor, target) =>
        `${actor} gives ${target} a reassuring pat. Even the roughest seas eventually calm down.`,
      (actor, target) =>
        `${actor} stays with ${target} for a while. Sometimes having a nakama nearby is enough. 💛`
    ],
    solo: [
      actor =>
        `${actor} takes a quiet moment to breathe. Even pirates need a break sometimes. 💛`,
      actor =>
        `${actor} reminds themselves that one rough day doesn't define the whole journey. 🫂`
    ]
  },

  sigh: {
    emoji: "😮‍💨",
    targeted: [
      (actor, target) =>
        `${actor} lets out a dramatic sigh while looking at ${target}. 😮‍💨`,
      (actor, target) =>
        `${actor} sighs. ${target}, what kind of chaos have we sailed into now?`,
      (actor, target) =>
        `${actor} sighs like they're the only responsible person on the Thousand Sunny.`
    ],
    solo: [
      actor =>
        `${actor} lets out the longest sigh known to the Grand Line. 😮‍💨`,
      actor =>
        `${actor} has seen enough server chaos for one day.`
    ]
  },

  wink: {
    emoji: "😉",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} a mischievous wink. 😉`,
      (actor, target) =>
        `${actor} winks at ${target} like they've got a secret treasure map.`,
      (actor, target) =>
        `${actor} gives ${target} a suspiciously confident wink. What are they planning? 👀`
    ],
    solo: [
      actor =>
        `${actor} winks at the camera. Nobody knows why. 😉`,
      actor =>
        `${actor} has a secret plan. Probably. 👀`
    ]
  },

  sleep: {
    emoji: "😴",
    targeted: [
      (actor, target) =>
        `${actor} falls asleep beside ${target}. Wake them up when the next arc starts. 😴`,
      (actor, target) =>
        `${actor} starts dozing off while ${target} keeps watch.`,
      (actor, target) =>
        `${actor} curls up for a nap near ${target}. Even pirates need rest!`
    ],
    solo: [
      actor =>
        `${actor} has entered hibernation mode. See you after the filler arc. 😴`,
      actor =>
        `${actor} falls asleep mid-adventure. Zoro would be proud.`
    ]
  },

  celebrate: {
    emoji: "🥳",
    targeted: [
      (actor, target) =>
        `${actor} celebrates with ${target}! PARTY ON THE THOUSAND SUNNY! 🥳`,
      (actor, target) =>
        `${actor} throws a tiny pirate party for ${target}. Meat for everyone! 🍖`,
      (actor, target) =>
        `${actor} and ${target} celebrate like they've found the One Piece! 🏴‍☠️`
    ],
    solo: [
      actor =>
        `${actor} throws a party for absolutely no reason. THAT'S THE PIRATE WAY! 🥳`,
      actor =>
        `${actor} celebrates like Roger just announced the treasure is real!`
    ]
  },

  pout: {
    emoji: "😤",
    targeted: [
      (actor, target) =>
        `${actor} pouts at ${target}. Hmph! 😤`,
      (actor, target) =>
        `${actor} folds their arms and pouts at ${target}. Someone owes them meat.`,
      (actor, target) =>
        `${actor} gives ${target} the most dramatic pout in the East Blue.`
    ],
    solo: [
      actor =>
        `${actor} is pouting. The entire crew must now investigate. 😤`,
      actor =>
        `${actor} activates maximum pout mode. Even Chopper can't resist.`
    ]
  },

  shrug: {
    emoji: "🤷",
    targeted: [
      (actor, target) =>
        `${actor} shrugs at ${target}. What can you do? 🤷`,
      (actor, target) =>
        `${actor} gives ${target} the universal "I have no idea" gesture.`,
      (actor, target) =>
        `${actor} shrugs like the World Government isn't their problem.`
    ],
    solo: [
      actor =>
        `${actor} shrugs. The plot has officially gone off the rails. 🤷`,
      actor =>
        `${actor} has absolutely no explanation for today's chaos.`
    ]
  },

  salute: {
    emoji: "🫡",
    targeted: [
      (actor, target) =>
        `${actor} gives ${target} a respectful salute. 🫡`,
      (actor, target) =>
        `${actor} salutes ${target}. A true member of the crew!`,
      (actor, target) =>
        `${actor} stands at attention for ${target}. The mission awaits!`
    ],
    solo: [
      actor =>
        `${actor} salutes the crew before heading into another adventure. 🫡`,
      actor =>
        `${actor} reports for duty! The Grand Line won't explore itself.`
    ]
  },

  dance: {
    emoji: "💃",
    targeted: [
      (actor, target) =>
        `${actor} challenges ${target} to a dance-off aboard the Sunny!`,
      (actor, target) =>
        `${actor} and ${target} break into the most ridiculous pirate dance ever!`
    ],
    solo: [
      actor => `${actor} breaks into a legendary pirate dance!`,
      actor => `${actor} dances like nobody is watching. Even Brook approves!`
    ]
  }
};

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

let supportedGifActionsPromise;

const GIF_ACTION_ALIASES = {
  cuddle: "hug",
  boop: "pat",
  poke: "pat"
};

async function getActionGif(actionName) {
  try {
    if (!supportedGifActionsPromise) {
      supportedGifActionsPromise = fetch(
        "https://api.gifukai.com/v1/actions",
        { signal: AbortSignal.timeout(4000) }
      )
        .then(response => {
          if (!response.ok) {
            throw new Error(`GIF action list returned ${response.status}`);
          }

          return response.json();
        })
        .then(data => new Set(Object.keys(data.actions || {})))
        .catch(error => {
          supportedGifActionsPromise = null;
          throw error;
        });
    }

    const supportedActions = await supportedGifActionsPromise;
    const requestedAction = GIF_ACTION_ALIASES[actionName] || actionName;

    if (!supportedActions.has(requestedAction)) {
      return null;
    }

    const response = await fetch(
      `https://api.gifukai.com/v1/${encodeURIComponent(requestedAction)}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      throw new Error(`GIF request returned ${response.status}`);
    }

    const data = await response.json();

    if (
      typeof data.url !== "string" ||
      !data.url.startsWith("https://") ||
      !data.url.toLowerCase().endsWith(".gif")
    ) {
      return null;
    }

    return {
      url: data.url,
      anime: typeof data.anime === "string" ? data.anime : null
    };
  } catch (error) {
    console.warn("Action GIF unavailable:", error.message);
    return null;
  }
}


async function handleActionMessage(message) {
  if (message.author.bot || message.webhookId) {
    return false;
  }

  let actionName;

  if (message.guild) {
    // In servers, preserve the existing "nakama hug" format.
    const match = message.content.match(
      /^\s*nakama\s+([a-z]+)(?:\s+.+)?$/i
    );

    if (!match) return false;

    actionName = match[1].toLowerCase();
  } else {
    // In DMs, allow "hug", "cry", "dance", etc.
    // An optional explicit user mention allows targeted actions.
    const match = message.content.match(
      /^\s*(?:nakama\s+)?([a-z]+)(?:\s+<@!?\d+>)?\s*$/i
    );

    if (!match) return false;

    actionName = match[1].toLowerCase();
  }

  const action = ACTIONS[actionName];

  if (!action) return false;

  const target = message.mentions.users.first() || null;
  const actor = message.author;

  if (target && target.id === actor.id) {
    await message.reply({
      content: "You can't target yourself for that one, nakama! 🏴‍☠️",
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  if (target?.bot) {
    await message.reply({
      content: "Let's interact with a fellow pirate instead, nakama!",
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const cooldownKey = message.guild
    ? `guild:${message.guild.id}:${actor.id}`
    : `dm:${actor.id}`;

  const now = Date.now();
  const lastUsed = cooldowns.get(cooldownKey) || 0;
  const remaining = COOLDOWN_MS - (now - lastUsed);

  if (remaining > 0) {
    await message.reply({
      content: `Easy there, pirate! Try again in ${(remaining / 1000).toFixed(1)} seconds.`,
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  cooldowns.set(cooldownKey, now);

  const actorMention = `<@${actor.id}>`;
  const targetMention = target ? `<@${target.id}>` : null;

  const response = target
    ? pickRandom(action.targeted)(actorMention, targetMention)
    : pickRandom(action.solo)(actorMention);

  try {
    const gif = actionName === "celebrate"
      ? {
          url: pickRandom(CELEBRATE_GIFS),
          anime: "One Piece"
        }
      : await getActionGif(actionName);

    await message.reply({
      content: `${action.emoji} **Nakama ${actionName}!**\n${response}`,
      embeds: gif
        ? [{
            color: 0xD8A33E,
            image: { url: gif.url },
            footer: {
              text: gif.anime
                ? `Anime: ${gif.anime} • Den Den Mushi`
                : "Den Den Mushi • Grand Line Interactions"
            }
          }]
        : [],
      allowedMentions: {
        repliedUser: false,
        users: target
          ? [actor.id, target.id]
          : [actor.id]
      }
    });
  } catch (error) {
    cooldowns.delete(cooldownKey);
    throw error;
  }

  return true;
}


const interactionCooldowns = new Map();

async function handleActionCommand(interaction) {
  const actionName = interaction.options
    .getString("name", true)
    .toLowerCase();

  const action = ACTIONS[actionName];

  if (!action) {
    await interaction.reply({
      content: "That action isn't available, nakama! 🏴‍☠️",
      ephemeral: true
    });
    return true;
  }

  const actor = interaction.user;
  const target = interaction.options.getUser("target");

  if (target && target.id === actor.id) {
    await interaction.reply({
      content: "Choose another nakama for that action! 🏴‍☠️",
      ephemeral: true
    });
    return true;
  }

  if (target?.bot) {
    await interaction.reply({
      content: "Let's save our actions for other nakamas! 🏴‍☠️",
      ephemeral: true
    });
    return true;
  }

  const cooldownKey =
    `${interaction.guildId || "dm"}:${actor.id}`;

  const now = Date.now();
  const expiresAt = interactionCooldowns.get(cooldownKey) || 0;

  if (now < expiresAt) {
    await interaction.reply({
      content: "Easy there, nakama! Give it a moment before your next action. 🏴‍☠️",
      ephemeral: true
    });
    return true;
  }

  interactionCooldowns.set(
    cooldownKey,
    now + COOLDOWN_MS
  );

  try {
    const actorMention = `<@${actor.id}>`;
    const targetMention = target ? `<@${target.id}>` : null;

    const response = target
      ? pickRandom(action.targeted)(actorMention, targetMention)
      : pickRandom(action.solo)(actorMention);

    const gif = actionName === "celebrate"
      ? {
          url: pickRandom(CELEBRATE_GIFS),
          anime: "One Piece"
        }
      : await getActionGif(actionName);

    await interaction.reply({
      content:
        `${action.emoji} **Nakama ${actionName}!**\n${response}`,
      embeds: gif
        ? [{
            color: 0xD8A33E,
            image: { url: gif.url },
            footer: {
              text: gif.anime
                ? `Anime: ${gif.anime} • Den Den Mushi`
                : "Den Den Mushi • Grand Line Interactions"
            }
          }]
        : [],
      allowedMentions: {
        users: target
          ? [actor.id, target.id]
          : [actor.id]
      }
    });

    return true;
  } catch (error) {
    interactionCooldowns.delete(cooldownKey);
    throw error;
  }
}

module.exports = {
  handleActionMessage,
  handleActionCommand,
  getActionHelp: () =>
    Object.entries(ACTIONS).map(([name, action]) => ({
      name,
      emoji: action.emoji
    }))
};