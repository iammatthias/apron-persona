import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { site, admin } from '../src/http.js';
const env = { APRON_URL: 'wss://apron.test/', APRON_TOKEN: '', OPENROUTER_API_KEY: 'k', ROOMS: 'general', HALF_LIFE_DAYS: '30', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', DECISION_MODEL: 'd', CHAT_MODEL: 'c' };
const listeners = () => {
  const bot = new Bot({ ...env }, { load: () => ({}), save: () => {} }, { connect: () => { throw Error('no network in tests'); } });
  return { bot, site: site(bot), admin: admin(bot, () => {}) };
};
const get = (handler, path, init) => handler(new Request(`http://bot.test${path}`, init));
test('the public listener serves only the status page and its JSON', async () => {
  const { site } = listeners();
  assert.deepEqual(await (await get(site, '/status.json')).json(), { connected: false, paused: false, error: null, server: null, budget: { day: '', calls: 0 }, personality: { warmth: .5, playfulness: .5, curiosity: .5, expressiveness: .5 } });
  assert.ok((await (await get(site, '/')).text()).includes('<h1>Persona</h1>'));
  assert.equal((await get(site, '/?tab=persona')).status, 200);
  assert.equal((await get(site, '/settings', { method: 'POST' })).status, 404);
});
test('admin writes need a same-origin form post and redirect to their tab', async () => {
  const { bot, admin } = listeners();
  const form = new URLSearchParams({ tab: 'overview', paused: 'on' });
  assert.equal((await get(admin, '/settings', { method: 'POST', body: form })).status, 403);
  const res = await get(admin, '/settings', { method: 'POST', body: form, headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(res.headers.get('Location'), '/?tab=overview&ok=Paused%3A%20not%20reading%20or%20replying');
  assert.equal(bot.settings.paused, true);
});
