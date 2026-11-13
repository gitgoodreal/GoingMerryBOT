
const path = require("node:path");

const CHARACTER_DIR = path.join(
  __dirname,
  "..",
  "assets",
  "characters"
);

const characters = {
  luffy: {
    name: "Monkey D. Luffy",
    image: "luffy.jpg",
    maxHp: 120,
    attack: 18,
    defense: 8,
    special: "Gum-Gum Pistol"
  },
  zoro: {
    name: "Roronoa Zoro",
    image: "zoro.jpg",
    maxHp: 120,
    attack: 20,
    defense: 10,
    special: "Three-Sword Style"
  },
  sanji: {
    name: "Vinsmoke Sanji",
    image: "sanji.jpg",
    maxHp: 110,
    attack: 19,
    defense: 8,
    special: "Diable Jambe"
  },
  usopp: {
    name: "Usopp",
    image: "ussop.jpg",
    maxHp: 95,
    attack: 15,
    defense: 7,
    special: "Special Attack"
  },
  franky: {
    name: "Franky",
    image: "franky.jpg",
    maxHp: 125,
    attack: 18,
    defense: 12,
    special: "Strong Right"
  },
  robin: {
    name: "Nico Robin",
    image: "robin.jpg",
    maxHp: 105,
    attack: 17,
    defense: 9,
    special: "Clutch"
  },
  chopper: {
    name: "Tony Tony Chopper",
    image: "chopper.jpg",
    maxHp: 110,
    attack: 16,
    defense: 10,
    special: "Guard Point"
  },
  nami: {
    name: "Nami",
    image: "nami.jpg",
    maxHp: 100,
    attack: 17,
    defense: 7,
    special: "Thunderbolt Tempo"
  }
};

function getCharacterImage(characterId) {
  const character = characters[characterId];

  if (!character) {
    throw new Error(`Unknown character: ${characterId}`);
  }

  return path.join(CHARACTER_DIR, character.image);
}

module.exports = {
  characters,
  getCharacterImage
};
