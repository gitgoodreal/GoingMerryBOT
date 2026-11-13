
require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { commands } = require("./src/commands");

const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.CLIENT_ID?.trim();

async function registerAvatarCommand() {
  if (!token) {
    throw new Error("Missing DISCORD_TOKEN in .env");
  }

  if (!clientId || !/^\d+$/.test(clientId)) {
    throw new Error("Missing or invalid CLIENT_ID in .env");
  }

  const avCommand = commands.find(
    command => command.name === "av"
  );

  if (!avCommand) {
    throw new Error(
      'Could not find the "av" command in src/commands.js'
    );
  }

  const rest = new REST({ version: "10" }).setToken(token);

  await rest.post(
    Routes.applicationCommands(clientId),
    { body: avCommand.toJSON() }
  );

  console.log("Successfully registered /av globally!");
}

registerAvatarCommand().catch(error => {
  console.error("Failed to register /av globally:");
  console.error(error);
  process.exitCode = 1;
});
