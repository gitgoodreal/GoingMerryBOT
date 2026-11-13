require("dotenv").config();

const {
  REST,
  Routes
} = require("discord.js");
const { commands } = require("./commands");

const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.CLIENT_ID?.trim();
const guildId = process.env.GUILD_ID?.trim();

async function registerCommands() {
  if (!token) {
    throw new Error("Missing DISCORD_TOKEN in your .env file.");
  }

  if (!clientId) {
    throw new Error("Missing CLIENT_ID in your .env file.");
  }

  if (guildId && !/^\d+$/.test(guildId)) {
    throw new Error("GUILD_ID must be a valid Discord server ID.");
  }

  if (!/^\d+$/.test(clientId)) {
    throw new Error("CLIENT_ID must be a valid Discord application ID.");
  }

  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error("No slash commands were exported from src/commands.js.");
  }

  const commandData = commands.map((command, index) => {
    if (!command || typeof command.toJSON !== "function") {
      throw new Error(
        `Invalid command at index ${index}. Each command must support toJSON().`
      );
    }

    return command.toJSON();
  });

  const commandNames = commandData.map(command => command.name);
  const duplicateNames = commandNames.filter(
    (name, index) => commandNames.indexOf(name) !== index
  );

  if (duplicateNames.length > 0) {
    throw new Error(
      `Duplicate slash command names found: ${
        [...new Set(duplicateNames)].join(", ")
      }`
    );
  }

  const actionCommand = commandData.find(
    command => command.name === "action"
  );

  if (!actionCommand) {
    throw new Error(
      'The "action" command was not found in src/commands.js.'
    );
  }
  const actionCommandData =
  typeof actionCommand?.toJSON === "function"
    ? actionCommand.toJSON()
    : actionCommand;

if (
  !actionCommandData ||
  actionCommandData.name !== "action"
) {
  throw new Error(
    "actionCommand was not exported correctly from src/commands.js."
  );
}

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    const globalRoute = Routes.applicationCommands(clientId);
    const globalCommands = await rest.get(globalRoute);

    for (const command of commandData) {
      const existingCommand = globalCommands.find(
        existing =>
          existing.name === command.name &&
          existing.type === (command.type ?? 1)
      );

      if (existingCommand) {
        await rest.patch(
          Routes.applicationCommand(clientId, existingCommand.id),
          { body: command }
        );

        console.log(`Updated global /${command.name}`);
      } else {
        await rest.post(globalRoute, {
          body: command
        });

        console.log(`Created global /${command.name}`);
      }
    }

    const guildRoute = Routes.applicationGuildCommands(clientId, guildId);
    const guildCommands = await rest.get(guildRoute);
    const managedGuildCommandKeys = new Set(
      commandData.map(command => `${command.type ?? 1}:${command.name}`)
    );

    for (const command of guildCommands) {
      const commandKey = `${command.type ?? 1}:${command.name}`;

      if (managedGuildCommandKeys.has(commandKey)) {
        await rest.delete(
          Routes.applicationGuildCommand(clientId, guildId, command.id)
        );

        console.log(`Removed server-specific /${command.name}`);
      }
    }

    console.log(
      "Global command registration finished. Existing unrelated global and server commands were preserved."
    );
  } else {
    // Preserve the original behavior when GUILD_ID is not set.
    console.log("GUILD_ID is not set. Registering global slash commands...");

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commandData }
    );

    console.log("Global slash commands registered successfully.");
  }
}


registerCommands().catch(error => {
  console.error("Failed to register slash commands:");
  console.error(error);
  process.exitCode = 1;
});