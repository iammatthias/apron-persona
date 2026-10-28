import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
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
function fixture(request) {
  const saved = [], ws = socket();
  const bot = new Bot(env, { load: () => ({}), save: s => saved.push(JSON.stringify(s)) }, { connect: () => ws, request });
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
