const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const plugin = require('../dist/index.js').default;
const { prepareSendGroupHistoryDocuments } = require('../dist/delivery.js');
const { ChatArchiveExportTooLargeError } = require('@wabs/plugin-sdk/chat-archive');

const recipient = { identityId: 'fixture-identity', canonicalWid: 'fixture-user@c.us', sourceWid: 'fixture-user@lid', deliveryChatId: 'fixture-user@lid' };
function event(overrides = {}) {
  return { pluginId: plugin.manifest.pluginId, scopeId: 'fixture-scope', eventId: 'fixture-join',
    receivedAt: new Date('2026-09-12T12:00:00Z'), action: 'join', chatId: 'fixture@g.us',
    groupDisplayName: 'Fixture group', affectedIdentities: [recipient], botIdentityIds: [], ...overrides };
}
function archive(format = 'txt') {
  return { filename: 'fixture.' + format, mimeType: 'text/plain', buffer: Buffer.from('fixture transcript'),
    messageCount: 2, messageTypeCounts: { chat: 2 }, placeholderMessageTypeCounts: {}, chatTitle: 'Fixture group', format };
}
function hooks(config, exportChatArchive, context = {}) {
  const values = new Map();
  return plugin.registerHooks({ pluginId: plugin.manifest.pluginId, manifest: plugin.manifest,
    enabledFor: async () => true, configFor: async () => config,
    logger: { warn: () => {} },
    i18n: { translatorForIdentity: async () => key => plugin.manifest.defaultMessages[key] ?? key },
    ephemeralStore: { increment: async key => { const next = (values.get(key) ?? 0) + 1; values.set(key, next); return next; },
      delete: async key => Number(values.delete(key)) },
    exportChatArchive, ...context
  });
}

test('retains configured formats, captions, exclusions, window and disabled state', async () => {
  const configured = { enabled: false, formats: ['txt', 'html'], introText: 'History for {groupDisplayName}',
    exemptGroupChatIds: ['excluded@g.us'], historyDays: 30, dedupeTtlSeconds: 900 };
  const parsed = plugin.manifest.configSchema.parse(configured);
  for (const [key, value] of Object.entries(configured)) assert.deepEqual(parsed[key], value);
  const result = await hooks(configured, async () => { throw new Error('Unexpected export'); }).onParticipantChange(event());
  assert.equal(result, undefined);
});

test('prepares authorized delivery actions for the stable recipient and suppresses duplicate events', async () => {
  const exports = [];
  const configured = { enabled: true, formats: ['txt', 'html'], introText: 'History for {groupDisplayName}', historyDays: 2 };
  const provider = hooks(configured, async input => { exports.push(input); return archive(input.format); });
  const first = await provider.onParticipantChange(event());
  const deliveries = first.filter(action => action.type === 'message.sendTextAndDocument');
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].text, 'History for Fixture group');
  assert.equal(deliveries[1].text, undefined);
  for (const action of deliveries) {
    assert.equal(action.chatId, recipient.deliveryChatId);
    assert.equal(action.requiredRemoteChatId, recipient.deliveryChatId);
    assert.ok(action.idempotencyKey.includes('fixture-identity'));
    assert.equal(action.successAudit.metadataJson.messageCount, 2);
  }
  assert.equal(exports[0].scopeId, 'fixture-scope');
  assert.equal(exports[0].chatId, 'fixture@g.us');
  assert.equal(exports[0].since.toISOString(), '2026-09-10T12:00:00.000Z');
  const second = await provider.onParticipantChange(event({ eventId: 'duplicate-notification' }));
  assert.equal(exports.length, 2);
  assert.equal(second[0].metadataJson.reason, 'duplicate-event');
});

test('retries failed exports without permanently suppressing history', async () => {
  let count = 0;
  const provider = hooks({ enabled: true, formats: ['txt'], introText: '' }, async () => {
    count += 1;
    if (count === 1) throw new Error('Fixture export unavailable');
    return archive();
  });
  const first = await provider.onParticipantChange(event());
  assert.equal(first[0].action, 'send-group-history.failed');
  const second = await provider.onParticipantChange(event());
  assert.equal(second[0].type, 'message.sendTextAndDocument');
  assert.equal(count, 2);
});

test('private archive captions mention the recipient and source group only on the first document', async () => {
  const configured = { enabled: true, formats: ['txt', 'html'],
    introText: '{{#if hasGroupDisplayName == true}}For {{mention target "recipient"}} from {{mention target "currentGroup"}}{{else}}{{mention person "unavailable"}}{{/if}}' };
  const provider = hooks(configured, async input => archive(input.format), {
    resolveStableIdentityById: async id => {
      assert.equal(id, recipient.identityId);
      return { identityId: id, mentionWid: '351912345678@c.us' };
    },
    coveredGroupsForScope: async scopeId => {
      assert.equal(scopeId, 'fixture-scope');
      return [{ groupWid: 'fixture@g.us', groupDisplayName: 'Fixture group' }];
    }
  });
  const actions = (await provider.onParticipantChange(event())).filter(action => action.type === 'message.sendTextAndDocument');
  assert.equal(actions[0].text, 'For @351912345678 from @fixture@g.us');
  assert.deepEqual(actions[0].mentionedWids, ['351912345678@c.us']);
  assert.deepEqual(actions[0].groupMentions, [{ groupJid: 'fixture@g.us', groupSubject: 'Fixture group' }]);
  assert.equal(actions[0].mentionAll, undefined);
  assert.equal(actions[1].text, undefined);
  assert.equal(actions[1].mentionedWids, undefined);
  assert.equal(actions[1].groupMentions, undefined);
  assert.throws(() => plugin.manifest.configSchema.parse({ introText: '{{mention all}}' }), /mention/i);
});

test('does not export for exempt groups or the bot identity', async () => {
  const exporter = async () => { throw new Error('Unexpected export'); };
  const exempt = await hooks({ enabled: true, exemptGroupChatIds: ['fixture@g.us'] }, exporter).onParticipantChange(event());
  assert.equal(exempt[0].metadataJson.reason, 'exempt-group');
  const bot = await hooks({ enabled: true }, exporter).onParticipantChange(event({ botIdentityIds: [recipient.identityId] }));
  assert.equal(bot[0].metadataJson.reason, 'self-recipient');
});

test('reports oversized exports and preserves the available format', async () => {
  const prepared = await prepareSendGroupHistoryDocuments({ formats: ['pdf','txt'], maxBytes: 100,
    exportFormat: async format => {
      if (format === 'pdf') throw new ChatArchiveExportTooLargeError({ filename: 'fixture.pdf', mimeType: 'application/pdf', format, sizeBytes: 101, maxBytes: 100, messageCount: 2, chatTitle: 'Fixture group' });
      return archive();
    }
  });
  assert.equal(prepared.omissions[0].reason, 'archive-document-too-large');
  assert.equal(prepared.omissions[0].format, 'pdf');
  assert.equal(prepared.documents.length, 1);
  assert.equal(prepared.documents[0].format, 'txt');
  assert.equal(prepared.everyFormatFailedDuringExport, false);
});

test('ships complete Portuguese defaults and matching console metadata without lifecycle authority', () => {
  const pt = JSON.parse(fs.readFileSync('locales/pt-PT/official.send-group-history.json'));
  const metadata = JSON.parse(fs.readFileSync('wa-plugin.json'));
  for (const key of Object.keys(plugin.manifest.defaultMessages)) assert.ok(pt[key]?.trim(), key);
  assert.equal(metadata.pluginId, plugin.manifest.pluginId);
  assert.equal(metadata.version, plugin.manifest.version);
  assert.equal(metadata.operatorConsole.controls.length, 10);
  assert.equal(plugin.lifecycle, undefined);
});
