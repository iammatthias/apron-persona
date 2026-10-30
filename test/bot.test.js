import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { ALONE, FOLLOWUP, LEARN_EVERY, CONTEXT, SEEN, BLOCK } from '../src/core.js';
import { margins } from '../src/events.js';
import { settings, guardrails, cue, chime, tensionsPrompt } from '../src/settings.js';
import { check, disk, never } from '../src/disk.js';
import { tally } from '../src/memory.js';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { socket } from './fakes.js';
import { snapshot } from '../src/http.js';
import { needs } from '../src/views.js';
const classified = { choices: [{ message: { content: JSON.stringify({ learn: .9, reply: .9, point: .9, warmth: 'balanced', playfulness: 'balanced', curiosity: 'balanced', expressiveness: 'balanced' }) } }] };
const env = { APRON_URL: 'wss://apron.test/', APRON_TOKEN: 't', OPENROUTER_API_KEY: 'k', ROOMS: 'general', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', DECISION_MODEL: 'd', CHAT_MODEL: 'c' };
const held = tensionsPrompt(settings.tensions.default());
const defaults = { persona: settings.persona.default(), tensions: settings.tensions.default(), revisions: [], paused: false, reply_mentions: true, reply_replies: true, reply_threshold: .7, organic: false, organic_threshold: .9, norms: {}, owner: '' };
const spoke = (user_id, room_id = 'general') => ({ room_id, message_id: `heard-${++heardIds}`, from: { user_id }, body: { text: 'hi' } });
let heardIds = 0;
function fixture(request, load = () => ({})) {
  const saved = [], ws = socket();
  const bot = new Bot(env, { load, save: s => saved.push(JSON.stringify(check('state.json', s))) }, { connect: () => ws, request });
  // A second person spoke lately, so a message isn't taken as talking to the bot just for being alone with it.
  bot.hear(spoke('zed'));
  return { bot, ws, saved };
}
test('transcript stays in memory and persists only aggregate weights', async () => {
  const { bot, ws, saved } = fixture();
  bot.self = 'bot_me'; bot.ws = ws; bot.ready = true;
  let calls = 0; bot.api = async () => { ++calls; return classified; };
  const p = { room_id: 'general', message_id: '42', from: { user_id: 'alice' }, body: { text: 'private-content-canary' } };
  await bot.handle(p); await bot.handle(p); bot.save();
  assert.equal(calls, 1);
  assert.ok(saved.every(s => !s.includes('private-content-canary') && !s.includes('alice')));
  assert.deepEqual(bot.context, [{ room: 'general', name: 'alice', content: 'private-content-canary' }]);
  for (let i = 0; i < 13; ++i) await bot.handle({ room_id: 'general', message_id: `c${i}`, from: { user_id: `u${i}` }, body: { text: `line ${i}` } });
  assert.equal(bot.context.length, CONTEXT);
  assert.deepEqual(bot.context.map(x => x.content).slice(0, 2), ['line 1', 'line 2']);
});
test('there is no call cap unless DAILY_CALLS sets a whole number', () => {
  const left = DAILY_CALLS => new Bot({ ...env, DAILY_CALLS }, { load: () => ({}), save() {} }, { connect: socket }).left();
  assert.deepEqual(['lots', '', '  ', undefined, null, 'NaN', 'Infinity', '-3', '-1', '2.5', '0.5', '1e2x'].map(left), Array(12).fill(Infinity));
  assert.deepEqual([' 12 ', '0', 7].map(left), [12, 0, 7]);
});
test('daily budget prevents an upstream request', async () => {
  let requested = false;
  const { bot } = fixture(async () => { requested = true; });
  bot.budget = { day: new Date().toISOString().slice(0, 10), calls: 40 };
  await assert.rejects(bot.api('judge', {}), /budget/);
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
  assert.deepEqual(bot.settings, defaults);
  assert.equal(saved.length, 0);
});
test('a legacy state.json with top-level name and paused migrates into settings, and a version-1 personality keeps its cells', async () => {
  const personality = { version: 1, at: 1761700000000, cells: { '4023': 2.5 } };
  const { bot, saved } = fixture(undefined, () => ({ personality, budget: { day: '', calls: 0 }, name: 'Old Ghost', paused: true }));
  assert.deepEqual(bot.settings, { ...defaults, paused: true });
  assert.deepEqual(bot.traits(), { warmth: .6, playfulness: .4, curiosity: .5, expressiveness: .55 });
  bot.save();
  assert.deepEqual(bot.memory, { rooms: {}, pages: {} });
  assert.deepEqual(JSON.parse(saved[0]), { personality: { version: 2, cells: { '4023': 2.5 }, n: 0 }, budget: { day: '', calls: 0 }, spent: {}, settings: { ...defaults, paused: true }, memory: { rooms: {}, pages: {} } });
  const broken = fixture(undefined, () => ({ personality, memory: { rooms: { general: { days: { yesterday: 'carol said hi' }, weeks: {} } } } }));
  assert.deepEqual(broken.bot.memory, { rooms: {}, pages: {} });
});
test('a saved persona persists, and a reply sees the room as one named transcript and posts a clean line', async () => {
  const bodies = [];
  const { bot, ws, saved } = connected(async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    return Response.json(body.temperature === 0 ? classified : { choices: [{ message: { content: 'Persona: "arr"' } }] });
  });
  bot.configure({ persona: 'You are {name}, a pirate.' });
  assert.equal(JSON.parse(saved.at(-1)).settings.persona, 'You are {name}, a pirate.');
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '11', from: { user_id: 'u_ana', name: 'Ana\nB' }, body: { text: 'ship ahoy' } } });
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '12', from: { user_id: 'carol' }, body: { text: 'hey @bot_me' } } });
  ws.emit({ method: 'message', params: { room_id: 'general', message_id: '13', from: { user_id: 'dave' }, body: { text: 'again @bot_me' } } });
  await bot.queue;
  assert.deepEqual(bodies.at(-1).messages, [
    { role: 'system', content: `You are Persona, a pirate. Match the room's temperament: so far it's middle of the road on every count. ${held} ${guardrails}` },
    { role: 'user', content: `Ana B: ship ahoy\ncarol: hey @bot_me\nyou: arr\ndave: again @bot_me\n\n${cue}` },
  ]);
  assert.deepEqual(posts(ws).map(m => m.body.text), ['arr', 'arr']);
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
// Delivers one message frame and returns the message events it recorded, without their times, text or spans.
async function deliver({ bot, ws }, params = {}, text = 'hey @bot_me') {
  const before = bot.log.list().at(-1)?.at;
  const message_id = String(++ids);
  ws.emit({ method: 'message', params: { room_id: 'general', message_id, from: { user_id: 'carol' }, body: { text }, ...params } });
  await bot.queue;
  return bot.log.list(before).filter(e => e.kind === 'message').map(({ at, kind, text, ms, via, hedged, ...e }) => ({ ...e, message_id: e.message_id === message_id ? 'this' : e.message_id }));
}
// The message event deliver() expects; an extra field set to undefined is absent from the event.
const seen = (outcome, extra = {}) => [Object.fromEntries(Object.entries({ room: 'general', message_id: 'this', from: 'carol', addressed: 'mention', outcome, ...extra }).filter(([, v]) => v !== undefined))];
const flat = [.5, .5, .5, .5];
test('each skipped frame records exactly one message event naming why', async () => {
  const f = connected(model());
  assert.deepEqual(await deliver(f, { room_id: 'random' }), [{ room: 'random', message_id: 'this', from: 'carol', addressed: 'mention', outcome: 'other-room' }]);
  assert.deepEqual(await deliver(f, { from: { user_id: 'bot_alice' } }), [{ room: 'general', message_id: 'this', from: 'bot_alice', addressed: 'mention', outcome: 'from-bot' }]);
  assert.deepEqual(await deliver(f, { from: { user_id: 'bot_me' } }, 'mine'), [{ room: 'general', message_id: 'this', from: 'bot_me', outcome: 'own' }]);
  assert.deepEqual(await deliver(f, { deleted: true, body: undefined }), seen('deleted', { addressed: undefined }));
  assert.deepEqual(await deliver(f, {}, '   '), seen('empty', { addressed: undefined }));
  f.bot.configure({ paused: true });
  assert.deepEqual(await deliver(f), seen('paused'));
});
test('a frame before sign-in is stale, and a fifth queued frame is busy', async () => {
  const f = fixture(model());
  f.bot.tick(); f.ws.emit({ method: 'server', params: {} });
  assert.deepEqual(await deliver(f, {}, 'hello'), seen('stale', { addressed: undefined }));
  assert.deepEqual(await deliver(f, { room_id: undefined, from: { user_id: '~private' } }, 'welcome'), [{ message_id: 'this', from: '~private', outcome: 'other-room' }]);
  let release; const gate = new Promise(r => release = r);
  const g = connected(async (...a) => { await gate; return model()(...a); });
  for (const n of [1, 2, 3, 4, 5]) g.ws.emit({ method: 'message', params: { room_id: 'general', message_id: `q${n}`, from: { user_id: `u${n}` }, body: { text: `hey @bot_me ${n}` } } });
  assert.deepEqual(g.bot.log.list().filter(e => e.kind === 'message').map(e => [e.message_id, e.outcome]), [['q5', 'busy']]);
  release(); await g.bot.queue;
  assert.deepEqual(g.bot.log.list().filter(e => e.kind === 'message').map(e => [e.message_id, e.outcome]), [['q5', 'busy'], ['q1', 'replied'], ['q2', 'replied'], ['q3', 'replied'], ['q4', 'replied']]);
});
test('duplicates and a sender already counted are skipped before any call', async () => {
  let calls = 0;
  const f = connected(async (...a) => { ++calls; return model()(...a); });
  assert.deepEqual(await deliver(f, {}, 'nice weather'), seen('learned-only', { addressed: undefined, learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.deepEqual(await deliver(f, {}, 'nice  WEATHER'), seen('duplicate', { addressed: undefined }));
  assert.deepEqual(await deliver(f, {}, 'something else'), seen('rate-limited', { addressed: undefined }));
  assert.equal(calls, 1);
  assert.deepEqual(await deliver(f, {}, 'and you @bot_me'), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9 }));
});
test('a message event names its sender, and a pong times the ping', async () => {
  const f = connected(model());
  assert.deepEqual(await deliver(f, { from: { user_id: 'carol', name: 'Carol '.repeat(20) } }, 'nice weather'),
    seen('learned-only', { name: 'Carol '.repeat(20).slice(0, 64), addressed: undefined, learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.equal(f.bot.details().latency, null);
  f.bot.tick();
  assert.equal(f.ws.sent.at(-1).method, 'ping');
  f.bot.pingedAt -= 40;
  f.ws.emit({ method: 'pong' });
  assert.ok(f.bot.details().latency >= 40 && f.bot.details().latency < 1000);
});
test('a mention can be declined or out of budget, and a second one right after the first is answered too', async () => {
  assert.deepEqual(await deliver(connected(model({ scores: { reply: .4 } }))), seen('declined', { learn_p: .9, reply_p: .4, point_p: .9, style: flat, need: .7 }));
  const f = connected(model());
  assert.deepEqual(await deliver(f), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.deepEqual(await deliver(f, { from: { user_id: 'dave' } }, 'again @bot_me'), [{ ...seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat })[0], from: 'dave' }]);
  const g = connected(model());
  g.bot.budget = { day: new Date().toISOString().slice(0, 10), calls: 40 };
  assert.deepEqual(await deliver(g), seen('budget'));
});
test('classification and reply failures carry their code', async () => {
  assert.deepEqual(await deliver(connected(model({ classify: 'not json' })), {}, 'just chatting'), seen('classify-failed', { addressed: undefined, detail: 'invalid-decision' }));
  assert.deepEqual(await deliver(connected(model({ status: 500 })), {}, 'just chatting'), seen('classify-failed', { addressed: undefined, detail: 'inference-500' }));
  const empty = connected(model({ text: '  ' }));
  assert.deepEqual(await deliver(empty), seen('reply-empty', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.equal(empty.ws.sent.filter(f => f.method === 'message').length, 0);
  assert.deepEqual(await deliver(connected(model({ replyStatus: 503 }))), seen('reply-failed', { learn_p: .9, reply_p: .9, point_p: .9, style: flat, detail: 'inference-503' }));
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
  const [{ ms, via, ...message }, posted] = f.bot.log.list().slice(-2).map(({ at, ...e }) => e);
  assert.deepEqual(message, { kind: 'message', room: 'general', message_id: String(ids), reply_to: 'm1', from: 'carol', addressed: 'mention', text: engaged, outcome: 'replied', learn_p: .9, reply_p: .9, point_p: .9, style: flat });
  assert.deepEqual(Object.keys(ms), ['context', 'judge', 'compose', 'post', 'total']);
  assert.deepEqual(via, { judge: 'd', compose: 'c' });
  const id = f.ws.sent.at(-1).id;
  assert.deepEqual(posted, { kind: 'posted', room: 'general', message_id: `posted-${id}`, reply_to: String(ids), text: 'model-canary' });
  assert.ok(f.bot.own.has(`posted-${id}`));
});
test('nothing written to DATA_DIR carries anything on the never-store list', async () => {
  const canaries = {
    'message text': ['quiet-canary', 'engaged-canary', 'chime-canary'],
    'sender names': ['Canary Name'],
    'sender user ids': ['u_canary', 'u_other'],
    'auth tokens outside apron.json': ['canary-apron-token', 'canary-openrouter-key', 'canary-hash-secret'],
    prompts: ['You classify one chat message', guardrails.slice(0, 60), cue],
    'model output': ['model-canary'],
  };
  assert.deepEqual(Object.keys(canaries), Object.keys(never));
  const dir = mkdtempSync(join(tmpdir(), 'persona-canary-'));
  try {
    const { write, load } = disk(dir), ws = socket();
    const secrets = { APRON_TOKEN: 'canary-apron-token', OPENROUTER_API_KEY: 'canary-openrouter-key', HASH_SECRET: 'canary-hash-secret' };
    const bot = new Bot({ ...env, ...secrets }, { load: () => load('state.json'), save: s => write('state.json', s) },
      { connect: () => ws, request: model({ scores: { reply: .95, point: .95 }, text: 'model-canary' }) });
    const f = { bot, ws };
    bot.hear(spoke('zed'));
    bot.tick(); ws.emit({ method: 'server', params: {} }); ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
    bot.configure({ organic: 'on' });
    assert.equal((await deliver(f, { from: { user_id: 'u_canary', name: 'Canary Name' } }, 'chime-canary'))[0].outcome, 'chimed-in');
    assert.equal((await deliver(f, { from: { user_id: 'u_other', name: 'Canary Name' } }, 'quiet-canary'))[0].outcome, 'spoke-last');
    assert.equal((await deliver(f, { from: { user_id: 'u_canary', name: 'Canary Name' } }, 'engaged-canary @bot_me'))[0].outcome, 'replied');
    bot.save(); write('status.json', bot.status());
    assert.deepEqual(posts(ws).map(m => m.body.text), ['model-canary', 'model-canary']);
    assert.deepEqual(readdirSync(dir).sort(), ['state.json', 'status.json']);
    const stored = readdirSync(dir).map(name => readFileSync(join(dir, name), 'utf8')).join('\n');
    assert.deepEqual(Object.keys(load('state.json').personality.cells), ['2222']);
    for (const canary of Object.values(canaries).flat()) assert.ok(!stored.includes(canary), canary);
  } finally { rmSync(dir, { recursive: true }); }
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
    { kind: 'error', code: 'no-apron-token' },
  ]);
  assert.equal(f.bot.lastError.code, 'apron-auth-denied');
});
const posts = ws => ws.sent.filter(f => f.method === 'message').map(f => f.params);
// While the server is unreachable, each tick's attempt dies before sign-in; only the connection that was up was lost.
test('an attempt that dies before sign-in is not another lost connection', () => {
  const sockets = [];
  const bot = new Bot({ ...env, APRON_URL: 'wss://apron.test/' }, { load: () => ({}), save: () => {} }, { connect: () => { const ws = socket(); sockets.push(ws); return ws; } });
  bot.tick();
  sockets[0].emit({ method: 'server', params: {} });
  sockets[0].emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  sockets[0].close();
  bot.tick(); sockets[1].close();
  bot.tick(); sockets[2].close();
  assert.equal(sockets.length, 3);
  assert.deepEqual(bot.log.list().map(({ at, ...e }) => e), [
    { kind: 'connected', host: 'apron.test', user_id: 'bot_me' },
    { kind: 'disconnected', reason: 'close-1006' },
  ]);
  assert.equal(bot.status().connected, false);
});
// The server may send a new `server` frame at any time, and it answers a repeated auth id with the first result.
test('a later server frame replaces the greeting without signing in or connecting again', () => {
  const ws = socket(), you = { user_id: 'bot_me', name: 'Persona' };
  const raw = ws.send.bind(ws);
  ws.send = r => { raw(r); if (JSON.parse(r).method === 'auth') ws.emit({ id: 'auth', result: { you } }); };
  const bot = new Bot(env, { load: () => ({}), save: () => {} }, { connect: () => ws });
  bot.tick();
  ws.emit({ method: 'server', params: { agent: 'x/1' } });
  const since = bot.since;
  ws.emit({ method: 'server', params: { agent: 'x/2' } });
  assert.equal(bot.server.agent, 'x/2');
  assert.deepEqual(ws.sent.map(f => f.method), ['auth', 'room_join']);
  assert.deepEqual(bot.log.list().map(e => e.kind), ['connected']);
  assert.equal(bot.since, since);
});
test('a mention or a reply whose trigger is off is let be, without a classifier call when nothing is learned', async () => {
  let calls = 0;
  const f = connected(async (...a) => { ++calls; return model()(...a); });
  f.bot.configure({ reply_mentions: false });
  assert.deepEqual(await deliver(f), seen('trigger-off', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.deepEqual(await deliver(f, {}, 'again @bot_me'), seen('trigger-off'));
  assert.equal(calls, 1);
  assert.equal(f.bot.log.list().filter(e => e.kind === 'message').at(-1).text, 'again @bot_me');
  const g = connected(model());
  assert.deepEqual(await deliver(g), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  const mine = g.bot.log.list().find(e => e.kind === 'posted').message_id;
  g.bot.configure({ reply_replies: false });
  assert.deepEqual(await deliver(g, { from: { user_id: 'dave' }, reply_to: { message_id: mine } }, 'meaning what'), [{ ...seen('trigger-off', { addressed: 'reply', reply_to: mine, learn_p: .9, reply_p: .9, point_p: .9, style: flat })[0], from: 'dave' }]);
  assert.deepEqual(await deliver(g, { from: { user_id: 'erin' }, reply_to: { message_id: mine } }, 'meaning what @bot_me'), [{ ...seen('replied', { reply_to: mine, learn_p: .9, reply_p: .9, point_p: .9, style: flat })[0], from: 'erin' }]);
  g.bot.configure({ reply_replies: true, reply_mentions: false });
  assert.deepEqual(await deliver(g, { from: { user_id: 'finn' }, reply_to: { message_id: mine } }, 'and @bot_me'), [{ ...seen('replied', { addressed: 'reply', reply_to: mine, learn_p: .9, reply_p: .9, point_p: .9, style: flat })[0], from: 'finn' }]);
  assert.equal(posts(g.ws).length, 3);
});
test('the reply bar follows the settings, and the clock never gates a mention', async () => {
  const f = connected(model({ scores: { reply: .74 } }));
  f.bot.configure({ reply_threshold: '0.75' });
  assert.deepEqual(await deliver(f), seen('declined', { learn_p: .9, reply_p: .74, point_p: .9, style: flat, need: .75 }));
  f.bot.configure({ reply_threshold: '0.70' });
  for (const [user_id, text] of [['dave', 'one @bot_me'], ['erin', 'two @bot_me'], ['finn', 'three @bot_me']])
    assert.deepEqual(await deliver(f, { from: { user_id } }, text), [{ ...seen('replied', { learn_p: .9, reply_p: .74, point_p: .9, style: flat })[0], from: user_id }]);
  assert.equal(posts(f.ws).length, 3);
  assert.throws(() => f.bot.configure({ cooldown: '60' }), { message: 'unknown setting cooldown' });
});
const unaddressed = (outcome, extra) => seen(outcome, { addressed: undefined, learn_p: .9, ...extra });
test('a chime-in posts a plain message, records it as posted, and keeps the text it answered', async () => {
  const prompts = [], answer = model({ scores: { reply: .93 }, text: 'the broth is the point' });
  const f = connected(async (url, init) => { prompts.push(JSON.parse(init.body).messages.at(-1).content); return answer(url, init); });
  assert.deepEqual(await deliver(f, {}, 'ramen tonight?'), unaddressed('learned-only', { reply_p: .93, point_p: .9, style: flat }));
  assert.equal(posts(f.ws).length, 0);
  f.bot.configure({ organic: 'on' });
  assert.deepEqual(await deliver(f, { from: { user_id: 'dave' } }, 'anyone tried the new ramen place'), [{ ...unaddressed('chimed-in', { reply_p: .93, point_p: .9, style: flat })[0], from: 'dave' }]);
  assert.deepEqual(posts(f.ws), [{ room_id: 'general', body: { text: 'the broth is the point' } }]);
  assert.equal(prompts.at(-1), `carol: ramen tonight?\ndave: anyone tried the new ramen place\n\n${chime}`);
  const [message, posted] = f.bot.log.list().slice(-2).map(({ at, ...e }) => e);
  assert.equal(message.text, 'anyone tried the new ramen place');
  assert.deepEqual(posted, { kind: 'posted', room: 'general', message_id: `posted-${f.ws.sent.at(-1).id}`, organic: true, text: 'the broth is the point' });
  assert.ok(f.bot.own.has(posted.message_id));
});
test('a busy room gets a chime-in at most once per four messages from others', async () => {
  // Each message comes from someone new, so each is sized up and only the chime-in rule decides.
  const f = connected(model({ scores: { learn: .5, reply: .95, point: .95 } }));
  f.bot.configure({ organic: 'on' });
  const outcomes = [];
  for (let i = 1; i <= 9; ++i) outcomes.push((await deliver(f, { from: { user_id: `u${i}` } }, `thought ${i}`))[0].outcome);
  assert.deepEqual(outcomes, ['chimed-in', 'spoke-last', 'spoke-last', 'spoke-last', 'chimed-in', 'spoke-last', 'spoke-last', 'spoke-last', 'chimed-in']);
  assert.equal(posts(f.ws).length, 3);
});
test('organic is held back below its bar, waits four messages after a post, and costs no extra classifier call', async () => {
  const count = async organic => {
    let calls = 0;
    const f = connected(async (url, init) => { if (JSON.parse(init.body).temperature === 0) ++calls; return model({ scores: { reply: .8 } })(url, init); });
    f.bot.configure({ organic });
    const outcomes = [];
    for (const [user_id, text] of [['a', 'one'], ['a', 'two'], ['b', 'three'], ['b', 'four'], ['c', 'five']]) outcomes.push((await deliver(f, { from: { user_id } }, text))[0].outcome);
    return { calls, outcomes, text: f.bot.log.list().some(e => e.text) };
  };
  assert.deepEqual(await count('off'), { calls: 3, outcomes: ['learned-only', 'rate-limited', 'learned-only', 'rate-limited', 'learned-only'], text: false });
  assert.deepEqual(await count('on'), { calls: 3, outcomes: ['held-back', 'rate-limited', 'held-back', 'rate-limited', 'held-back'], text: false });
  const f = connected(model({ scores: { reply: .95 } }));
  f.bot.configure({ organic: 'on' });
  assert.equal((await deliver(f, {}, 'first'))[0].outcome, 'chimed-in');
  const [quiet] = await deliver(f, { from: { user_id: 'dave' } }, 'second');
  assert.equal(quiet.outcome, 'spoke-last');
  assert.equal(f.bot.log.list().filter(e => e.kind === 'message').at(-1).text, undefined);
  assert.equal(posts(f.ws).length, 1);
  assert.equal((await deliver(f, { from: { user_id: 'erin' } }, 'third'))[0].outcome, 'spoke-last');
  assert.equal((await deliver(f, { from: { user_id: 'finn' } }, 'fourth'))[0].outcome, 'spoke-last');
  assert.equal(posts(f.ws).length, 1);
  assert.equal((await deliver(f, { from: { user_id: 'gina' } }, 'fifth'))[0].outcome, 'chimed-in');
  assert.equal(posts(f.ws).length, 2);
});
test('a welcome chime-in with nothing specific to add stays quiet and keeps no text', async () => {
  const f = connected(model({ scores: { reply: .95, point: .42 } }));
  f.bot.configure({ organic: 'on' });
  assert.deepEqual(await deliver(f, {}, 'long day'), unaddressed('nothing-to-add', { reply_p: .95, point_p: .42, style: flat, need: .9 }));
  assert.equal(posts(f.ws).length, 0);
  assert.equal(f.bot.log.list().filter(e => e.kind === 'message').at(-1).text, undefined);
  assert.equal(f.bot.log.list().filter(e => e.kind === 'message').at(-1).point_p, .42);
});
test('the room memory counts only messages it classified, by block and topic, with no extra classifier call', async () => {
  let calls = 0;
  const answer = model({ scores: { reply: .95, point: .95, topic: 'deploys', warmth: 'high' } });
  const f = connected(async (url, init) => { if (JSON.parse(init.body).temperature === 0) ++calls; return answer(url, init); });
  f.bot.configure({ organic: 'on' });
  const outcomes = [];
  for (const [params, text] of [[{}, 'did it ship'], [{}, 'did it ship'], [{}, 'anyone?'], [{ from: { user_id: 'dave' } }, 'deploy @bot_me'], [{ room_id: 'random' }, 'elsewhere'], [{ from: { user_id: 'bot_other' } }, 'beep']])
    outcomes.push((await deliver(f, params, text))[0].outcome);
  assert.deepEqual(outcomes, ['chimed-in', 'duplicate', 'rate-limited', 'replied', 'other-room', 'from-bot']);
  assert.equal(calls, 2);
  assert.deepEqual(f.bot.memory, { rooms: { general: { open: { topics: { deploys: { messages: 2, engaged: 1, replies: 1, chimes: 1 } }, learned: 2, lean: [1, 0, 0, 0] }, blocks: [], folds: [], closed: 0 } }, pages: { general: { closed: 0, mostly: [], some: [], shifts: [] } } });
  const failed = connected(model({ status: 500 }));
  assert.equal((await deliver(failed))[0].outcome, 'replied');
  assert.deepEqual(failed.bot.memory.rooms, {});
});
test('room notes are rebuilt when a block closes, byte-stable while one fills, and follow the norms at once', async () => {
  const f = connected(model());
  const count = (topic, n) => { for (let i = 0; i < n; ++i) tally(f.bot.memory, 'general', { topic, engaged: false, outcome: 'learned-only' }); };
  count('code', BLOCK);
  const first = f.bot.notes('general');
  assert.equal(first, 'In #general lately: mostly code.');
  count('music', BLOCK - 1);
  assert.equal(f.bot.notes('general'), first);
  f.bot.configure({ norms: { general: 'no spoilers' } });
  assert.equal(f.bot.notes('general'), 'In #general lately: mostly code. Norms: no spoilers');
  count('music', 1);
  assert.equal(f.bot.notes('general'), 'In #general lately: mostly code and music. Norms: no spoilers');
  assert.deepEqual(f.bot.memory.pages.general, { closed: 2, mostly: ['code', 'music'], some: [], shifts: [] });
  assert.deepEqual(f.bot.log.list().filter(e => e.kind === 'settings').map(({ at, ...e }) => e), [{ kind: 'settings', keys: ['norms'] }]);
  f.bot.configure({ norms: { general: 'no spoilers' } });
  assert.equal(f.bot.log.list().filter(e => e.kind === 'settings').length, 1);
});
test('a reply carries its room notes in the system prompt, before the tensions and the guardrails', async () => {
  let system;
  const f = connected(async (url, init) => { const body = JSON.parse(init.body); if (body.temperature !== 0) system = body.messages[0].content; return model()(url, init); });
  f.bot.configure({ norms: { general: 'english only' } });
  await deliver(f);
  assert.equal(system, `${settings.persona.default().split('{name}').join('Persona')} Match the room's temperament: so far it's middle of the road on every count. Norms: english only ${held} ${guardrails}`);
});
test('saving settings records only the values that changed', () => {
  const { bot } = connected();
  bot.configure({ reply_mentions: 'on', reply_replies: 'on', reply_threshold: '0.7', organic: 'on', organic_threshold: '0.95' });
  bot.configure({ organic: 'on' });
  assert.deepEqual(bot.log.list().filter(e => e.kind === 'settings').map(({ at, ...e }) => e), [{ kind: 'settings', keys: ['organic', 'organic_threshold'], organic: true, organic_threshold: .95 }]);
});
test('a mention is answered even when sizing it up fails, and learns nothing', async () => {
  const f = connected(model({ status: 500 }));
  assert.deepEqual(await deliver(f), seen('replied', { detail: 'inference-500' }));
  assert.equal(f.ws.sent.filter(x => x.method === 'message').length, 1);
  assert.deepEqual(f.bot.state.cells, {});
  assert.equal(margins.replied.say({ detail: 'timeout' }), "answered, though I couldn't size it up first (timeout).");
});
test('a failed or empty reply moves to the next model, and the chain ends with the last answer', async () => {
  let replies = 0;
  const flaky = async (url, init) => JSON.parse(init.body).temperature === 0
    ? model()(url, init)
    : ++replies === 1 ? new Response('', { status: 503 }) : Response.json({ choices: [{ message: { content: 'second try' } }] });
  const f = connected(flaky);
  assert.deepEqual(await deliver(f), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.equal(replies, 2);
  assert.equal(f.ws.sent.filter(x => x.method === 'message').at(-1).params.body.text, 'second try');
  let calls = 0;
  const empty = connected(async (url, init) => { if (JSON.parse(init.body).temperature !== 0) ++calls; return model({ text: '' })(url, init); });
  assert.deepEqual(await deliver(empty), seen('reply-empty', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.equal(calls, 2);
});
test('a reply is written from the room history Apron holds, up to the message answered', async () => {
  let prompt;
  const f = connected(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.temperature !== 0) prompt = body.messages[1].content;
    return model()(url, init);
  });
  const m = (id, user_id, name, text, extra) => ({ room_id: 'general', message_id: id, log_id: id, from: { user_id, name }, body: { text }, ...extra });
  const next = String(ids + 1);
  f.ws.history = [
    m('50', 'ana', 'Ana', 'is the deploy done'), m('51', 'bot_me', 'Persona', 'it shipped an hour ago'),
    m('52', 'ben', 'Ben', 'gone', { deleted: true }), m('53', '~room', 'notice', 'joined'),
    m(next, 'carol', 'Carol', 'hey @bot_me'), m('99999', 'dave', 'Dave', 'after the mention'),
  ];
  await deliver(f);
  assert.equal(prompt.split('\n\n')[0], 'Ana: is the deploy done\nyou: it shipped an hour ago\nCarol: hey @bot_me');
});
test('status folds a server agent string to one bounded line', () => {
  const { bot } = connected(model());
  bot.server = { agent: 'weird\nagent\t' + 'x'.repeat(300) };
  const agent = bot.status().server.agent;
  assert.ok(!/\s{2}|\n|\t/.test(agent)); assert.equal(agent.length, 200); assert.ok(agent.startsWith('weird agent x'));
});
test('a state.json section that would not pass the write check loads as its default, and a day-bucket memory starts over', () => {
  const bucket = { topics: { code: { messages: 1, engaged: 0, replies: 0, chimes: 0 } }, learned: 0, lean: [0, 0, 0, 0] };
  const { bot, saved } = fixture(undefined, () => ({
    personality: { version: 1, at: 0, cells: { bad: 'x' } }, budget: { day: 'yesterday', calls: -1 },
    memory: { rooms: { general: { days: { '2026-10-28': bucket }, weeks: { '2026-10-19': bucket } } }, pages: { general: { day: '2026-10-28', mostly: ['code'], some: [], pace: null, shifts: [] } } },
  }));
  assert.deepEqual(bot.state.cells, {});
  assert.deepEqual(bot.budget, { day: '', calls: 0 });
  assert.deepEqual(bot.memory, { rooms: {}, pages: {} });
  bot.save();
  assert.deepEqual(JSON.parse(saved[0]).memory, { rooms: {}, pages: {} });
});
test('a state.json from before calls were sorted by role loads with the day\'s calls intact and saves the counter', () => {
  const day = new Date().toISOString().slice(0, 10);
  const { bot, saved } = fixture(undefined, () => ({ personality: { version: 1, at: 0, cells: {} }, budget: { day, calls: 30 }, settings: defaults, memory: { rooms: {}, pages: {} } }));
  assert.deepEqual([bot.budget, bot.spent], [{ day, calls: 30 }, {}]);
  bot.save();
  assert.deepEqual(JSON.parse(saved[0]).spent, {});
  const bad = fixture(undefined, () => ({ budget: { day, calls: 3 }, spent: { judge: { calls: 3, hedges: 0, retries: 0 }, carol: { calls: 1, hedges: 0, retries: 0 } } }));
  assert.deepEqual([bad.bot.budget, bad.bot.spent], [{ day, calls: 3 }, {}]);
});
test('a state.json from before the clock guards went loads without them and saves cleanly', () => {
  const personality = { version: 1, at: 0, cells: {} };
  const { bot, saved } = fixture(undefined, () => ({ personality, budget: { day: '', calls: 0 }, settings: { ...defaults, cooldown: 15, organic_gap: 30, organic: true }, memory: { rooms: {}, pages: {} } }));
  assert.deepEqual(bot.settings, { ...defaults, organic: true });
  bot.save();
  assert.deepEqual(JSON.parse(saved[0]).settings, { ...defaults, organic: true });
});
test('a refused state write is recorded and the bot carries on', () => {
  const { bot } = fixture();
  bot.store.save = () => { throw Error('refused to store state.json'); };
  bot.save();
  assert.equal(bot.status().error, 'state-refused');
  assert.equal(bot.dirty, false);
});
test('a message that names the bot without tagging it is answered like a mention', async () => {
  const f = connected(model());
  assert.deepEqual(await deliver(f, {}, 'bot, you there?'), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  assert.equal(f.ws.sent.filter(x => x.method === 'message').length, 1);
});
test('alone with the bot, or just answered by it, a sender is talking to it', async () => {
  const solo = connected(model());
  solo.bot.heard.clear();
  assert.deepEqual(await deliver(solo, {}, 'you there?'), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  const crowd = connected(model({ scores: { learn: .9, reply: .9, point: .1 } }));
  crowd.bot.configure({ organic: 'on' });
  assert.equal((await deliver(crowd, {}, 'lunch anyone?'))[0].outcome, 'nothing-to-add');
  assert.equal((await deliver(crowd, { from: { user_id: 'carol' } }, 'hey @bot_me, lunch?'))[0].outcome, 'replied');
  // Answered, carol's next lines are follow-ups for FOLLOWUP messages of the room, and then they aren't.
  assert.deepEqual((await deliver(crowd, { from: { user_id: 'carol' } }, 'and what about dinner')).map(e => [e.addressed, e.outcome]), [['mention', 'replied']]);
  for (let i = 0; i < FOLLOWUP; ++i) crowd.bot.hear(spoke(`other${i}`));
  assert.deepEqual((await deliver(crowd, { from: { user_id: 'carol' } }, 'or breakfast')).map(e => [e.addressed, e.outcome]), [[undefined, 'rate-limited']]);
});
// A sender's reply to the bot's latest post, as a peer bot's would be.
const replyTo = (f, user_id, text) => deliver(f, { from: { user_id }, reply_to: { message_id: f.bot.log.list().findLast(e => e.kind === 'posted').message_id } }, text);
test('a sender the bot has answered six times running gets a rest, and the bot picks up once the room has moved on', async () => {
  let calls = 0;
  const f = connected(async (...a) => { ++calls; return model()(...a); });
  const outcomes = [(await deliver(f, { from: { user_id: 'dave' } }, 'hey @bot_me'))[0].outcome];
  for (let i = 1; i <= 6; ++i) outcomes.push((await replyTo(f, 'dave', `and then ${i}`))[0].outcome);
  assert.deepEqual(outcomes, ['replied', 'replied', 'replied', 'replied', 'replied', 'replied', 'looping']);
  assert.deepEqual([posts(f.ws).length, calls], [6, 12]);
  const mine = f.bot.log.list().findLast(e => e.kind === 'posted').message_id;
  // Just answered, dave is conversing, which addressing() ranks with a mention.
  assert.deepEqual(await replyTo(f, 'dave', 'hello?'), [{ room: 'general', message_id: 'this', reply_to: mine, from: 'dave', addressed: 'mention', outcome: 'looping' }]);
  assert.equal(calls, 12);
  // One voice more doesn't move the room on: its six posts still sit among the last eighteen turns.
  assert.equal((await deliver(f, { from: { user_id: 'erin' } }, 'what did I miss'))[0].outcome, 'learned-only');
  assert.equal((await replyTo(f, 'dave', 'erin, nothing'))[0].outcome, 'looping');
  for (const text of ['a lot it seems', 'anyway', 'lunch?', 'soup']) assert.equal((await deliver(f, { from: { user_id: 'erin' } }, text))[0].outcome, 'rate-limited');
  assert.equal((await replyTo(f, 'dave', 'soup sounds good'))[0].outcome, 'replied');
  assert.deepEqual([posts(f.ws).length, calls], [7, 15]);
});
test("the bot's owner is never rested, however long they keep talking to it alone", async () => {
  const f = connected(model());
  assert.equal(f.bot.owner, 'me');
  const outcomes = [(await deliver(f, { from: { user_id: 'me' } }, 'hey @bot_me'))[0].outcome];
  for (let i = 1; i <= 8; ++i) outcomes.push((await replyTo(f, 'me', `more ${i}`))[0].outcome);
  assert.deepEqual(outcomes, Array(9).fill('replied'));
  assert.equal(posts(f.ws).length, 9);
});
test('two senders taking turns with the bot draw at most six of its posts in any eighteen messages, however they alternate', async () => {
  const f = connected(model());
  const outcomes = [(await deliver(f, { from: { user_id: 'ada' } }, 'hey @bot_me'))[0].outcome];
  for (let i = 1; i < 20; ++i) outcomes.push((await replyTo(f, i % 2 ? 'ben' : 'ada', `and then ${i}`))[0].outcome);
  assert.deepEqual(outcomes, [...Array(6).fill('replied'), ...Array(8).fill('looping'), ...Array(6).fill('replied')]);
  assert.equal(posts(f.ws).length, 12);
  // The room as it went: each message, then the bot's post where it answered. No eighteen in a row hold more than six of its.
  const room = outcomes.flatMap(o => o === 'replied' ? ['them', 'me'] : ['them']);
  for (let i = 0; i + 18 <= room.length; ++i) assert.ok(room.slice(i, i + 18).filter(x => x === 'me').length <= 6, `messages ${i} to ${i + 18}`);
});
test("a room the bot is resting in still answers its owner at no cost to the others, and a third party's chatter lets it pick up again", async () => {
  let calls = 0;
  const f = connected(async (...a) => { ++calls; return model()(...a); });
  await deliver(f, { from: { user_id: 'ada' } }, 'hey @bot_me');
  for (let i = 1; i < 6; ++i) await replyTo(f, i % 2 ? 'ben' : 'ada', `and then ${i}`);
  assert.deepEqual([posts(f.ws).length, calls], [6, 12]);
  assert.equal((await replyTo(f, 'ben', 'still there?'))[0].outcome, 'looping');
  assert.equal((await replyTo(f, 'me', 'are you resting?'))[0].outcome, 'replied');
  assert.equal((await replyTo(f, 'ada', 'and me?'))[0].outcome, 'looping');
  assert.deepEqual([posts(f.ws).length, calls], [7, 14]);
  const chatter = [];
  for (const text of ['what did I miss', 'a lot it seems', 'anyway', 'lunch?']) chatter.push((await deliver(f, { from: { user_id: 'erin' } }, text))[0].outcome);
  assert.deepEqual(chatter, ['learned-only', 'rate-limited', 'rate-limited', 'rate-limited']);
  assert.equal((await replyTo(f, 'ada', 'so, where were we'))[0].outcome, 'replied');
  assert.deepEqual([posts(f.ws).length, calls], [8, 17]);
});
test('a message the bot rests on is neither sized up nor learned from, however eligible its sender', async () => {
  let calls = 0;
  // learn .5 never lapses a sender's eligibility, so without the rest every message of theirs would be classified.
  const f = connected(async (...a) => { ++calls; return model({ scores: { learn: .5, reply: .9 } })(...a); });
  await deliver(f, { from: { user_id: 'pat' } }, 'hey @bot_me');
  for (let i = 1; i < 6; ++i) await replyTo(f, 'pat', `and then ${i}`);
  assert.deepEqual([posts(f.ws).length, calls], [6, 12]);
  const mine = f.bot.log.list().findLast(e => e.kind === 'posted').message_id;
  assert.deepEqual(await replyTo(f, 'pat', 'and then 6'), [{ room: 'general', message_id: 'this', reply_to: mine, from: 'pat', addressed: 'mention', outcome: 'looping' }]);
  assert.deepEqual(await deliver(f, { from: { user_id: 'hana' } }, 'oh hi @bot_me'), [{ room: 'general', message_id: 'this', from: 'hana', addressed: 'mention', outcome: 'looping' }]);
  assert.equal(calls, 12);
  assert.deepEqual(f.bot.state.cells, {});
  // With chiming in on, a message nobody addressed to the bot is rested the same way; with it off it is classified to learn from.
  f.bot.configure({ organic: 'on' });
  assert.deepEqual(await deliver(f, { from: { user_id: 'erin' } }, 'what did I miss'), [{ room: 'general', message_id: 'this', from: 'erin', outcome: 'looping' }]);
  assert.equal(calls, 12);
  f.bot.configure({ organic: 'off' });
  assert.equal((await deliver(f, { from: { user_id: 'erin' } }, 'anyone?'))[0].outcome, 'learned-only');
  assert.equal(calls, 13);
});
test('the owner is who the server says, or failing that whoever the bot_ prefix names', () => {
  const named = fixture(model());
  named.bot.tick(); named.ws.emit({ method: 'server', params: {} });
  named.ws.emit({ id: 'auth', result: { you: { user_id: 'bot_legacy_id', name: 'Persona', owner: 'alice' } } });
  assert.equal(named.bot.owner, 'alice');
  const { bot } = fixture(model());
  assert.equal(bot.owner, undefined);
  bot.tick(); bot.ws.emit({ method: 'server', params: {} });
  bot.ws.emit({ id: 'auth', result: { you: { user_id: 'persona', name: 'Persona' } } });
  assert.equal(bot.owner, undefined);
  bot.use('wss://other.test/', 'apron_bot_x');
  bot.ws.emit({ method: 'server', params: {} });
  bot.ws.emit({ id: 'auth', result: { you: { user_id: 'bot_guest_1', name: 'Bot of guest_1' } } });
  assert.equal(bot.owner, 'guest_1');
});
test('who spoke is kept by position: a sender drops out of the room record once ALONE others have spoken', async () => {
  const f = connected(model());
  for (let i = 0; i < ALONE - 1; ++i) f.bot.hear(spoke('zed'));
  // zed is the only other voice, so far; one more of zed's and carol is talking to the bot alone... except carol herself counts.
  assert.deepEqual(await deliver(f, {}, 'hello'), seen('learned-only', { addressed: undefined, learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
  for (let i = 0; i < ALONE; ++i) f.bot.hear(spoke('carol'));
  // Reading how a message addresses the bot records nothing: only its arrival does.
  f.bot.addressed({ room_id: 'general', message_id: 'x', from: { user_id: 'dave' }, body: { text: 'hi' } });
  assert.deepEqual(await deliver(f, {}, 'you there?'), seen('replied', { learn_p: .9, reply_p: .9, point_p: .9, style: flat }));
});
test('a room the server refuses is left alone until the next sign-in, and needs you says so', async () => {
  const sockets = [], tick = () => new Promise(r => setTimeout(r, 0));
  const bot = new Bot({ ...env, ROOMS: 'general,ghost' }, { load: () => ({}), save() {} }, { connect: () => { const ws = socket(); ws.refuse = new Set(['ghost']); sockets.push(ws); return ws; }, request: model() });
  bot.tick();
  const [ws] = sockets;
  ws.emit({ method: 'server', params: {} }); ws.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  assert.deepEqual(ws.sent.filter(f => f.method === 'room_join').map(f => f.params.room_id), ['general', 'ghost']);
  await tick();
  assert.deepEqual([...bot.unavailable], [['ghost', 'Room does not exist']]);
  assert.deepEqual((await bot.posts()).length, 0);
  assert.deepEqual(ws.sent.filter(f => f.method === 'history').map(f => f.params.room_id), ['general']);
  assert.equal(await bot.recent({ room_id: 'ghost', message_id: 'x' }), null);
  assert.deepEqual(ws.sent.filter(f => f.method === 'history').map(f => f.params.room_id), ['general']);
  assert.deepEqual(needs(await snapshot(bot)).map(n => [n.text, n.why]), [["#ghost doesn't exist or I can't see it", 'the server said "Room does not exist". I\'ll try again when I next sign in.']]);
  // A room that joined but whose history the server then refuses is marked the same way, and the others still read.
  ws.refuse.add('general');
  assert.deepEqual(await bot.posts(), []);
  assert.deepEqual([...bot.unavailable.keys()], ['ghost', 'general']);
  assert.equal(ws.sent.filter(f => f.method === 'history').length, 2);
  await bot.posts();
  assert.equal(ws.sent.filter(f => f.method === 'history').length, 2);
  // The next sign-in tries every room again.
  ws.close(); bot.tick();
  const [, next] = sockets;
  next.emit({ method: 'server', params: {} }); next.emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  assert.deepEqual([next.sent.filter(f => f.method === 'room_join').map(f => f.params.room_id), bot.unavailable.size], [['general', 'ghost'], 0]);
  await tick();
  assert.deepEqual([...bot.unavailable], [['ghost', 'Room does not exist']]);
});
test('a signed-in connection the network breaks is retried in seconds, a refused or switched one is not', async () => {
  const sockets = [];
  const bot = new Bot(env, { load: () => ({}), save: () => {} }, { connect: () => { const ws = socket(); sockets.push(ws); return ws; }, retry: 5 });
  bot.tick();
  sockets[0].emit({ method: 'server', params: {} });
  sockets[0].emit({ id: 'auth', result: { you: { user_id: 'bot_me', name: 'Persona' } } });
  sockets[0].close();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sockets.length, 2);
  bot.drop('switched');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sockets.length, 2);
});
test('only an invalid_params answer marks a room unavailable; another server error does not', async () => {
  const f = connected(model());
  f.ws.history = [];
  const e = Object.assign(Error('Too Many Requests'), { refused: true, code: -32002 });
  f.bot.refuse('general', e);
  assert.equal(f.bot.unavailable.size, 0);
  f.bot.refuse('general', Object.assign(Error('Unknown room "general"'), { refused: true, code: -32602 }));
  assert.deepEqual([...f.bot.unavailable], [['general', 'Unknown room "general"']]);
});
test('a stream of declined mentions from one person rests the room instead of spending calls without end', async () => {
  let calls = 0;
  const f = connected(async (url, init) => { ++calls; return model({ scores: { learn: .9, reply: .1, point: .1 } })(url, init); });
  const outcomes = [];
  for (let i = 0; i < 10; i++) outcomes.push((await deliver(f, { from: { user_id: 'dave' } }, `hey @bot_me ${i}`))[0].outcome);
  assert.deepEqual(outcomes, [...Array(6).fill('declined'), ...Array(4).fill('looping')]);
  assert.equal(calls, 12);
});
test('an eligible sender is classified once per learning window even when nothing is learned', async () => {
  let judged = 0;
  const f = connected(async (url, init) => { if (JSON.parse(init.body).temperature === 0) ++judged; return model({ scores: { learn: .2, reply: .1, point: .1 } })(url, init); });
  for (const t of ['one', 'two', 'three']) await deliver(f, { from: { user_id: 'dave' } }, t);
  assert.equal(judged, 1);
});
test('an empty owner from the server counts as no owner', () => {
  const { bot } = fixture();
  bot.self = 'bot_ana'; bot.you = { owner: '' };
  assert.equal(bot.owner, 'ana');
});
test('request ids never repeat across a restart, since the server remembers them per user', () => {
  const ids = () => { const { bot, ws } = connected(model()); bot.send('ping', {}); bot.send('ping', {}); return ws.sent.filter(f => f.method === 'ping').map(f => f.id); };
  const [a, b] = [ids(), ids()];
  assert.equal(new Set([...a, ...b]).size, 4);
  assert.match(a[0], /^[0-9a-f]{8}\.\d+$/);
});
test('an owner set on the portal wins over the guess from the bot id, and a bad one is refused', () => {
  const { bot } = connected(model());
  bot.self = 'bot_guest_1';
  assert.equal(bot.owner, 'guest_1');
  bot.configure({ owner: 'matthias' });
  assert.equal(bot.owner, 'matthias');
  assert.throws(() => bot.configure({ owner: 'two words' }), /the owner is a user id/);
  bot.configure({ owner: '' });
  assert.equal(bot.owner, 'guest_1');
});
test('every persona save is a numbered revision with its reason; the last 20 are kept, and a restore is a revision too', () => {
  const { bot, saved } = connected();
  assert.deepEqual(bot.settings.revisions, []);
  assert.equal(bot.rewrite('You are {name}, a pirate.', ' because pirates '), true);
  assert.deepEqual(bot.settings.revisions, [{ text: 'You are {name}, a pirate.', reason: 'because pirates', n: 1 }]);
  assert.equal(bot.settings.persona, 'You are {name}, a pirate.');
  assert.equal(bot.rewrite('You are {name}, a pirate.', 'again'), false);
  assert.equal(bot.settings.revisions.length, 1);
  assert.equal(bot.rewrite('You are {name}, a sailor.'), true);
  assert.deepEqual(bot.settings.revisions.at(-1), { text: 'You are {name}, a sailor.', reason: '', n: 2 });
  assert.throws(() => bot.rewrite('You are {name}, a cook.', 'x'.repeat(201)), { message: 'a reason is at most 200 characters' });
  assert.throws(() => bot.rewrite('', 'blank'), { message: 'a persona is 1 to 4000 characters' });
  assert.equal(bot.settings.revisions.length, 2);
  for (let i = 3; i <= 25; ++i) bot.rewrite(`You are {name}, number ${i}.`, `step ${i}`);
  assert.equal(bot.settings.revisions.length, 20);
  assert.deepEqual(bot.settings.revisions.map(r => r.n), Array.from({ length: 20 }, (_, i) => i + 6));
  assert.equal(bot.restore(7), true);
  assert.deepEqual([bot.settings.persona, bot.settings.revisions.at(-1)], ['You are {name}, number 7.', { text: 'You are {name}, number 7.', reason: 'restored #7', n: 26 }]);
  assert.equal(bot.settings.revisions[0].n, 7);
  assert.throws(() => bot.restore(1), { message: 'no revision #1' });
  assert.throws(() => bot.restore('x'), { message: 'no revision #x' });
  assert.deepEqual(JSON.parse(saved.at(-1)).settings.revisions.at(-1), { text: 'You are {name}, number 7.', reason: 'restored #7', n: 26 });
  assert.deepEqual(bot.log.list().filter(e => e.kind === 'settings').slice(0, 2).map(({ at, ...e }) => e), [{ kind: 'settings', keys: ['persona'], reason: 'because pirates' }, { kind: 'settings', keys: ['persona'] }]);
  assert.deepEqual(bot.log.list().filter(e => e.kind === 'settings').at(-1).reason, 'restored #7');
  assert.throws(() => bot.configure({ revisions: 'x' }), { message: 'revisions are kept, not written' });
});
test('a sender is sized up for learning once per LEARN_EVERY messages of the room, by position', async () => {
  let judged = 0;
  const f = connected(async (url, init) => { if (JSON.parse(init.body).temperature === 0) ++judged; return model({ scores: { learn: .9, reply: .1, point: .1 } })(url, init); });
  assert.equal(LEARN_EVERY, 10);
  assert.equal((await deliver(f, { from: { user_id: 'dave' } }, 'one'))[0].outcome, 'learned-only');
  for (let i = 0; i < LEARN_EVERY - 2; ++i) f.bot.hear(spoke(`p${i}`));
  assert.equal((await deliver(f, { from: { user_id: 'dave' } }, 'two'))[0].outcome, 'rate-limited');
  assert.equal((await deliver(f, { from: { user_id: 'dave' } }, 'three'))[0].outcome, 'learned-only');
  assert.equal(judged, 2);
  assert.equal(margins['rate-limited'].say({ name: 'dave' }), 'already sized dave up within the last 10 messages here.');
});
test('a repeated text is a duplicate while it is among the last SEEN distinct ones, however long ago', async () => {
  const f = connected(model());
  f.bot.env.DAILY_CALLS = '';
  assert.equal((await deliver(f, {}, 'nice weather'))[0].outcome, 'learned-only');
  assert.equal((await deliver(f, { from: { user_id: 'dave' } }, 'NICE   weather'))[0].outcome, 'duplicate');
  for (let i = 0; i < SEEN; ++i) await deliver(f, { from: { user_id: `v${i}` } }, `distinct ${i}`);
  assert.equal((await deliver(f, { from: { user_id: 'erin' } }, 'nice weather'))[0].outcome, 'learned-only');
  assert.equal(f.bot.seen.size, SEEN);
});
