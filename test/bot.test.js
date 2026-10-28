import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { page } from '../src/page.js';
import { settings, guardrails } from '../src/settings.js';
const classified = { choices: [{ message: { content: JSON.stringify({ learn: .9, reply: .9, warmth: 'balanced', playfulness: 'balanced', curiosity: 'balanced', expressiveness: 'balanced' }) } }] };
const env = { APRON_URL: 'wss://apron.test/', APRON_TOKEN: 't', OPENROUTER_API_KEY: 'k', ROOMS: 'general', HALF_LIFE_DAYS: '30', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', DECISION_MODEL: 'd', CHAT_MODEL: 'c' };
// A fake Apron connection that records sent frames; `emit` delivers server frames.
function socket() {
  const listeners = {}, sent = [];
  return {
    sent, readyState: 1,
    addEventListener(type, f) { (listeners[type] ??= []).push(f); },
    emit(frame) { listeners.message?.forEach(f => f({ data: JSON.stringify(frame) })); },
    close() { this.readyState = 3; listeners.close?.forEach(f => f({})); },
    send(raw) { sent.push(JSON.parse(raw)); },
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
test('pages escape text and show moderation only when given posts', () => {
  const status = { connected: true, error: null, budget: { calls: 0 }, personality: { warmth: .5 } };
  assert.ok(!page('P', status).includes('Moderation'));
  const html = page('P', status, { url: 'wss://a"b/', posts: [{ room_id: 'general', message_id: '9', log_id: '1793214835055', body: { text: '<script>x</script>' } }] });
  assert.ok(html.includes('&#60;script&#62;') && !html.includes('<script>'));
  assert.ok(html.includes('value="wss://a&#34;b/"') && html.includes('type="password"'));
  const detailed = page('P', { ...status, server: { host: 'h', user_id: 'bot_x', agent: 'a/9' } }, { posts: [], url: 'wss://h/', details: { url: 'wss://h/', since: 0, server: { agent: 'a/9', capabilities: ['history', 'edit'], welcome: '<b>hi</b>' }, you: { user_id: 'bot_x', roles: ['bot'], ext: { permissions: [] } } } });
  assert.ok(detailed.includes('<dd>history, edit</dd>') && detailed.includes('&#60;b&#62;hi') && !detailed.includes('<b>hi'));
  assert.ok(detailed.includes('<dt>roles</dt><dd>bot</dd>') && detailed.includes('online · h · bot_x · a/9'));
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
