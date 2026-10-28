import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { axes, fresh, learn, decay, persona, fingerprint, incoming, decision } from '../src/core.js';
test('4D cells decay by half-life and centroid has a neutral prior', () => {
  const s = fresh(0); learn(s, [1, 0, .5, .75], 1, 0);
  assert.deepEqual(s.cells, { '4023': 1 });
  assert.equal(persona(s).warmth, .545);
  decay(s, 30 * 86400000); assert.equal(s.cells['4023'], .5);
  assert.equal(persona(s).warmth, .524);
});
test('personality grid is bounded at 625 cells', () => {
  const s = fresh(0);
  for (let i = 0; i < 1250; ++i) learn(s, [0, 1, 2, 3].map(n => (Math.floor(i / 5 ** n) % 5) / 4), 1, 0);
  assert.ok(Object.keys(s.cells).length <= 625);
});
test('fingerprints normalize repeats and depend on secret', async () => {
  const a = await fingerprint('one', ' Hello   World ');
  assert.equal(a, await fingerprint('one', 'hello world'));
  assert.notEqual(a, await fingerprint('two', 'hello world'));
});
test('ignores bots, notices, own messages, deletes and unapproved rooms', () => {
  const p = { from: { user_id: 'human' }, room_id: 'general', message_id: '1', body: { text: 'hello' } };
  const accept = x => incoming(x, 'self', new Set(['otherbot']), ['general']);
  assert.ok(accept(p));
  for (const user_id of ['self', '~private', 'bot_alice', 'otherbot']) assert.ok(!accept({ ...p, from: { user_id } }));
  assert.ok(!accept({ ...p, deleted: true }));
  assert.ok(!accept({ ...p, room_id: 'private' }));
  assert.ok(!accept({ ...p, from: { user_id: 'custom', roles: ['bot'] } }));
});
test('rejects malformed decisions and computes expected trait values', () => {
  const reply = content => ({ choices: [{ message: { content } }] });
  const answers = { learn: .9, reply: .8, warmth: 'high', playfulness: 'low', curiosity: 'balanced', expressiveness: 'elevated' };
  assert.deepEqual(decision(reply(JSON.stringify(answers))).vector, [1, 0, .5, .75]);
  assert.equal(decision(reply('```json\n' + JSON.stringify(answers) + '\n```')).learn, .9);
  assert.throws(() => decision(reply(JSON.stringify({ ...answers, warmth: 'toString' }))));
  assert.throws(() => decision(reply(JSON.stringify({ ...answers, learn: 2 }))));
  assert.throws(() => decision(reply('not json')));
  assert.throws(() => decision({}));
});
