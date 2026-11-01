// The bot as an Apron client, against the demo's "well-behaved client" checklist (apron-server-cloudflare docs/limits.md).
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { clock, socket } from './fakes.js';
const env = { APRON_URL: 'wss://apron.test/', APRON_TOKEN: 't', OPENROUTER_API_KEY: 'k', ROOMS: 'general', HASH_SECRET: 'test-key', BOT_NAME: 'Persona' };
const store = { load: () => ({}), save() {} };
function rig({ rooms = 'general', request = async () => new Response(null, { status: 404 }), retry = 1000 } = {}) {
  const timers = clock(), sockets = [];
  const bot = new Bot({ ...env, ROOMS: rooms }, store, { connect: () => { const ws = socket(); sockets.push(ws); return ws; }, request, timers, retry });
  const signIn = (params = {}) => {
    const ws = sockets.at(-1);
    ws.emit({ method: 'server', params });
    ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
    return ws;
  };
  return { bot, timers, sockets, signIn };
}

test('pings are the exact notification, at the interval the server frame names, and two missed beats drop the socket', async () => {
  const r = rig();
  r.bot.tick();
  const ws = r.signIn({ ping: 30 });
  const pings = () => ws.sent.filter(f => f.method === 'ping');
  await r.timers.tick(29999);
  assert.equal(pings().length, 0);
  await r.timers.tick(1);
  assert.deepEqual(pings(), [{ method: 'ping' }]);
  assert.equal(ws.raw.at(-1), '{"method":"ping"}');
  ws.emit({ method: 'pong' });
  await r.timers.tick(60000);
  assert.equal(pings().length, 3);
  assert.equal(r.bot.ready, true);
  await r.timers.tick(30000);
  assert.equal(r.bot.ready, false);
  assert.equal(r.bot.log.list().at(-1).reason, 'silent');
});

test('typing is a notification without an id', async () => {
  const r = rig();
  r.bot.tick();
  r.signIn({ capabilities: ['activity'] });
  const stop = r.bot.typing('general', r.bot.ws);
  stop();
  assert.deepEqual(r.sockets[0].sent.filter(f => f.method === 'activity'), [
    { method: 'activity', params: { room_id: 'general', typing: 8 } },
    { method: 'activity', params: { room_id: 'general', typing: 0 } },
  ]);
});

test('history is read one request at a time, at most 50 records a page', async () => {
  const r = rig({ rooms: 'general,lab,yard' });
  r.bot.tick();
  const ws = r.signIn();
  const outstanding = [];
  const send = ws.send.bind(ws);
  ws.send = s => { send(s); outstanding.push(ws.sent.filter(f => f.method === 'history').length - ws.answered); };
  ws.answered = 0;
  const emit = ws.emit.bind(ws);
  ws.emit = f => { if (ws.sent.some(s => s.id === f.id && s.method === 'history')) ++ws.answered; emit(f); };
  await Promise.all([r.bot.posts(), r.bot.recent({ room_id: 'general', message_id: 'x' }, undefined)]);
  const reads = ws.sent.filter(f => f.method === 'history');
  assert.equal(reads.length, 4);
  assert.ok(reads.every(f => f.params.limit <= 50), JSON.stringify(reads.map(f => f.params.limit)));
  assert.ok(Math.max(...outstanding) <= 1, `at most one history outstanding, saw ${Math.max(...outstanding)}`);
});

test('a retry_after answer is retried as it says, with the same id, so a post is counted once', async () => {
  const r = rig();
  r.bot.tick();
  const ws = r.signIn();
  const send = ws.send.bind(ws);
  let refused = false;
  ws.send = s => {
    const f = JSON.parse(s);
    if (f.method === 'message' && !refused) { refused = true; ws.sent.push(f); queueMicrotask(() => ws.emit({ id: f.id, error: { code: -32002, message: 'Posting limit reached', data: { retry_after: 3 } } })); return; }
    send(s);
  };
  const posted = r.bot.call('message', { room_id: 'general', body: { text: 'hi' } });
  await r.timers.tick(2999);
  assert.equal(ws.sent.filter(f => f.method === 'message').length, 1);
  await r.timers.tick(1);
  const [first, again] = ws.sent.filter(f => f.method === 'message');
  assert.equal(again.id, first.id);
  assert.match((await posted).message_id, /^posted-/);
});

test('a denied request is not retried', async () => {
  const r = rig();
  r.bot.tick();
  const ws = r.signIn();
  ws.send = s => { const f = JSON.parse(s); ws.sent.push(f); queueMicrotask(() => ws.emit({ id: f.id, error: { code: -32001, message: 'denied' } })); };
  await assert.rejects(r.bot.call('message', { room_id: 'general', body: { text: 'hi' } }), { message: 'denied' });
  await r.timers.tick(60000);
  assert.equal(ws.sent.filter(f => f.method === 'message').length, 1);
});

test('reconnects back off exponentially with jitter, capped at a minute, and reset once a connection has stayed up', () => {
  const r = rig();
  const waits = [];
  for (let i = 0; i < 9; i++) {
    const before = Date.now();
    r.bot.connect();
    r.sockets.at(-1).close();
    waits.push(r.bot.nextAt - before);
  }
  const base = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000];
  waits.forEach((w, i) => assert.ok(w >= base[i] * .5 - 5 && w <= base[i] * 1.5 + 5, `attempt ${i}: ${w} ms for ${base[i]}`));
  // Before its wait is over the next tick does not reconnect.
  const count = r.sockets.length;
  r.bot.tick();
  assert.equal(r.sockets.length, count);
  r.bot.nextAt = 0;
  r.bot.tick();
  r.signIn();
  for (let i = 0; i < 2; i++) { r.bot.beat(); r.sockets.at(-1).emit({ method: 'pong' }); }
  const before = Date.now();
  r.sockets.at(-1).close();
  assert.ok(r.bot.nextAt - before <= 1500 + 5);
});

test('a 1013 close waits minutes; a credential close or a refused token stops reconnecting until a new token is set', () => {
  const r = rig();
  r.bot.tick(); r.signIn();
  const before = Date.now();
  r.sockets[0].fire('close', { code: 1013, reason: 'Demo capacity reached; try after daily reset' });
  assert.ok(r.bot.nextAt - before >= 300000);

  r.bot.nextAt = 0; r.bot.tick(); r.signIn();
  r.sockets[1].fire('close', { code: 1008, reason: 'Bot token replaced' });
  r.bot.nextAt = 0; r.bot.tick();
  assert.equal(r.sockets.length, 2);
  assert.equal(r.bot.error, 'apron-signed-out');

  r.bot.use('wss://apron.test/', 'bad');
  assert.equal(r.sockets.length, 3);
  r.sockets[2].emit({ method: 'server', params: {} });
  r.sockets[2].emit({ id: 'auth', error: { code: -32001, message: 'Bot token is not valid' } });
  r.bot.nextAt = 0; r.bot.tick();
  assert.equal(r.sockets.length, 3);
  assert.equal(r.bot.error, 'apron-auth-denied');

  r.bot.use('wss://apron.test/', 'good');
  r.sockets[3].emit({ method: 'server', params: {} });
  const limited = Date.now();
  r.sockets[3].emit({ id: 'auth', error: { code: -32002, message: 'Connection limit reached for this account', data: { retry_after: 60 } } });
  assert.ok(r.bot.nextAt - limited >= 60000);
  r.bot.nextAt = 0; r.bot.tick();
  assert.equal(r.sockets.length, 5);
});

test('a handshake that fails before the server frame is probed once for its reason and Retry-After', async () => {
  const asked = [];
  const r = rig({ request: async url => { asked.push(url); return new Response(JSON.stringify({ error: 'Connection attempts exceeded' }), { status: 429, headers: { 'Retry-After': '120', 'Apron-Connection-Status': '1' } }); } });
  const before = Date.now();
  r.bot.tick();
  r.sockets[0].close();
  await r.timers.tick(0);
  assert.deepEqual(asked, ['https://apron.test/?apron_connection_status=1']);
  assert.ok(r.bot.nextAt - before >= 120000);
  assert.equal(r.bot.error, 'handshake-429');
  r.bot.nextAt = 0; r.bot.tick(); r.sockets[1].close();
  await r.timers.tick(0);
  assert.equal(asked.length, 1);
});

test('a post is cut to the 4,096 UTF-8 bytes a message may hold, at a code point', () => {
  const r = rig();
  r.bot.tick(); r.signIn();
  const text = r.bot.fit('🍳'.repeat(1500));
  assert.ok(Buffer.byteLength(text) <= 4096);
  assert.equal(text, '🍳'.repeat(1024));
});
