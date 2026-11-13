"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { MAX_CHARACTER_LEVEL } = require("./characters");

const databasePath =
  process.env.DATABASE_PATH ||
  path.join(__dirname, "..", "data", "den-den-mushi.sqlite");

fs.mkdirSync(path.dirname(path.resolve(databasePath)), {
  recursive: true,
});

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// --------------------------------------------------
// DATABASE HELPERS
// --------------------------------------------------

function validId(id) {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    id.length <= 100
  );
}

function validAmount(amount) {
  return Number.isSafeInteger(amount) && amount >= 0;
}

const CHANNEL_FEATURES = new Set([
  "player_economy",
  "battles",
  "crews_wars",
  "raids",
  "trivia",
  "potd",
  "crew_logs",
]);

function getGuildChannel(guildId, feature) {
  if (!validId(guildId) || !CHANNEL_FEATURES.has(feature)) return null;

  return db.prepare(`
    SELECT channel_id
    FROM guild_channel_settings
    WHERE guild_id = ? AND feature = ?
  `).get(guildId, feature)?.channel_id ?? null;
}

function getGuildChannelSettings(guildId) {
  if (!validId(guildId)) return {};

  return Object.fromEntries(
    db.prepare(`
      SELECT feature, channel_id
      FROM guild_channel_settings
      WHERE guild_id = ?
    `).all(guildId).map(({ feature, channel_id }) => [feature, channel_id])
  );
}

function setGuildChannel(guildId, feature, channelId) {
  if (
    !validId(guildId) ||
    !CHANNEL_FEATURES.has(feature) ||
    !validId(channelId)
  ) {
    return false;
  }

  db.prepare(`
    INSERT INTO guild_channel_settings (guild_id, feature, channel_id)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, feature) DO UPDATE SET
      channel_id = excluded.channel_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(guildId, feature, channelId);

  return true;
}

function ensureColumn(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info("${table}")`)
    .all();

  if (!columns.some((item) => item.name === column)) {
    db.exec(
      `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`
    );
  }
}

function tableExists(table) {
  return Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      .get(table)
  );
}

function ensureTableColumn(table, column, definition) {
  if (tableExists(table)) {
    ensureColumn(table, column, definition);
  }
}

function runTransaction(callback) {
  return db.transaction(callback)();
}

// --------------------------------------------------
// SCHEMA
// --------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  berries INTEGER NOT NULL DEFAULT 0,
  lifetime_berries INTEGER NOT NULL DEFAULT 0,
  bounty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_daily TEXT,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  leaderboard_joined_at TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS crews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    abbreviation TEXT,
    description TEXT,
    captain_id TEXT,
    leader_id TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS crew_banners (
    guild_id TEXT NOT NULL,
    crew_id INTEGER NOT NULL,
    image_data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, crew_id),
    FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crew_members (
    crew_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (crew_id, user_id),
    UNIQUE (guild_id, user_id),
    FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crew_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crew_id INTEGER NOT NULL,
    inviter_id TEXT NOT NULL,
    invitee_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (crew_id, invitee_id),
    FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mission_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    reward INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, mission_id)
  );

  CREATE TABLE IF NOT EXISTS mission_definitions (
    mission_key TEXT PRIMARY KEY,
    message_goal INTEGER NOT NULL,
    reward INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mission_progress (
    user_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, mission_id)
  );

  CREATE TABLE IF NOT EXISTS guild_mission_definitions (
    guild_id TEXT NOT NULL,
    mission_key TEXT NOT NULL,
    message_goal INTEGER NOT NULL,
    reward INTEGER NOT NULL,
    PRIMARY KEY (guild_id, mission_key)
  );

  CREATE TABLE IF NOT EXISTS guild_mission_progress (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, mission_id)
  );

  CREATE TABLE IF NOT EXISTS guild_mission_claims (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    reward INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, user_id, mission_id)
  );

  CREATE TABLE IF NOT EXISTS guild_channel_settings (
    guild_id TEXT NOT NULL,
    feature TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, feature)
  );

  CREATE TABLE IF NOT EXISTS user_characters (
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    obtained_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    energy_level INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, character_id)
  );

  CREATE TABLE IF NOT EXISTS user_base_characters (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS character_chat_xp (
    user_id TEXT PRIMARY KEY,
    utc_date TEXT NOT NULL,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    last_awarded_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS daily_rewards (
    user_id TEXT PRIMARY KEY,
    last_claim TEXT,
    streak INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS battle_stats (
    user_id TEXT PRIMARY KEY,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    last_opponent_id TEXT,
    last_battle_at TEXT
  );

  CREATE TABLE IF NOT EXISTS bounty_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_items (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS reward_claims (
    reward_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS raids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    max_hp INTEGER NOT NULL,
    current_hp INTEGER NOT NULL,
    reward INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS raid_participants (
    raid_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    damage INTEGER NOT NULL DEFAULT 0,
    attacks INTEGER NOT NULL DEFAULT 0,
    last_attack_at INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (raid_id, user_id),
    FOREIGN KEY (raid_id) REFERENCES raids(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS raid_player_state (
    raid_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    energy INTEGER NOT NULL DEFAULT 100,
    cooldown_until INTEGER,
    PRIMARY KEY (raid_id, user_id),
    FOREIGN KEY (raid_id) REFERENCES raids(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crew_wars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    crew_one_id INTEGER NOT NULL,
    crew_two_id INTEGER NOT NULL,
    score_one INTEGER NOT NULL DEFAULT 0,
    score_two INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    winner_crew_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS crew_war_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    war_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    crew_id INTEGER NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (war_id, user_id),
    FOREIGN KEY (war_id) REFERENCES crew_wars(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crew_war_matches (
    match_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    war_id INTEGER NOT NULL,
    player_one_id TEXT NOT NULL,
    crew_one_id INTEGER NOT NULL,
    player_two_id TEXT NOT NULL,
    crew_two_id INTEGER NOT NULL,
    winner_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    FOREIGN KEY (war_id) REFERENCES crew_wars(id) ON DELETE CASCADE
  );
`);

// --------------------------------------------------
// TRIVIA TABLES
// --------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS trivia_settings (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trivia_activity (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    last_message_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trivia_rounds (
    round_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    winner_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at INTEGER NOT NULL,
    closed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS trivia_answers (
    guild_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    selected_index INTEGER NOT NULL,
    is_correct INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0,
    answered_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, round_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS trivia_stats (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    participations INTEGER NOT NULL DEFAULT 0,
    berries_earned INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_trivia_stats_leaderboard
    ON trivia_stats(guild_id, wins DESC, correct_answers DESC);
`);

db.exec(`
  INSERT OR IGNORE INTO guild_channel_settings (guild_id, feature, channel_id)
  SELECT guild_id, 'trivia', channel_id
  FROM trivia_settings;
`);

// Add columns safely for existing trivia installations.
const triviaRoundColumns = db
  .prepare("PRAGMA table_info(trivia_rounds)")
  .all()
  .map(column => column.name);

if (!triviaRoundColumns.includes("message_id")) {
  db.exec("ALTER TABLE trivia_rounds ADD COLUMN message_id TEXT");
}

// --------------------------------------------------
// MIGRATIONS
// --------------------------------------------------

const migrations = [
  ["users", "berries", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "bounty", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "created_at", "TEXT"],
  ["users", "lifetime_berries", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "last_daily", "TEXT"],
  ["users", "daily_streak", "INTEGER NOT NULL DEFAULT 0"],
  ["users", "leaderboard_joined_at", "TEXT"],

  ["transactions", "user_id", "TEXT"],
  ["transactions", "amount", "INTEGER NOT NULL DEFAULT 0"],
  ["transactions", "type", "TEXT"],
  ["transactions", "description", "TEXT"],
  ["transactions", "created_at", "TEXT"],

  ["crews", "name", "TEXT"],
  ["crews", "guild_id", "TEXT"],
  ["crews", "abbreviation", "TEXT"],
  ["crews", "description", "TEXT"],
  ["crews", "captain_id", "TEXT"],
  ["crews", "leader_id", "TEXT"],
  ["crews", "points", "INTEGER NOT NULL DEFAULT 0"],
  ["crews", "created_at", "TEXT"],

  ["crew_members", "crew_id", "INTEGER"],
  ["crew_members", "guild_id", "TEXT"],
  ["crew_members", "user_id", "TEXT"],
  ["crew_members", "role", "TEXT NOT NULL DEFAULT 'member'"],
  ["crew_members", "joined_at", "TEXT"],

  ["crew_invites", "inviter_id", "TEXT"],
  ["crew_invites", "invitee_id", "TEXT"],
  ["crew_invites", "invited_by", "TEXT"],
  ["crew_invites", "invited_user_id", "TEXT"],
  ["crew_wars", "guild_id", "TEXT"],

  ["mission_claims", "user_id", "TEXT"],
  ["mission_claims", "mission_id", "TEXT"],
  ["mission_claims", "reward", "INTEGER NOT NULL DEFAULT 0"],
  ["mission_claims", "created_at", "TEXT"],

  ["user_characters", "obtained_at", "TEXT"],
  ["user_characters", "level", "INTEGER NOT NULL DEFAULT 1"],
  ["user_characters", "xp", "INTEGER NOT NULL DEFAULT 0"],
  ["user_characters", "energy_level", "INTEGER NOT NULL DEFAULT 0"],
  ["daily_rewards", "last_claim", "TEXT"],

  ["daily_rewards", "streak", "INTEGER NOT NULL DEFAULT 0"],

  ["battle_stats", "wins", "INTEGER NOT NULL DEFAULT 0"],
  ["battle_stats", "losses", "INTEGER NOT NULL DEFAULT 0"],
  ["battle_stats", "draws", "INTEGER NOT NULL DEFAULT 0"],
  ["battle_stats", "last_opponent_id", "TEXT"],
  ["battle_stats", "last_battle_at", "TEXT"],

  ["bounty_history", "amount", "INTEGER NOT NULL DEFAULT 0"],
  ["bounty_history", "reason", "TEXT"],
  ["bounty_history", "created_at", "TEXT"],

  ["raids", "max_hp", "INTEGER NOT NULL DEFAULT 1"],
  ["raids", "current_hp", "INTEGER NOT NULL DEFAULT 1"],
  ["raids", "reward", "INTEGER NOT NULL DEFAULT 0"],
  ["raids", "status", "TEXT NOT NULL DEFAULT 'active'"],
  ["raids", "created_by", "TEXT"],
  ["raids", "created_at", "TEXT"],
  ["raids", "ended_at", "TEXT"],
  ["raids", "guild_id", "TEXT"],

  ["raid_participants", "damage", "INTEGER NOT NULL DEFAULT 0"],
  ["raid_participants", "attacks", "INTEGER NOT NULL DEFAULT 0"],
  ["raid_participants", "last_attack_at", "INTEGER NOT NULL DEFAULT 0"],
  ["raid_participants", "reward", "INTEGER NOT NULL DEFAULT 0"],

  ["crew_wars", "score_one", "INTEGER NOT NULL DEFAULT 0"],
  ["crew_wars", "score_two", "INTEGER NOT NULL DEFAULT 0"],
  ["crew_wars", "status", "TEXT NOT NULL DEFAULT 'active'"],
  ["crew_wars", "winner_crew_id", "INTEGER"],
  ["crew_wars", "challenged_by", "TEXT"],
  ["crew_wars", "ended_at", "TEXT"],
  ["crew_war_matches", "guild_id", "TEXT"],

  ["crew_war_contributions", "points", "INTEGER NOT NULL DEFAULT 0"],
  ["crew_war_contributions", "created_at", "TEXT"],
];

for (const [table, column, definition] of migrations) {
  ensureTableColumn(table, column, definition);
}

db.exec(`
  UPDATE crews
  SET captain_id = leader_id
  WHERE captain_id IS NULL AND leader_id IS NOT NULL;

  UPDATE crews
  SET leader_id = captain_id
  WHERE leader_id IS NULL AND captain_id IS NOT NULL;
`);

function getIndexColumns(table, indexName) {
  return db.prepare(`PRAGMA index_info("${indexName}")`)
    .all()
    .map(column => column.name);
}

function hasGlobalUniqueIndex(table, column) {
  return db.prepare(`PRAGMA index_list("${table}")`)
    .all()
    .some(index =>
      index.unique &&
      JSON.stringify(getIndexColumns(table, index.name)) === JSON.stringify([column])
    );
}

function migrateCrewTablesToGuildScope() {
  const needsRebuild =
    hasGlobalUniqueIndex("crews", "name") ||
    hasGlobalUniqueIndex("crew_members", "user_id");

  if (!needsRebuild) return;

  const configuredGuildId = process.env.GUILD_ID?.trim();
  const legacyGuildId =
    configuredGuildId && /^\d+$/.test(configuredGuildId)
      ? configuredGuildId
      : "legacy-unassigned";

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE crews_scoped (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE,
          abbreviation TEXT,
          description TEXT,
          captain_id TEXT,
          leader_id TEXT NOT NULL,
          points INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (guild_id, name)
        );

        CREATE TABLE crew_members_scoped (
          crew_id INTEGER NOT NULL,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (crew_id, user_id),
          UNIQUE (guild_id, user_id),
          FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
        );
      `);
      db.prepare(`
        INSERT INTO crews_scoped (
          id, guild_id, name, abbreviation, description, captain_id,
          leader_id, points, created_at
        )
        SELECT id, COALESCE(NULLIF(guild_id, ''), ?), name, abbreviation,
               description, captain_id, leader_id, points,
               COALESCE(created_at, CURRENT_TIMESTAMP)
        FROM crews
      `).run(legacyGuildId);
      db.exec(`
        INSERT INTO crew_members_scoped (crew_id, guild_id, user_id, role, joined_at)
        SELECT cm.crew_id, c.guild_id, cm.user_id, cm.role,
               COALESCE(cm.joined_at, CURRENT_TIMESTAMP)
        FROM crew_members cm
        JOIN crews_scoped c ON c.id = cm.crew_id;
      `);
      db.exec(`
        DROP TABLE crew_members;
        DROP TABLE crews;
        ALTER TABLE crews_scoped RENAME TO crews;
        ALTER TABLE crew_members_scoped RENAME TO crew_members;
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

migrateCrewTablesToGuildScope();

const configuredGuildId = process.env.GUILD_ID?.trim();
const legacyGuildId =
  configuredGuildId && /^\d+$/.test(configuredGuildId)
    ? configuredGuildId
    : "legacy-unassigned";

db.prepare(`
  UPDATE crews
  SET guild_id = ?
  WHERE guild_id IS NULL OR guild_id = ''
`).run(legacyGuildId);

db.exec(`
  UPDATE crew_members
  SET guild_id = (
    SELECT guild_id FROM crews WHERE crews.id = crew_members.crew_id
  )
  WHERE guild_id IS NULL OR guild_id = '';

  UPDATE crew_invites
  SET inviter_id = COALESCE(inviter_id, invited_by),
      invitee_id = COALESCE(invitee_id, invited_user_id),
      invited_by = COALESCE(invited_by, inviter_id),
      invited_user_id = COALESCE(invited_user_id, invitee_id);
`);
db.prepare(`
  UPDATE crew_wars
  SET guild_id = ?
  WHERE guild_id IS NULL OR guild_id = ''
`).run(legacyGuildId);
db.prepare(`
  UPDATE crew_war_matches
  SET guild_id = (
    SELECT guild_id FROM crew_wars WHERE crew_wars.id = crew_war_matches.war_id
  )
  WHERE guild_id IS NULL OR guild_id = ''
`).run();

const defaultMissions = [
  ["message-1", 3, 150],
  ["message-2", 5, 250],
  ["message-3", 8, 400],
];

const insertMissionDefinition = db.prepare(`
  INSERT OR IGNORE INTO mission_definitions
    (mission_key, message_goal, reward)
  VALUES (?, ?, ?)
`);

for (const mission of defaultMissions) {
  insertMissionDefinition.run(...mission);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_user
    ON transactions(user_id, id DESC);

  CREATE INDEX IF NOT EXISTS idx_bounty_history_user
    ON bounty_history(user_id, id DESC);

  CREATE INDEX IF NOT EXISTS idx_crew_members_user
    ON crew_members(guild_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_raids_guild_status
  ON raids(guild_id, status);  

  CREATE INDEX IF NOT EXISTS idx_mission_claims_user
    ON mission_claims(user_id);

  CREATE INDEX IF NOT EXISTS idx_raid_participants_raid
    ON raid_participants(raid_id);

  CREATE INDEX IF NOT EXISTS idx_crew_wars_status
    ON crew_wars(guild_id, status);

  CREATE INDEX IF NOT EXISTS idx_crew_war_matches_war
    ON crew_war_matches(war_id, status);
`);

db.prepare(`
  UPDATE crew_war_matches
  SET status = 'cancelled',
      ended_at = CURRENT_TIMESTAMP
  WHERE status = 'active'
`).run();

// --------------------------------------------------
// USERS
// --------------------------------------------------

const STARTER_CHARACTER_IDS = ["luffy", "zoro", "nami"];

function ensureUser(userId) {
  if (!validId(userId)) {
    throw new Error("Invalid user ID.");
  }

  const operation = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO users (user_id)
      VALUES (?)
    `).run(userId);

    db.prepare(`
      INSERT OR IGNORE INTO battle_stats (user_id)
      VALUES (?)
    `).run(userId);

    db.prepare(`
      INSERT OR IGNORE INTO daily_rewards (user_id)
      VALUES (?)
    `).run(userId);

    const addStarter = db.prepare(`
      INSERT OR IGNORE INTO user_characters (user_id, character_id)
      VALUES (?, ?)
    `);

    for (const characterId of STARTER_CHARACTER_IDS) {
      addStarter.run(userId, characterId);
    }

    return db.prepare(`
      SELECT * FROM users WHERE user_id = ?
    `).get(userId);
  });

  return operation();
}

function startPirateJourney(userId) {
  if (!validId(userId)) {
    throw new Error("Invalid user ID.");
  }

  ensureUser(userId);
  db.prepare(`
    UPDATE users
    SET leaderboard_joined_at = COALESCE(leaderboard_joined_at, CURRENT_TIMESTAMP)
    WHERE user_id = ?
  `).run(userId);
}

function getUser(userId) {
  if (!validId(userId)) return null;

  return db.prepare(`
    SELECT * FROM users WHERE user_id = ?
  `).get(userId) || null;
}

function getBalance(userId) {
  return getBerries(userId);
}

function getBerries(userId) {
  if (!validId(userId)) return 0;

  const user = db.prepare(`
    SELECT berries FROM users WHERE user_id = ?
  `).get(userId);

  return user ? user.berries : 0;
}

// --------------------------------------------------
// BERRIES ECONOMY
// --------------------------------------------------


function addTransaction(userId, amount, type, description = "") {
  if (!validId(userId)) {
    throw new Error("Invalid user ID.");
  }

  if (!Number.isSafeInteger(amount)) {
    throw new Error("Transaction amount must be a safe integer.");
  }

  ensureUser(userId);

  // Support both legacy and current database schemas.
  const columns = db
    .prepare("PRAGMA table_info(transactions)")
    .all();

  const columnNames = new Set(
    columns.map((column) => column.name)
  );

  const fields = ["user_id", "amount", "type"];
  const values = [
    userId,
    amount,
    String(type),
  ];

  if (columnNames.has("reason")) {
    fields.push("reason");
    values.push(String(description));
  }

  if (columnNames.has("description")) {
    fields.push("description");
    values.push(String(description));
  }

  const placeholders = fields.map(() => "?").join(", ");

  return db.prepare(`
    INSERT INTO transactions (${fields.join(", ")})
    VALUES (${placeholders})
  `).run(...values);
}


function addBerries(userId, amount, reason = "Reward") {
  if (
    !validId(userId) ||
    !validAmount(amount) ||
    amount === 0
  ) {
    return false;
  }

  return db.transaction(() => {
    ensureUser(userId);

    const result = db.prepare(`
      UPDATE users
      SET berries = berries + ?,
          lifetime_berries = lifetime_berries + ?
      WHERE user_id = ?
        AND berries <= ?
        AND lifetime_berries <= ?
    `).run(
      amount,
      amount,
      userId,
      Number.MAX_SAFE_INTEGER - amount,
      Number.MAX_SAFE_INTEGER - amount
    );

    if (result.changes !== 1) {
      throw new Error(
        "Berries or lifetime Berries limit reached."
      );
    }

    addTransaction(userId, amount, "earn", reason);
    return true;
  })();
}

function spendBerries(userId, amount, reason = "Purchase") {
  if (!validId(userId) || !validAmount(amount) || amount === 0) {
    return false;
  }

  return db.transaction(() => {
    ensureUser(userId);

    const result = db.prepare(`
      UPDATE users
      SET berries = berries - ?
      WHERE user_id = ?
        AND berries >= ?
    `).run(amount, userId, amount);

    if (result.changes !== 1) return false;

    addTransaction(userId, -amount, "spend", reason);
    return true;
  })();
}

function transferBerries(fromUserId, toUserId, amount) {
  if (
    !validId(fromUserId) ||
    !validId(toUserId) ||
    fromUserId === toUserId ||
    !validAmount(amount) ||
    amount === 0
  ) {
    return false;
  }

  return db.transaction(() => {
    ensureUser(fromUserId);
    ensureUser(toUserId);

    const debit = db.prepare(`
      UPDATE users
      SET berries = berries - ?
      WHERE user_id = ?
        AND berries >= ?
    `).run(amount, fromUserId, amount);

    if (debit.changes !== 1) return false;

    const credit = db.prepare(`
      UPDATE users
      SET berries = berries + ?
      WHERE user_id = ?
        AND berries <= ?
    `).run(amount, toUserId, Number.MAX_SAFE_INTEGER - amount);

    if (credit.changes !== 1) {
      throw new Error("Recipient's balance limit reached.");
    }

    addTransaction(fromUserId, -amount, "transfer_out", `Transfer to ${toUserId}`);
    addTransaction(toUserId, amount, "transfer_in", `Transfer from ${fromUserId}`);

    return true;
  })();
}

function getTransactionHistory(userId, limit = 10) {
  if (!validId(userId)) return [];

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  return db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, safeLimit);
}

function getBerryLeaderboard(limit = 10, offset = 0) {
  const safeLimit = Math.max(
    1,
    Math.min(100, Math.floor(limit))
  );
  const safeOffset = Math.max(0, Math.floor(offset) || 0);

  return db.prepare(`
    SELECT user_id, lifetime_berries
    FROM users
    WHERE leaderboard_joined_at IS NOT NULL
    ORDER BY lifetime_berries DESC, user_id ASC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset);
}

function getTopBerryBalances(limit = 10) {
  return getBerryLeaderboard(limit);
}

// --------------------------------------------------
// DAILY REWARDS
// --------------------------------------------------

function getDailyStatus(userId) {
  if (!validId(userId)) return null;

  ensureUser(userId);

  const user = db.prepare(`
    SELECT last_claim, streak
    FROM daily_rewards
    WHERE user_id = ?
  `).get(userId);

  return {
    lastClaim: user.last_claim,
    streak: user.streak,
    claimedToday: user.last_claim === new Date().toISOString().slice(0, 10),
  };
}

function claimDailyReward(userId) {
  if (!validId(userId)) {
    return { success: false, message: "Invalid user." };
  }

  return db.transaction(() => {
    ensureUser(userId);

    const today = new Date().toISOString().slice(0, 10);
    const daily = db.prepare(`
      SELECT last_claim, streak
      FROM daily_rewards
      WHERE user_id = ?
    `).get(userId);

    if (daily.last_claim === today) {
      return {
        success: false,
        message: "You have already claimed your daily reward.",
        streak: daily.streak,
      };
    }

    const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const streak =
      daily.last_claim === yesterday
        ? Math.min(7, daily.streak + 1)
        : 1;

    const reward = 100 + (streak - 1) * 25;

    db.prepare(`
      UPDATE daily_rewards
      SET last_claim = ?, streak = ?
      WHERE user_id = ?
    `).run(today, streak, userId);

    db.prepare(`
      UPDATE users
      SET last_daily = ?, daily_streak = ?
      WHERE user_id = ?
    `).run(today, streak, userId);

    const updated = db.prepare(`
  UPDATE users
  SET berries = berries + ?,
      lifetime_berries = lifetime_berries + ?
  WHERE user_id = ?
    AND berries <= ?
    AND lifetime_berries <= ?
`).run(
  reward,
  reward,
  userId,
  Number.MAX_SAFE_INTEGER - reward,
  Number.MAX_SAFE_INTEGER - reward
);

    if (updated.changes !== 1) {
      throw new Error("Berries balance limit reached.");
    }

    addTransaction(userId, reward, "daily", `Daily reward, streak ${streak}`);

    return { success: true, reward, streak };
  })();
}

// --------------------------------------------------
// BOUNTY
// --------------------------------------------------

function getBounty(userId) {
  if (!validId(userId)) return 0;

  const row = db.prepare(`
    SELECT bounty FROM users WHERE user_id = ?
  `).get(userId);

  return row ? row.bounty : 0;
}

function increaseBounty(userId, amount, reason = "Bounty increased") {
  if (!validId(userId) || !validAmount(amount) || amount === 0) {
    return false;
  }

  return db.transaction(() => {
    ensureUser(userId);

    const result = db.prepare(`
      UPDATE users
      SET bounty = bounty + ?
      WHERE user_id = ?
        AND bounty <= ?
    `).run(amount, userId, Number.MAX_SAFE_INTEGER - amount);

    if (result.changes !== 1) {
      throw new Error("Bounty limit reached.");
    }

    db.prepare(`
      INSERT INTO bounty_history (user_id, amount, reason)
      VALUES (?, ?, ?)
    `).run(userId, amount, reason);

    return getBounty(userId);
  })();
}

function awardBounty(userId, amount, reason = "Bounty reward") {
  return increaseBounty(userId, amount, reason);
}

function getBountyHistory(userId, limit = 10) {
  if (!validId(userId)) return [];

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  return db.prepare(`
    SELECT * FROM bounty_history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, safeLimit);
}

function getTopBounties(limit = 10, offset = 0) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);

  return db.prepare(`
    SELECT user_id, bounty
    FROM users
    WHERE leaderboard_joined_at IS NOT NULL
    ORDER BY bounty DESC, user_id ASC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset);
}

// --------------------------------------------------
// IDEMPOTENT REWARD CLAIMS
// --------------------------------------------------

function claimUniqueReward(rewardKey, userId, amount, description = "Reward") {
  if (
    typeof rewardKey !== "string" ||
    !rewardKey.trim() ||
    !validId(userId) ||
    !validAmount(amount)
  ) {
    return false;
  }

  return db.transaction(() => {
    ensureUser(userId);

    const claim = db.prepare(`
      INSERT OR IGNORE INTO reward_claims (reward_key, user_id, amount)
      VALUES (?, ?, ?)
    `).run(rewardKey, userId, amount);

    if (claim.changes !== 1) return false;

    
    if (amount > 0) {
      const credit = db.prepare(`
  UPDATE users
  SET berries = berries + ?,
      lifetime_berries = lifetime_berries + ?
  WHERE user_id = ?
    AND berries <= ?
    AND lifetime_berries <= ?
`).run(
  amount,
  amount,
  userId,
  Number.MAX_SAFE_INTEGER - amount,
  Number.MAX_SAFE_INTEGER - amount
);

      if (credit.changes !== 1) {
        throw new Error("Berries balance limit reached.");
      }

      addTransaction(userId, amount, "reward", description);
    }

    return true;
  })();
}

// --------------------------------------------------
// CHARACTERS
// --------------------------------------------------

function ownsCharacter(userId, characterId) {
  if (!validId(userId) || !validId(characterId)) return false;

  return Boolean(db.prepare(`
    SELECT 1
    FROM user_characters
    WHERE user_id = ? AND character_id = ?
  `).get(userId, characterId));
}

function getOwnedCharacters(userId) {
  if (!validId(userId)) return [];

  ensureUser(userId);

  return db.prepare(`
    SELECT character_id, obtained_at, level, xp, energy_level
    FROM user_characters
    WHERE user_id = ?
    ORDER BY obtained_at ASC
  `).all(userId);
}

function getCharacterProgress(userId, characterId) {
  if (!validId(userId) || !validId(characterId)) return null;

  ensureUser(userId);
  return db.prepare(`
    SELECT character_id, level, xp, energy_level
    FROM user_characters
    WHERE user_id = ? AND character_id = ?
  `).get(userId, characterId) || null;
}

function getBaseCharacter(userId, guildId) {
  if (!validId(userId) || !validId(guildId)) return null;

  ensureUser(userId);
  const saved = db.prepare(`
    SELECT character_id
    FROM user_base_characters
    WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);

  if (saved && ownsCharacter(userId, saved.character_id)) {
    return getCharacterProgress(userId, saved.character_id);
  }

  const firstOwned = getOwnedCharacters(userId)[0];
  if (!firstOwned) return null;

  setBaseCharacter(userId, guildId, firstOwned.character_id);
  return getCharacterProgress(userId, firstOwned.character_id);
}

function setBaseCharacter(userId, guildId, characterId) {
  if (
    !validId(userId) ||
    !validId(guildId) ||
    !validId(characterId) ||
    !ownsCharacter(userId, characterId)
  ) {
    return { success: false, message: "Choose a character you own." };
  }

  db.prepare(`
    INSERT INTO user_base_characters (guild_id, user_id, character_id)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      character_id = excluded.character_id
  `).run(guildId, userId, characterId);

  return { success: true, characterId };
}

function grantCharacterXp(userId, characterId, amount) {
  if (
    !validId(userId) ||
    !validId(characterId) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return { success: false, message: "Invalid character XP award." };
  }

  return db.transaction(() => {
    ensureUser(userId);
    const current = getCharacterProgress(userId, characterId);
    if (!current) {
      return { success: false, message: "You don't own that character." };
    }

    if (current.level >= MAX_CHARACTER_LEVEL) {
      return {
        success: true,
        characterId,
        level: MAX_CHARACTER_LEVEL,
        xp: 0,
        xpToNextLevel: 0,
        levelsGained: 0,
        awarded: 0
      };
    }

    let level = current.level;
    let xp = current.xp + amount;
    const startingLevel = level;

    while (level < MAX_CHARACTER_LEVEL && xp >= level * 100) {
      xp -= level * 100;
      level += 1;
    }

    if (level === MAX_CHARACTER_LEVEL) xp = 0;

    db.prepare(`
      UPDATE user_characters
      SET level = ?, xp = ?
      WHERE user_id = ? AND character_id = ?
    `).run(level, xp, userId, characterId);

    return {
      success: true,
      characterId,
      level,
      xp,
      xpToNextLevel:
        level < MAX_CHARACTER_LEVEL ? level * 100 : 0,
      levelsGained: level - startingLevel,
      awarded: amount
    };
  })();
}

function grantBaseCharacterChatXp(userId, guildId, now = Date.now()) {
  if (
    !validId(userId) ||
    !validId(guildId) ||
    !Number.isSafeInteger(now)
  ) {
    return { success: false, message: "Invalid chat XP award." };
  }

  return db.transaction(() => {
    ensureUser(userId);
    if (getOwnedCharacters(userId).length === 0) {
      grantStarterCharacters(userId);
    }

    const base = getBaseCharacter(userId, guildId);
    if (!base) return { success: false, message: "No base character is selected." };

    const utcDate = new Date(now).toISOString().slice(0, 10);
    const daily = db.prepare(`
      SELECT utc_date, xp_awarded, last_awarded_at
      FROM character_chat_xp
      WHERE user_id = ?
    `).get(userId);

    if (
      daily &&
      daily.utc_date === utcDate &&
      now - daily.last_awarded_at < 60_000
    ) {
      return { success: true, awarded: 0, characterId: base.character_id };
    }

    const awardedToday = daily?.utc_date === utcDate ? daily.xp_awarded : 0;
    const amount = Math.min(5, Math.max(0, 100 - awardedToday));
    if (amount === 0) {
      return { success: true, awarded: 0, characterId: base.character_id };
    }

    const result = grantCharacterXp(userId, base.character_id, amount);
    if (!result.success) return result;
    if (result.awarded === 0) return result;

    db.prepare(`
      INSERT INTO character_chat_xp (user_id, utc_date, xp_awarded, last_awarded_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        utc_date = excluded.utc_date,
        xp_awarded = CASE
          WHEN character_chat_xp.utc_date = excluded.utc_date
            THEN character_chat_xp.xp_awarded + excluded.xp_awarded
          ELSE excluded.xp_awarded
        END,
        last_awarded_at = excluded.last_awarded_at
    `).run(userId, utcDate, amount, now);

    return { ...result, awarded: amount };
  })();
}

function upgradeCharacterEnergy(userId, characterId) {
  if (!validId(userId) || !validId(characterId)) {
    return { success: false, message: "Choose a character you own." };
  }

  return db.transaction(() => {
    ensureUser(userId);
    const current = getCharacterProgress(userId, characterId);
    if (!current) {
      return { success: false, message: "You don't own that character." };
    }
    if (current.energy_level >= 10) {
      return { success: false, message: "This character's raid energy is fully upgraded." };
    }

    const price = (current.energy_level + 1) * 1000;
    const debit = db.prepare(`
      UPDATE users
      SET berries = berries - ?
      WHERE user_id = ? AND berries >= ?
    `).run(price, userId, price);
    if (debit.changes !== 1) {
      return {
        success: false,
        message: `You need ${price.toLocaleString("en-US")} Berries for this upgrade.`
      };
    }

    const nextLevel = current.energy_level + 1;
    db.prepare(`
      UPDATE user_characters
      SET energy_level = ?
      WHERE user_id = ? AND character_id = ?
    `).run(nextLevel, userId, characterId);
    addTransaction(
      userId,
      -price,
      "upgrade",
      `Raid energy: ${characterId} (level ${nextLevel})`
    );

    return {
      success: true,
      characterId,
      energyLevel: nextLevel,
      maxEnergy: 100 + nextLevel * 10,
      price
    };
  }).immediate();
}

function grantStarterCharacters(userId) {
  if (!validId(userId)) return false;

  ensureUser(userId);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_characters (user_id, character_id)
    VALUES (?, ?)
  `);

  return db.transaction(() => {
    for (const characterId of STARTER_CHARACTER_IDS) {
      insert.run(userId, characterId);
    }
    return true;
  })();
}

function purchaseCharacter(userId, characterId, price) {
  if (
    !validId(userId) ||
    !validId(characterId) ||
    !validAmount(price)
  ) {
    return { success: false, message: "Invalid purchase." };
  }

  return db.transaction(() => {
    ensureUser(userId);

    if (ownsCharacter(userId, characterId)) {
      return {
        success: false,
        message: "You already own this character.",
      };
    }

    const debit = db.prepare(`
      UPDATE users
      SET berries = berries - ?
      WHERE user_id = ?
        AND berries >= ?
    `).run(price, userId, price);

    if (debit.changes !== 1) {
      return {
        success: false,
        message: "You don't have enough Berries.",
      };
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO user_characters (user_id, character_id)
      VALUES (?, ?)
    `).run(userId, characterId);

    if (insert.changes !== 1) {
      throw new Error("Character ownership changed during purchase.");
    }

    addTransaction(userId, -price, "purchase", `Character: ${characterId}`);

    return { success: true, characterId, price };
  })();
}

// --------------------------------------------------
// ACHIEVEMENTS
// --------------------------------------------------

function unlockAchievement(userId, achievementId) {
  if (!validId(userId) || !validId(achievementId)) {
    return { success: false, achievementId };
  }

  ensureUser(userId);

  const result = db.prepare(`
    INSERT OR IGNORE INTO achievements (user_id, achievement_id)
    VALUES (?, ?)
  `).run(userId, achievementId);

  return {
    success: result.changes === 1,
    achievementId,
  };
}

function getAchievements(userId) {
  if (!validId(userId)) return [];

  return db.prepare(`
    SELECT achievement_id, unlocked_at
    FROM achievements
    WHERE user_id = ?
    ORDER BY unlocked_at ASC
  `).all(userId);
}

// --------------------------------------------------
// BATTLE STATS AND RESULTS
// --------------------------------------------------

function getBattleStats(userId) {
  if (!validId(userId)) return null;

  ensureUser(userId);

  return db.prepare(`
    SELECT wins, losses, draws, last_opponent_id, last_battle_at
    FROM battle_stats
    WHERE user_id = ?
  `).get(userId);
}

function recordBattleResult(first, second, third = {}) {
  let winnerId;
  let loserId;
  let battleKey;

  if (third && typeof third === "object" && !Array.isArray(third)) {
    winnerId = first;
    loserId = second;
    battleKey =
      third.idempotencyKey ||
      third.battleId ||
      `${winnerId}:${loserId}:${Date.now()}`;
  } else {
    battleKey = first;
    winnerId = second;
    loserId = third;
  }

  if (
    !validId(winnerId) ||
    !validId(loserId) ||
    winnerId === loserId ||
    !validId(String(battleKey))
  ) {
    return { success: false, message: "Invalid battle result." };
  }

  return db.transaction(() => {
    ensureUser(winnerId);
    ensureUser(loserId);

    const claimed = db.prepare(`
      INSERT OR IGNORE INTO reward_claims (reward_key, user_id, amount)
      VALUES (?, ?, ?)
    `).run(`battle:${battleKey}`, winnerId, 100);

    if (claimed.changes !== 1) {
      return {
        success: false,
        duplicate: true,
        message: "This battle has already been recorded.",
        newBounty: getBounty(winnerId),
      };
    }

    const credit = db.prepare(`
  UPDATE users
  SET berries = berries + 100,
      lifetime_berries = lifetime_berries + 100
  WHERE user_id = ?
    AND berries <= ?
    AND lifetime_berries <= ?
`).run(
  winnerId,
  Number.MAX_SAFE_INTEGER - 100,
  Number.MAX_SAFE_INTEGER - 100
);

    if (credit.changes !== 1) {
      throw new Error("Winner's Berries balance limit reached.");
    }

    addTransaction(winnerId, 100, "battle", "Battle victory reward");

    const previous = getBattleStats(winnerId);
    const nextWins = previous.wins + 1;

    db.prepare(`
      UPDATE battle_stats
      SET wins = wins + 1,
          last_opponent_id = ?,
          last_battle_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(loserId, winnerId);

    db.prepare(`
      UPDATE battle_stats
      SET losses = losses + 1,
          last_opponent_id = ?,
          last_battle_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(winnerId, loserId);

    const bountyAmount = 1000;

    const bountyUpdate = db.prepare(`
      UPDATE users
      SET bounty = bounty + ?
      WHERE user_id = ?
        AND bounty <= ?
    `).run(bountyAmount, winnerId, Number.MAX_SAFE_INTEGER - bountyAmount);

    if (bountyUpdate.changes !== 1) {
      throw new Error("Winner's bounty limit reached.");
    }

    db.prepare(`
      INSERT INTO bounty_history (user_id, amount, reason)
      VALUES (?, ?, ?)
    `).run(winnerId, bountyAmount, "Battle victory");

    const milestones = [];

    if (nextWins === 1) {
      unlockAchievement(winnerId, "first_victory");
    }

    if (nextWins === 5) {
      increaseBounty(winnerId, 2500, "Five battle wins milestone");

      const bonus = 500;
      const bonusCredit = db.prepare(`
  UPDATE users
  SET berries = berries + ?,
      lifetime_berries = lifetime_berries + ?
  WHERE user_id = ?
    AND berries <= ?
    AND lifetime_berries <= ?
`).run(
  bonus,
  bonus,
  winnerId,
  Number.MAX_SAFE_INTEGER - bonus,
  Number.MAX_SAFE_INTEGER - bonus
);

      if (bonusCredit.changes !== 1) {
        throw new Error("Milestone reward exceeds the balance limit.");
      }

      addTransaction(winnerId, bonus, "milestone", "Five battle wins");
      unlockAchievement(winnerId, "battle_wins_5");

      milestones.push({ wins: 5, bounty: 2500, berries: 500 });
    }

    if (nextWins === 10) {
      increaseBounty(winnerId, 5000, "Ten battle wins milestone");

      const bonus = 1000;
      const bonusCredit = db.prepare(`
  UPDATE users
  SET berries = berries + ?,
      lifetime_berries = lifetime_berries + ?
  WHERE user_id = ?
    AND berries <= ?
    AND lifetime_berries <= ?
`).run(
  bonus,
  bonus,
  winnerId,
  Number.MAX_SAFE_INTEGER - bonus,
  Number.MAX_SAFE_INTEGER - bonus
);

      if (bonusCredit.changes !== 1) {
        throw new Error("Milestone reward exceeds the balance limit.");
      }

      addTransaction(winnerId, bonus, "milestone", "Ten battle wins");
      unlockAchievement(winnerId, "battle_wins_10");

      milestones.push({ wins: 10, bounty: 5000, berries: 1000 });
    }

    return {
      success: true,
      rewarded: true,
      berries: 100,
      bounty: bountyAmount,
      newBounty: getBounty(winnerId),
      firstWin: nextWins === 1,
      milestones,
      winnerStats: getBattleStats(winnerId),
    };
  })();
}

function recordBattleDraw(userIdOne, userIdTwo, options = {}) {
  if (
    !validId(userIdOne) ||
    !validId(userIdTwo) ||
    userIdOne === userIdTwo
  ) {
    return { success: false, message: "Invalid battle draw." };
  }

  const key =
    options.idempotencyKey ||
    options.battleId ||
    `${userIdOne}:${userIdTwo}:${Date.now()}`;

  if (!validId(String(key))) {
    return { success: false, message: "Invalid draw key." };
  }

  return db.transaction(() => {
    ensureUser(userIdOne);
    ensureUser(userIdTwo);

    const claim = db.prepare(`
      INSERT OR IGNORE INTO reward_claims (reward_key, user_id, amount)
      VALUES (?, ?, 0)
    `).run(`battle-draw:${key}`, userIdOne);

    if (claim.changes !== 1) {
      return { success: false, duplicate: true };
    }

    db.prepare(`
      UPDATE battle_stats
      SET draws = draws + 1,
          last_opponent_id = ?,
          last_battle_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userIdTwo, userIdOne);

    db.prepare(`
      UPDATE battle_stats
      SET draws = draws + 1,
          last_opponent_id = ?,
          last_battle_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userIdOne, userIdTwo);

    return { success: true };
  })();
}

// --------------------------------------------------
// CREWS
// --------------------------------------------------

function getCrewForUser(guildId, userId) {
  if (!validId(guildId) || !validId(userId)) return null;

  const crew = db.prepare(`
    SELECT c.*, cm.role, cm.joined_at
    FROM crew_members cm
    JOIN crews c ON c.id = cm.crew_id
      AND c.guild_id = cm.guild_id
    WHERE cm.guild_id = ? AND cm.user_id = ?
  `).get(guildId, userId) || null;

  if (!crew) return null;

  return {
    ...crew,
    captain_id: crew.captain_id || crew.leader_id,
    leader_id: crew.leader_id || crew.captain_id,
    role: crew.role === "leader" ? "captain" : crew.role,
  };
}

function getCrewByName(guildId, name) {
  if (!validId(guildId) || typeof name !== "string" || !name.trim()) return null;

  return db.prepare(`
    SELECT * FROM crews
    WHERE guild_id = ?
      AND (name = ? COLLATE NOCASE OR abbreviation = ? COLLATE NOCASE)
  `).get(guildId, name.trim(), name.trim()) || null;
}

function getCrewBanner(guildId, crewId) {
  const id = Number(crewId);
  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0) return null;

  return db.prepare(`
    SELECT image_data, updated_at
    FROM crew_banners
    WHERE guild_id = ? AND crew_id = ?
  `).get(guildId, id) || null;
}

function setCrewBanner(guildId, crewId, imageData) {
  const id = Number(crewId);
  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Buffer.isBuffer(imageData) ||
    imageData.length === 0 ||
    imageData.length > 8 * 1024 * 1024
  ) {
    return { success: false, message: "Invalid crew banner image." };
  }

  const crewExists = db.prepare(`
    SELECT 1 FROM crews WHERE id = ? AND guild_id = ?
  `).get(id, guildId);
  if (!crewExists) {
    return { success: false, message: "Crew not found." };
  }

  db.prepare(`
    INSERT INTO crew_banners (guild_id, crew_id, image_data)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, crew_id) DO UPDATE SET
      image_data = excluded.image_data,
      updated_at = CURRENT_TIMESTAMP
  `).run(guildId, id, imageData);
  return { success: true };
}

function deleteCrewBanner(guildId, crewId) {
  const id = Number(crewId);
  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0) {
    return false;
  }

  return db.prepare(`
    DELETE FROM crew_banners WHERE guild_id = ? AND crew_id = ?
  `).run(guildId, id).changes > 0;
}

function updateCrewDetails(guildId, crewId, changes) {
  const id = Number(crewId);
  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !changes ||
    typeof changes !== "object"
  ) {
    return { success: false, message: "Invalid crew details." };
  }

  const allowedFields = ["name", "abbreviation", "description"];
  const fields = allowedFields.filter(field =>
    Object.prototype.hasOwnProperty.call(changes, field)
  );
  if (fields.length === 0) {
    return { success: false, message: "Choose at least one crew detail to update." };
  }

  const normalized = {};
  for (const field of fields) {
    const value = typeof changes[field] === "string" ? changes[field].trim() : "";
    if (field === "name" && (value.length < 3 || value.length > 40)) {
      return { success: false, message: "Crew names must be 3–40 characters long." };
    }
    if (field === "abbreviation" && (value.length < 2 || value.length > 6)) {
      return { success: false, message: "Crew tags must be 2–6 characters long." };
    }
    if (field === "description" && value.length > 200) {
      return { success: false, message: "Crew descriptions can't exceed 200 characters." };
    }
    normalized[field] = field === "abbreviation" ? value.toUpperCase() : value;
  }

  return db.transaction(() => {
    const crew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(id, guildId);
    if (!crew) return { success: false, message: "Crew not found." };

    const nextName = normalized.name ?? crew.name;
    const nextAbbreviation = normalized.abbreviation ?? crew.abbreviation;
    const duplicate = db.prepare(`
      SELECT 1 FROM crews
      WHERE guild_id = ? AND id != ?
        AND (
          name = ? COLLATE NOCASE OR
          abbreviation = ? COLLATE NOCASE OR
          name = ? COLLATE NOCASE OR
          abbreviation = ? COLLATE NOCASE
        )
      LIMIT 1
    `).get(
      guildId,
      id,
      nextName,
      nextName,
      nextAbbreviation,
      nextAbbreviation
    );
    if (duplicate) {
      return {
        success: false,
        message: "That crew name or tag is already used by another crew."
      };
    }

    const assignments = fields.map(field => `${field} = @${field}`).join(", ");
    const params = { id, guildId, ...normalized };
    db.prepare(`
      UPDATE crews SET ${assignments}
      WHERE id = @id AND guild_id = @guildId
    `).run(params);

    return {
      success: true,
      crew: db.prepare(`
        SELECT * FROM crews WHERE id = ? AND guild_id = ?
      `).get(id, guildId),
      previous: crew,
      changedFields: fields
    };
  })();
}

function getAllCrews(guildId) {
  if (!validId(guildId)) return [];

  return db.prepare(`
    SELECT * FROM crews
    WHERE guild_id = ?
    ORDER BY name COLLATE NOCASE ASC
  `).all(guildId);
}

function getCrewMembers(guildId, crewId) {
  const id = Number(crewId);
  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0) return [];

  return db.prepare(`
    SELECT cm.user_id, cm.role, cm.joined_at
    FROM crew_members cm
    WHERE cm.guild_id = ? AND cm.crew_id = ?
    ORDER BY
      CASE cm.role
        WHEN 'leader' THEN 0
        WHEN 'captain' THEN 0
        WHEN 'officer' THEN 1
        ELSE 2
      END,
      cm.joined_at ASC
  `).all(guildId, id).map(member => ({
    ...member,
    role: member.role === "leader" ? "captain" : member.role,
  }));
}

function createCrew(guildId, name, leaderId) {
  if (
    !validId(guildId) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 50 ||
    !validId(leaderId)
  ) {
    return { success: false, message: "Invalid crew details." };
  }

  return db.transaction(() => {
    ensureUser(leaderId);

    if (getCrewForUser(guildId, leaderId)) {
      return { success: false, message: "You are already in a crew." };
    }

    if (getCrewByName(guildId, name.trim())) {
      return {
        success: false,
        message: "A crew with that name already exists.",
      };
    }

    const result = db.prepare(`
      INSERT INTO crews (guild_id, name, leader_id, captain_id)
      VALUES (?, ?, ?, ?)
    `).run(guildId, name.trim(), leaderId, leaderId);

    const crewId = Number(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO crew_members (crew_id, guild_id, user_id, role)
      VALUES (?, ?, ?, 'leader')
    `).run(crewId, guildId, leaderId);

    return {
      success: true,
      crew: db.prepare("SELECT * FROM crews WHERE id = ? AND guild_id = ?")
        .get(crewId, guildId),
    };
  })();
}

function joinCrew(guildId, crewId, userId) {
  const id = Number(crewId);

  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0 || !validId(userId)) {
    return { success: false, message: "Invalid crew details." };
  }

  return db.transaction(() => {
    ensureUser(userId);

    const crew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(id, guildId);

    if (!crew) return { success: false, message: "Crew not found." };

    if (getCrewForUser(guildId, userId)) {
      return { success: false, message: "You are already in a crew." };
    }

    db.prepare(`
      INSERT INTO crew_members (crew_id, guild_id, user_id, role)
      VALUES (?, ?, ?, 'member')
    `).run(id, guildId, userId);

    db.prepare(`
      DELETE FROM crew_invites
      WHERE crew_id = ?
        AND (invitee_id = ? OR invited_user_id = ?)
        AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
    `).run(id, userId, userId, guildId);

    return { success: true, crew };
  })();
}

function leaveCrew(guildId, userId) {
  if (!validId(guildId) || !validId(userId)) return false;

  return db.transaction(() => {
    const membership = db.prepare(`
      SELECT cm.crew_id, cm.role, c.leader_id, c.captain_id
      FROM crew_members cm
      JOIN crews c ON c.id = cm.crew_id
      WHERE cm.guild_id = ? AND cm.user_id = ?
    `).get(guildId, userId);

    if (!membership) return false;

    if (
      membership.role === "leader" ||
      membership.role === "captain" ||
      membership.leader_id === userId ||
      membership.captain_id === userId
    ) {
      const successor = db.prepare(`
        SELECT user_id
        FROM crew_members
        WHERE guild_id = ? AND crew_id = ? AND user_id <> ?
        ORDER BY joined_at ASC
        LIMIT 1
      `).get(guildId, membership.crew_id, userId);

      if (!successor) {
        db.prepare(`
          DELETE FROM crews WHERE id = ? AND guild_id = ?
        `).run(membership.crew_id, guildId);

        return true;
      }

      db.prepare(`
        UPDATE crews
        SET leader_id = ?, captain_id = ?
        WHERE id = ? AND guild_id = ?
      `).run(successor.user_id, successor.user_id, membership.crew_id, guildId);

      db.prepare(`
        UPDATE crew_members SET role = 'leader'
        WHERE guild_id = ? AND crew_id = ? AND user_id = ?
      `).run(guildId, membership.crew_id, successor.user_id);
    }

    db.prepare(`
      DELETE FROM crew_members WHERE guild_id = ? AND user_id = ?
    `).run(guildId, userId);

    db.prepare(`
      DELETE FROM crew_invites
      WHERE (invitee_id = ? OR invited_user_id = ?)
        AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
    `).run(userId, userId, guildId);

    return true;
  })();
}

function inviteToCrew(guildId, crewId, inviterId, inviteeId) {
  const id = Number(crewId);

  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(inviterId) ||
    !validId(inviteeId) ||
    inviterId === inviteeId
  ) {
    return { success: false, message: "Invalid invitation." };
  }

  return db.transaction(() => {
    const crew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(id, guildId);

    if (!crew) return { success: false, message: "Crew not found." };

    const inviter = db.prepare(`
      SELECT role FROM crew_members
      WHERE guild_id = ? AND crew_id = ? AND user_id = ?
    `).get(guildId, id, inviterId);

    if (!inviter || !["leader", "captain", "officer"].includes(inviter.role)) {
      return { success: false, message: "You cannot invite members." };
    }

    if (getCrewForUser(guildId, inviteeId)) {
      return { success: false, message: "That user is already in a crew." };
    }

    db.prepare(`
      DELETE FROM crew_invites
      WHERE crew_id = ?
        AND (invitee_id = ? OR invited_user_id = ?)
        AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
    `).run(id, inviteeId, inviteeId, guildId);

    db.prepare(`
      INSERT INTO crew_invites
        (crew_id, inviter_id, invitee_id, invited_by, invited_user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, inviterId, inviteeId, inviterId, inviteeId);

    return { success: true };
  })();
}

function acceptCrewInvite(guildId, userId, crewId) {
  const id = Number(crewId);

  if (!validId(guildId) || !validId(userId) || !Number.isSafeInteger(id) || id <= 0) {
    return { success: false, message: "Invalid invitation." };
  }

  return db.transaction(() => {
    const invite = db.prepare(`
      SELECT * FROM crew_invites
      WHERE crew_id = ? AND invitee_id = ?
        AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
    `).get(id, userId, guildId);

    if (!invite) {
      return { success: false, message: "Invitation not found." };
    }

    const result = joinCrew(guildId, id, userId);

    if (result.success) {
      db.prepare(`
        DELETE FROM crew_invites
        WHERE crew_id = ?
          AND (invitee_id = ? OR invited_user_id = ?)
          AND crew_id IN (SELECT id FROM crews WHERE guild_id = ?)
      `).run(id, userId, userId, guildId);
    }

    return result;
  })();
}

function removeCrewMember(guildId, crewId, requesterId, targetId) {
  const id = Number(crewId);

  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(requesterId) ||
    !validId(targetId)
  ) {
    return false;
  }

  return db.transaction(() => {
    const crew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(id, guildId);

    if (!crew || requesterId === targetId) return false;

    const requester = db.prepare(`
      SELECT role FROM crew_members
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).get(id, guildId, requesterId);

    const target = db.prepare(`
      SELECT role FROM crew_members
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).get(id, guildId, targetId);

    if (!requester || !target) return false;
    if (!["leader", "captain", "officer"].includes(requester.role)) return false;
    if (target.role === "leader" || target.role === "captain") return false;
    if (requester.role === "officer" && target.role === "officer") return false;

    db.prepare(`
      DELETE FROM crew_members
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).run(id, guildId, targetId);

    return true;
  })();
}

function promoteCrewMember(guildId, crewId, requesterId, targetId, role = "officer") {
  const id = Number(crewId);

  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(requesterId) ||
    !validId(targetId) ||
    !["member", "officer"].includes(role)
  ) {
    return false;
  }

  return db.transaction(() => {
    const crew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(id, guildId);

    if (
      !crew ||
      (crew.leader_id !== requesterId && crew.captain_id !== requesterId)
    ) return false;

    const target = db.prepare(`
      SELECT 1 FROM crew_members
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).get(id, guildId, targetId);

    if (!target || requesterId === targetId) return false;

    db.prepare(`
      UPDATE crew_members SET role = ?
      WHERE crew_id = ? AND guild_id = ? AND user_id = ?
    `).run(role, id, guildId, targetId);

    return true;
  })();
}

function addCrewPoints(guildId, crewId, points) {
  const id = Number(crewId);

  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(points) ||
    points <= 0
  ) {
    return false;
  }

  return db.prepare(`
    UPDATE crews
    SET points = points + ?
    WHERE id = ? AND guild_id = ? AND points <= ?
  `).run(points, id, guildId, Number.MAX_SAFE_INTEGER - points).changes === 1;
}

function getTopCrews(guildId, limit = 10, offset = 0) {
  if (!validId(guildId)) return [];
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);

  return db.prepare(`
    SELECT * FROM crews
    WHERE guild_id = ?
    ORDER BY points DESC, name ASC
    LIMIT ? OFFSET ?
  `).all(guildId, safeLimit, safeOffset);
}

function disbandCrew(guildId, crewId, requesterId) {
  const id = Number(crewId);

  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0 || !validId(requesterId)) {
    return { success: false, message: "Invalid crew details." };
  }

  return db.transaction(() => {
    const crew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(id, guildId);

    if (!crew) return { success: false, message: "Crew not found." };

    const captainId = crew.captain_id || crew.leader_id;
    if (captainId !== requesterId) {
      return {
        success: false,
        message: "Only the crew captain can disband the crew.",
      };
    }

    const activeWar = db.prepare(`
      SELECT 1
      FROM crew_wars
      WHERE status IN ('pending', 'active', 'finishing')
        AND guild_id = ?
        AND (crew_one_id = ? OR crew_two_id = ?)
      LIMIT 1
    `).get(guildId, id, id);

    if (activeWar) {
      return {
        success: false,
        message: "Finish the active crew war before disbanding this crew.",
      };
    }

    db.prepare("DELETE FROM crews WHERE id = ? AND guild_id = ?")
      .run(id, guildId);
    return { success: true, crew };
  })();
}

// --------------------------------------------------
// MISSIONS
// --------------------------------------------------

const DEFAULT_DAILY_MISSIONS = [
  ["message-1", 3, 150],
  ["message-2", 5, 250],
  ["message-3", 8, 400],
];

function ensureGuildMissionDefinitions(guildId) {
  if (!validId(guildId)) {
    throw new Error("A valid server ID is required for daily missions.");
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO guild_mission_definitions
      (guild_id, mission_key, message_goal, reward)
    VALUES (?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const [missionKey, messageGoal, reward] of DEFAULT_DAILY_MISSIONS) {
      insert.run(guildId, missionKey, messageGoal, reward);
    }
  })();
}

function getMissionDefinition(guildId, missionKey) {
  if (!validId(guildId) || !validId(missionKey)) return null;

  ensureGuildMissionDefinitions(guildId);

  return db.prepare(`
    SELECT guild_id, mission_key, message_goal, reward
    FROM guild_mission_definitions
    WHERE guild_id = ? AND mission_key = ?
  `).get(guildId, missionKey) || null;
}

function getDailyMission(guildId, date = new Date().toISOString().slice(0, 10)) {
  if (!validId(guildId)) {
    throw new Error("A valid server ID is required for daily missions.");
  }

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Mission date must be a valid UTC calendar date.");
  }

  ensureGuildMissionDefinitions(guildId);

  const definitions = db.prepare(`
    SELECT guild_id, mission_key, message_goal, reward
    FROM guild_mission_definitions
    WHERE guild_id = ?
    ORDER BY mission_key ASC
  `).all(guildId);

  if (definitions.length === 0) {
    throw new Error("No daily mission definitions are configured.");
  }

  const dayNumber = Math.floor(
    Date.parse(`${date}T00:00:00Z`) / 86_400_000
  );
  const definition = definitions[
    ((dayNumber % definitions.length) + definitions.length) % definitions.length
  ];

  return {
    ...definition,
    id: `daily-${date}`,
    date,
    title: `Send ${definition.message_goal} messages in a server channel`,
  };
}

function getMissionProgress(guildId, userId, missionId) {
  if (!validId(guildId) || !validId(userId) || !validId(missionId)) return 0;

  const row = db.prepare(`
    SELECT progress
    FROM guild_mission_progress
    WHERE guild_id = ? AND user_id = ? AND mission_id = ?
  `).get(guildId, userId, missionId);

  return row?.progress || 0;
}

function recordMissionMessage(guildId, userId, missionId, messageGoal) {
  if (
    !validId(guildId) ||
    !validId(userId) ||
    !validId(missionId) ||
    !Number.isSafeInteger(messageGoal) ||
    messageGoal < 1
  ) {
    return { success: false, message: "Invalid mission progress details." };
  }

  return db.transaction(() => {
    ensureUser(userId);

    const previousProgress = getMissionProgress(guildId, userId, missionId);
    const claimed = db.prepare(`
      SELECT 1
      FROM guild_mission_claims
      WHERE guild_id = ? AND user_id = ? AND mission_id = ?
      LIMIT 1
    `).get(guildId, userId, missionId);

    if (claimed) {
      return {
        success: true,
        progress: previousProgress,
        goal: messageGoal,
        completed: true,
        newlyCompleted: false,
      };
    }

    const progress = Math.min(previousProgress + 1, messageGoal);

    db.prepare(`
      INSERT INTO guild_mission_progress
        (guild_id, user_id, mission_id, progress)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, mission_id)
      DO UPDATE SET progress = excluded.progress
    `).run(guildId, userId, missionId, progress);

    return {
      success: true,
      progress,
      goal: messageGoal,
      completed: progress >= messageGoal,
      newlyCompleted:
        previousProgress < messageGoal && progress >= messageGoal,
    };
  })();
}

function configureMission(guildId, missionKey, messageGoal, reward) {
  if (
    !validId(guildId) ||
    !validId(missionKey) ||
    !Number.isSafeInteger(messageGoal) ||
    messageGoal < 1 ||
    messageGoal > 1000 ||
    !validAmount(reward) ||
    reward > 1_000_000
  ) {
    return { success: false, message: "Invalid mission settings." };
  }

  ensureGuildMissionDefinitions(guildId);

  const result = db.prepare(`
    UPDATE guild_mission_definitions
    SET message_goal = ?, reward = ?
    WHERE guild_id = ? AND mission_key = ?
  `).run(messageGoal, reward, guildId, missionKey);

  if (result.changes !== 1) {
    return { success: false, message: "Mission rotation not found." };
  }

  return {
    success: true,
    mission: getMissionDefinition(guildId, missionKey),
  };
}

function claimMission(
  guildId,
  userId,
  missionId,
  reward = 0,
  crewPoints = 1,
  requiredProgress = 0
) {
  if (
    !validId(guildId) ||
    !validId(userId) ||
    !validId(missionId) ||
    !validAmount(reward) ||
    !Number.isSafeInteger(crewPoints) ||
    crewPoints < 0 ||
    !Number.isSafeInteger(requiredProgress) ||
    requiredProgress < 0
  ) {
    return { success: false, message: "Invalid mission reward." };
  }

  return db.transaction(() => {
    ensureUser(userId);

    const progress = getMissionProgress(guildId, userId, missionId);
    if (progress < requiredProgress) {
      return {
        success: false,
        message: "Mission activity requirement not met.",
        progress,
        requiredProgress,
      };
    }

    const claim = db.prepare(`
      INSERT OR IGNORE INTO guild_mission_claims
        (guild_id, user_id, mission_id, reward)
      VALUES (?, ?, ?, ?)
    `).run(guildId, userId, missionId, reward);

    if (claim.changes !== 1) {
      return { success: false, message: "Mission already claimed." };
    }

    if (reward > 0) {
      const credit = db.prepare(`
  UPDATE users
  SET berries = berries + ?,
      lifetime_berries = lifetime_berries + ?
  WHERE user_id = ?
    AND berries <= ?
    AND lifetime_berries <= ?
`).run(
  reward,
  reward,
  userId,
  Number.MAX_SAFE_INTEGER - reward,
  Number.MAX_SAFE_INTEGER - reward
);

      if (credit.changes !== 1) {
        throw new Error("Mission reward exceeds the balance limit.");
      }

      addTransaction(userId, reward, "mission", `Mission: ${missionId}`);
    }

    const crew = getCrewForUser(guildId, userId);

    if (crew && crewPoints > 0) {
      addCrewPoints(guildId, crew.id, crewPoints);
    }

    return { success: true, reward, crewPoints };
  })();
}

// --------------------------------------------------
// INVENTORY
// --------------------------------------------------

function getUserItems(userId) {
  if (!validId(userId)) return [];

  return db.prepare(`
    SELECT item_id, quantity
    FROM user_items
    WHERE user_id = ?
    ORDER BY item_id ASC
  `).all(userId);
}

function addUserItem(userId, itemId, quantity = 1) {
  if (
    !validId(userId) ||
    !validId(itemId) ||
    !Number.isSafeInteger(quantity) ||
    quantity === 0
  ) {
    return false;
  }

  return db.transaction(() => {
    ensureUser(userId);

    const current = db.prepare(`
      SELECT quantity FROM user_items
      WHERE user_id = ? AND item_id = ?
    `).get(userId, itemId);

    const next = (current ? current.quantity : 0) + quantity;

    if (next < 0 || !Number.isSafeInteger(next)) return false;

    if (next === 0) {
      db.prepare(`
        DELETE FROM user_items
        WHERE user_id = ? AND item_id = ?
      `).run(userId, itemId);
    } else {
      db.prepare(`
        INSERT INTO user_items (user_id, item_id, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, item_id)
        DO UPDATE SET quantity = excluded.quantity
      `).run(userId, itemId, next);
    }

    return true;
  })();
}

// --------------------------------------------------
// RAIDS
// --------------------------------------------------


function getActiveRaid(guildId = null) {
  if (guildId !== null && !validId(guildId)) {
    return null;
  }

  if (guildId === null) {
    return db.prepare(`
      SELECT *, name AS boss_name
      FROM raids
      WHERE status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `).get() || null;
  }

  return db.prepare(`
    SELECT *, name AS boss_name
    FROM raids
    WHERE status = 'active'
      AND guild_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(guildId) || null;
}

function getRaidById(raidId) {
  const id = Number(raidId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  return db.prepare(`
    SELECT *, name AS boss_name
    FROM raids
    WHERE id = ?
  `).get(id) || null;
}

function createRaid({
  guildId,
  bossName,
  maxHp,
  reward = 0,
  startedBy = null,
}) {
  if (
    !validId(guildId) ||
    typeof bossName !== "string" ||
    !bossName.trim() ||
    bossName.trim().length > 100 ||
    !Number.isSafeInteger(maxHp) ||
    maxHp <= 0 ||
    !validAmount(reward) ||
    (startedBy !== null && !validId(startedBy))
  ) {
    return {
      success: false,
      message: "Invalid raid details.",
    };
  }

  return db.transaction(() => {
    if (getActiveRaid(guildId)) {
      return {
        success: false,
        message: "A raid is already active in this server.",
      };
    }

    const result = db.prepare(`
      INSERT INTO raids (
        guild_id,
        name,
        max_hp,
        current_hp,
        reward,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      guildId,
      bossName.trim(),
      maxHp,
      maxHp,
      reward,
      startedBy
    );

    // Return the raid row directly, matching handleRaid().
    return getRaidById(Number(result.lastInsertRowid));
  }).immediate();
}

function getRaidPlayerState(raidId, userId, now = Date.now()) {
  const id = Number(raidId);
  if (!Number.isSafeInteger(id) || id <= 0 || !validId(userId)) return null;

  const state = db.prepare(`
    SELECT rps.raid_id, rps.user_id, rps.character_id, rps.energy,
      rps.cooldown_until, COALESCE(uc.energy_level, 0) AS energy_level
    FROM raid_player_state rps
    LEFT JOIN user_characters uc
      ON uc.user_id = rps.user_id AND uc.character_id = rps.character_id
    WHERE rps.raid_id = ? AND rps.user_id = ?
  `).get(id, userId);

  if (!state) return null;

  state.energy_capacity = 100 + state.energy_level * 10;

  if (state.cooldown_until !== null && state.cooldown_until <= now) {
    db.prepare(`
      UPDATE raid_player_state
      SET energy = ?, cooldown_until = NULL
      WHERE raid_id = ? AND user_id = ?
        AND cooldown_until IS NOT NULL AND cooldown_until <= ?
    `).run(state.energy_capacity, id, userId, now);
    state.energy = state.energy_capacity;
    state.cooldown_until = null;
  }

  return state;
}

function setRaidFighter(raidId, userId, characterId) {
  const id = Number(raidId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(userId) ||
    !validId(characterId)
  ) {
    return { success: false, message: "Invalid raid fighter selection." };
  }

  return db.transaction(() => {
    const raid = getRaidById(id);
    if (!raid || raid.status !== "active") {
      return { success: false, message: "This raid is no longer active." };
    }

    ensureUser(userId);
    const character = getCharacterProgress(userId, characterId);
    if (!character) {
      return { success: false, message: "You don't own that fighter." };
    }

    const energyCapacity = 100 + character.energy_level * 10;
    const result = db.prepare(`
      INSERT OR IGNORE INTO raid_player_state (
        raid_id, user_id, character_id, energy
      ) VALUES (?, ?, ?, ?)
    `).run(id, userId, characterId, energyCapacity);

    if (result.changes !== 1) {
      return {
        success: false,
        message: "You've already chosen a fighter for this raid."
      };
    }

    return {
      success: true,
      state: getRaidPlayerState(id, userId)
    };
  }).immediate();
}

function recordRaidAction(
  raidId,
  userId,
  damage,
  energyCost,
  { now = Date.now(), cooldownMs = 60_000 } = {}
) {
  const id = Number(raidId);

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(userId) ||
    !Number.isSafeInteger(damage) ||
    damage <= 0 ||
    !Number.isSafeInteger(energyCost) ||
    energyCost <= 0 ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(cooldownMs) ||
    cooldownMs < 0
  ) {
    return { success: false, message: "Invalid raid action." };
  }

  return db.transaction(() => {
    ensureUser(userId);
    const raid = getRaidById(id);
    if (!raid || raid.status !== "active") {
      return { success: false, message: "This raid is not active." };
    }

    const state = getRaidPlayerState(id, userId, now);
    if (!state) {
      return {
        success: false,
        message: "Choose your fighter before attacking the boss."
      };
    }

    if (state.energy < energyCost) {
      return {
        success: false,
        message:
          `Not enough energy. This move costs ${energyCost}, and you have ${state.energy}.` +
          (state.cooldown_until !== null
            ? ` Energy recharges <t:${Math.ceil(state.cooldown_until / 1000)}:R>.`
            : ""),
        state
      };
    }

    const previousActions = db.prepare(`
      SELECT attacks
      FROM raid_participants
      WHERE raid_id = ? AND user_id = ?
    `).get(id, userId)?.attacks ?? 0;

    const appliedDamage = Math.min(damage, raid.current_hp);
    const remainingHp = Math.max(0, raid.current_hp - appliedDamage);
    const remainingEnergy = state.energy - energyCost;
    const cooldownUntil =
      state.cooldown_until ??
      (remainingEnergy < state.energy_capacity ? now + cooldownMs : null);

    db.prepare(`
      INSERT INTO raid_participants (
        raid_id, user_id, damage, attacks, last_attack_at
      ) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(raid_id, user_id) DO UPDATE SET
        damage = damage + excluded.damage,
        attacks = attacks + 1,
        last_attack_at = excluded.last_attack_at
    `).run(id, userId, appliedDamage, now);

    db.prepare(`
      UPDATE raid_player_state
      SET energy = ?, cooldown_until = ?
      WHERE raid_id = ? AND user_id = ?
    `).run(remainingEnergy, cooldownUntil, id, userId);

    db.prepare(`
      UPDATE raids
      SET current_hp = ?,
          status = CASE WHEN ? = 0 THEN 'defeated' ELSE status END,
          ended_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE ended_at END
      WHERE id = ? AND status = 'active'
    `).run(remainingHp, remainingHp, remainingHp, id);

    const xpResult = previousActions === 0
      ? grantCharacterXp(userId, state.character_id, 20)
      : null;

    return {
      success: true,
      damage: appliedDamage,
      remainingHp,
      defeated: remainingHp === 0,
      energy: remainingEnergy,
      cooldownUntil,
      xpResult,
      state: {
        ...state,
        energy: remainingEnergy,
        cooldown_until: cooldownUntil
      },
      raid: getRaidById(id)
    };
  }).immediate();
}

function getRaidParticipants(raidId) {
  const id = Number(raidId);

  if (!Number.isSafeInteger(id) || id <= 0) return [];

  return db.prepare(`
    SELECT raid_id, user_id, damage, attacks, reward
    FROM raid_participants
    WHERE raid_id = ?
    ORDER BY damage DESC
  `).all(id);
}

function getRaidLeaderboardParticipants(raidId, limit = 10, offset = 0) {
  const id = Number(raidId);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);

  if (!Number.isSafeInteger(id) || id <= 0) return [];

  return db.prepare(`
    SELECT participants.raid_id, participants.user_id, participants.damage,
      participants.attacks, participants.reward
    FROM raid_participants AS participants
    JOIN users ON users.user_id = participants.user_id
    WHERE participants.raid_id = ?
      AND users.leaderboard_joined_at IS NOT NULL
    ORDER BY participants.damage DESC, participants.user_id ASC
    LIMIT ? OFFSET ?
  `).all(id, safeLimit, safeOffset);
}

function distributeRaidRewards(raidId) {
  const id = Number(raidId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return { success: false, message: "Invalid raid." };
  }

  return db.transaction(() => {
    const raid = getRaidById(id);

    if (!raid || raid.status !== "defeated") {
      return {
        success: false,
        message: "The raid has not been defeated.",
      };
    }

    const participants = getRaidParticipants(id);

    if (participants.length === 0) {
      return { success: true, distributed: 0, rewards: [] };
    }

    const totalDamage = participants.reduce(
      (sum, participant) => sum + participant.damage,
      0
    );

    if (totalDamage <= 0) {
      return { success: true, distributed: 0, rewards: [] };
    }

    let allocated = 0;
    let distributed = 0;
    const rewards = [];

    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];

      const share =
        i === participants.length - 1
          ? Math.max(0, raid.reward - allocated)
          : Math.floor((raid.reward * participant.damage) / totalDamage);

      allocated += share;

      const rewardKey = `raid:${id}:participant:${participant.user_id}`;

      const paid = claimUniqueReward(
        rewardKey,
        participant.user_id,
        share,
        `Raid reward: ${raid.name}`
      );

      if (paid) {
        db.prepare(`
          UPDATE raid_participants
          SET reward = ?
          WHERE raid_id = ? AND user_id = ?
        `).run(share, id, participant.user_id);

        distributed++;
        rewards.push({
          userId: participant.user_id,
          reward: share,
        });
      }
    }

    return {
      success: true,
      distributed,
      rewards,
    };
  })();
}

function endRaid(raidId) {
  const id = Number(raidId);

  if (!Number.isSafeInteger(id) || id <= 0) return false;

  return db.transaction(() => {
    const raid = getRaidById(id);

    if (!raid || raid.status !== "active") return false;

    db.prepare(`
      UPDATE raids
      SET status = 'ended',
          ended_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'active'
    `).run(id);

    return true;
  })();
}

// --------------------------------------------------
// CREW WARS
// --------------------------------------------------

function createCrewWar(guildId, crewOneId, crewTwoId) {
  const first = Number(crewOneId);
  const second = Number(crewTwoId);

  if (
    !validId(guildId) ||
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(second) ||
    first <= 0 ||
    second <= 0 ||
    first === second
  ) {
    return { success: false, message: "Invalid crews." };
  }

  return db.transaction(() => {
    const crewOne = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(first, guildId);

    const crewTwo = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(second, guildId);

    if (!crewOne || !crewTwo) {
      return { success: false, message: "One or both crews do not exist." };
    }

    const activeWar = db.prepare(`
      SELECT id FROM crew_wars
      WHERE status IN ('pending', 'active', 'finishing')
        AND guild_id = ?
        AND (
          crew_one_id IN (?, ?) OR
          crew_two_id IN (?, ?)
        )
      LIMIT 1
    `).get(guildId, first, second, first, second);

    if (activeWar) {
      return {
        success: false,
        message: "One of these crews is already in an active war.",
      };
    }

    const result = db.prepare(`
      INSERT INTO crew_wars (guild_id, crew_one_id, crew_two_id)
      VALUES (?, ?, ?)
    `).run(guildId, first, second);

    return {
      success: true,
      war: getCrewWar(guildId, Number(result.lastInsertRowid)),
    };
  })();
}

function challengeCrewWar(guildId, challengerCrewId, targetCrewId, requesterId) {
  const challengerId = Number(challengerCrewId);
  const targetId = Number(targetCrewId);
  if (
    !validId(guildId) ||
    !Number.isSafeInteger(challengerId) ||
    !Number.isSafeInteger(targetId) ||
    challengerId <= 0 ||
    targetId <= 0 ||
    challengerId === targetId ||
    !validId(requesterId)
  ) {
    return { success: false, message: "Choose two different valid crews." };
  }

  return db.transaction(() => {
    const challenger = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(challengerId, guildId);
    const target = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(targetId, guildId);
    if (!challenger || !target) {
      return { success: false, message: "One or both crews do not exist in this server." };
    }

    const captainId = challenger.captain_id || challenger.leader_id;
    if (captainId !== requesterId) {
      return { success: false, message: "Only your crew captain can challenge another crew." };
    }

    const existingWar = db.prepare(`
      SELECT 1
      FROM crew_wars
      WHERE guild_id = ?
        AND status IN ('pending', 'active', 'finishing')
        AND (
          crew_one_id IN (?, ?) OR crew_two_id IN (?, ?)
        )
      LIMIT 1
    `).get(guildId, challengerId, targetId, challengerId, targetId);
    if (existingWar) {
      return {
        success: false,
        message: "One of these crews already has a pending challenge or active war."
      };
    }

    const result = db.prepare(`
      INSERT INTO crew_wars (
        guild_id, crew_one_id, crew_two_id, status, challenged_by
      ) VALUES (?, ?, ?, 'pending', ?)
    `).run(guildId, challengerId, targetId, requesterId);

    return {
      success: true,
      war: getCrewWar(guildId, Number(result.lastInsertRowid)),
      challenger,
      target
    };
  })();
}

function respondToCrewWarChallenge(guildId, warId, responderId, action) {
  const id = Number(warId);
  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(responderId) ||
    !["accept", "decline", "cancel"].includes(action)
  ) {
    return { success: false, message: "Invalid crew war response." };
  }

  return db.transaction(() => {
    const war = getCrewWar(guildId, id);
    if (!war || war.status !== "pending") {
      return { success: false, message: "This crew war challenge is no longer pending." };
    }

    const responderCrewId = action === "cancel"
      ? war.crew_one_id
      : war.crew_two_id;
    const responderCrew = db.prepare(`
      SELECT * FROM crews WHERE id = ? AND guild_id = ?
    `).get(responderCrewId, guildId);
    const captainId = responderCrew?.captain_id || responderCrew?.leader_id;
    if (captainId !== responderId) {
      return {
        success: false,
        message: action === "cancel"
          ? "Only the challenging crew's captain can cancel this challenge."
          : "Only the challenged crew's captain can respond to this challenge."
      };
    }

    if (action !== "accept") {
      db.prepare(`
        UPDATE crew_wars
        SET status = ?, ended_at = CURRENT_TIMESTAMP
        WHERE id = ? AND guild_id = ? AND status = 'pending'
      `).run(action === "cancel" ? "cancelled" : "declined", id, guildId);
      return {
        success: true,
        accepted: false,
        action,
        war: getCrewWar(guildId, id)
      };
    }

    const conflictingWar = db.prepare(`
      SELECT 1
      FROM crew_wars
      WHERE guild_id = ?
        AND id != ?
        AND status IN ('active', 'finishing')
        AND (
          crew_one_id IN (?, ?) OR crew_two_id IN (?, ?)
        )
      LIMIT 1
    `).get(guildId, id, war.crew_one_id, war.crew_two_id, war.crew_one_id, war.crew_two_id);
    if (conflictingWar) {
      return {
        success: false,
        message: "One of these crews has entered another active war."
      };
    }

    db.prepare(`
      UPDATE crew_wars
      SET status = 'active'
      WHERE id = ? AND guild_id = ? AND status = 'pending'
    `).run(id, guildId);
    return { success: true, accepted: true, war: getCrewWar(guildId, id) };
  })();
}

function cancelPendingCrewWar(guildId, warId) {
  const id = Number(warId);
  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0) {
    return false;
  }

  return db.prepare(`
    UPDATE crew_wars
    SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
    WHERE guild_id = ? AND id = ? AND status = 'pending'
  `).run(guildId, id).changes === 1;
}

function getCrewWar(guildId, warId) {
  const id = Number(warId);

  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0) return null;

  return db.prepare(`
    SELECT * FROM crew_wars WHERE id = ? AND guild_id = ?
  `).get(id, guildId) || null;
}

function getActiveCrewWar(guildId, crewId = null) {
  if (!validId(guildId)) return null;

  if (crewId === null || crewId === undefined) {
    return db.prepare(`
      SELECT * FROM crew_wars
      WHERE guild_id = ? AND status IN ('active', 'finishing')
      ORDER BY id DESC
      LIMIT 1
    `).get(guildId) || null;
  }

  const id = Number(crewId);

  if (!Number.isSafeInteger(id) || id <= 0) return null;

  return db.prepare(`
    SELECT * FROM crew_wars
    WHERE guild_id = ? AND status IN ('active', 'finishing')
      AND (crew_one_id = ? OR crew_two_id = ?)
    ORDER BY id DESC
    LIMIT 1
  `).get(guildId, id, id) || null;
}

function hasCrewWarMatchParticipant(guildId, warId, userId) {
  const id = Number(warId);
  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0 || !validId(userId)) return false;

  return Boolean(db.prepare(`
    SELECT 1
    FROM crew_war_matches
    WHERE guild_id = ? AND war_id = ?
      AND status = 'finished'
      AND (player_one_id = ? OR player_two_id = ?)
    LIMIT 1
  `).get(guildId, id, userId, userId));
}

function startCrewWarMatch(guildId, warId, matchId, playerOneId, playerTwoId) {
  const id = Number(warId);

  if (
    !validId(guildId) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !validId(matchId) ||
    !validId(playerOneId) ||
    !validId(playerTwoId) ||
    playerOneId === playerTwoId
  ) {
    return { success: false, message: "Invalid crew war match." };
  }

  return db.transaction(() => {
    const war = getCrewWar(guildId, id);
    if (!war || war.status !== "active") {
      return { success: false, message: "This crew war is not active." };
    }

    const playerOneCrew = getCrewForUser(guildId, playerOneId);
    const playerTwoCrew = getCrewForUser(guildId, playerTwoId);
    if (!playerOneCrew || !playerTwoCrew) {
      return { success: false, message: "Both fighters must belong to a crew." };
    }

    const competingCrews = new Set([war.crew_one_id, war.crew_two_id]);
    if (
      playerOneCrew.id === playerTwoCrew.id ||
      !competingCrews.has(playerOneCrew.id) ||
      !competingCrews.has(playerTwoCrew.id)
    ) {
      return {
        success: false,
        message: "Choose fighters from opposite crews in this war.",
      };
    }

    const previousMatch = db.prepare(`
      SELECT 1
      FROM crew_war_matches
      WHERE guild_id = ? AND war_id = ?
        AND status IN ('active', 'finished')
        AND (
          player_one_id IN (?, ?) OR
          player_two_id IN (?, ?)
        )
      LIMIT 1
    `).get(guildId, id, playerOneId, playerTwoId, playerOneId, playerTwoId);

    if (previousMatch) {
      return {
        success: false,
        message: "A fighter has already completed a duel or has an active match in this war.",
      };
    }

    db.prepare(`
      INSERT INTO crew_war_matches (
        match_id,
        guild_id,
        war_id,
        player_one_id,
        crew_one_id,
        player_two_id,
        crew_two_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      matchId,
      guildId,
      id,
      playerOneId,
      playerOneCrew.id,
      playerTwoId,
      playerTwoCrew.id
    );

    return { success: true };
  })();
}

function finishCrewWarMatch(guildId, matchId, winnerId) {
  if (!validId(guildId) || !validId(matchId) || !validId(winnerId)) {
    return { success: false, message: "Invalid crew war match result." };
  }

  return db.transaction(() => {
    const match = db.prepare(`
      SELECT * FROM crew_war_matches WHERE match_id = ? AND guild_id = ?
    `).get(matchId, guildId);

    if (!match || match.status !== "active") {
      return { success: false, message: "This crew war match is no longer active." };
    }

    const war = getCrewWar(guildId, match.war_id);
    if (!war || !["active", "finishing"].includes(war.status)) {
      db.prepare(`
        UPDATE crew_war_matches
        SET status = 'cancelled',
            ended_at = CURRENT_TIMESTAMP
        WHERE match_id = ? AND guild_id = ? AND status = 'active'
      `).run(matchId, guildId);
      return { success: false, message: "This crew war has ended." };
    }

    const winnerCrewId =
      winnerId === match.player_one_id
        ? match.crew_one_id
        : winnerId === match.player_two_id
          ? match.crew_two_id
          : null;

    if (!winnerCrewId) {
      return { success: false, message: "The winner is not in this match." };
    }

    const pointAwarded = war.status === "active";
    if (pointAwarded) {
      const scoreColumn =
        winnerCrewId === war.crew_one_id ? "score_one" : "score_two";
      const score = db.prepare(`
        UPDATE crew_wars
        SET ${scoreColumn} = ${scoreColumn} + 1
        WHERE id = ? AND status = 'active'
          AND ${scoreColumn} < ?
      `).run(match.war_id, Number.MAX_SAFE_INTEGER);

      if (score.changes !== 1) {
        throw new Error("Could not award the crew war match point.");
      }
    }

    db.prepare(`
      UPDATE crew_war_matches
      SET winner_id = ?,
          status = 'finished',
          ended_at = CURRENT_TIMESTAMP
      WHERE match_id = ? AND guild_id = ? AND status = 'active'
    `).run(winnerId, matchId, guildId);

    let updatedWar = getCrewWar(guildId, match.war_id);
    const targetReached =
      updatedWar.score_one >= CREW_WAR_WIN_TARGET ||
      updatedWar.score_two >= CREW_WAR_WIN_TARGET;
    const remainingCrewMembers = db.prepare(`
      SELECT members.crew_id, COUNT(*) AS remaining
      FROM crew_members AS members
      WHERE members.guild_id = ?
        AND members.crew_id IN (?, ?)
        AND NOT EXISTS (
          SELECT 1
          FROM crew_war_matches AS matches
          WHERE matches.guild_id = ?
            AND matches.war_id = ?
            AND matches.status IN ('active', 'finished')
            AND (
              matches.player_one_id = members.user_id OR
              matches.player_two_id = members.user_id
            )
        )
      GROUP BY members.crew_id
    `).all(
      guildId,
      updatedWar.crew_one_id,
      updatedWar.crew_two_id,
      guildId,
      match.war_id
    );
    const noMoreDuels = remainingCrewMembers.length < 2 ||
      remainingCrewMembers.some(crew => crew.remaining === 0);
    if ((targetReached || noMoreDuels) && updatedWar.status === "active") {
      db.prepare(`
        UPDATE crew_wars
        SET status = 'finishing'
        WHERE id = ? AND guild_id = ? AND status = 'active'
      `).run(match.war_id, guildId);
      updatedWar = getCrewWar(guildId, match.war_id);
    }

    let autoFinished = false;
    if (targetReached || noMoreDuels || updatedWar.status === "finishing") {
      const activeMatches = db.prepare(`
        SELECT COUNT(*) AS count
        FROM crew_war_matches
        WHERE guild_id = ? AND war_id = ? AND status = 'active'
      `).get(guildId, match.war_id).count;
      if (activeMatches === 0) {
        const finalResult = finalizeCrewWar(guildId, match.war_id);
        autoFinished = finalResult.success;
        updatedWar = finalResult.war;
      }
    }

    return {
      success: true,
      winnerCrewId,
      pointAwarded,
      warFinishing: updatedWar.status === "finishing" && !autoFinished,
      autoFinished,
      war: updatedWar,
    };
  })();
}

function cancelCrewWarMatch(guildId, matchId) {
  if (!validId(guildId) || !validId(matchId)) return false;

  return db.prepare(`
    UPDATE crew_war_matches
    SET status = 'cancelled',
        ended_at = CURRENT_TIMESTAMP
    WHERE guild_id = ? AND match_id = ? AND status = 'active'
  `).run(guildId, matchId).changes === 1;
}

const CREW_WAR_WIN_TARGET = 10;

function finalizeCrewWar(guildId, id) {
  const war = getCrewWar(guildId, id);
  if (!war || !["active", "finishing"].includes(war.status)) {
    return { success: false, message: "This war has already finished." };
  }

  let winnerCrewId = null;
  if (war.score_one > war.score_two) {
    winnerCrewId = war.crew_one_id;
  } else if (war.score_two > war.score_one) {
    winnerCrewId = war.crew_two_id;
  }

  if (winnerCrewId && !addCrewPoints(guildId, winnerCrewId, 10)) {
    throw new Error("Could not award crew war points to the winning crew.");
  }

  db.prepare(`
    UPDATE crew_wars
    SET status = 'finished',
        winner_crew_id = ?,
        ended_at = CURRENT_TIMESTAMP
    WHERE id = ? AND guild_id = ? AND status IN ('active', 'finishing')
  `).run(winnerCrewId, id, guildId);

  return {
    success: true,
    draw: winnerCrewId === null,
    winnerCrewId,
    war: getCrewWar(guildId, id),
  };
}

function finishCrewWar(guildId, warId) {
  const id = Number(warId);

  if (!validId(guildId) || !Number.isSafeInteger(id) || id <= 0) {
    return { success: false, message: "Invalid war." };
  }

  return db.transaction(() => {
    const war = getCrewWar(guildId, id);

    if (!war) {
      return { success: false, message: "War not found." };
    }

    if (!["active", "finishing"].includes(war.status)) {
      return {
        success: false,
        message: "This war has already finished.",
      };
    }

    const activeMatches = db.prepare(`
      SELECT COUNT(*) AS count
      FROM crew_war_matches
      WHERE guild_id = ? AND war_id = ? AND status = 'active'
    `).get(guildId, id).count;

    if (activeMatches > 0) {
      return {
        success: false,
        message: "Finish or cancel the active crew duel before ending the war.",
      };
    }

    return finalizeCrewWar(guildId, id);
  })();
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
  db,
  getGuildChannel,
  getGuildChannelSettings,
  setGuildChannel,

  // Users
  ensureUser,
  startPirateJourney,
  getUser,
  getBalance,
  getBerries,

  // Economy
  addTransaction,
  addBerries,
  spendBerries,
  transferBerries,
  getTransactionHistory,
  getBerryLeaderboard,
  getTopBerryBalances,

  // Daily rewards
  getDailyStatus,
  claimDailyReward,

  // Bounty
  getBounty,
  increaseBounty,
  awardBounty,
  getBountyHistory,
  getTopBounties,

  // Idempotent rewards
  claimUniqueReward,

  // Characters
  ownsCharacter,
  getOwnedCharacters,
  getCharacterProgress,
  getBaseCharacter,
  setBaseCharacter,
  grantCharacterXp,
  grantBaseCharacterChatXp,
  upgradeCharacterEnergy,
  grantStarterCharacters,
  purchaseCharacter,

  // Achievements
  unlockAchievement,
  getAchievements,

  // Battles
  getBattleStats,
  recordBattleResult,
  recordBattleDraw,

  // Crews
  getCrewForUser,
  getCrewByName,
  getCrewBanner,
  setCrewBanner,
  deleteCrewBanner,
  updateCrewDetails,
  getAllCrews,
  getCrewMembers,
  createCrew,
  joinCrew,
  leaveCrew,
  inviteToCrew,
  acceptCrewInvite,
  removeCrewMember,
  promoteCrewMember,
  disbandCrew,
  addCrewPoints,
  getTopCrews,

  // Missions
  getMissionDefinition,
  getDailyMission,
  getMissionProgress,
  recordMissionMessage,
  configureMission,
  claimMission,

  // Inventory
  getUserItems,
  addUserItem,

  // Raids
  getActiveRaid,
  getRaidById,
  createRaid,
  getRaidPlayerState,
  setRaidFighter,
  recordRaidAction,
  getRaidParticipants,
  getRaidLeaderboardParticipants,
  distributeRaidRewards,
  endRaid,

  // Crew wars
  createCrewWar,
  getCrewWar,
  getActiveCrewWar,
  hasCrewWarMatchParticipant,
  startCrewWarMatch,
  finishCrewWarMatch,
  cancelCrewWarMatch,
  finishCrewWar,
  challengeCrewWar,
  respondToCrewWarChallenge,
  cancelPendingCrewWar,
  CREW_WAR_WIN_TARGET,
};