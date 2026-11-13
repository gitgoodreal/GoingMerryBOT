const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { PermissionFlagsBits } = require("discord.js");

const temporaryDirectory = mkdtempSync(
  path.join(tmpdir(), "den-den-mushi-test-")
);
process.env.DATABASE_PATH = path.join(temporaryDirectory, "test.sqlite");

const {
  db,
  claimMission,
  configureMission,
  createCrew,
  createCrewWar,
  challengeCrewWar,
  respondToCrewWarChallenge,
  cancelPendingCrewWar,
  CREW_WAR_WIN_TARGET,
  createRaid,
  disbandCrew,
  getBalance,
  addBerries,
  ensureUser,
  startPirateJourney,
  getUser,
  getBerryLeaderboard,
  getTopBounties,
  getRaidLeaderboardParticipants,
  getRaidParticipants,
  grantStarterCharacters,
  getOwnedCharacters,
  getCharacterProgress,
  getBaseCharacter,
  setBaseCharacter,
  grantCharacterXp,
  grantBaseCharacterChatXp,
  upgradeCharacterEnergy,
  setRaidFighter,
  getRaidPlayerState,
  recordRaidAction,
  getGuildChannel,
  getGuildChannelSettings,
  setGuildChannel,
  getCrewForUser,
  getCrewByName,
  getCrewBanner,
  setCrewBanner,
  deleteCrewBanner,
  updateCrewDetails,
  getTopCrews,
  joinCrew,
  getActiveCrewWar,
  getDailyMission,
  getMissionProgress,
  inviteToCrew,
  acceptCrewInvite,
  recordMissionMessage,
  hasCrewWarMatchParticipant,
  startCrewWarMatch,
  finishCrewWarMatch,
  cancelCrewWarMatch,
  finishCrewWar,
  getCrewWar
} = require("../src/db");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("daily missions rotate by UTC date and reject invalid dates", () => {
  const guildId = `guild-${randomUUID()}`;
  const first = getDailyMission(guildId, "2026-01-01");
  const second = getDailyMission(guildId, "2026-01-02");
  const third = getDailyMission(guildId, "2026-01-03");

  assert.notEqual(first.mission_key, second.mission_key);
  assert.notEqual(second.mission_key, third.mission_key);
  assert.equal(first.id, "daily-2026-01-01");
  assert.match(first.title, /^Send \d+ messages in a server channel$/);
  assert.throws(
    () => getDailyMission(guildId, "2026-02-31"),
    /valid UTC calendar date/
  );
});

test("crew banners persist per crew and reject missing crews or oversized images", () => {
  const guildId = `guild-${randomUUID()}`;
  const captainId = `captain-${randomUUID()}`;
  const created = createCrew(guildId, `Banner-${randomUUID()}`, captainId);
  assert.equal(created.success, true);

  const banner = Buffer.from("normalized banner image");
  assert.deepEqual(setCrewBanner(guildId, created.crew.id, banner), { success: true });
  assert.deepEqual(
    Buffer.from(getCrewBanner(guildId, created.crew.id).image_data),
    banner
  );
  assert.equal(deleteCrewBanner(guildId, created.crew.id), true);
  assert.equal(getCrewBanner(guildId, created.crew.id), null);
  assert.equal(
    setCrewBanner(guildId, created.crew.id, Buffer.alloc(8 * 1024 * 1024 + 1)).success,
    false
  );
  assert.equal(setCrewBanner(guildId, 999999, banner).success, false);
});

test("hero level-up card is a compact image embed with the character portrait", async () => {
  const { loadImage } = require("@napi-rs/canvas");
  const { createHeroLevelUpMessage } = require("../src/hero-levelup-card");
  const payload = await createHeroLevelUpMessage({
    success: true,
    characterId: "luffy",
    level: 4,
    levelsGained: 2
  }, "Test Pirate");

  assert.equal(
    payload.embeds[0].data.title,
    "⭐ Test Pirate's Monkey D. Luffy levelled up to Level 4!"
  );
  assert.equal(payload.embeds[0].data.image.url, "attachment://hero-level-up.png");
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  const image = await loadImage(payload.files[0].attachment);
  assert.equal(image.width, 960);
  assert.equal(image.height, 320);
  assert.equal(
    await createHeroLevelUpMessage({
      success: true,
      characterId: "luffy",
      level: 1,
      levelsGained: 0
    }),
    null
  );
});

test("crew captains can update public details without name or tag collisions", () => {
  const guildId = `guild-${randomUUID()}`;
  const first = createCrew(guildId, `First-${randomUUID()}`, `captain-${randomUUID()}`);
  const second = createCrew(guildId, `Second-${randomUUID()}`, `captain-${randomUUID()}`);
  const secondTagged = updateCrewDetails(guildId, second.crew.id, {
    abbreviation: "SECOND"
  });
  assert.equal(secondTagged.success, true);

  const updated = updateCrewDetails(guildId, first.crew.id, {
    name: "New First Crew",
    abbreviation: "FIRST",
    description: "A changed crew description."
  });
  assert.equal(updated.success, true);
  assert.equal(updated.crew.name, "New First Crew");
  assert.equal(updated.crew.abbreviation, "FIRST");
  assert.equal(updated.crew.description, "A changed crew description.");
  assert.equal(updated.previous.name, first.crew.name);
  assert.deepEqual(updated.changedFields, ["name", "abbreviation", "description"]);

  assert.equal(
    updateCrewDetails(guildId, first.crew.id, {
      name: second.crew.name
    }).success,
    false
  );
  assert.equal(
    updateCrewDetails(guildId, first.crew.id, {
      abbreviation: secondTagged.crew.abbreviation
    }).success,
    false
  );
  const cleared = updateCrewDetails(guildId, first.crew.id, { description: "" });
  assert.equal(cleared.success, true);
  assert.equal(cleared.crew.description, "");
});

test("/crew edit updates crew details and writes a before-and-after log", async () => {
  const { handleCommand } = require("../src/commands");
  const guildId = `guild-${randomUUID()}`;
  const channelId = `crew-channel-${randomUUID()}`;
  const logChannelId = `crew-log-${randomUUID()}`;
  const captainId = `captain-${randomUUID()}`;
  const created = createCrew(guildId, `Old-${randomUUID()}`, captainId);
  setGuildChannel(guildId, "crews_wars", channelId);
  setGuildChannel(guildId, "crew_logs", logChannelId);
  const logMessages = [];
  let deferred = false;
  const guild = {
    id: guildId,
    name: "Test Server",
    members: { me: { id: `bot-${guildId}`, permissions: { has: () => true } } },
    roles: { cache: new Map() },
    channels: {
      fetch: async id => id === logChannelId
        ? {
            isTextBased: () => true,
            send: async payload => {
              assert.equal(deferred, true);
              logMessages.push(payload);
            }
          }
        : null,
      create: async () => {
        throw new Error("The shared log channel should be reused.");
      }
    }
  };
  let response;
  await handleCommand({
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "crew",
    guildId,
    guild,
    channelId,
    user: { id: captainId },
    options: {
      getSubcommand: () => "edit",
      getString: name => ({
        name: "New Crew Name",
        abbreviation: "NEW",
        description: "New description"
      })[name] ?? null
    },
    deferReply: async () => {
      deferred = true;
    },
    editReply: async payload => {
      assert.equal(deferred, true);
      response = payload;
    }
  });

  assert.equal(getCrewByName(guildId, "NEW").id, created.crew.id);
  assert.equal(getCrewByName(guildId, "NEW").description, "New description");
  assert.match(response.embeds[0].data.description, /Updated: Crew name, Crew tag, Description/);
  assert.equal(logMessages.length, 1);
  assert.equal(logMessages[0].embeds[0].data.title, "Crew details updated");
  assert.deepEqual(
    logMessages[0].embeds[0].data.fields.slice(1).map(field => field.name),
    ["Crew name", "Crew tag", "Description"]
  );
  assert.match(logMessages[0].embeds[0].data.fields[1].value, /Before:/);
  assert.match(
    logMessages[0].embeds[0].data.fields[1].value,
    /\*\*After:\*\* New Crew Name/
  );
});

test("crew banner uploads validate the image and produce a normalized JPEG", async () => {
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const { createCrewBannerImage } = require("../src/commands");
  const inputImage = createCanvas(8, 8).toBuffer("image/png");
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => inputImage.buffer.slice(
      inputImage.byteOffset,
      inputImage.byteOffset + inputImage.byteLength
    )
  });

  try {
    const output = await createCrewBannerImage({
      url: "https://cdn.discordapp.com/test.png",
      size: inputImage.length,
      contentType: "image/png"
    }, { name: "Test Crew", abbreviation: "TEST" });
    assert.equal(output[0], 0xff);
    assert.equal(output[1], 0xd8);
    const image = await loadImage(output);
    assert.equal(image.width, 1200);
    assert.equal(image.height, 400);
    await assert.rejects(
      () => createCrewBannerImage({
        url: "https://cdn.discordapp.com/test.gif",
        size: 10,
        contentType: "image/gif"
      }, { name: "Test Crew", abbreviation: "TEST" }),
      /PNG or JPEG/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("only a crew captain can change the crew banner", async () => {
  const { handleCommand } = require("../src/commands");
  const guildId = `guild-${randomUUID()}`;
  const channelId = `crew-channel-${randomUUID()}`;
  createCrew(guildId, `Captain Crew ${randomUUID()}`, `captain-${randomUUID()}`);
  setGuildChannel(guildId, "crews_wars", channelId);
  let response;

  assert.equal(await handleCommand({
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "crew",
    guildId,
    channelId,
    user: { id: `outsider-${randomUUID()}` },
    options: {
      getSubcommand: () => "banner",
      getAttachment: () => {
        throw new Error("Unauthorized users must not process uploads.");
      }
    },
    reply: async payload => {
      response = payload;
    }
  }), true);
  assert.match(response.content, /Only a crew captain/);
  assert.equal(response.ephemeral, true);
});

test("crew banner crop controls preview edits and save the selected crop", async () => {
  const { createCanvas } = require("@napi-rs/canvas");
  const { handleCommand, handleInteraction } = require("../src/commands");
  const guildId = `guild-${randomUUID()}`;
  const channelId = `crew-channel-${randomUUID()}`;
  const logChannelId = `crew-log-${randomUUID()}`;
  const captainId = `captain-${randomUUID()}`;
  const created = createCrew(guildId, `Crop Crew ${randomUUID()}`, captainId);
  const logChannel = {
    id: logChannelId,
    isTextBased: () => true,
    send: async () => {}
  };
  const guild = {
    id: guildId,
    name: "Test Server",
    members: {
      me: {
        id: `bot-${guildId}`,
        permissions: { has: () => true }
      }
    },
    roles: { cache: new Map() },
    channels: {
      fetch: async id => id === logChannelId ? logChannel : null,
      create: async () => {
        throw new Error("The existing shared crew log must be reused.");
      }
    }
  };
  setGuildChannel(guildId, "crews_wars", channelId);
  setGuildChannel(guildId, "crew_logs", logChannelId);

  const canvas = createCanvas(32, 16);
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "#ff0000");
  gradient.addColorStop(1, "#0000ff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const source = canvas.toBuffer("image/png");
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    )
  });

  try {
    let response;
    await handleCommand({
      isChatInputCommand: () => true,
      inGuild: () => true,
      commandName: "crew",
      guildId,
      guild,
      channelId,
      user: { id: captainId },
      options: {
        getSubcommand: () => "banner",
        getAttachment: () => ({
          url: "https://cdn.discordapp.com/banner.png",
          size: source.length,
          contentType: "image/png"
        })
      },
      deferReply: async options => {
        assert.equal(options.ephemeral, true);
      },
      editReply: async payload => {
        response = payload;
      }
    });

    const zoomButton = response.components[0].components.find(button =>
      button.data.custom_id.endsWith(":zoom-in")
    );
    let previewUpdate;
    await handleInteraction({
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isModalSubmit: () => false,
      isChannelSelectMenu: () => false,
      customId: zoomButton.data.custom_id,
      guildId,
      guild,
      channelId,
      user: { id: captainId },
      deferUpdate: async () => {},
      editReply: async payload => {
        previewUpdate = payload;
      }
    });
    assert.match(previewUpdate.embeds[0].data.description, /Zoom: \*\*115%\*\*/);

    const saveButton = previewUpdate.components[1].components.find(button =>
      button.data.custom_id.endsWith(":save")
    );
    let saveUpdate;
    await handleInteraction({
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isModalSubmit: () => false,
      isChannelSelectMenu: () => false,
      customId: saveButton.data.custom_id,
      guildId,
      guild,
      channelId,
      user: { id: captainId },
      deferUpdate: async () => {},
      editReply: async payload => {
        saveUpdate = payload;
      }
    });
    assert.match(saveUpdate.content, /cropped banner has been saved/);
    assert.deepEqual(saveUpdate.components, []);
    assert.ok(getCrewBanner(guildId, created.crew.id).image_data.length > 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("crew log provisioning creates a private moderator channel and logs activity", async () => {
  const guildId = `guild-${randomUUID()}`;
  const moderatorPermission = PermissionFlagsBits.ManageGuild;
  let createdOptions;
  let createdChannelCount = 0;
  const sentMessages = [];
  const channel = {
    id: `channel-${randomUUID()}`,
    isTextBased: () => true,
    send: async payload => sentMessages.push(payload)
  };
  const guild = {
    id: guildId,
    members: {
      me: {
        id: `bot-${randomUUID()}`,
        permissions: { has: () => true }
      }
    },
    roles: {
      cache: new Map([[
        "moderator-role",
        {
          id: "moderator-role",
          permissions: {
            has: permission => permission === moderatorPermission
          }
        }
      ]])
    },
    channels: {
      fetch: async id => id === channel.id ? channel : null,
      create: async options => {
        createdChannelCount += 1;
        createdOptions = options;
        return channel;
      }
    }
  };
  const { ensureCrewLogChannel, logCrewActivity } = require("../src/crew-logs");

  assert.equal(await ensureCrewLogChannel(guild), channel);
  assert.equal(createdOptions.name, "crew-logs");
  assert.ok(createdOptions.permissionOverwrites.some(overwrite =>
    overwrite.id === guildId &&
    overwrite.deny.includes(PermissionFlagsBits.ViewChannel)
  ));
  assert.ok(createdOptions.permissionOverwrites.some(overwrite =>
    overwrite.id === "moderator-role" &&
    overwrite.allow.includes(PermissionFlagsBits.ViewChannel)
  ));

  await logCrewActivity(
    guild,
    { name: "Test Crew", abbreviation: "TEST" },
    "Crew founded",
    "Created for a test.",
    {
      bannerImage: Buffer.from("banner image"),
      fields: [{ name: "Description", value: "A test crew." }]
    }
  );
  await logCrewActivity(
    guild,
    { name: "Second Crew", abbreviation: "SECOND" },
    "Crew founded",
    "Also created for a test."
  );
  assert.equal(createdChannelCount, 1);
  assert.equal(getGuildChannel(guildId, "crew_logs"), channel.id);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].embeds[0].data.title, "Crew founded");
  assert.equal(sentMessages[0].embeds[0].data.image.url, "attachment://crew-banner-log.jpg");
  assert.deepEqual(sentMessages[0].files[0].attachment, Buffer.from("banner image"));
  assert.equal(sentMessages[0].embeds[0].data.fields[1].name, "Description");
  assert.match(sentMessages[0].embeds[0].data.footer.text, /Private crew log/);
  assert.equal(sentMessages[1].embeds[0].data.fields[0].value, "Second Crew [SECOND]");
  assert.deepEqual(sentMessages[0].allowedMentions, { parse: [] });
});

test("mission progress gates claims and grants the reward once", () => {
  const guildId = `guild-${randomUUID()}`;
  const userId = `mission-${randomUUID()}`;
  const mission = getDailyMission(guildId, "2026-04-15");

  const prematureClaim = claimMission(
    guildId,
    userId,
    mission.id,
    mission.reward,
    1,
    mission.message_goal
  );
  assert.equal(prematureClaim.success, false);
  assert.equal(prematureClaim.progress, 0);

  for (let count = 1; count < mission.message_goal; count += 1) {
    const progress = recordMissionMessage(
      guildId,
      userId,
      mission.id,
      mission.message_goal
    );
    assert.equal(progress.success, true);
    assert.equal(progress.newlyCompleted, false);
  }

  const completed = recordMissionMessage(
    guildId,
    userId,
    mission.id,
    mission.message_goal
  );
  assert.equal(completed.completed, true);
  assert.equal(completed.newlyCompleted, true);

  const extraMessage = recordMissionMessage(
    guildId,
    userId,
    mission.id,
    mission.message_goal
  );
  assert.equal(extraMessage.newlyCompleted, false);
  assert.equal(
    getMissionProgress(guildId, userId, mission.id),
    mission.message_goal
  );

  const claim = claimMission(
    guildId,
    userId,
    mission.id,
    mission.reward,
    1,
    mission.message_goal
  );
  assert.equal(claim.success, true);
  assert.equal(claim.reward, mission.reward);
  assert.equal(getBalance(userId), mission.reward);

  const duplicateClaim = claimMission(
    guildId,
    userId,
    mission.id,
    mission.reward,
    1,
    mission.message_goal
  );
  assert.equal(duplicateClaim.success, false);
  assert.equal(duplicateClaim.message, "Mission already claimed.");
  assert.equal(getBalance(userId), mission.reward);
});

test("only pirates who started appear on global and activity leaderboards", () => {
  const startedUserId = `started-${randomUUID()}`;
  const unstartedUserId = `unstarted-${randomUUID()}`;
  const guildId = `leaderboard-guild-${randomUUID()}`;
  ensureUser(startedUserId);
  ensureUser(unstartedUserId);
  db.prepare(`
    UPDATE users SET lifetime_berries = 500, bounty = 100
    WHERE user_id = ?
  `).run(startedUserId);
  db.prepare(`
    UPDATE users SET lifetime_berries = 1000, bounty = 200
    WHERE user_id = ?
  `).run(unstartedUserId);

  assert.ok(!getBerryLeaderboard().some(row =>
    [startedUserId, unstartedUserId].includes(row.user_id)
  ));
  assert.ok(!getTopBounties().some(row =>
    [startedUserId, unstartedUserId].includes(row.user_id)
  ));

  startPirateJourney(startedUserId);
  const firstStartedAt = getUser(startedUserId).leaderboard_joined_at;
  startPirateJourney(startedUserId);

  assert.equal(getUser(startedUserId).leaderboard_joined_at, firstStartedAt);
  assert.ok(getBerryLeaderboard().some(row => row.user_id === startedUserId));
  assert.ok(getTopBounties().some(row => row.user_id === startedUserId));
  assert.ok(!getBerryLeaderboard().some(row => row.user_id === unstartedUserId));
  assert.ok(!getTopBounties().some(row => row.user_id === unstartedUserId));

  const raid = createRaid({
    guildId,
    bossName: "Test Boss",
    maxHp: 1000
  });
  assert.ok(raid.id);
  db.prepare(`
    INSERT INTO raid_participants (raid_id, user_id, damage, attacks)
    VALUES (?, ?, 100, 1), (?, ?, 200, 1)
  `).run(
    raid.id,
    startedUserId,
    raid.id,
    unstartedUserId
  );
  assert.deepEqual(
    getRaidLeaderboardParticipants(raid.id).map(row => row.user_id),
    [startedUserId]
  );
  assert.deepEqual(
    getRaidParticipants(raid.id).map(row => row.user_id),
    [unstartedUserId, startedUserId]
  );

  const { getTriviaLeaderboard } = require("../src/trivia");
  db.prepare(`
    INSERT INTO trivia_stats (
      guild_id, user_id, wins, correct_answers, participations, berries_earned
    ) VALUES (?, ?, 1, 2, 3, 50), (?, ?, 2, 4, 5, 100)
  `).run(guildId, startedUserId, guildId, unstartedUserId);
  assert.deepEqual(
    getTriviaLeaderboard(guildId).map(row => row.user_id),
    [startedUserId]
  );
});

test("hero XP levels progressively, carries XP forward, and stops at level 100", () => {
  const { characters, getCharacterStats } = require("../src/characters");
  const userId = `hero-xp-${randomUUID()}`;
  grantStarterCharacters(userId);

  const first = grantCharacterXp(userId, "luffy", 99);
  assert.equal(first.level, 1);
  assert.equal(first.xp, 99);

  const second = grantCharacterXp(userId, "luffy", 201);
  assert.equal(second.level, 3);
  assert.equal(second.xp, 0);

  const maxed = grantCharacterXp(userId, "luffy", 1_000_000);
  assert.equal(maxed.level, 100);
  assert.equal(maxed.xp, 0);
  assert.equal(maxed.awarded, 1_000_000);

  const afterMax = grantCharacterXp(userId, "luffy", 50);
  assert.equal(afterMax.level, 100);
  assert.equal(afterMax.awarded, 0);
  assert.equal(getCharacterProgress(userId, "luffy").xp, 0);

  const maxLevelStats = getCharacterStats(characters.luffy, 100);
  assert.equal(maxLevelStats.hp, Math.round(characters.luffy.hp * 5.95));
  assert.equal(maxLevelStats.attack, Math.round(characters.luffy.attack * 2.98));
  assert.equal(maxLevelStats.defense, Math.round(characters.luffy.defense * 2.98));
});

test("chat XP follows the per-server base hero with global anti-spam limits", () => {
  const userId = `hero-chat-${randomUUID()}`;
  const firstGuild = `guild-${randomUUID()}`;
  const secondGuild = `guild-${randomUUID()}`;
  const start = Date.UTC(2026, 4, 1, 12);
  grantStarterCharacters(userId);
  assert.equal(setBaseCharacter(userId, firstGuild, "zoro").success, true);
  assert.equal(setBaseCharacter(userId, secondGuild, "nami").success, true);

  const firstAward = grantBaseCharacterChatXp(userId, firstGuild, start);
  assert.equal(firstAward.awarded, 5);
  assert.equal(grantBaseCharacterChatXp(userId, firstGuild, start + 30_000).awarded, 0);

  const otherServerAward = grantBaseCharacterChatXp(
    userId,
    secondGuild,
    start + 61_000
  );
  assert.equal(otherServerAward.characterId, "nami");
  assert.equal(otherServerAward.awarded, 5);
  assert.equal(getBaseCharacter(userId, firstGuild).character_id, "zoro");
  assert.equal(getCharacterProgress(userId, "zoro").xp, 5);
  assert.equal(getCharacterProgress(userId, "nami").xp, 5);

  for (let award = 2; award < 20; award += 1) {
    grantBaseCharacterChatXp(userId, firstGuild, start + award * 61_000);
  }
  const dailyCap = grantBaseCharacterChatXp(userId, firstGuild, start + 20 * 61_000);
  assert.equal(dailyCap.awarded, 0);
});

test("chat level-ups immediately send a character-card announcement", async () => {
  const userId = `hero-level-chat-${randomUUID()}`;
  const guildId = `guild-${randomUUID()}`;
  grantStarterCharacters(userId);
  assert.equal(setBaseCharacter(userId, guildId, "luffy").success, true);
  assert.equal(grantCharacterXp(userId, "luffy", 95).level, 1);
  const sent = [];
  const { recordMissionActivity } = require("../src/message-replies");

  await recordMissionActivity({
    author: { id: userId, username: "Test Pirate", bot: false },
    guild: { id: guildId },
    content: "A message that earns hero XP",
    member: { displayName: "Test Pirate" },
    channel: {
      send: async payload => sent.push(payload)
    },
    reply: async () => {}
  });

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].embeds[0].data.title,
    "⭐ Test Pirate's Monkey D. Luffy levelled up to Level 2!"
  );
  assert.equal(sent[0].embeds[0].data.image.url, "attachment://hero-level-up.png");
  assert.equal(getCharacterProgress(userId, "luffy").level, 2);
});

test("raid energy upgrades spend scaling Berries and raise raid capacity", () => {
  const userId = `hero-energy-${randomUUID()}`;
  const guildId = `guild-${randomUUID()}`;
  grantStarterCharacters(userId);
  assert.equal(addBerries(userId, 55_000, "Test funding"), true);

  const firstUpgrade = upgradeCharacterEnergy(userId, "luffy");
  assert.equal(firstUpgrade.price, 1_000);
  assert.equal(firstUpgrade.maxEnergy, 110);

  for (let upgrade = 2; upgrade <= 10; upgrade += 1) {
    const result = upgradeCharacterEnergy(userId, "luffy");
    assert.equal(result.success, true);
    assert.equal(result.energyLevel, upgrade);
  }
  assert.equal(upgradeCharacterEnergy(userId, "luffy").success, false);

  const raid = createRaid({
    guildId,
    bossName: "Test Boss",
    maxHp: 10_000
  });
  const selection = setRaidFighter(raid.id, userId, "luffy");
  assert.equal(selection.success, true);
  assert.equal(selection.state.energy, 200);
  assert.equal(getRaidPlayerState(raid.id, userId).energy_capacity, 200);

  const attack = recordRaidAction(raid.id, userId, 100, 20);
  assert.equal(attack.success, true);
  assert.equal(attack.xpResult.awarded, 20);
  assert.equal(attack.state.energy_capacity, 200);
  const laterAttack = recordRaidAction(raid.id, userId, 100, 20);
  assert.equal(laterAttack.success, true);
  assert.equal(laterAttack.energy, 160);
  assert.equal(laterAttack.xpResult, null);
  assert.equal(getBalance(userId), 0);
});

test("admins can configure valid mission rotations", () => {
  const guildId = `guild-${randomUUID()}`;
  const result = configureMission(guildId, "message-1", 12, 750);

  assert.equal(result.success, true);
  assert.equal(result.mission.message_goal, 12);
  assert.equal(result.mission.reward, 750);
  assert.equal(
    configureMission(guildId, "not-a-rotation", 12, 750).success,
    false
  );
  assert.equal(configureMission(guildId, "message-1", 0, 750).success, false);
  assert.equal(
    configureMission(guildId, "message-1", 12, -1).success,
    false
  );
});

test("daily mission configuration, progress, and claims are isolated per guild", () => {
  const firstGuildId = `guild-one-${randomUUID()}`;
  const secondGuildId = `guild-two-${randomUUID()}`;
  const userId = `shared-user-${randomUUID()}`;
  const date = "2026-08-12";
  const defaultMission = getDailyMission(firstGuildId, date);
  const configured = configureMission(
    firstGuildId,
    defaultMission.mission_key,
    1,
    900
  );

  assert.equal(configured.success, true);

  const firstGuildMission = getDailyMission(firstGuildId, date);
  const secondGuildMission = getDailyMission(secondGuildId, date);
  assert.equal(firstGuildMission.message_goal, 1);
  assert.equal(firstGuildMission.reward, 900);
  assert.equal(secondGuildMission.message_goal, defaultMission.message_goal);
  assert.equal(secondGuildMission.reward, defaultMission.reward);

  const firstProgress = recordMissionMessage(
    firstGuildId,
    userId,
    firstGuildMission.id,
    firstGuildMission.message_goal
  );
  assert.equal(firstProgress.completed, true);
  assert.equal(getMissionProgress(firstGuildId, userId, firstGuildMission.id), 1);
  assert.equal(getMissionProgress(secondGuildId, userId, secondGuildMission.id), 0);

  const firstClaim = claimMission(
    firstGuildId,
    userId,
    firstGuildMission.id,
    firstGuildMission.reward,
    1,
    firstGuildMission.message_goal
  );
  assert.equal(firstClaim.success, true);

  const secondClaimWithoutProgress = claimMission(
    secondGuildId,
    userId,
    secondGuildMission.id,
    secondGuildMission.reward,
    1,
    secondGuildMission.message_goal
  );
  assert.equal(secondClaimWithoutProgress.success, false);
  assert.equal(
    secondClaimWithoutProgress.message,
    "Mission activity requirement not met."
  );
});

test("feature channels are persisted independently per guild", () => {
  const firstGuildId = `channel-guild-one-${randomUUID()}`;
  const secondGuildId = `channel-guild-two-${randomUUID()}`;
  const firstChannelId = `channel-one-${randomUUID()}`;
  const secondChannelId = `channel-two-${randomUUID()}`;

  assert.equal(setGuildChannel(firstGuildId, "raids", firstChannelId), true);
  assert.equal(setGuildChannel(secondGuildId, "raids", secondChannelId), true);
  assert.equal(getGuildChannel(firstGuildId, "raids"), firstChannelId);
  assert.equal(getGuildChannel(secondGuildId, "raids"), secondChannelId);
  assert.deepEqual(getGuildChannelSettings(firstGuildId), {
    raids: firstChannelId
  });
  assert.equal(setGuildChannel(firstGuildId, "missions", firstChannelId), false);
  assert.equal(getGuildChannel(firstGuildId, "missions"), null);
});

test("raid fighters can keep attacking during recharge if they have enough energy", () => {
  const {
    createRaid,
    getRaidPlayerState,
    recordRaidAction,
    setRaidFighter
  } = require("../src/db");
  const guildId = `energy-raid-guild-${randomUUID()}`;
  const userId = `energy-raid-user-${randomUUID()}`;
  const raid = createRaid({
    guildId,
    bossName: "Energy Test Boss",
    maxHp: 10000,
    reward: 50000,
    startedBy: `energy-raid-admin-${randomUUID()}`
  });

  assert.equal(raid.status, "active");
  assert.equal(setRaidFighter(raid.id, userId, "luffy").success, true);
  assert.deepEqual(
    setRaidFighter(raid.id, userId, "zoro"),
    {
      success: false,
      message: "You've already chosen a fighter for this raid."
    }
  );
  assert.equal(getRaidPlayerState(raid.id, userId).character_id, "luffy");

  const firstAttack = recordRaidAction(raid.id, userId, 500, 20, {
    now: 100000,
    cooldownMs: 60000
  });
  assert.equal(firstAttack.success, true);
  assert.equal(firstAttack.energy, 80);
  assert.equal(firstAttack.raid.current_hp, 9500);
  assert.equal(firstAttack.cooldownUntil, 160000);

  const duringCooldown = recordRaidAction(raid.id, userId, 1000, 40, {
    now: 100001,
    cooldownMs: 60000
  });
  assert.equal(duringCooldown.success, true);
  assert.equal(duringCooldown.energy, 40);
  assert.equal(duringCooldown.cooldownUntil, 160000);

  const attackDuringRecharge = recordRaidAction(raid.id, userId, 500, 20, {
    now: 100002,
    cooldownMs: 60000
  });
  assert.equal(attackDuringRecharge.success, true);
  assert.equal(attackDuringRecharge.energy, 20);
  assert.equal(attackDuringRecharge.cooldownUntil, 160000);

  const insufficientEnergy = recordRaidAction(raid.id, userId, 500, 40, {
    now: 100003,
    cooldownMs: 60000
  });
  assert.equal(insufficientEnergy.success, false);
  assert.match(insufficientEnergy.message, /Not enough energy/);
  assert.equal(insufficientEnergy.state.cooldown_until, 160000);

  const afterCooldown = recordRaidAction(raid.id, userId, 500, 20, {
    now: 160000,
    cooldownMs: 60000
  });
  assert.equal(afterCooldown.success, true);
  assert.equal(afterCooldown.energy, 80);
  assert.equal(afterCooldown.cooldownUntil, 220000);
  assert.equal(getRaidPlayerState(raid.id, userId, 160000).energy, 80);

  assert.deepEqual(
    recordRaidAction(raid.id, `unselected-${randomUUID()}`, 500, 20),
    {
      success: false,
      message: "Choose your fighter before attacking the boss."
    }
  );
});

test("raid energy starts recharging when it drops one point below capacity", () => {
  const { createRaid, getRaidPlayerState, recordRaidAction, setRaidFighter } =
    require("../src/db");
  const userId = `energy-one-below-${randomUUID()}`;
  const raid = createRaid({
    guildId: `energy-one-below-guild-${randomUUID()}`,
    bossName: "One Point Test Boss",
    maxHp: 10000
  });
  setRaidFighter(raid.id, userId, "luffy");

  const action = recordRaidAction(raid.id, userId, 100, 1, {
    now: 200000,
    cooldownMs: 60000
  });

  assert.equal(action.success, true);
  assert.equal(action.energy, 99);
  assert.equal(action.cooldownUntil, 260000);
  assert.equal(getRaidPlayerState(raid.id, userId, 200000).cooldown_until, 260000);
  const duringRecharge = recordRaidAction(raid.id, userId, 100, 20, {
    now: 200001,
    cooldownMs: 60000
  });
  assert.equal(duringRecharge.success, true);
  assert.equal(duringRecharge.energy, 79);
  assert.equal(duringRecharge.cooldownUntil, 260000);

  const recharged = getRaidPlayerState(raid.id, userId, 260000);
  assert.equal(recharged.energy, 100);
  assert.equal(recharged.cooldown_until, null);
});

test("raid panel buttons select a fighter and update the boss after an attack", async () => {
  const { handleInteraction } = require("../src/commands");
  const { createRaid, getActiveRaid, getRaidPlayerState } = require("../src/db");
  const guildId = `raid-panel-guild-${randomUUID()}`;
  const channelId = `raid-panel-channel-${randomUUID()}`;
  const userId = `raid-panel-user-${randomUUID()}`;
  const raid = createRaid({
    guildId,
    bossName: "Button Test Boss",
    maxHp: 15000,
    reward: 50000,
    startedBy: `raid-panel-admin-${randomUUID()}`
  });
  setGuildChannel(guildId, "raids", channelId);

  function makeComponent(customId, kind, callbacks) {
    return {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => kind === "button",
      isStringSelectMenu: () => kind === "select",
      isRoleSelectMenu: () => false,
      isModalSubmit: () => false,
      isChannelSelectMenu: () => false,
      inGuild: () => true,
      guildId,
      channelId,
      customId,
      user: { id: userId, username: "Raid Tester" },
      values: kind === "select" ? ["luffy"] : undefined,
      ...callbacks
    };
  }

  let fighterMenu;
  assert.equal(await handleInteraction(makeComponent(
    `raid:choose:${raid.id}`,
    "button",
    {
      reply: async payload => {
        fighterMenu = payload;
      }
    }
  )), true);
  assert.equal(fighterMenu.ephemeral, true);
  assert.ok(fighterMenu.components[0].components[0].options.some(option =>
    option.data.value === "luffy"
  ));

  let selectionConfirmation;
  assert.equal(await handleInteraction(makeComponent(
    `raid:select:${raid.id}`,
    "select",
    {
      update: async payload => {
        selectionConfirmation = payload;
      }
    }
  )), true);
  assert.match(selectionConfirmation.content, /Monkey D\. Luffy/);
  assert.equal(getRaidPlayerState(raid.id, userId).character_id, "luffy");

  let actionPanel;
  assert.equal(await handleInteraction(makeComponent(
    `raid:attack:${raid.id}`,
    "button",
    {
      deferUpdate: async () => {},
      editReply: async payload => {
        actionPanel = payload;
      }
    }
  )), true);
  assert.match(actionPanel.embeds[0].data.description, /damage/);
  assert.ok(actionPanel.components.length > 0);
  assert.ok(getActiveRaid(guildId).current_hp < raid.max_hp);
  assert.equal(getRaidPlayerState(raid.id, userId).energy, 80);

  let specialPanel;
  assert.equal(await handleInteraction(makeComponent(
    `raid:special:${raid.id}`,
    "button",
    {
      deferUpdate: async () => {},
      editReply: async payload => {
        specialPanel = payload;
      }
    }
  )), true);
  assert.match(specialPanel.embeds[0].data.description, /Gum-Gum Pistol/);
  assert.equal(getRaidPlayerState(raid.id, userId).energy, 40);
});

test("Trivia and POTD channel choices also configure their posting destinations", () => {
  const guildId = `scheduled-channel-guild-${randomUUID()}`;
  const triviaChannelId = `trivia-channel-${randomUUID()}`;
  const potdChannelId = `potd-channel-${randomUUID()}`;
  const { setTriviaChannel } = require("../src/trivia");
  const { setPotdChannel } = require("../src/potd");

  setTriviaChannel(guildId, triviaChannelId);
  setPotdChannel(guildId, potdChannelId);

  assert.equal(getGuildChannel(guildId, "trivia"), triviaChannelId);
  assert.equal(getGuildChannel(guildId, "potd"), potdChannelId);
  assert.equal(
    db.prepare("SELECT channel_id FROM trivia_settings WHERE guild_id = ?")
      .get(guildId).channel_id,
    triviaChannelId
  );
  assert.equal(
    db.prepare("SELECT channel_id FROM potd_settings WHERE guild_id = ?")
      .get(guildId).channel_id,
    potdChannelId
  );
});

test("Trivia round closure publishes results and recovers interrupted rounds", async () => {
  const {
    closeQuestion,
    recoverOpenTriviaRounds,
    setTriviaChannel
  } = require("../src/trivia");
  const guildId = `result-trivia-${randomUUID()}`;
  const channelId = `result-channel-${randomUUID()}`;
  const roundId = `result-round-${randomUUID()}`;
  const question = "Who is the captain of the Straw Hat Pirates?";
  const options = ["Zoro", "Luffy", "Sanji", "Usopp"];
  setTriviaChannel(guildId, channelId);
  db.prepare(`
    INSERT INTO trivia_rounds (
      round_id, guild_id, question, options_json, correct_index,
      status, opened_at, message_id
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(roundId, guildId, question, JSON.stringify(options), 1, Date.now(), "result-message");

  let editedPayload;
  await closeQuestion(guildId, roundId, {
    edit: async payload => {
      editedPayload = payload;
    }
  });

  assert.equal(editedPayload.embeds[0].data.title, "📣 Trivia Results");
  assert.match(editedPayload.embeds[0].data.description, /Correct answer:\*\* Luffy/);
  assert.ok(
    editedPayload.components[0].components.every(component =>
      component.toJSON().disabled
    )
  );
  assert.equal(
    db.prepare("SELECT status FROM trivia_rounds WHERE round_id = ?")
      .get(roundId).status,
    "closed"
  );

  const recoveredRoundId = `recovered-round-${randomUUID()}`;
  db.prepare(`
    INSERT INTO trivia_rounds (
      round_id, guild_id, question, options_json, correct_index,
      status, opened_at, message_id
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    recoveredRoundId,
    guildId,
    question,
    JSON.stringify(options),
    1,
    Date.now(),
    "interrupted-message"
  );

  let fetchedMessageId;
  let recoveredPayload;
  const client = {
    guilds: {
      cache: new Map([[guildId, {
        channels: {
          cache: new Map([[channelId, {
            messages: {
              fetch: async messageId => {
                fetchedMessageId = messageId;
                return {
                  edit: async payload => {
                    recoveredPayload = payload;
                  }
                };
              }
            }
          }]])
        }
      }]])
    }
  };
  await recoverOpenTriviaRounds(client);

  assert.equal(fetchedMessageId, "interrupted-message");
  assert.equal(recoveredPayload.embeds[0].data.title, "📣 Trivia Results");
  assert.equal(
    db.prepare("SELECT status FROM trivia_rounds WHERE round_id = ?")
      .get(recoveredRoundId).status,
    "closed"
  );
});

test("pirate battles choose a fair first turn and show fighter status", () => {
  const {
    buildBattleEmbed,
    selectFirstTurn
  } = require("../src/battle");
  const playerIds = ["challenger", "opponent"];

  assert.equal(selectFirstTurn(playerIds, () => 0), "challenger");
  assert.equal(selectFirstTurn(playerIds, () => 0.99), "opponent");
  assert.throws(() => selectFirstTurn(["only-one-player"]), /exactly two players/);

  const battle = {
    playerIds,
    players: {
      challenger: {
        username: "Luffy",
        characterId: "luffy",
        hp: 60,
        defending: false,
        specialUsed: false,
        recoverUsed: false,
        passiveUsed: false
      },
      opponent: {
        username: "Zoro",
        characterId: "zoro",
        hp: 85,
        defending: true,
        specialUsed: true,
        recoverUsed: false,
        passiveUsed: false
      }
    },
    currentTurn: "opponent",
    round: 3
  };
  const embed = buildBattleEmbed(battle, "Zoro struck back!");
  const data = embed.toJSON();

  assert.match(data.title, /ROUND 3/);
  assert.match(data.fields[0].value, /Never Gives Up/);
  assert.match(data.fields[0].value, /Passive ready/);
  assert.match(data.fields[0].value, /Special ready/);
  assert.match(data.fields[1].value, /Three-Sword Pressure/);
  assert.match(data.fields[1].value, /Special used/);
  assert.match(data.fields[1].value, /Guard active/);
  assert.match(data.fields[2].value, /\*\*Zoro\*\* is up/);
  assert.ok(data.fields.every(field => field.value.length <= 1024));
  assert.ok(
    data.title.length +
      data.description.length +
      data.fields.reduce((total, field) => total + field.name.length + field.value.length, 0) +
      data.footer.text.length <= 6000
  );
});

test("battle move buttons disable when the active fighter has spent them", () => {
  const { getActionRows } = require("../src/battle");
  const battle = {
    id: "button-state-test",
    playerIds: ["first", "second"],
    players: {
      first: {
        characterId: "luffy",
        hp: 80,
        specialUsed: false,
        recoverUsed: false,
        defending: false
      },
      second: {
        characterId: "zoro",
        hp: 120,
        specialUsed: true,
        recoverUsed: true,
        defending: true
      }
    },
    currentTurn: "second"
  };
  const actionButtons = getActionRows(battle)[0].toJSON().components;

  assert.deepEqual(
    actionButtons.map(button => button.label),
    ["Attack", "Special Used", "Defending", "Recover Used"]
  );
  assert.deepEqual(
    actionButtons.map(button => Boolean(button.disabled)),
    [false, true, true, true]
  );

  battle.currentTurn = "first";
  const nextTurnButtons = getActionRows(battle)[0].toJSON().components;
  assert.deepEqual(
    nextTurnButtons.map(button => Boolean(button.disabled)),
    [false, false, false, false]
  );

  battle.players.first.hp = 120;
  const fullHealthButtons = getActionRows(battle)[0].toJSON().components;
  assert.equal(fullHealthButtons[3].disabled, true);
});

test("character passives add small distinct battle effects", () => {
  const {
    calculateDamage,
    getCharacterPassive,
    getRecoveryAmount,
    triggerLowHealthPassive
  } = require("../src/battle");
  const fixedRandom = () => 0;
  const defender = {
    characterId: "zoro",
    hp: 120,
    defending: false
  };

  assert.equal(
    calculateDamage({ characterId: "zoro" }, defender, false, fixedRandom),
    12
  );
  assert.equal(
    calculateDamage({ characterId: "nami" }, defender, true, fixedRandom),
    25
  );
  assert.equal(
    calculateDamage(
      { characterId: "luffy" },
      { ...defender, characterId: "franky" },
      false,
      fixedRandom
    ),
    3
  );
  assert.equal(getRecoveryAmount("chopper"), 32);
  assert.equal(getRecoveryAmount("luffy"), 20);
  assert.match(getCharacterPassive("chopper").name, /Emergency Medicine/);
  assert.match(getCharacterPassive("brook").description, /no passive ability/);

  const luffy = {
    characterId: "luffy",
    hp: 60,
    passiveUsed: false
  };
  assert.equal(triggerLowHealthPassive(luffy), 10);
  assert.equal(luffy.hp, 70);
  assert.equal(luffy.passiveUsed, true);
  assert.equal(triggerLowHealthPassive(luffy), 0);

  const knockedOutLuffy = {
    characterId: "luffy",
    hp: 0,
    passiveUsed: false
  };
  assert.equal(triggerLowHealthPassive(knockedOutLuffy), 0);
});

test("Trivia has a broad, valid question pool and shuffles answer positions", () => {
  const { QUESTIONS, getQuestion } = require("../src/trivia");

  assert.ok(QUESTIONS.length >= 60, "Trivia should have at least 60 questions");
  assert.equal(
    new Set(QUESTIONS.map(question => question.question.toLowerCase())).size,
    QUESTIONS.length,
    "Trivia questions should not be duplicated"
  );

  for (const question of QUESTIONS) {
    assert.equal(typeof question.question, "string");
    assert.equal(question.options.length, 4);
    assert.ok(
      new Set(question.options.map(option => option.toLowerCase())).size === 4,
      `${question.question} should have four distinct options`
    );
    assert.ok(
      Number.isInteger(question.answer) &&
        question.answer >= 0 &&
        question.answer < question.options.length,
      `${question.question} should have a valid correct-answer index`
    );
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selected = getQuestion();
    const source = QUESTIONS.find(question => question.question === selected.question);
    assert.ok(source);
    assert.deepEqual([...selected.options].sort(), [...source.options].sort());
    assert.equal(
      selected.options[selected.answer],
      source.options[source.answer],
      "shuffling must preserve the correct answer"
    );
  }
});

test("Trivia waits for channel quiet and preserves the minimum gap between rounds", () => {
  const guildId = `quiet-trivia-guild-${randomUUID()}`;
  const channelId = `quiet-trivia-channel-${randomUUID()}`;
  const { setTriviaChannel, recordTriviaChannelActivity, getTriviaWaitTime } =
    require("../src/trivia");

  setTriviaChannel(guildId, channelId);
  let now = Date.now();
  assert.ok(getTriviaWaitTime(guildId, now) > 4 * 60_000);

  assert.equal(recordTriviaChannelActivity({
    guild: { id: guildId },
    channelId: `other-channel-${randomUUID()}`,
    author: { bot: false },
    webhookId: null,
    createdTimestamp: now
  }), false);
  assert.equal(recordTriviaChannelActivity({
    guild: { id: guildId },
    channelId,
    author: { bot: true },
    webhookId: null,
    createdTimestamp: now
  }), false);
  assert.equal(recordTriviaChannelActivity({
    guild: { id: guildId },
    channelId,
    author: { bot: false },
    webhookId: null,
    createdTimestamp: now
  }), true);
  assert.ok(getTriviaWaitTime(guildId, now) >= 5 * 60_000);

  const openedAt = now - 2 * 60_000;
  db.prepare(`
    INSERT INTO trivia_rounds (
      round_id, guild_id, question, options_json, correct_index,
      status, opened_at, closed_at
    ) VALUES (?, ?, 'Question', '[]', 0, 'closed', ?, ?)
  `).run(randomUUID(), guildId, openedAt, openedAt);

  now += 6 * 60_000;
  assert.ok(getTriviaWaitTime(guildId, now) >= 2 * 60_000);
  now += 3 * 60_000;
  assert.equal(getTriviaWaitTime(guildId, now), 0);
});

test("feature commands are blocked until configured and outside their selected channel", async () => {
  const guildId = `channel-gate-guild-${randomUUID()}`;
  const channelId = `allowed-channel-${randomUUID()}`;
  const { handleCommand } = require("../src/commands");
  const responses = [];
  const interaction = {
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "raid",
    guildId,
    channelId: `wrong-channel-${randomUUID()}`,
    reply: async payload => responses.push(payload.content)
  };

  assert.equal(await handleCommand(interaction), true);
  assert.match(responses.pop(), /\/setup/);

  setGuildChannel(guildId, "raids", channelId);
  interaction.channelId = `wrong-channel-${randomUUID()}`;
  assert.equal(await handleCommand(interaction), true);
  assert.match(responses.pop(), new RegExp(`<#${channelId}>`));
});

test("hero commands set a server base hero and autocomplete owned characters", async () => {
  const guildId = `hero-command-guild-${randomUUID()}`;
  const channelId = `hero-command-channel-${randomUUID()}`;
  const userId = `hero-command-user-${randomUUID()}`;
  const { handleCommand, handleAutocomplete } = require("../src/commands");
  setGuildChannel(guildId, "player_economy", channelId);

  let commandResponse;
  assert.equal(await handleCommand({
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "hero",
    guildId,
    channelId,
    user: { id: userId },
    options: {
      getSubcommand: () => "set-base",
      getString: () => "zoro"
    },
    reply: async payload => {
      commandResponse = payload;
    }
  }), true);
  assert.match(commandResponse.embeds[0].data.description, /base hero in this server/);
  assert.equal(getBaseCharacter(userId, guildId).character_id, "zoro");

  let choices;
  assert.equal(await handleAutocomplete({
    commandName: "hero",
    user: { id: userId },
    options: {
      getFocused: value => value ? { name: "character", value: "zo" } : "zo"
    },
    respond: async response => {
      choices = response;
    }
  }), true);
  assert.ok(choices.some(choice => choice.value === "zoro"));
});

test("profile, inventory, bounty, balance, and achievement commands return image cards", async () => {
  const { handleCommand } = require("../src/commands");
  const guildId = `stats-cards-guild-${randomUUID()}`;
  const channelId = `stats-cards-channel-${randomUUID()}`;
  const user = {
    id: `stats-cards-user-${randomUUID()}`,
    username: "Card Tester",
    displayAvatarURL: () => null
  };
  setGuildChannel(guildId, "player_economy", channelId);

  for (const commandName of [
    "profile",
    "inventory",
    "bounty",
    "balance",
    "achievements"
  ]) {
    let response;
    const interaction = {
      isChatInputCommand: () => true,
      inGuild: () => true,
      commandName,
      guildId,
      channelId,
      guild: { name: "Card Test Server" },
      user,
      options: {
        getUser: () => null,
        getSubcommand: () => null
      },
      deferReply: async () => {},
      editReply: async payload => {
        response = payload;
      }
    };

    assert.equal(await handleCommand(interaction), true);
    assert.equal(response.files.length, 1, `${commandName} should attach a card`);
    const png = Buffer.from(response.files[0].attachment);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${commandName} should return a valid PNG`
    );
  }
});

test("Berry, bounty, crew, raid, and Trivia leaderboards return image cards", async () => {
  const { handleCommand } = require("../src/commands");
  const { createRaid } = require("../src/db");
  const guildId = `leaderboard-cards-guild-${randomUUID()}`;
  const channelFeatures = {
    leaderboard: "player_economy",
    "bounty-top": "player_economy",
    crew: "crews_wars",
    raid: "raids",
    trivia: "trivia"
  };
  for (const feature of new Set(Object.values(channelFeatures))) {
    setGuildChannel(guildId, feature, `${feature}-${guildId}`);
  }
  createRaid({
    guildId,
    bossName: "Leaderboard Test Boss",
    maxHp: 10_000
  });

  for (const [commandName, feature] of Object.entries(channelFeatures)) {
    let response;
    const channelId = `${feature}-${guildId}`;
    const interaction = {
      isChatInputCommand: () => true,
      inGuild: () => true,
      commandName,
      guildId,
      channelId,
      guild: {
        name: "Leaderboard Test Server",
        members: { cache: new Map() }
      },
      client: { users: { cache: new Map() } },
      user: {
        id: `leaderboard-user-${guildId}`,
        username: "Leaderboard Tester"
      },
      options: {
        getUser: () => null,
        getSubcommand: () => "leaderboard"
      },
      deferReply: async () => {},
      editReply: async payload => {
        response = payload;
      }
    };

    assert.equal(await handleCommand(interaction), true, `${commandName} should be handled`);
    assert.equal(response.files.length, 1, `${commandName} should attach a card`);
    const png = Buffer.from(response.files[0].attachment);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${commandName} should return a valid PNG`
    );
  }
});

test("Trivia leaderboards page through ten fixed player slots", async () => {
  const { handleInteraction } = require("../src/commands");
  const { resolveLeaderboardNames } = require("../src/stats-card");
  const guildId = `trivia-pages-guild-${randomUUID()}`;
  const channelId = `trivia-pages-channel-${guildId}`;
  setGuildChannel(guildId, "trivia", channelId);

  const users = Array.from({ length: 11 }, (_, index) => {
    const userId = `trivia-page-user-${randomUUID()}`;
    ensureUser(userId);
    startPirateJourney(userId);
    db.prepare(`
      INSERT INTO trivia_stats (
        guild_id, user_id, wins, correct_answers, participations, berries_earned
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(guildId, userId, 11 - index, 11 - index, 11 - index, 100);
    return {
      id: userId,
      username: `pirate-${index}`,
      globalName: `Display Pirate ${index}`,
      displayAvatarURL: () => null
    };
  });
  const client = {
    users: { cache: new Map(users.map(user => [user.id, user])) }
  };
  const namedRows = await resolveLeaderboardNames(
    client,
    { members: { cache: new Map() } },
    [{ userId: users[0].id, score: 11, value: "11 wins" }]
  );
  assert.equal(namedRows[0].label, users[0].globalName);
  assert.equal(typeof namedRows[0].avatar.displayAvatarURL, "function");

  const makeInteraction = overrides => {
    const interaction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isModalSubmit: () => false,
      isChannelSelectMenu: () => false,
      inGuild: () => true,
      guildId,
      channelId,
      guild: {
        name: "Trivia Page Test",
        members: { cache: new Map() }
      },
      client,
      user: { id: `page-viewer-${guildId}` },
      deferReply: async () => {},
      deferUpdate: async () => {},
      editReply: async payload => {
        interaction.response = payload;
      },
      reply: async payload => {
        interaction.response = payload;
      },
      ...overrides
    };
    return interaction;
  };

  const firstPageInteraction = makeInteraction({
    isChatInputCommand: () => true,
    commandName: "trivia",
    options: { getSubcommand: () => "leaderboard" }
  });
  assert.equal(await handleInteraction(firstPageInteraction), true);
  assert.equal(firstPageInteraction.response.components.length, 1);
  assert.deepEqual(
    firstPageInteraction.response.components[0].components.map(button =>
      button.data.custom_id
    ),
    ["leaderboard:page:trivia:1"]
  );

  const secondPageInteraction = makeInteraction({
    isButton: () => true,
    customId: "leaderboard:page:trivia:1"
  });
  assert.equal(await handleInteraction(secondPageInteraction), true);
  assert.deepEqual(
    secondPageInteraction.response.components[0].components.map(button =>
      button.data.custom_id
    ),
    ["leaderboard:page:trivia:0"]
  );
  const png = Buffer.from(secondPageInteraction.response.files[0].attachment);
  assert.equal(png.readUInt32BE(20), 1220, "every leaderboard card has ten slots");

  setGuildChannel(guildId, "player_economy", channelId);
  const berriesPageInteraction = makeInteraction({
    isChatInputCommand: () => true,
    commandName: "leaderboard"
  });
  assert.equal(await handleInteraction(berriesPageInteraction), true);
  assert.deepEqual(
    berriesPageInteraction.response.components[0].components.map(button =>
      button.data.custom_id
    ),
    ["leaderboard:page:berry:1"]
  );

  const berriesNextPageInteraction = makeInteraction({
    isButton: () => true,
    customId: "leaderboard:page:berry:1"
  });
  assert.equal(await handleInteraction(berriesNextPageInteraction), true);
  assert.equal(
    berriesNextPageInteraction.response.components[0].components[0].data.custom_id,
    "leaderboard:page:berry:0"
  );
});

test("moderator command roots route through their protected handlers", async () => {
  const { handleCommand } = require("../src/commands");
  const commandsToCheck = [
    { commandName: "raid-admin", feature: "raids", subcommand: "start" },
    { commandName: "crew-war-admin", feature: "crews_wars", subcommand: "finish" },
    { commandName: "trivia-admin", feature: "trivia", subcommand: "start" }
  ];

  for (const command of commandsToCheck) {
    const guildId = `moderator-routing-${randomUUID()}`;
    const channelId = `moderator-channel-${randomUUID()}`;
    setGuildChannel(guildId, command.feature, channelId);
    let response;

    assert.equal(await handleCommand({
      isChatInputCommand: () => true,
      inGuild: () => true,
      commandName: command.commandName,
      guildId,
      channelId,
      user: { id: `moderator-test-${randomUUID()}` },
      memberPermissions: { has: () => false },
      options: { getSubcommand: () => command.subcommand },
      reply: async payload => {
        response = payload;
      }
    }), true);
    assert.equal(response.ephemeral, true);
    assert.match(response.content, /Manage Server|moderators/);
  }
});

test("crew-war-admin start autocomplete returns guild crews", async () => {
  const { handleAutocomplete } = require("../src/commands");
  const guildId = `crew-war-admin-autocomplete-${randomUUID()}`;
  const crewName = `Auto-${randomUUID().slice(0, 8)}`;
  createCrew(guildId, crewName, `autocomplete-captain-${randomUUID()}`);
  let choices;

  assert.equal(await handleAutocomplete({
    commandName: "crew-war-admin",
    guildId,
    options: {
      getSubcommand: () => "start",
      getFocused: () => ({ name: "crew_one", value: "Auto-" })
    },
    respond: async response => {
      choices = response;
    }
  }), true);
  assert.ok(choices.some(choice => choice.name.startsWith(crewName)));
});

test("/crew-war challenge lets captains start wars without moderator permissions", async () => {
  const { handleInteraction } = require("../src/commands");
  const guildId = `crew-war-command-${randomUUID()}`;
  const channelId = `crew-war-channel-${guildId}`;
  const challenger = createCrew(
    guildId,
    `Captain One ${randomUUID()}`,
    `captain-one-${randomUUID()}`
  );
  const target = createCrew(
    guildId,
    `Captain Two ${randomUUID()}`,
    `captain-two-${randomUUID()}`
  );
  setGuildChannel(guildId, "crews_wars", channelId);
  const logChannelId = `crew-log-${guildId}`;
  const logChannel = {
    id: logChannelId,
    isTextBased: () => true,
    send: async () => {}
  };
  const guild = {
    id: guildId,
    members: {
      me: {
        id: `bot-${guildId}`,
        permissions: { has: () => true }
      }
    },
    roles: { cache: new Map() },
    channels: {
      fetch: async id => id === logChannelId ? logChannel : null,
      create: async () => logChannel
    }
  };

  let challengePayload;
  assert.equal(await handleInteraction({
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "crew-war",
    guildId,
    guild,
    channelId,
    user: { id: challenger.crew.leader_id },
    options: {
      getSubcommand: () => "challenge",
      getString: () => target.crew.name
    },
    deferReply: async () => {},
    editReply: async payload => {
      challengePayload = payload;
    }
  }), true);
  assert.equal(challengePayload.components.length, 1);
  assert.deepEqual(
    challengePayload.components[0].components.map(button => button.data.custom_id.split(":")[1]),
    ["accept", "decline", "cancel"]
  );
  assert.match(challengePayload.embeds[0].data.description, /first crew to \*\*10 duel wins\*\*/);

  let response;
  const acceptButton = challengePayload.components[0].components[0].data.custom_id;
  assert.equal(await handleInteraction({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    isChannelSelectMenu: () => false,
    inGuild: () => true,
    customId: acceptButton,
    guildId,
    guild,
    channelId,
    user: { id: target.crew.leader_id },
    deferUpdate: async () => {},
    editReply: async payload => {
      response = payload;
    }
  }), true);
  assert.deepEqual(response.components, []);
  assert.match(response.embeds[0].data.title, /Accepted/);
  assert.equal(getActiveCrewWar(guildId, challenger.crew.id).status, "active");
});

test("only the captain can disband a crew and related rows are removed", () => {
  const guildId = `guild-${randomUUID()}`;
  const captainId = `captain-${randomUUID()}`;
  const memberId = `member-${randomUUID()}`;
  const created = createCrew(guildId, `Crew ${randomUUID()}`, captainId);
  assert.equal(created.success, true);

  assert.equal(
    inviteToCrew(guildId, created.crew.id, captainId, memberId).success,
    true
  );
  assert.equal(
    acceptCrewInvite(guildId, memberId, created.crew.id).success,
    true
  );
  db.prepare(`
    INSERT INTO crew_invites (crew_id, inviter_id, invitee_id)
    VALUES (?, ?, ?)
  `).run(created.crew.id, captainId, `invitee-${randomUUID()}`);

  assert.equal(getCrewForUser(guildId, captainId).role, "captain");
  assert.equal(disbandCrew(guildId, created.crew.id, memberId).success, false);

  const result = disbandCrew(guildId, created.crew.id, captainId);
  assert.equal(result.success, true);
  assert.equal(getCrewForUser(guildId, captainId), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM crew_members WHERE crew_id = ?")
      .get(created.crew.id).count,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM crew_invites WHERE crew_id = ?")
      .get(created.crew.id).count,
    0
  );
});

test("crews in active wars cannot be disbanded", () => {
  const guildId = `guild-${randomUUID()}`;
  const first = createCrew(guildId, `First ${randomUUID()}`, `captain-${randomUUID()}`);
  const second = createCrew(guildId, `Second ${randomUUID()}`, `captain-${randomUUID()}`);
  assert.equal(first.success, true);
  assert.equal(second.success, true);

  const war = createCrewWar(guildId, first.crew.id, second.crew.id);
  assert.equal(war.success, true);

  const result = disbandCrew(guildId, first.crew.id, first.crew.leader_id);
  assert.equal(result.success, false);
  assert.match(result.message, /active crew war/i);
});

test("crews, membership, names, and wars are isolated by guild", () => {
  const firstGuildId = `guild-one-${randomUUID()}`;
  const secondGuildId = `guild-two-${randomUUID()}`;
  const sharedUserId = `shared-captain-${randomUUID()}`;
  const otherCaptainId = `other-captain-${randomUUID()}`;
  const firstCrew = createCrew(firstGuildId, "Same Crew", sharedUserId);
  const secondCrew = createCrew(secondGuildId, "Same Crew", sharedUserId);
  const opponentCrew = createCrew(
    firstGuildId,
    "Opponent Crew",
    otherCaptainId
  );

  assert.equal(firstCrew.success, true);
  assert.equal(secondCrew.success, true);
  assert.equal(
    getCrewByName(firstGuildId, "Same Crew").id,
    firstCrew.crew.id
  );
  assert.equal(
    getCrewByName(secondGuildId, "Same Crew").id,
    secondCrew.crew.id
  );
  assert.equal(getCrewForUser(firstGuildId, sharedUserId).id, firstCrew.crew.id);
  assert.equal(getCrewForUser(secondGuildId, sharedUserId).id, secondCrew.crew.id);
  assert.equal(getCrewForUser("unrelated-guild", sharedUserId), null);
  assert.equal(getTopCrews(firstGuildId).length, 2);
  assert.equal(getTopCrews(secondGuildId).length, 1);

  const firstWar = createCrewWar(
    firstGuildId,
    firstCrew.crew.id,
    opponentCrew.crew.id
  );
  assert.equal(firstWar.success, true);
  assert.equal(getActiveCrewWar(secondGuildId), null);
  assert.equal(getCrewWar(secondGuildId, firstWar.war.id), null);
  assert.equal(
    createCrewWar(
      secondGuildId,
      firstCrew.crew.id,
      opponentCrew.crew.id
    ).success,
    false
  );
});

test("crew captains can challenge and accept wars; only the challenged captain responds", () => {
  const guildId = `crew-war-challenge-${randomUUID()}`;
  const challenger = createCrew(
    guildId,
    `Challenger ${randomUUID()}`,
    `challenger-captain-${randomUUID()}`
  );
  const target = createCrew(
    guildId,
    `Target ${randomUUID()}`,
    `target-captain-${randomUUID()}`
  );
  const challenge = challengeCrewWar(
    guildId,
    challenger.crew.id,
    target.crew.id,
    challenger.crew.leader_id
  );

  assert.equal(challenge.success, true);
  assert.equal(challenge.war.status, "pending");
  assert.equal(
    respondToCrewWarChallenge(
      guildId,
      challenge.war.id,
      `not-the-captain-${randomUUID()}`,
      "accept"
    ).success,
    false
  );
  assert.equal(
    respondToCrewWarChallenge(
      guildId,
      challenge.war.id,
      target.crew.leader_id,
      "accept"
    ).war.status,
    "active"
  );
  assert.equal(getActiveCrewWar(guildId, challenger.crew.id).id, challenge.war.id);
  assert.equal(
    challengeCrewWar(
      guildId,
      challenger.crew.id,
      target.crew.id,
      challenger.crew.leader_id
    ).success,
    false
  );

  const declineChallenger = createCrew(
    guildId,
    `Decliner ${randomUUID()}`,
    `decliner-captain-${randomUUID()}`
  );
  const declineTarget = createCrew(
    guildId,
    `Decline ${randomUUID()}`,
    `decline-captain-${randomUUID()}`
  );
  const declineChallenge = challengeCrewWar(
    guildId,
    declineChallenger.crew.id,
    declineTarget.crew.id,
    declineChallenger.crew.leader_id
  );
  assert.equal(declineChallenge.success, true);
  assert.equal(
    respondToCrewWarChallenge(
      guildId,
      declineChallenge.war.id,
      declineTarget.crew.leader_id,
      "decline"
    ).war.status,
    "declined"
  );

  const cancelChallenger = createCrew(
    guildId,
    `Cancel ${randomUUID().slice(0, 8)}`,
    `cancel-captain-${randomUUID()}`
  );
  const cancelTarget = createCrew(
    guildId,
    `Cancel target ${randomUUID().slice(0, 8)}`,
    `cancel-target-captain-${randomUUID()}`
  );
  assert.equal(cancelChallenger.success, true, cancelChallenger.message);
  assert.equal(cancelTarget.success, true, cancelTarget.message);
  const moderatorCancelledChallenge = challengeCrewWar(
    guildId,
    cancelChallenger.crew.id,
    cancelTarget.crew.id,
    cancelChallenger.crew.leader_id
  );
  assert.equal(moderatorCancelledChallenge.success, true);
  assert.equal(
    cancelPendingCrewWar(guildId, moderatorCancelledChallenge.war.id),
    true
  );
  assert.equal(
    getCrewWar(guildId, moderatorCancelledChallenge.war.id).status,
    "cancelled"
  );
});

test("crew wars end at ten wins after already-running duels settle", () => {
  const guildId = `crew-war-target-${randomUUID()}`;
  const first = createCrew(
    guildId,
    `First ${randomUUID()}`,
    `first-captain-${randomUUID()}`
  );
  const second = createCrew(
    guildId,
    `Second ${randomUUID()}`,
    `second-captain-${randomUUID()}`
  );
  const firstFighters = [];
  const secondFighters = [];
  for (let index = 0; index < CREW_WAR_WIN_TARGET; index += 1) {
    const firstId = `first-war-fighter-${randomUUID()}`;
    const secondId = `second-war-fighter-${randomUUID()}`;
    assert.equal(joinCrew(guildId, first.crew.id, firstId).success, true);
    assert.equal(joinCrew(guildId, second.crew.id, secondId).success, true);
    firstFighters.push(firstId);
    secondFighters.push(secondId);
  }

  const war = createCrewWar(guildId, first.crew.id, second.crew.id).war;
  const inFlightId = randomUUID();
  assert.equal(
    startCrewWarMatch(
      guildId,
      war.id,
      inFlightId,
      first.crew.leader_id,
      second.crew.leader_id
    ).success,
    true
  );

  for (let index = 0; index < CREW_WAR_WIN_TARGET; index += 1) {
    const matchId = randomUUID();
    assert.equal(
      startCrewWarMatch(
        guildId,
        war.id,
        matchId,
        firstFighters[index],
        secondFighters[index]
      ).success,
      true
    );
    const result = finishCrewWarMatch(guildId, matchId, firstFighters[index]);
    assert.equal(result.success, true);
    if (index === CREW_WAR_WIN_TARGET - 1) {
      assert.equal(result.autoFinished, false);
      assert.equal(result.warFinishing, true);
      assert.equal(result.war.status, "finishing");
    }
  }

  const finalDuel = finishCrewWarMatch(
    guildId,
    inFlightId,
    second.crew.leader_id
  );
  assert.equal(finalDuel.success, true);
  assert.equal(finalDuel.autoFinished, true);
  assert.equal(finalDuel.pointAwarded, false);
  assert.equal(finalDuel.war.status, "finished");
  assert.equal(finalDuel.war.winner_crew_id, first.crew.id);
  assert.equal(finalDuel.war.score_one, CREW_WAR_WIN_TARGET);
  assert.equal(finalDuel.war.score_two, 0);
  assert.equal(
    db.prepare("SELECT points FROM crews WHERE id = ?").get(first.crew.id).points,
    10
  );
});

test("crew duel wins score once, and active duels prevent ending the war", () => {
  const guildId = `guild-${randomUUID()}`;
  const first = createCrew(guildId, `Duel One ${randomUUID()}`, `fighter-one-${randomUUID()}`);
  const second = createCrew(guildId, `Duel Two ${randomUUID()}`, `fighter-two-${randomUUID()}`);
  assert.equal(
    joinCrew(guildId, first.crew.id, `reserve-one-${randomUUID()}`).success,
    true
  );
  assert.equal(
    joinCrew(guildId, second.crew.id, `reserve-two-${randomUUID()}`).success,
    true
  );
  const warResult = createCrewWar(guildId, first.crew.id, second.crew.id);
  const war = warResult.war;
  const firstFighter = first.crew.leader_id;
  const secondFighter = second.crew.leader_id;
  const matchId = randomUUID();

  assert.equal(warResult.success, true);
  assert.equal(
    startCrewWarMatch(guildId, war.id, matchId, firstFighter, secondFighter).success,
    true
  );
  assert.match(finishCrewWar(guildId, war.id).message, /active crew duel/i);

  const result = finishCrewWarMatch(guildId, matchId, secondFighter);
  assert.equal(result.success, true);
  assert.equal(result.winnerCrewId, second.crew.id);
  assert.equal(result.war.score_one, 0);
  assert.equal(result.war.score_two, 1);
  assert.equal(hasCrewWarMatchParticipant(guildId, war.id, firstFighter), true);

  const duplicateMatch = startCrewWarMatch(
    guildId,
    war.id,
    randomUUID(),
    firstFighter,
    secondFighter
  );
  assert.equal(duplicateMatch.success, false);
  assert.match(duplicateMatch.message, /already completed a duel/i);

  const finished = finishCrewWar(guildId, war.id);
  assert.equal(finished.success, true);
  assert.equal(finished.winnerCrewId, second.crew.id);
  assert.equal(getCrewWar(guildId, war.id).status, "finished");
});

test("cancelled crew duels do not score or prevent a rematch", () => {
  const guildId = `guild-${randomUUID()}`;
  const first = createCrew(guildId, `Draw One ${randomUUID()}`, `draw-one-${randomUUID()}`);
  const second = createCrew(guildId, `Draw Two ${randomUUID()}`, `draw-two-${randomUUID()}`);
  assert.equal(
    joinCrew(guildId, first.crew.id, `reserve-one-${randomUUID()}`).success,
    true
  );
  assert.equal(
    joinCrew(guildId, second.crew.id, `reserve-two-${randomUUID()}`).success,
    true
  );
  const war = createCrewWar(guildId, first.crew.id, second.crew.id).war;
  const fighterOne = first.crew.leader_id;
  const fighterTwo = second.crew.leader_id;
  const cancelledMatchId = randomUUID();

  assert.equal(
    startCrewWarMatch(guildId, war.id, cancelledMatchId, fighterOne, fighterTwo).success,
    true
  );
  assert.equal(cancelCrewWarMatch(guildId, cancelledMatchId), true);

  const rematchId = randomUUID();
  assert.equal(
    startCrewWarMatch(guildId, war.id, rematchId, fighterOne, fighterTwo).success,
    true
  );
  assert.equal(finishCrewWarMatch(guildId, rematchId, fighterOne).success, true);
});

test("small crew wars end when no more member duels are possible", () => {
  const guildId = `crew-war-small-${randomUUID()}`;
  const first = createCrew(
    guildId,
    `Small One ${randomUUID()}`,
    `small-one-${randomUUID()}`
  );
  const second = createCrew(
    guildId,
    `Small Two ${randomUUID()}`,
    `small-two-${randomUUID()}`
  );
  const war = createCrewWar(guildId, first.crew.id, second.crew.id).war;
  const matchId = randomUUID();
  assert.equal(
    startCrewWarMatch(
      guildId,
      war.id,
      matchId,
      first.crew.leader_id,
      second.crew.leader_id
    ).success,
    true
  );

  const result = finishCrewWarMatch(guildId, matchId, first.crew.leader_id);
  assert.equal(result.autoFinished, true);
  assert.equal(result.war.status, "finished");
  assert.equal(result.winnerCrewId, first.crew.id);
});

test("legacy crew and invitation columns migrate without losing pending invites", () => {
  const legacyPath = path.join(temporaryDirectory, "legacy.sqlite");
  const legacyDatabase = new Database(legacyPath);
  legacyDatabase.exec(`
    CREATE TABLE crews (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      abbreviation TEXT,
      description TEXT,
      captain_id TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT
    );
    INSERT INTO crews (id, name, abbreviation, captain_id)
    VALUES (1, 'Legacy Crew', 'LEG', 'legacy-captain');

    CREATE TABLE crew_members (
      crew_id INTEGER NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT,
      PRIMARY KEY (crew_id, user_id)
    );
    INSERT INTO crew_members (crew_id, user_id, role)
    VALUES (1, 'legacy-captain', 'captain');

    CREATE TABLE crew_invites (
      id INTEGER PRIMARY KEY,
      crew_id INTEGER NOT NULL,
      invited_by TEXT NOT NULL,
      invited_user_id TEXT NOT NULL,
      created_at TEXT,
      UNIQUE (crew_id, invited_user_id)
    );
    INSERT INTO crew_invites (crew_id, invited_by, invited_user_id)
    VALUES (1, 'legacy-captain', 'legacy-invitee');
  `);
  legacyDatabase.close();

  const output = execFileSync(process.execPath, [
    "-e",
    `
      const { db, getCrewForUser, acceptCrewInvite } = require("./src/db");
      const crew = getCrewForUser("legacy-unassigned", "legacy-captain");
      if (!crew || crew.role !== "captain" || crew.leader_id !== "legacy-captain") {
        throw new Error("Legacy captain data did not migrate.");
      }
      const accepted = acceptCrewInvite("legacy-unassigned", "legacy-invitee", crew.id);
      if (!accepted.success) throw new Error(accepted.message);
      db.close();
      console.log("legacy crew migration ok");
    `
  ], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_PATH: legacyPath, GUILD_ID: "" },
    encoding: "utf8"
  });

  assert.match(output, /legacy crew migration ok/);
});

test("slash command definitions separate moderator actions into restricted roots", () => {
  const { commands } = require("../src/commands");
  const serialized = commands.map(command => command.toJSON());
  const startCommand = serialized.find(command => command.name === "start");
  const setupCommand = serialized.find(command => command.name === "setup");
  const crewCommand = serialized.find(command => command.name === "crew");
  const adminCommand = serialized.find(command => command.name === "admin");
  const bountyAwardCommand = serialized.find(command => command.name === "bounty-award");
  const potdAdminCommand = serialized.find(command => command.name === "potd-admin");
  const raidCommand = serialized.find(command => command.name === "raid");
  const raidAdminCommand = serialized.find(command => command.name === "raid-admin");
  const crewWarCommand = serialized.find(command => command.name === "crew-war");
  const crewWarAdminCommand = serialized.find(command => command.name === "crew-war-admin");
  const triviaCommand = serialized.find(command => command.name === "trivia");
  const triviaAdminCommand = serialized.find(command => command.name === "trivia-admin");
  const missionAdminCommand = adminCommand.options.find(
    option => option.name === "mission"
  );
  const heroCommand = serialized.find(command => command.name === "hero");

  assert.ok(startCommand);
  assert.equal(startCommand.contexts?.length, 1);
  assert.ok(setupCommand);
  assert.equal(
    setupCommand.default_member_permissions,
    String(PermissionFlagsBits.ManageGuild)
  );
  assert.equal(setupCommand.contexts?.length, 1);
  for (const command of [
    setupCommand,
    bountyAwardCommand,
    adminCommand,
    potdAdminCommand,
    raidAdminCommand,
    crewWarAdminCommand,
    triviaAdminCommand
  ]) {
    assert.ok(command, "expected moderator command to be registered");
    assert.equal(
      command.default_member_permissions,
      String(PermissionFlagsBits.ManageGuild),
      `${command.name} must be hidden from members without Manage Server`
    );
  }
  assert.ok(crewCommand.options.some(option => option.name === "disband"));
  assert.ok(crewCommand.options.some(option =>
    option.name === "edit" &&
    ["name", "abbreviation", "description"].every(name =>
      option.options.some(option => option.name === name)
    )
  ));
  assert.ok(crewCommand.options.some(option =>
    option.name === "banner" &&
    option.options.some(option => option.name === "image" && option.type === 11)
  ));
  assert.ok(crewCommand.options.some(option => option.name === "banner-reset"));
  assert.ok(missionAdminCommand);
  assert.deepEqual(
    missionAdminCommand.options.find(option => option.name === "day").choices
      .map(choice => choice.value),
    ["today", "tomorrow", "day-after"]
  );
  assert.ok(crewWarCommand.options.some(option => option.name === "fight"));
  assert.ok(crewWarCommand.options.some(option => option.name === "challenge"));
  assert.ok(!crewWarCommand.options.some(option => option.name === "contribute"));
  assert.deepEqual(
    crewWarCommand.options.map(option => option.name),
    ["challenge", "score", "fight"]
  );
  assert.deepEqual(
    heroCommand.options.map(option => option.name),
    ["set-base", "upgrade-energy"]
  );
  assert.deepEqual(
    raidCommand.options.map(option => option.name),
    ["status", "leaderboard", "rewards"]
  );
  assert.deepEqual(
    raidAdminCommand.options.find(option => option.name === "start")
      .options.find(option => option.name === "boss").choices
      .map(choice => choice.name),
    [
      "Kaido — 15,000 HP",
      "Big Mom — 15,000 HP",
      "Akainu — 15,000 HP",
      "Blackbeard — 15,000 HP"
    ]
  );
  assert.deepEqual(triviaCommand.options.map(option => option.name), ["leaderboard"]);

  function assertOptionDescriptions(options) {
    for (const option of options || []) {
      assert.equal(typeof option.description, "string", `${option.name} needs a description`);
      assert.ok(option.description.length <= 100, `${option.name} description is too long`);
      assertOptionDescriptions(option.options);
    }
  }

  for (const command of serialized) {
    assert.match(command.name, /^[a-z0-9-]+$/);
    assert.equal(typeof command.description, "string", `${command.name} needs a description`);
    assert.ok(command.description.length <= 100, `${command.name} description is too long`);
    assertOptionDescriptions(command.options);
  }
});

test("/help opens a private dropdown with public topics and an admin-only section", async () => {
  const { handleCommand, handleInteraction } = require("../src/commands");
  const userId = `help-user-${randomUUID()}`;
  const adminPermissions = {
    has: permission => permission === PermissionFlagsBits.ManageGuild
  };
  let response;
  const interaction = {
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "help",
    guildId: `help-guild-${randomUUID()}`,
    user: { id: userId },
    memberPermissions: adminPermissions,
    reply: async payload => {
      response = payload;
    }
  };

  assert.equal(await handleCommand(interaction), true);
  assert.equal(response.ephemeral, true);
  const embed = response.embeds[0].data;
  assert.equal(embed.title, "🏴‍☠️ Den Den Mushi Help");
  assert.match(embed.author.name, /GRAND LINE GUIDE/);
  assert.match(embed.description, /Choose a topic below/);
  assert.ok(embed.fields.length >= 2);
  assert.match(embed.fields[0].name, /Your first voyage/);
  assert.match(embed.footer.text, /Select a topic below/);
  assert.equal(response.components.length, 1);
  const adminMenuOptions = response.components[0].components[0].options;
  assert.deepEqual(
    adminMenuOptions.map(option => option.data.value),
    ["welcome", "pirate", "characters", "crews", "activities", "actions", "emotes", "admin"]
  );

  let memberResponse;
  assert.equal(await handleCommand({
    ...interaction,
    user: { id: `${userId}-member` },
    memberPermissions: { has: () => false },
    reply: async payload => {
      memberResponse = payload;
    }
  }), true);
  assert.equal(memberResponse.ephemeral, true);
  const memberMenuOptions = memberResponse.components[0].components[0].options;
  assert.ok(!memberMenuOptions.some(option => option.data.value === "admin"));

  let topicResponse;
  assert.equal(await handleInteraction({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    isChannelSelectMenu: () => false,
    customId: `help:guide:${userId}`,
    user: { id: userId },
    memberPermissions: adminPermissions,
    values: ["admin"],
    update: async payload => {
      topicResponse = payload;
    }
  }), true);
  const adminEmbed = topicResponse.embeds[0].data;
  const adminText = adminEmbed.fields
    .map(field => `${field.name}\n${field.value}`)
    .join("\n");
  assert.ok(adminEmbed.fields.length >= 3);
  for (const command of [
    "/setup",
    "/bounty-award",
    "/admin mission",
    "/trivia-admin setup",
    "/potd-admin setup",
    "/raid-admin start",
    "/crew-war-admin start"
  ]) {
    assert.ok(adminText.includes(command), `${command} should appear in the admin topic`);
  }

  let emotesResponse;
  await handleInteraction({
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    isChannelSelectMenu: () => false,
    customId: `help:guide:${userId}`,
    user: { id: userId },
    memberPermissions: adminPermissions,
    values: ["emotes"],
    update: async payload => {
      emotesResponse = payload;
    }
  });
  const emoteEmbed = emotesResponse.embeds[0].data;
  assert.match(emoteEmbed.fields[0].value, /`hug`/);
  assert.match(emoteEmbed.fields[0].value, /`dance`/);
  assert.match(emoteEmbed.footer.text, /\/action name/);

  for (const option of adminMenuOptions) {
    let selectedPayload;
    await handleInteraction({
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isRoleSelectMenu: () => false,
      isModalSubmit: () => false,
      isChannelSelectMenu: () => false,
      customId: `help:guide:${userId}`,
      user: { id: userId },
      memberPermissions: adminPermissions,
      values: [option.data.value],
      update: async payload => {
        selectedPayload = payload;
      }
    });

    const selectedEmbed = selectedPayload.embeds[0].data;
    assert.ok(selectedEmbed.fields.length > 0, `${option.data.value} needs formatted sections`);
    assert.ok(selectedEmbed.title.length <= 256);
    assert.ok(selectedEmbed.description.length <= 4096);
    assert.ok(selectedEmbed.fields.every(field =>
      field.name.length <= 256 && field.value.length <= 1024
    ), `${option.data.value} fields must fit Discord limits`);
    assert.ok(
      selectedEmbed.title.length +
        selectedEmbed.description.length +
        selectedEmbed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0) +
        selectedEmbed.footer.text.length +
        selectedEmbed.author.name.length <= 6000,
      `${option.data.value} embed must fit Discord's total character limit`
    );
  }
});

test("/start opens a private interactive guide with working sections", async () => {
  const { handleInteraction } = require("../src/commands");
  const userId = `guide-user-${randomUUID()}`;
  let initialPayload;
  const startCommand = {
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "start",
    guildId: `guide-guild-${randomUUID()}`,
    user: { id: userId },
    reply: async payload => {
      initialPayload = payload;
    }
  };

  assert.equal(await handleInteraction(startCommand), true);
  assert.equal(initialPayload.ephemeral, true);
  assert.ok(initialPayload.embeds[0].data.description.includes("`/help`"));
  assert.equal(
    initialPayload.components[0].components[0].options.length,
    4
  );
  const welcomeText = initialPayload.embeds[0].data.description;
  assert.match(welcomeText, /`\/daily`/);
  assert.match(welcomeText, /join the leaderboards/);
  assert.match(welcomeText, /`\/profile` — See your pirate profile; it is created automatically/);
  assert.match(welcomeText, /No need to learn every command today/);
  assert.ok(getUser(userId).leaderboard_joined_at);

  let updatedPayload;
  const sectionMenu = {
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    isChannelSelectMenu: () => false,
    customId: `start:guide:${userId}`,
    user: { id: userId },
    values: ["crew"],
    update: async payload => {
      updatedPayload = payload;
    }
  };

  assert.equal(await handleInteraction(sectionMenu), true);
  assert.equal(updatedPayload.embeds[0].data.title, "Find your nakama");
  assert.match(updatedPayload.embeds[0].data.description, /crew-war fight/);
});

test("/setup explains the minimum channel setup and keeps other features optional", async () => {
  const { handleInteraction } = require("../src/commands");
  let response;
  const interaction = {
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    inGuild: () => true,
    commandName: "setup",
    guildId: `setup-guide-${randomUUID()}`,
    user: { id: `setup-admin-${randomUUID()}` },
    memberPermissions: {
      has: permission => permission === PermissionFlagsBits.ManageGuild
    },
    reply: async payload => {
      response = payload;
    }
  };

  assert.equal(await handleInteraction(interaction), true);
  const description = response.embeds[0].data.description;
  assert.match(description, /Start with Player and economy commands/);
  assert.match(description, /Configure only the other features your server plans to use/);
  assert.match(description, /add or change channels later/);
  assert.equal(response.components[0].components[0].options.length, 6);
});

test("character triggers include varied phrases and attach curated local GIFs", async () => {
  const {
    CHARACTER_REACTIONS,
    getMentionedCharacters
  } = require("../src/character-replies");

  assert.ok(CHARACTER_REACTIONS.length >= 30);
  const strawHatIds = [
    "luffy", "zoro", "nami", "usopp", "sanji",
    "chopper", "robin", "franky", "brook", "jinbe"
  ];
  for (const character of CHARACTER_REACTIONS) {
    const minimumPhrases = strawHatIds.includes(character.id) ? 9 : 3;
    assert.ok(
      character.phrases.length >= minimumPhrases,
      `${character.id} needs at least ${minimumPhrases} phrase options`
    );
    for (const alias of character.aliases) {
      assert.ok(
        getMentionedCharacters(alias).some(match => match.id === character.id),
        `${alias} should trigger ${character.id}`
      );
    }
  }

  assert.deepEqual(
    getMentionedCharacters("Luffy and Zoro are planning an adventure.")
      .map(character => character.id),
    ["luffy", "zoro"]
  );
  assert.ok(
    getMentionedCharacters("Monkey D. Luffy met Cutty Flam.")
      .some(character => character.id === "luffy")
  );
  assert.ok(
    getMentionedCharacters("Monkey D. Luffy met Cutty Flam.")
      .some(character => character.id === "franky")
  );
  assert.deepEqual(
    getMentionedCharacters("Luffyyyy is talking to Zoroooo and Nami!!!!")
      .map(character => character.id),
    ["luffy", "zoro", "nami"]
  );
  assert.deepEqual(getMentionedCharacters("fluffy and gazoroid"), []);

  const luffy = CHARACTER_REACTIONS.find(character => character.id === "luffy");
  const previousGifPath = luffy.gifPath;
  const gifPath = path.join(temporaryDirectory, "curated-luffy.gif");
  writeFileSync(gifPath, Buffer.from("GIF89a"));
  luffy.gifPath = gifPath;

  try {
    const { handleMessage } = require("../src/message-replies");
    const responses = [];
    await handleMessage({
      author: { id: `reaction-${randomUUID()}`, bot: false },
      webhookId: null,
      guild: { id: `reaction-guild-${randomUUID()}` },
      content: "Monkey D. Luffy is here!",
      reply: async payload => responses.push(payload)
    });

    assert.equal(responses.length, 1);
    assert.ok(luffy.phrases.includes(responses[0].content));
    assert.equal(responses[0].files[0].attachment, gifPath);
  } finally {
    luffy.gifPath = previousGifPath;
  }
});

test("mission activity replies on completion and reports rejected progress", async () => {
  const { recordMissionActivity } = require("../src/message-replies");
  const guildId = `activity-guild-${randomUUID()}`;
  const mission = getDailyMission(guildId);
  const replies = [];
  const message = {
    author: { id: `activity-${randomUUID()}`, bot: false },
    webhookId: null,
    guild: { id: guildId },
    content: "A useful message",
    reply: async payload => replies.push(payload.content)
  };

  for (let count = 1; count < mission.message_goal; count += 1) {
    assert.equal(await recordMissionActivity(message), false);
  }
  assert.equal(await recordMissionActivity(message), true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Daily mission complete/);

  const rejectedReplies = [];
  const invalidMessage = {
    ...message,
    author: { id: "", bot: false },
    reply: async payload => rejectedReplies.push(payload.content)
  };
  assert.equal(await recordMissionActivity(invalidMessage), true);
  assert.match(rejectedReplies[0], /couldn't record your mission progress/i);

  assert.equal(
    await recordMissionActivity({
      ...message,
      author: { id: `bot-${randomUUID()}`, bot: true }
    }),
    false
  );
});
