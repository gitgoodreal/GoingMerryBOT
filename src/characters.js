const characters = {
  luffy: {
    name: "Monkey D. Luffy",
    emoji: "🍖",
    hp: 120,
    attack: 18,
    defense: 8,
    special: "Gum-Gum Pistol",
    price: 0
  },
  zoro: {
    name: "Roronoa Zoro",
    emoji: "⚔️",
    hp: 120,
    attack: 20,
    defense: 10,
    special: "Three-Sword Style",
    price: 0
  },
  sanji: {
    name: "Vinsmoke Sanji",
    emoji: "🔥",
    hp: 110,
    attack: 19,
    defense: 8,
    special: "Diable Jambe",
    price: 500
  },
  usopp: {
    name: "Usopp",
    emoji: "🎯",
    hp: 95,
    attack: 15,
    defense: 7,
    special: "Special Attack",
    price: 350
  },
  franky: {
    name: "Franky",
    emoji: "🤖",
    hp: 125,
    attack: 18,
    defense: 12,
    special: "Strong Right",
    price: 600
  },
  robin: {
    name: "Nico Robin",
    emoji: "🌸",
    hp: 105,
    attack: 17,
    defense: 9,
    special: "Clutch",
    price: 550
  },
  chopper: {
    name: "Tony Tony Chopper",
    emoji: "🦌",
    hp: 110,
    attack: 16,
    defense: 10,
    special: "Guard Point",
    price: 400
  },
  nami: {
    name: "Nami",
    emoji: "⚡",
    hp: 100,
    attack: 17,
    defense: 7,
    special: "Thunderbolt Tempo",
    price: 0
  }
};

const STARTER_CHARACTER_IDS = ["luffy", "zoro", "nami"];
const MAX_CHARACTER_LEVEL = 100;

function getCharacterStats(character, level = 1) {
  if (!character) return null;

  const safeLevel = Number.isSafeInteger(level)
    ? Math.max(1, Math.min(MAX_CHARACTER_LEVEL, level))
    : 1;
  const levelBonuses = safeLevel - 1;

  return {
    ...character,
    level: safeLevel,
    hp: Math.round(character.hp * (1 + levelBonuses * 0.05)),
    attack: Math.round(character.attack * (1 + levelBonuses * 0.02)),
    defense: Math.round(character.defense * (1 + levelBonuses * 0.02))
  };
}

module.exports = {
  characters,
  STARTER_CHARACTER_IDS,
  MAX_CHARACTER_LEVEL,
  getCharacterStats
};