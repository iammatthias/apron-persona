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
test('admin writes need a same-origin form post and redirect to their view and room', async () => {
  const { bot, admin } = listeners();
  const form = new URLSearchParams({ view: 'who', room: 'general', paused: 'on' });
  assert.equal((await get(admin, '/settings', { method: 'POST', body: form })).status, 403);
  const res = await get(admin, '/settings', { method: 'POST', body: form, headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(res.headers.get('Location'), '/?view=who&room=general&ok=Paused%3A%20not%20reading%20or%20replying');
  const bad = await get(admin, '/settings', { method: 'POST', body: new URLSearchParams({ view: 'x', room: 'nope', persona: '' }), headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(bad.headers.get('Location'), '/?view=transcript&room=general&error=a%20persona%20is%201%20to%204000%20characters');
  assert.equal(bot.settings.paused, true);
});
const read = async reader => new TextDecoder().decode((await reader.read()).value);
test('events are served only on the admin listener, filtered by since', async () => {
  const { bot, site, admin } = listeners();
  bot.configure({ paused: true }); bot.configure({ paused: false });
  const [first, second] = bot.log.list();
  assert.deepEqual(await (await get(admin, '/events.json')).json(), [first, second]);
  assert.deepEqual(await (await get(admin, `/events.json?since=${first.at}`)).json(), [{ at: second.at, kind: 'settings', keys: ['paused'], paused: false }]);
  for (const path of ['/events.json', '/events', '/rows']) assert.equal((await get(site, path)).status, 404);
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
test('the dashboard shows the transcript and the last error, and /rows serves rows after since or one post by id', async () => {
  const { bot, admin } = listeners();
  bot.log.push({ kind: 'message', room: 'general', message_id: '1', from: 'u_a', name: 'ana', mentioned: true, text: '@bot hi', outcome: 'replied', learn_p: .9, reply_p: .9 });
  const posted = bot.log.push({ kind: 'posted', room: 'general', message_id: 'p1', reply_to: '1', text: 'hello <b>' });
  bot.fail('inference-<429>');
  const html = await (await get(admin, '/')).text();
  assert.ok(html.includes('<p>@bot hi</p></div></div><div class="note ok">answered. I was 0.90 sure a reply fit.</div>'));
  assert.ok(html.includes('last error inference-&#60;429&#62; at '));
  assert.ok(html.includes("I can't read my history right now (not-connected)."));
  const rows = await (await get(admin, `/rows?room=general&since=${posted.at - 1}`)).text();
  assert.equal(rows.match(/data-at="\d+"/g).length, 2);
  assert.ok(rows.startsWith(`<div class="m self" data-at="${posted.at}" data-message-id="p1">`) && rows.includes('<p>hello &#60;b&#62;</p>'));
  assert.ok(rows.includes('error: inference-&#60;429&#62;'));
  bot.log.push({ kind: 'deleted', room: 'general', message_id: 'p1' });
  const one = await (await get(admin, '/rows?room=general&id=p1')).text();
  assert.ok(one.startsWith(`<div class="m self gone" data-at="${posted.at}" data-message-id="p1">`) && one.includes('I deleted this.') && !one.includes('<form'));
  assert.equal(await (await get(admin, '/rows?room=elsewhere')).text(), '');
});
test('pages refuse to be framed and are never sniffed', async () => {
  const { site, admin } = listeners();
  for (const res of [await get(admin, '/'), await get(site, '/')]) {
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(res.headers.get('Content-Security-Policy'), "frame-ancestors 'none'");
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  }
});
