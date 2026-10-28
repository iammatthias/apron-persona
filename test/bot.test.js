import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { settings, guardrails } from '../src/settings.js';
const classified = { choices: [{ message: { content: JSON.stringify({ learn: .9, reply: .9, warmth: 'balanced', playfulness: 'balanced', curiosity: 'balanced', expressiveness: 'balanced' }) } }] };
const env = { APRON_URL: 'wss://apron.test/', APRON_TOKEN: 't', OPENROUTER_API_KEY: 'k', ROOMS: 'general', HALF_LIFE_DAYS: '30', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', DECISION_MODEL: 'd', CHAT_MODEL: 'c' };
// A fake Apron connection that records sent frames and acknowledges each new post; `emit` delivers server frames.
function socket() {
  const listeners = {}, sent = [];
  return {
    sent, readyState: 1,
    addEventListener(type, f) { (listeners[type] ??= []).push(f); },
    emit(frame) { listeners.message?.forEach(f => f({ data: JSON.stringify(frame) })); },
    close() { this.readyState = 3; listeners.close?.forEach(f => f({ type: 'close', code: 1006, reason: '' })); },
    send(raw) {
      const frame = JSON.parse(raw); sent.push(frame);
      if (frame.method === 'message' && !frame.params.deleted) queueMicrotask(() => this.emit({ id: frame.id, result: { message_id: `posted-${frame.id}` } }));
    },
  };
}
function fixture(request, load = () => ({})) {
  const saved = [], ws = socket();
  const bot = new Bot(env, { load, save: s => saved.push(JSON.stringify(s)) }, { connect: () => ws, request });
  return { bot, ws, saved };
}
test('transcript stays in memory and persists only aggregate weights', async () => {
  const { bot, saved } = fixture();
  bot.self = 'bot_me'; bot.ws = {}; bot.ready = true;
  let calls = 0; bot.api = async () => { ++calls; return classified; };
  const p = { room_id: 'general', message_id: '42', from: { user_id: 'alice' }, body: { text: 'private-content-canary' } };
  await bot.handle(p); await bot.handle(p); bot.save();
  assert.equal(calls, 1);
  assert.ok(saved.every(s => !s.includes('private-content-canary') && !s.includes('alice')));
  bot.context[0].at = Date.now() - 300001; bot.prune(); assert.equal(bot.context.length, 0);
});
test('daily budget prevents an upstream request', async () => {
  let requested = false;
  const { bot } = fixture(async () => { requested = true; });
  bot.budget = { day: new Date().toISOString().slice(0, 10), calls: 40 };
  await assert.rejects(bot.api({}), /budget/);
  assert.equal(requested, false);
});
test('authenticates silently and replies only to a mention', async () => {
  const kinds = [];
  const { bot, ws } = fixture(async (url, init) => {
    const kind = JSON.parse(init.body).temperature === 0 ? 'classify' : 'reply'; kinds.push(kind);
    return Response.json(kind === 'classify' ? classified : { choices: [{ message: { content: 'hi there' } }] });
  });
  bot.tick();
  ws.emit({ method: 'server', params: {} });
  assert.deepEqual(ws.sent.at(-1), { method: 'auth', id: 'auth', params: { scheme: 'token', token: 't' } });
  ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  assert.deepEqual(ws.sent.slice(1).map(f => f.method), ['room_join']);
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '11', from: { user_id: 'bob' }, body: { text: 'just chatting' } } });
  await bot.queue;
  assert.equal(ws.sent.filter(f => f.method === 'message').length, 0);
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '12', from: { user_id: 'carol' }, body: { text: 'hey @bot_me' } } });
  await bot.queue;
  assert.deepEqual(kinds, ['classify', 'classify', 'reply']);
  assert.deepEqual(ws.sent.at(-1).params, { room_id: 'general', body: { text: 'hi there' }, reply_to: { message_id: '12' } });
  assert.equal(ws.sent.filter(f => f.method === 'message').length, 1);
});
test('lists only its own live posts and deletes by message id', async () => {
  const { bot, ws } = fixture();
  bot.tick();
  ws.emit({ method: 'server', params: {} });
  ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  const listing = bot.posts();
  const history = ws.sent.at(-1);
  assert.deepEqual(history.params, { room_id: 'general', limit: 200 });
  const m = (id, user_id, extra) => ({ room_id: 'general', message_id: id, log_id: id, from: { user_id }, body: { text: id }, ...extra });
  ws.emit({ id: history.id, result: { messages: [m('1', 'bot_me'), m('2', 'carol'), m('3', 'bot_me', { deleted: true, body: undefined }), m('4', 'bot_me')] } });
  assert.deepEqual((await listing).map(x => x.message_id), ['4', '1']);
  const removal = bot.remove('general', '4');
  assert.deepEqual(ws.sent.at(-1).params, { room_id: 'general', message_id: '4', deleted: true });
  ws.emit({ id: ws.sent.at(-1).id, result: { message_id: '4' } });
  await removal;
});
test('switching server or token reconnects with the new credentials', () => {
  const sockets = [];
  const bot = new Bot({ ...env }, { load: () => ({}), save: () => {} }, { connect: url => { const ws = socket(); ws.url = url; sockets.push(ws); return ws; } });
  bot.tick();
  bot.use('wss://other.test/ws', 'apron_bot_new');
  assert.equal(sockets.length, 2); assert.equal(sockets[0].readyState, 3); assert.equal(sockets[1].url, 'wss://other.test/ws');
  sockets[1].emit({ method: 'server', params: {} });
  assert.equal(sockets[1].sent.at(-1).params.token, 'apron_bot_new');
});
test('without a token it waits instead of connecting', () => {
  let connects = 0;
  const bot = new Bot({ ...env, APRON_TOKEN: '' }, { load: () => ({}), save: () => {} }, { connect: () => { ++connects; return socket(); } });
  bot.tick();
  assert.equal(connects, 0); assert.equal(bot.status().error, 'no-apron-token');
});
function connected(request) {
  const f = fixture(request);
  f.bot.tick();
  f.ws.emit({ method: 'server', params: {} });
  f.ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  return f;
}
const reply = (ws, result) => ws.emit({ id: ws.sent.at(-1).id, result });
test('a post whose newest snapshot is a tombstone is gone from the feed', async () => {
  const { bot, ws } = connected();
  const listing = bot.posts();
  reply(ws, { messages: [
    { room_id: 'general', message_id: '7', log_id: '7', from: { user_id: 'bot_me' }, body: { text: 'hello' } },
    { room_id: 'general', message_id: '7', log_id: '8', prev_log_id: '7', from: { user_id: 'bot_me' }, deleted: true },
    { room_id: 'general', message_id: '9', log_id: '9', from: { user_id: 'bot_me' }, body: { text: 'first' } },
    { room_id: 'general', message_id: '9', log_id: '10', prev_log_id: '9', from: { user_id: 'bot_me' }, body: { text: 'edited' } },
  ] });
  assert.deepEqual((await listing).map(m => m.body.text), ['edited']);
});
test('paused, it ignores messages even when mentioned', async () => {
  let calls = 0;
  const { bot, ws } = connected(async () => { ++calls; });
  bot.configure({ paused: true });
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '12', from: { user_id: 'carol' }, body: { text: 'hey @bot_me' } } });
  await bot.queue;
  assert.equal(calls, 0); assert.equal(bot.status().paused, true);
});
test('it takes its name from the server and never asks to rename', () => {
  const { bot, ws } = fixture();
  assert.equal(bot.name, 'Persona');
  bot.tick();
  ws.emit({ method: 'server', params: {} });
  ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Owner Bot' } } });
  assert.equal(bot.name, 'Owner Bot');
  assert.deepEqual(ws.sent.map(f => f.method), ['auth', 'room_join']);
});
test('configure applies nothing unless every key parses', () => {
  const { bot, saved } = fixture();
  assert.throws(() => bot.configure({ persona: 'Hello', mood: 'x' }), { message: 'unknown setting mood' });
  assert.throws(() => bot.configure({ persona: 'Hello', paused: 'maybe' }), { message: 'paused is on or off' });
  assert.throws(() => bot.configure({ name: 'Ghost' }), { message: 'unknown setting name' });
  assert.deepEqual(bot.settings, { persona: settings.persona.default(), paused: false });
  assert.equal(saved.length, 0);
});
test('a legacy state.json with top-level name and paused migrates into settings', async () => {
  const personality = { version: 1, at: 0, cells: {} };
  const { bot, saved } = fixture(undefined, () => ({ personality, budget: { day: '', calls: 0 }, name: 'Old Ghost', paused: true }));
  assert.deepEqual(bot.settings, { persona: settings.persona.default(), paused: true });
  bot.save();
  assert.deepEqual(JSON.parse(saved[0]), { personality, budget: { day: '', calls: 0 }, settings: { persona: settings.persona.default(), paused: true } });
});
test('a saved persona persists and becomes the next reply\'s system message', async () => {
  const bodies = [];
  const { bot, ws, saved } = connected(async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    return Response.json(body.temperature === 0 ? classified : { choices: [{ message: { content: 'arr' } }] });
  });
  bot.configure({ persona: 'You are {name}, a pirate.' });
  assert.equal(JSON.parse(saved.at(-1)).settings.persona, 'You are {name}, a pirate.');
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '12', from: { user_id: 'carol' }, body: { text: 'hey @bot_me' } } });
  await bot.queue;
  assert.deepEqual(bodies.at(-1).messages[0], { role: 'system', content: `You are Persona, a pirate. Your style scores from 0 to 1 are {"warmth":0.5,"playfulness":0.5,"curiosity":0.5,"expressiveness":0.5}. Higher means warmer, more playful, more curious, more expressive. ${guardrails}` });
  assert.equal(ws.sent.at(-1).params.body.text, 'arr');
});
// A model that classifies with `scores` (or answers `classify` raw) and replies with `text`, or fails with a status.
const model = ({ scores = { learn: .9, reply: .9 }, classify, text = 'hi there', status = 200, replyStatus = 200 } = {}) => async (url, init) => {
  if (JSON.parse(init.body).temperature === 0) {
    if (status !== 200) return new Response('', { status });
    return Response.json({ choices: [{ message: { content: classify ?? JSON.stringify({ ...JSON.parse(classified.choices[0].message.content), ...scores }) } }] });
  }
  return replyStatus === 200 ? Response.json({ choices: [{ message: { content: text } }] }) : new Response('', { status: replyStatus });
};
let ids = 100;
// Delivers one message frame and returns the message events it recorded, without their times.
async function deliver({ bot, ws }, params = {}, text = 'hey @bot_me') {
  const before = bot.log.list().at(-1)?.at;
  const message_id = String(++ids);
  ws.emit({ method: 'message', params: { room_id: 'general', message_id, from: { user_id: 'carol' }, body: { text }, ...params } });
  await bot.queue;
  return bot.log.list(before).filter(e => e.kind === 'message').map(({ at, kind, text, ...e }) => ({ ...e, message_id: e.message_id === message_id ? 'this' : e.message_id }));
}
const seen = (outcome, extra = {}) => [{ room: 'general', message_id: 'this', from: 'carol', mentioned: true, outcome, ...extra }];
const flat = [.5, .5, .5, .5];
test('each skipped frame records exactly one message event naming why', async () => {
  const f = connected(model());
  assert.deepEqual(await deliver(f, { room_id: 'random' }), [{ room: 'random', message_id: 'this', from: 'carol', mentioned: true, outcome: 'other-room' }]);
  assert.deepEqual(await deliver(f, { from: { user_id: 'bot_alice' } }), [{ room: 'general', message_id: 'this', from: 'bot_alice', mentioned: true, outcome: 'from-bot' }]);
  assert.deepEqual(await deliver(f, { from: { user_id: 'bot_me' } }, 'mine'), [{ room: 'general', message_id: 'this', from: 'bot_me', mentioned: false, outcome: 'own' }]);
  assert.deepEqual(await deliver(f, { deleted: true, body: undefined }), seen('deleted', { mentioned: false }));
  assert.deepEqual(await deliver(f, {}, '   '), seen('empty', { mentioned: false }));
  f.bot.configure({ paused: true });
  assert.deepEqual(await deliver(f), seen('paused'));
});
test('a frame before sign-in is stale, and a fifth queued frame is busy', async () => {
  const f = fixture(model());
  f.bot.tick(); f.ws.emit({ method: 'server', params: {} });
  assert.deepEqual(await deliver(f, {}, 'hello'), seen('stale', { mentioned: false }));
  assert.deepEqual(await deliver(f, { room_id: undefined, from: { user_id: '~private' } }, 'welcome'), [{ message_id: 'this', from: '~private', mentioned: false, outcome: 'other-room' }]);
  let release; const gate = new Promise(r => release = r);
  const g = connected(async (...a) => { await gate; return model()(...a); });
  for (const n of [1, 2, 3, 4, 5]) g.ws.emit({ method: 'message', params: { room_id: 'general', message_id: `q${n}`, from: { user_id: `u${n}` }, body: { text: `hey @bot_me ${n}` } } });
  assert.deepEqual(g.bot.log.list().filter(e => e.kind === 'message').map(e => [e.message_id, e.outcome]), [['q5', 'busy']]);
  release(); await g.bot.queue;
  assert.deepEqual(g.bot.log.list().filter(e => e.kind === 'message').map(e => [e.message_id, e.outcome]), [['q5', 'busy'], ['q1', 'replied'], ['q2', 'cooldown'], ['q3', 'cooldown'], ['q4', 'cooldown']]);
});
test('duplicates and a sender already counted are skipped before any call', async () => {
  let calls = 0;
  const f = connected(async (...a) => { ++calls; return model()(...a); });
  assert.deepEqual(await deliver(f, {}, 'nice weather'), seen('learned-only', { mentioned: false, learn_p: .9, reply_p: .9, style: flat }));
  assert.deepEqual(await deliver(f, {}, 'nice  WEATHER'), seen('duplicate', { mentioned: false }));
  assert.deepEqual(await deliver(f, {}, 'something else'), seen('rate-limited', { mentioned: false }));
  assert.equal(calls, 1);
  assert.deepEqual(await deliver(f, {}, 'and you @bot_me'), seen('replied', { learn_p: .9, reply_p: .9 }));
});
test('a message event names its sender, and a pong times the ping', async () => {
  const f = connected(model());
  assert.deepEqual(await deliver(f, { from: { user_id: 'carol', name: 'Carol '.repeat(20) } }, 'nice weather'),
    seen('learned-only', { name: 'Carol '.repeat(20).slice(0, 64), mentioned: false, learn_p: .9, reply_p: .9, style: flat }));
  assert.equal(f.bot.details().latency, null);
  f.bot.tick();
  assert.equal(f.ws.sent.at(-1).method, 'ping');
  f.bot.pingedAt -= 40;
  f.ws.emit({ method: 'pong' });
  assert.ok(f.bot.details().latency >= 40 && f.bot.details().latency < 1000);
});
test('a mention can be declined, cooled down, or out of budget', async () => {
  assert.deepEqual(await deliver(connected(model({ scores: { reply: .4 } }))), seen('declined', { learn_p: .9, reply_p: .4, style: flat }));
  const f = connected(model());
  assert.deepEqual(await deliver(f), seen('replied', { learn_p: .9, reply_p: .9, style: flat }));
  assert.deepEqual(await deliver(f, { from: { user_id: 'dave' } }, 'again @bot_me'), [{ ...seen('cooldown', { learn_p: .9, reply_p: .9, style: flat })[0], from: 'dave' }]);
  const g = connected(model());
  g.bot.budget = { day: new Date().toISOString().slice(0, 10), calls: 40 };
  assert.deepEqual(await deliver(g), seen('budget'));
});
test('classification and reply failures carry their code', async () => {
  assert.deepEqual(await deliver(connected(model({ classify: 'not json' }))), seen('classify-failed', { detail: 'invalid-decision' }));
  assert.deepEqual(await deliver(connected(model({ status: 500 }))), seen('classify-failed', { detail: 'inference-500' }));
  const empty = connected(model({ text: '  ' }));
  assert.deepEqual(await deliver(empty), seen('reply-empty', { learn_p: .9, reply_p: .9, style: flat }));
  assert.equal(empty.ws.sent.filter(f => f.method === 'message').length, 0);
  assert.deepEqual(await deliver(connected(model({ replyStatus: 503 }))), seen('reply-failed', { learn_p: .9, reply_p: .9, style: flat, detail: 'inference-503' }));
});
test('only messages that engage the bot keep their text, and a reply records what was posted', async () => {
  const quiet = 'quiet-canary', engaged = 'engaged-canary @bot_me';
  for (const m of [model({ text: 'model-canary' }), model({ scores: { reply: .1 } }), model({ text: '' }), model({ classify: 'x' })]) {
    const f = connected(m);
    await deliver(f, {}, quiet); await deliver(f, { from: { user_id: 'dave' } }, engaged);
    const messages = f.bot.log.list().filter(e => e.kind === 'message');
    assert.equal(messages.length, 2);
    assert.ok(!JSON.stringify(f.bot.log.list()).includes('quiet-canary'));
    assert.equal(messages[1].text, engaged);
  }
  const f = connected(model({ text: ' model-canary ' }));
  await deliver(f, { reply_to: { message_id: 'm1' } }, engaged);
  const [message, posted] = f.bot.log.list().slice(-2).map(({ at, ...e }) => e);
  assert.deepEqual(message, { kind: 'message', room: 'general', message_id: String(ids), reply_to: 'm1', from: 'carol', mentioned: true, text: engaged, outcome: 'replied', learn_p: .9, reply_p: .9, style: flat });
  const id = f.ws.sent.at(-1).id;
  assert.deepEqual(posted, { kind: 'posted', room: 'general', message_id: `posted-${id}`, reply_to: String(ids), text: 'model-canary' });
  assert.ok(f.bot.own.has(`posted-${id}`));
});
test('nothing bound for DATA_DIR carries message or reply text', async () => {
  const f = connected(model({ text: 'model-canary' }));
  await deliver(f, {}, 'quiet-canary'); await deliver(f, { from: { user_id: 'dave' } }, 'engaged-canary @bot_me');
  f.bot.save();
  assert.equal(f.bot.log.list().filter(e => e.kind === 'posted').length, 1);
  const disk = [...f.saved, JSON.stringify(f.bot.status())].join('\n');
  for (const canary of ['quiet-canary', 'engaged-canary', 'model-canary']) assert.ok(!disk.includes(canary), canary);
});
test('connection, auth, settings, deletes and errors are recorded', async () => {
  const f = connected();
  f.bot.configure({ paused: true });
  const removal = f.bot.remove('general', '4');
  reply(f.ws, { message_id: '4' }); await removal;
  f.ws.close();
  f.bot.use('wss://other.test/', 'bad');
  f.ws.emit({ method: 'server', params: {} });
  f.ws.emit({ id: 'auth', error: { message: 'denied' } });
  f.bot.tick();
  const g = new Bot({ ...env, APRON_TOKEN: '' }, { load: () => ({}), save: () => {} }, { connect: socket });
  g.tick(); g.tick();
  assert.deepEqual([...f.bot.log.list(), ...g.log.list()].map(({ at, ...e }) => e), [
    { kind: 'connected', host: 'apron.test', user_id: 'bot_me' },
    { kind: 'settings', keys: ['paused'], paused: true },
    { kind: 'deleted', room: 'general', message_id: '4' },
    { kind: 'disconnected', reason: 'close-1006' },
    { kind: 'auth-denied' },
    { kind: 'error', code: 'apron-auth-denied' },
    { kind: 'disconnected', reason: 'auth-denied' },
    { kind: 'error', code: 'no-apron-token' },
  ]);
  assert.equal(f.bot.lastError.code, 'apron-auth-denied');
});
