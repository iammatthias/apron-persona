import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { named, conversing, axes, fresh, learn, seed, migrate, persona, fingerprint, incoming, decision, HALF_LIFE } from '../src/core.js';
test('a lesson fades by intake, not by the calendar: half after HALF_LIFE more lessons, untouched while nothing is learned', () => {
  const s = fresh();
  assert.deepEqual(s, { version: 2, cells: {}, n: 0 });
  learn(s, [1, 0, .5, .75], 1);
  assert.deepEqual(s, { version: 2, cells: { '4023': 1 }, n: 1 });
  assert.equal(persona(s).warmth, .545);
  const read = structuredClone(s);
  for (let i = 0; i < 50; ++i) persona(s);
  assert.deepEqual(s, read);
  for (let i = 0; i < HALF_LIFE; ++i) learn(s, [.5, .5, .5, .5], 1);
  assert.equal(Math.round(s.cells['4023'] * 1e6) / 1e6, .5);
  assert.equal(s.n, 1 + HALF_LIFE);
  for (let i = 0; i < HALF_LIFE; ++i) learn(s, [.5, .5, .5, .5], 1);
  assert.equal(Math.round(s.cells['4023'] * 1e6) / 1e6, .25);
  assert.equal(HALF_LIFE, 200);
  // A lesson that has faded below notice is dropped, so the grid never fills with ghosts.
  const t = fresh(); learn(t, [0, 0, 0, 0], 1);
  for (let i = 0; i < 14 * HALF_LIFE; ++i) learn(t, [1, 1, 1, 1], 1);
  assert.deepEqual(Object.keys(t.cells), ['4444']);
});
test('a seed is a head start worth ten lessons, and pushes earlier lessons back the same as ten would', () => {
  const s = fresh();
  seed(s, [1, 0, .5, .75]);
  assert.deepEqual(s, { version: 2, cells: { '4023': 10 }, n: 10 });
  learn(s, [0, 0, 0, 0], 1);
  seed(s, [1, 1, 1, 1]);
  assert.equal(Math.round(s.cells['0000'] * 1e6) / 1e6, Math.round(2 ** (-10 / HALF_LIFE) * 1e6) / 1e6);
  assert.equal(s.n, 21);
});
test('a version-1 personality migrates on load: its cells kept, its clock dropped, n starting at 0', () => {
  assert.deepEqual(migrate({ version: 1, at: 1761700000000, cells: { '2222': 3.5, '4023': .2 } }), { version: 2, cells: { '2222': 3.5, '4023': .2 }, n: 0 });
  const v2 = { version: 2, cells: { '2222': 1 }, n: 7 };
  assert.equal(migrate(v2), v2);
  assert.deepEqual(migrate(undefined), undefined);
  assert.deepEqual(migrate({ version: 1, at: 0 }), { version: 1, at: 0 });
});
test('personality grid is bounded at 625 cells', () => {
  const s = fresh();
  for (let i = 0; i < 1250; ++i) learn(s, [0, 1, 2, 3].map(n => (Math.floor(i / 5 ** n) % 5) / 4), 1);
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
test('a blank or missing name never matches every message', () => {
  for (const names of [['   '], [''], [undefined, null]]) assert.equal(named('lunch anyone?', names), false);
  assert.equal(named('bot?', ['   ']), true);
});
test('conversing: alone in the room, or answered within ten minutes', () => {
  const now = 1e7, heard = m => new Map(m);
  assert.equal(conversing(heard([]), new Map(), 'ana', now), true);
  assert.equal(conversing(heard([['ana', now - 1000]]), new Map(), 'ana', now), true);
  assert.equal(conversing(heard([['ben', now - 60000]]), new Map(), 'ana', now), false);
  assert.equal(conversing(heard([['ben', now - 31 * 60000]]), new Map(), 'ana', now), true);
  assert.equal(conversing(heard([['ben', now - 60000]]), new Map([['ana', now - 9 * 60000]]), 'ana', now), true);
  assert.equal(conversing(heard([['ben', now - 60000]]), new Map([['ana', now - 11 * 60000]]), 'ana', now), false);
});
