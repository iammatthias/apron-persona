import { test, mock } from 'bun:test';
import assert from 'node:assert/strict';
mock.module('cloudflare:workers', () => ({ DurableObject: class {} }));
const classified = { choices: [{ message: { content: JSON.stringify({ learn: .9, reply: .9, warmth: 'balanced', playfulness: 'balanced', curiosity: 'balanced', expressiveness: 'balanced' }) } }] };
// A fake Apron connection: answers server/auth/history from `log`, recording frames in `sent`.
function apron(log, sent) {
  const listeners = {};
  const emit = (type, data) => queueMicrotask(() => listeners[type]?.forEach(f => f({ data: JSON.stringify(data) })));
  const ws = {
    readyState: 1, accept() { emit('message', { method: 'server', params: {} }); },
    addEventListener(type, f) { (listeners[type] ??= []).push(f); },
    close() { if (this.readyState !== 1) return; this.readyState = 3; queueMicrotask(() => listeners.close?.forEach(f => f({}))); },
    send(raw) {
      const f = JSON.parse(raw); sent.push(f);
      if (f.method === 'auth') return emit('message', { id: f.id, result: { you: { user_id: 'bot_me', name: 'Persona' } } });
      if (f.method === 'history') {
        const after = f.params.after, msgs = after ? log.filter(m => BigInt(m.log_id) >= BigInt(after)) : log.slice(-f.params.limit);
        return emit('message', { id: f.id, result: { messages: msgs, latest_log_id: log.at(-1).log_id, ...(msgs.length && { first_log_id: msgs[0].log_id, last_log_id: msgs.at(-1).log_id }), more: false } });
      }
      emit('message', { id: f.id, result: { message_id: '999' } });
    },
  };
  return ws;
}
const { Bot, default: worker } = await import('../src/index.js');
function fixture() {
  const db = new Map(); const saved = [];
  let init;
  const ctx = { storage: { get: async k => db.get(k), put: async (k, v) => db.set(k, v), setAlarm: async () => {}, deleteAlarm: async () => {} }, blockConcurrencyWhile: fn => init = fn(), waitUntil: () => {} };
  const env = { ROOMS: 'general', POLL_MINUTES: '5', APRON_URL: 'wss://apron.test/', APRON_TOKEN: 't', OPENROUTER_API_KEY: 'k', HALF_LIFE_DAYS: '30', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', PERSONA: { get: async () => null, put: async (k, v) => saved.push([k, v]) } };
  const bot = new Bot(ctx, env); return { bot, env, init, saved };
}
test('HTTP controls require a secret', async () => {
  assert.equal((await worker.fetch(new Request('https://bot/status'), {})).status, 401);
});
test('transcript stays in memory and persists only aggregate weights', async () => {
  const { bot, init, saved } = fixture(); await init;
  bot.enabled = true; bot.self = 'bot_me'; bot.ws = {};
  let calls = 0; bot.api = async () => { ++calls; return classified; };
  const p = { room_id: 'general', message_id: '42', log_id: '42', from: { user_id: 'alice' }, body: { text: 'private-content-canary' } };
  await bot.handle(p); await bot.handle(p); await bot.flush();
  assert.equal(calls, 1); assert.equal(saved.length, 1);
  assert.ok(!saved[0][1].includes('private-content-canary')); assert.ok(!saved[0][1].includes('alice'));
});
test('daily budget prevents an upstream request', async () => {
  const { bot, init } = fixture(); await init;
  bot.budget = { day: new Date().toISOString().slice(0, 10), calls: 40 };
  await assert.rejects(bot.api('alpha/decisions', {}), /budget/);
});
test('a poll reads new messages, replies, and disconnects', async () => {
  const msg = (id, user_id, text, extra) => ({ room_id: 'general', message_id: id, log_id: id, from: { user_id }, body: { text }, ...extra });
  const log = [msg('10', 'alice', 'before the bot started')];
  const server = { sent: [] };
  const inference = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://apron.test')) return { webSocket: server.ws = apron(log, server.sent) };
    const body = JSON.parse(init.body);
    const kind = body.temperature === 0 ? 'classify' : 'reply'; inference.push(kind);
    return Response.json(kind === 'classify' ? classified : { choices: [{ message: { content: 'hi there' } }] });
  };
  const { bot, init } = fixture(); await init; bot.enabled = true;
  await bot.poll();
  assert.equal(bot.cursor, '10'); assert.equal(inference.length, 0);
  assert.equal(server.ws.readyState, 3);
  log.push(msg('11', 'bob', 'context line'), msg('12', 'carol', 'hey @bot_me'), msg('11', 'bob', 'edited', { log_id: '13', prev_log_id: '11' }));
  await bot.poll();
  assert.equal(bot.cursor, '13');
  assert.deepEqual(inference, ['classify', 'classify', 'reply']);
  const [hello, reply] = server.sent.filter(f => f.method === 'message');
  assert.equal(hello.params.room_id, 'general');
  assert.deepEqual(reply.params, { room_id: 'general', body: { text: 'hi there' }, reply_to: { message_id: '12' } });
  assert.equal(server.ws.readyState, 3); assert.equal(bot.context.length, 0);
  assert.equal(server.sent.filter(f => f.method === 'auth').length, 2);
  globalThis.fetch = realFetch;
});
