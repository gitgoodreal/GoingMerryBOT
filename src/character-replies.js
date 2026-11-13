"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CHARACTER_REACTIONS = [
  {
    id: "luffy",
    aliases: [
      "luffy", "monkey d luffy", "straw hat", "strawhat", "mugiwara"
    ],
    phrases: [
      "Captain's emergency plan: punch the problem, then ask Sanji if it was edible.",
      "Luffy heard 'all-you-can-eat' and just declared the restaurant a new island. 🍖",
      "Pirate King in training; indoor voice still missing. 🏴‍☠️",
      "His battle strategy is 10% instinct, 90% accidentally making friends.",
      "Someone said 'adventure' and Luffy has already packed zero provisions.",
      "The captain spotted a mysterious island. The crew spotted a repair bill.",
      "Luffy's map is mostly doodles of meat and people he wants to punch.",
      "No plan, no map, no problem. Luffy has already run toward it.",
      "Plot armor? Luffy calls it 'my friends are behind me'."
    ]
  },
  {
    id: "zoro",
    aliases: [
      "zoro", "roronoa zoro", "marimo", "mosshead", "pirate hunter zoro"
    ],
    phrases: [
      "Zoro joined the chat and somehow got lost in the member list.",
      "His compass points north; Zoro interprets this as a personal challenge.",
      "Three swords, zero GPS, one very confused crow's nest.",
      "Zoro's cardio plan: walk the wrong way until it counts as training.",
      "Someone shouted 'left' and Zoro has been gone for two arcs.",
      "The crew's emergency plan is to throw Zoro in the correct direction.",
      "Zoro can cut a ship in half but can't find the ship.",
      "He took a shortcut. The next island has started asking questions.",
      "Zoro's training schedule: lift weights, nap, accidentally leave the island."
    ]
  },
  {
    id: "nami",
    aliases: ["nami", "cat burglar", "navigator nami"],
    phrases: [
      "Nami heard 'treasure' and opened a spreadsheet before the sentence ended.",
      "That plan sounds expensive. Nami has prepared an invoice for the captain.",
      "Weather forecast: sunny, with a strong chance of collecting overdue debt.",
      "Nami has the map, the Log Pose, and the crew's only working budget.",
      "The crew found treasure. Nami found the tax forms.",
      "Nami changed course before the storm arrived. She also changed the interest rate.",
      "New island, new map, new souvenirs the crew is absolutely not allowed to touch.",
      "Nami's navigation is priceless. Her lending rates have boss-fight music.",
      "The crew's budget meeting has begun. Please surrender your wallets at the door."
    ]
  },
  {
    id: "usopp",
    aliases: ["usopp", "uso p", "sogeking", "sniper king", "god usopp"],
    phrases: [
      "Usopp says this was all in the plan. The plan was written five seconds ago.",
      "A brave warrior of the sea has entered the chat. The sea has not confirmed this.",
      "Usopp's story has three sequels, a prequel, and one inconvenient witness.",
      "The sniper has spotted danger three islands away. It might be a seagull.",
      "Usopp's courage stat increases whenever his friends are in trouble. Convenient!",
      "A new Usopp story just dropped. Sources: Usopp.",
      "He built a gadget from scrap, string, and a concerning amount of confidence.",
      "Usopp once sailed this exact sea. The map has requested a fact-check.",
      "The crew's morale officer is bravely standing behind the tallest person."
    ]
  },
  {
    id: "sanji",
    aliases: [
      "sanji", "vinsmoke sanji", "black leg", "curly brow", "mr prince"
    ],
    phrases: [
      "Sanji can turn three potatoes into a feast and one argument into a kick.",
      "Let him cook. Just don't let Luffy near the serving tray.",
      "The kitchen is open; the captain has already eaten the menu. 🔥",
      "Sanji's five-course meal has one course labeled 'stop stealing the food'.",
      "Nobody leaves the galley hungry. Luffy has made this a legal requirement.",
      "Sanji guards the kitchen like the All Blue is hidden in the pantry.",
      "A leg-powered solution has been proposed. The kitchen is still spotless.",
      "Today's menu: fresh fish, perfect plating, and one cigarette break.",
      "Sanji is plating dinner while the crew debates who broke the stove."
    ]
  },
  {
    id: "chopper",
    aliases: ["chopper", "tony tony chopper", "cotton candy lover"],
    phrases: [
      "Chopper is blushing. He definitely did not enjoy that compliment. 🥺",
      "Doctor's orders: hydrate, sleep, and stop diagnosing yourselves from memes.",
      "Emergency diagnosis: the chat needs cotton candy and adult supervision.",
      "Chopper checked the crew's vitals. The captain's stomach is somehow a vital.",
      "The doctor packed medicine for every illness and one very specific idiot.",
      "Chopper prescribed a nap. The crew asked if naps come with snacks.",
      "A strange new illness? Chopper already has twelve books open and no lunch.",
      "The ship's doctor is studying the patient. The patient is eating the chart.",
      "Chopper is proud of the crew. He is also charging Luffy for the bandages."
    ]
  },
  {
    id: "robin",
    aliases: [
      "robin", "nico robin", "demon child", "devil child", "miss all sunday"
    ],
    phrases: [
      "Robin has read the ancient history of this chat and found the deleted messages.",
      "A calm smile from Robin means she knows the ending and won't spoil it.",
      "Robin's hands have appeared to scroll up and retrieve the receipts.",
      "She translated the inscription. It says the crew should stop arguing.",
      "The archaeologist uncovered three centuries of chat history in one scroll.",
      "Robin solved the mystery while everyone else was still picking a suspect.",
      "A quiet library break sounds ideal. The crew has brought a marching band.",
      "Robin is translating the map while the captain tries to eat the corner.",
      "The footnotes are more interesting than the legend. Robin has receipts."
    ]
  },
  {
    id: "franky",
    aliases: [
      "franky", "franky the cyborg", "super franky", "cutty flam"
    ],
    phrases: [
      "That was SUPER! Franky has added sunglasses to the conversation. 🤖",
      "Franky is building a cola-powered solution. Warranty not included.",
      "This chat just got a shipwright, a blueprint, and a dramatic pose.",
      "Franky upgraded the Thousand Sunny. It now has a feature nobody requested.",
      "The cola-powered idea is seaworthy. The budget has left the island.",
      "Franky's latest invention has a dramatic entrance and no off switch.",
      "Someone asked for a repair. Franky returned with a second ship.",
      "The ship got a new feature. Franky is giving the tour to everyone.",
      "Tools, cola, and style: Franky's three-step plan for every emergency."
    ]
  },
  {
    id: "brook",
    aliases: ["brook", "soul king", "yohohoho", "humming brook"],
    phrases: [
      "Brook laughed so hard his soul left the chat. It should be back after the song. 💀",
      "Brook made a bone joke. The crew is contractually required to groan.",
      "A skeleton joke? Brook has been waiting centuries to reuse that one.",
      "Brook is tuning his violin. The neighbors have started a petition.",
      "The musician has a new song and absolutely no guts about sharing it.",
      "Brook's tea is ready. He would taste it, but, well, you know.",
      "A talking skeleton aboard the ship and Luffy is still the weirdest part.",
      "Brook is composing a sea shanty about the crew's unpaid tab.",
      "The Soul King has arrived. Please clap; he cannot feel his hands."
    ]
  },
  {
    id: "jinbe",
    aliases: [
      "jinbe", "jinbei", "jimbei", "first son of the sea",
      "knight of the sea"
    ],
    phrases: [
      "Jinbe has arrived with calm advice. The crew has immediately ignored it.",
      "The helmsman says this chat needs a steadier course and fewer captains.",
      "Jinbe is keeping the crew afloat. The captain is testing this professionally.",
      "Jinbe can steer through a storm and still find the galley on the first try.",
      "The safe course through this discussion is apparently 'let Jinbe handle it'.",
      "Fish-man karate lesson one: balance. Lesson two: stop poking the helmsman.",
      "A calm cup of tea with Jinbe. The crew has spilled it already.",
      "Jinbe steered through a typhoon. This group chat is the real challenge.",
      "The helmsman brought everyone back on course. The captain wandered off again."
    ]
  },
  {
    id: "shanks",
    aliases: ["shanks", "red hair shanks"],
    phrases: [
      "Shanks just walked in and the entire room suddenly got serious.",
      "Somebody check the sake supply. Shanks may be nearby.",
      "The red-haired crew has noticed this conversation. Stay cool."
    ]
  },
  {
    id: "ace",
    aliases: ["ace", "portgas d ace", "fire fist"],
    phrases: [
      "Ace heard there was food and definitely did not fall asleep on the way here.",
      "Fire Fist Ace has entered the chat. Keep the snacks away from the flames.",
      "Ace is smiling somewhere. The crew is probably looking for him."
    ]
  },
  {
    id: "sabo",
    aliases: ["sabo"],
    phrases: [
      "Sabo has filed this conversation under Revolutionary activity.",
      "The Revolutionary Army would like a word about these world events.",
      "Sabo is making a plan. It probably involves a dramatic entrance."
    ]
  },
  {
    id: "law",
    aliases: ["law", "trafalgar law", "surgeon of death"],
    phrases: [
      "Trafalgar Law is already regretting joining this alliance.",
      "Room. Law has rearranged the conversation and left without explaining.",
      "Law says the plan is simple. That usually means it isn't."
    ]
  },
  {
    id: "buggy",
    aliases: ["buggy", "buggy the clown", "captain buggy"],
    phrases: [
      "Buggy somehow got promoted again. Nobody knows how.",
      "The red nose has entered the chat—and the rumors are already growing.",
      "Buggy's plan is working perfectly. He just doesn't know what the plan is."
    ]
  },
  {
    id: "hancock",
    aliases: ["hancock", "boa hancock", "snake princess"],
    phrases: [
      "Boa Hancock has arrived. Please remain calm and admire from a distance.",
      "The Pirate Empress has decided this chat is worthy of her attention.",
      "Hancock heard Luffy's name. The conversation is now officially important."
    ]
  },
  {
    id: "garp",
    aliases: ["garp", "monkey d garp", "hero of the marines"],
    phrases: [
      "Garp's training plan starts with a fist and ends with a crater.",
      "The Hero of the Marines is asking why everyone's sitting around.",
      "Garp has brought snacks. They are all rice crackers."
    ]
  },
  {
    id: "koby",
    aliases: ["koby", "coby"],
    phrases: [
      "Koby is working hard, taking notes, and trying not to panic.",
      "A future Marine Admiral just politely asked everyone to calm down.",
      "Koby has found the courage to send this message. Respect."
    ]
  },
  {
    id: "mihawk",
    aliases: ["mihawk", "dracule mihawk", "hawk eyes"],
    phrases: [
      "Mihawk has judged this conversation with one glance.",
      "The world's greatest swordsman has arrived. Please keep the small talk sharp.",
      "Mihawk is looking for a worthy rival. This thread may not qualify."
    ]
  },
  {
    id: "crocodile",
    aliases: ["crocodile", "sir crocodile"],
    phrases: [
      "Crocodile is already turning this conversation into a business deal.",
      "The room is getting dry. Crocodile may be nearby.",
      "Crocodile has a plan, a backup plan, and absolutely no trust in this server."
    ]
  },
  {
    id: "doflamingo",
    aliases: ["doflamingo", "donquixote doflamingo", "joker"],
    phrases: [
      "Fufufufu... Doflamingo has found this conversation entertaining.",
      "Some invisible strings are definitely pulling this discussion off-topic.",
      "Doflamingo just called this chat a beautiful mess."
    ]
  },
  {
    id: "blackbeard",
    aliases: ["blackbeard", "marshall d teach", "teach"],
    phrases: [
      "Blackbeard says dreams never die. Neither does this argument, apparently.",
      "A loud laugh echoes across the server. Check your snacks.",
      "Blackbeard has arrived. Someone keep an eye on the treasure."
    ]
  },
  {
    id: "whitebeard",
    aliases: ["whitebeard", "edward newgate", "newgate"],
    phrases: [
      "Whitebeard has entered the chat. This whole server is his family now.",
      "A quiet drink with the crew sounds pretty good right about now.",
      "The world's strongest dad has seen the chat and is very proud."
    ]
  },
  {
    id: "marco",
    aliases: ["marco", "marco the phoenix"],
    phrases: [
      "Marco is on standby with healing flames and a tired smile.",
      "Yoi. Marco has this situation under control.",
      "The Phoenix has returned. Someone get him a break."
    ]
  },
  {
    id: "akainu",
    aliases: ["akainu", "sakazuki", "red dog"],
    phrases: [
      "Akainu has read this chat and declared it suspicious.",
      "Absolute justice has entered the conversation. Everybody behave.",
      "The Fleet Admiral is asking who approved this thread."
    ]
  },
  {
    id: "aokiji",
    aliases: ["aokiji", "kuzan"],
    phrases: [
      "Aokiji has arrived. This conversation may have just cooled down.",
      "Kuzan is taking a relaxed approach to this very urgent debate.",
      "Someone offered Aokiji a nap and he accepted."
    ]
  },
  {
    id: "kizaru",
    aliases: ["kizaru", "borsalino"],
    phrases: [
      "Kizaru is moving so fast the reply arrived before he did.",
      "Oh my, this conversation is moving at light speed.",
      "Kizaru has arrived. He may or may not know why he's here."
    ]
  },
  {
    id: "kaido",
    aliases: ["kaido", "kaidou", "king of the beasts"],
    phrases: [
      "Kaido is looking for the biggest challenger in this channel.",
      "A dragon-sized problem has appeared in the chat.",
      "Kaido asks if anyone here can actually give him a good fight."
    ]
  },
  {
    id: "big-mom",
    aliases: ["big mom", "big mom pirates", "charlotte linlin", "linlin"],
    phrases: [
      "Big Mom heard there might be snacks and is on her way.",
      "Someone hide the dessert. This could become a whole event.",
      "Big Mom's tea party invitation is either an honor or a warning."
    ]
  },
  {
    id: "katakuri",
    aliases: ["katakuri", "charlotte katakuri"],
    phrases: [
      "Katakuri already saw this message coming.",
      "The future looks like someone is about to mention donuts.",
      "Katakuri has quietly joined the chat. Nobody saw him arrive."
    ]
  },
  {
    id: "yamato",
    aliases: ["yamato"],
    phrases: [
      "Yamato is ready to set sail and join the adventure.",
      "Someone mentioned Oden and Yamato is already taking notes.",
      "Yamato has claimed this entire conversation as an adventure."
    ]
  },
  {
    id: "vivi",
    aliases: ["vivi", "nefertari vivi"],
    phrases: [
      "Vivi has entered the chat. The crew is always happy to see her.",
      "A royal request for everyone to please get along.",
      "Vivi is checking that every nakama made it home safely."
    ]
  },
  {
    id: "bon-clay",
    aliases: ["bon clay", "bon-chan", "mr 2", "bentham"],
    phrases: [
      "Bon Clay has arrived with friendship, flair, and a dramatic pose!",
      "Nakama power is at maximum. Bon-chan would be proud!",
      "This chat needs more sparkle. Bon Clay has volunteered."
    ]
  }
];

function createAliasPattern(alias) {
  const normalizedAlias = alias
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const characters = Array.from(normalizedAlias);
  const finalCharacter = characters.pop();
  const prefix = characters.join("")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const escapedFinalCharacter = finalCharacter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const finalPattern = /\p{L}/u.test(finalCharacter)
    ? `${escapedFinalCharacter}+`
    : escapedFinalCharacter;

  return new RegExp(
    `(?<![\\p{L}\\p{N}])${prefix}${finalPattern}(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  );
}

for (const character of CHARACTER_REACTIONS) {
  character.patterns = character.aliases.map(createAliasPattern);
  character.gifPath = path.join(
    __dirname,
    "..",
    "assets",
    "reactions",
    `${character.id}.gif`
  );
}

function getMentionedCharacters(content) {
  const normalizedContent = content.replace(/[^\p{L}\p{N}]+/gu, " ");

  return CHARACTER_REACTIONS.filter(character =>
    character.patterns.some(pattern => pattern.test(normalizedContent))
  );
}

function getCharacterGifPath(character) {
  return fs.existsSync(character.gifPath) ? character.gifPath : null;
}

module.exports = {
  CHARACTER_REACTIONS,
  getMentionedCharacters,
  getCharacterGifPath
};
