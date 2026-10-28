import { test, mock } from 'bun:test';
import assert from 'node:assert/strict';
mock.module('cloudflare:workers', () => ({ DurableObject: class {} }));
const { Bot, default: worker } = await import('../src/index.js');
function fixture() {
  const db = new Map(); const saved = [];
  let init;
  const ctx = { storage: { get: async k => db.get(k), put: async (k, v) => db.set(k, v), setAlarm: async () => {}, deleteAlarm: async () => {} }, blockConcurrencyWhile: fn => init = fn(), waitUntil: () => {} };
  const env = { ROOMS: 'general', HALF_LIFE_DAYS: '30', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', PERSONA: { get: async () => null, put: async (k, v) => saved.push([k, v]) } };
  const bot = new Bot(ctx, env); return { bot, env, init, saved };
}
test('HTTP controls require a secret', async () => {
  assert.equal((await worker.fetch(new Request('https://bot/status'), {})).status, 401);
});
test('transcript stays in memory and persists only aggregate weights', async () => {
  const { bot, init, saved } = fixture(); await init;
  bot.enabled = true; bot.ready = true; bot.self = 'bot_me'; bot.ws = {};
  const answers = { learn: { noul: .9 }, reply: { noul: .9 } };
  for (const a of ['warmth', 'playfulness', 'curiosity', 'expressiveness']) answers[a] = { choice: 'balanced', probabilities: { low: 0, reserved: 0, balanced: 1, elevated: 0, high: 0 } };
  let calls = 0; bot.api = async () => { ++calls; return { answers }; };
  const p = { room_id: 'general', message_id: '42', from: { user_id: 'alice' }, body: { text: 'private-content-canary' } };
  await bot.handle(p); await bot.handle(p); await bot.flush();
  assert.equal(calls, 1); assert.equal(saved.length, 1);
  assert.ok(!saved[0][1].includes('private-content-canary')); assert.ok(!saved[0][1].includes('alice'));
  bot.context[0].at = Date.now() - 300001; bot.prune(); assert.equal(bot.context.length, 0);
});
test('daily budget prevents an upstream request', async () => {
  const { bot, init } = fixture(); await init;
  bot.budget = { day: new Date().toISOString().slice(0, 10), calls: 40 };
  await assert.rejects(bot.api('alpha/decisions', {}), /budget/);
});
