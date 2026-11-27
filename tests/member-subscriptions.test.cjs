const assert = require('node:assert/strict');
const { test } = require('node:test');
const { historyRegistration } = require('../dist/subscriptions');

test('archive delivery starts on and reads the existing scoped identity preference', async () => {
  const config = { enabled: true };
  const [read, set] = historyRegistration({ configFor: async (scope, actor) => {
    assert.deepEqual([scope, actor], ['community', 'member']);
    return config;
  } }).methods;
  const call = { scopeId: 'community', actorIdentityId: 'member', setMemberBoolean: async value => { config.automaticHistory = value; } };
  assert.deepEqual(await read.handler({}, call), { choice: 'on' });
  assert.deepEqual(await set.handler({ choice: 'off' }, call), { choice: 'off' });
  assert.equal(config.automaticHistory, false);
  config.enabled = false;
  assert.equal(await set.handler({ choice: 'on' }, call), null);
});
