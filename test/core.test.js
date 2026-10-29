import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { named, axes, fresh, learn, decay, persona, fingerprint, incoming, decision } from '../src/core.js';
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
test('names why it skips bots, notices, own messages, deletes, blanks and unwatched rooms', () => {
  const p = { from: { user_id: 'human' }, room_id: 'general', message_id: '1', body: { text: 'hello' } };
  const skip = x => incoming(x, 'bot_self', new Set(['otherbot']), ['general']);
  assert.equal(skip(p), null);
  assert.equal(skip({ ...p, from: { user_id: 'bot_self' } }), 'own');
  assert.deepEqual(['~private', 'bot_alice', 'otherbot'].map(user_id => skip({ ...p, from: { user_id } })), ['from-bot', 'from-bot', 'from-bot']);
  assert.equal(skip({ ...p, from: { user_id: 'custom', roles: ['bot'] } }), 'from-bot');
  assert.equal(skip({ ...p, deleted: true, body: undefined }), 'deleted');
  assert.equal(skip({ ...p, room_id: 'private' }), 'other-room');
  assert.equal(skip({ ...p, body: { text: '  ' } }), 'empty');
  assert.equal(skip({ ...p, message_id: undefined }), 'empty');
  assert.equal(skip(undefined), 'other-room');
});
test('rejects malformed decisions and computes expected trait values', () => {
  const reply = content => ({ choices: [{ message: { content } }] });
  const answers = { learn: .9, reply: .8, point: .6, warmth: 'high', playfulness: 'low', curiosity: 'balanced', expressiveness: 'elevated' };
  assert.deepEqual(decision(reply(JSON.stringify(answers))).vector, [1, 0, .5, .75]);
  assert.equal(decision(reply('```json\n' + JSON.stringify(answers) + '\n```')).learn, .9);
  assert.throws(() => decision(reply(JSON.stringify({ ...answers, warmth: 'toString' }))));
  assert.throws(() => decision(reply(JSON.stringify({ ...answers, learn: 2 }))));
  assert.equal(decision(reply(JSON.stringify(answers))).point, .6);
  for (const point of [undefined, -0.1, 1.5, '0.6', null]) assert.throws(() => decision(reply(JSON.stringify({ ...answers, point }))), { message: 'invalid-decision' }, String(point));
  assert.throws(() => decision(reply('not json')));
  assert.throws(() => decision({}));
});
test('naming the bot addresses it, but a word that merely contains it does not', () => {
  const names = ['Bot of Matthias', 'bot_guest_1'];
  for (const t of ['bot, you there?', 'hey Bot of Matthias', 'yo bot_guest_1', 'Bot?']) assert.equal(named(t, names), true, t);
  for (const t of ['the robot army', 'bots are fun', 'about my chatbot', 'sabot', 'ping @someone']) assert.equal(named(t, names), false, t);
});
