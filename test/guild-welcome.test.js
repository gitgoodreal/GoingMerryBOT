const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType, Collection } = require("discord.js");
const { sendGuildWelcome } = require("../src/guild-welcome");

function makeChannel(type, rawPosition = 0) {
  return {
    type,
    rawPosition,
    permissionsFor: () => ({ has: () => true }),
    send: async payload => {
      channelMessages.push(payload.content);
    }
  };
}

let channelMessages;

test("joining a server posts a welcome and DMs the owner setup instructions", async () => {
  channelMessages = [];
  const systemChannel = makeChannel(ChannelType.GuildText);
  const fallbackChannel = makeChannel(ChannelType.GuildText, 1);
  const ownerMessages = [];
  const guild = {
    name: "Test Server",
    systemChannel,
    members: { me: {} },
    channels: {
      cache: new Collection([
        ["system", systemChannel],
        ["fallback", fallbackChannel]
      ])
    },
    fetchOwner: async () => ({
      send: async payload => ownerMessages.push(payload.content)
    })
  };

  await sendGuildWelcome(guild);

  assert.equal(channelMessages.length, 1);
  assert.match(channelMessages[0], /Thanks for adding/);
  assert.match(channelMessages[0], /`\/setup`/);
  assert.equal(ownerMessages.length, 1);
  assert.match(ownerMessages[0], /Quick setup/);
  assert.match(ownerMessages[0], /Manage Server/);
});

test("welcome uses the first permitted text channel when there is no usable system channel", async () => {
  channelMessages = [];
  const unavailableSystemChannel = makeChannel(ChannelType.GuildVoice);
  const firstTextChannel = makeChannel(ChannelType.GuildText, 0);
  const nextTextChannel = makeChannel(ChannelType.GuildAnnouncement, 1);
  firstTextChannel.send = async payload => {
    channelMessages.push(`first:${payload.content}`);
  };
  nextTextChannel.send = async payload => {
    channelMessages.push(`next:${payload.content}`);
  };
  const guild = {
    name: "Test Server",
    systemChannel: unavailableSystemChannel,
    members: { me: {} },
    channels: {
      cache: new Collection([
        ["next", nextTextChannel],
        ["first", firstTextChannel]
      ])
    },
    fetchOwner: async () => ({ send: async () => {} })
  };

  await sendGuildWelcome(guild);

  assert.equal(channelMessages.length, 1);
  assert.match(channelMessages[0], /^first:/);
});
