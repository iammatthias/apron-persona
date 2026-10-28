import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { site, admin } from '../src/http.js';
const env = { APRON_URL: 'wss://apron.test/', APRON_TOKEN: '', OPENROUTER_API_KEY: 'k', ROOMS: 'general', HALF_LIFE_DAYS: '30', DAILY_CALLS: '40', HASH_SECRET: 'test-key', BOT_NAME: 'Persona', DECISION_MODEL: 'd', CHAT_MODEL: 'c' };
const listeners = options => {
  const bot = new Bot({ ...env }, { load: () => ({}), save: () => {} }, { connect: () => { throw Error('no network in tests'); } });
  return { bot, site: site(bot), admin: admin(bot, () => {}, options) };
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
const read = async reader => new TextDecoder().decode((await reader.read()).value);
test('events are served only on the admin listener, filtered by since', async () => {
  const { bot, site, admin } = listeners();
  bot.configure({ paused: true }); bot.configure({ paused: false });
  const [first, second] = bot.log.list();
  assert.deepEqual(await (await get(admin, '/events.json')).json(), [first, second]);
  assert.deepEqual(await (await get(admin, `/events.json?since=${first.at}`)).json(), [{ at: second.at, kind: 'settings', keys: ['paused'], paused: false }]);
  for (const path of ['/events.json', '/events']) assert.equal((await get(site, path)).status, 404);
});
test('the event stream pings, sends new events, and unsubscribes on abort or cancel', async () => {
  const { bot, admin } = listeners();
  const aborter = new AbortController();
  const res = await get(admin, '/events', { signal: aborter.signal });
  assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
  const reader = res.body.getReader();
  assert.equal(await read(reader), ': ping\n\n');
  bot.configure({ paused: true });
  assert.equal(await read(reader), `data: ${JSON.stringify(bot.log.list()[0])}\n\n`);
  assert.equal(bot.log.listeners.size, 1);
  aborter.abort();
  assert.equal(bot.log.listeners.size, 0);
  const pinging = listeners({ ping: 5 });
  const other = (await get(pinging.admin, '/events')).body.getReader();
  assert.deepEqual([await read(other), await read(other)], [': ping\n\n', ': ping\n\n']);
  assert.equal(pinging.bot.log.listeners.size, 1);
  await other.cancel();
  assert.equal(pinging.bot.log.listeners.size, 0);
});
test('a stream nobody reads is cut off instead of buffering', async () => {
  const { bot, admin } = listeners();
  const reader = (await get(admin, '/events')).body.getReader();
  for (let i = 0; i < 40; ++i) bot.fail(`e${i}`);
  assert.equal(bot.log.listeners.size, 0);
  const chunks = [];
  for (let r; !(r = await reader.read()).done;) chunks.push(new TextDecoder().decode(r.value));
  assert.equal(chunks.length, 32);
  assert.equal(chunks[31], `data: ${JSON.stringify(bot.log.list()[30])}\n\n`);
});
test('the activity tab shows the newest 50 events first, and the overview the last error', async () => {
  const { bot, admin } = listeners();
  for (let i = 0; i < 60; ++i) bot.fail(`e${i}`);
  const html = await (await get(admin, '/?tab=activity')).text();
  assert.ok(html.includes('<h3>Last 50 events</h3>'));
  assert.deepEqual([...html.matchAll(/code (e\d+)/g)].map(m => m[1]).filter((_, i) => i < 2 || i > 47), ['e59', 'e58', 'e11', 'e10']);
  assert.ok((await (await get(admin, '/')).text()).includes('last error e59 at '));
});
