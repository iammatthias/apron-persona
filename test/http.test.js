import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { site, admin } from '../src/http.js';
const portal = bot => admin(bot, () => {});
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
  bot.log.push({ kind: 'message', room: 'general', message_id: '1', from: 'u_a', name: 'ana', addressed: 'mention', text: '@bot hi', outcome: 'replied', learn_p: .9, reply_p: .9 });
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
test('one save of how I respond round-trips every trigger, switching boxes off as well as on', async () => {
  const { bot, admin } = listeners();
  const save = fields => get(admin, '/settings', { method: 'POST', body: new URLSearchParams(fields), headers: { 'Sec-Fetch-Site': 'same-origin' } });
  const form = (organic, mentions) => [['view', 'who'], ['room', 'general'], ...(mentions ? [['reply_mentions', 'on']] : []), ['reply_mentions', 'off'], ['reply_replies', 'on'], ['reply_replies', 'off'],
    ['reply_threshold', '0.80'], ['cooldown', '30'], ...(organic ? [['organic', 'on']] : []), ['organic', 'off'], ['organic_threshold', '0.95'], ['organic_gap', '60']];
  assert.equal((await save(form(true, false))).headers.get('Location'), '/?view=who&room=general&ok=Saved');
  assert.deepEqual(bot.settings, { ...bot.settings, reply_mentions: false, reply_replies: true, reply_threshold: .8, cooldown: 30, organic: true, organic_threshold: .95, organic_gap: 60 });
  const html = await (await get(admin, '/?view=who')).text();
  assert.ok(html.includes('<input type="checkbox" name="reply_mentions" value="on"><input type="hidden"') && html.includes('<input type="checkbox" name="organic" value="on" checked>'));
  assert.ok(html.includes('name="reply_threshold" min="0.5" max="0.99" step="0.05" value="0.80"') && html.includes('name="organic_gap" min="5" max="1440" step="1" value="60"'));
  assert.ok(html.includes('you stopped me answering mentions, you set my reply bar to 0.80, you set my cooldown to 30 seconds, you let me chime in on my own, you set my chime-in bar to 0.95, you set my chime-in gap to 60 min'));
  await save(form(false, true));
  assert.equal(bot.settings.organic, false); assert.equal(bot.settings.reply_mentions, true);
  assert.ok((await (await get(admin, '/?view=who')).text()).includes('you let me answer mentions, you stopped me chiming in'));
  const bad = await save([['view', 'who'], ['room', 'general'], ['organic_gap', '2'], ['organic', 'off']]);
  assert.equal(bad.headers.get('Location'), '/?view=who&room=general&error=the%20chime-in%20gap%20in%20minutes%20is%20a%20whole%20number%20from%205%20to%201440');
  assert.equal(bot.settings.organic_gap, 60);
});
const post = (handler, path, fields) => get(handler, path, { method: 'POST', body: new URLSearchParams({ view: 'who', room: 'general', ...fields }), headers: { 'Sec-Fetch-Site': 'same-origin' } });
const job = { url: 'wss://server.apron.test/', token: '', rooms: '#general, random', cap: '300' };
test('learn from history validates its form, starts the job, and redirects at once', async () => {
  let drop;
  const bot = new Bot({ ...env }, { load: () => ({}), save: () => {} }, { connect: () => ({ addEventListener(type, f) { if (type === 'close') drop = f; }, send() {}, close() {} }) });
  const admin = portal(bot);
  for (const [fields, error] of [[{ url: 'https://x/' }, 'a wss:// URL is required'], [{ rooms: ' , ' }, 'name 1 to 8 rooms'], [{ cap: '1001' }, 'messages is a whole number from 1 to 1000'], [{ cap: '2.5' }, 'messages is a whole number from 1 to 1000']])
    assert.equal((await post(admin, '/learn', { ...job, ...fields })).headers.get('Location'), `/?view=who&room=general&error=${encodeURIComponent(error)}`);
  assert.equal(bot.learning, null);
  assert.equal((await get(admin, '/learn', { method: 'POST', body: new URLSearchParams(job) })).status, 403);
  const res = await post(admin, '/learn', job);
  assert.equal(res.headers.get('Location'), '/?view=who&room=general&ok=Reading%20history.%20This%20takes%20about%20a%20minute');
  assert.deepEqual(bot.learning, { stage: 'reading', host: 'server.apron.test', rooms: ['general', 'random'] });
  assert.ok((await (await get(admin, '/?view=who')).text()).includes('<div id="lesson"><p class="small lesson">reading history in #general and #random on server.apron.test… <a href="/?view=who&amp;room=general">refresh</a></p></div>'));
  assert.equal((await post(admin, '/learn', job)).headers.get('Location'), '/?view=who&room=general&error=already%20learning%20from%20history');
  drop(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(bot.learning, { stage: 'failed', host: 'server.apron.test', rooms: ['general', 'random'], detail: 'history-closed' });
  assert.ok((await (await get(admin, '/?view=who')).text()).includes("I couldn't learn from history in #general and #random on server.apron.test (history-closed)."));
  assert.equal((await post(admin, '/learn/discard', {})).headers.get('Location'), '/?view=who&room=general&ok=Discarded');
  assert.equal(bot.learning, null);
});
test('a proposal renders escaped beside the traits it would leave, and applies the edited text', async () => {
  const { bot, admin } = listeners();
  const hostile = '</textarea><script>alert(1)</script> You are {name} & "co"';
  bot.learning = { stage: 'ready', host: 'server.apron.test', rooms: ['general'], persona: hostile, vector: [1, 0, .5, .75], count: 300, failed: 1, detail: 'inference-<429>', at: 0 };
  const html = await (await get(admin, '/?view=who')).text();
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('<textarea name="persona" maxlength="4000" required>&#60;/textarea&#62;&#60;script&#62;alert(1)&#60;/script&#62; You are {name} &#38; &#34;co&#34;</textarea>'));
  assert.ok(html.includes('300 messages from #general on server.apron.test. 1 of my readings failed (inference-&#60;429&#62;), so this leans on the rest.'));
  assert.ok(html.includes('<div class="vs"><span></span><small>now</small><small>after</small><span>warmth</span><span>0.50</span><b>0.75</b><span>playfulness</span><span>0.50</span><b>0.25</b><span>curiosity</span><span>0.50</span><b>0.50</b><span>expressiveness</span><span>0.50</span><b>0.63</b></div>'));
  assert.equal((await post(admin, '/learn/apply', { persona: 'You are {name}, trimmed.' })).headers.get('Location'), "/?view=who&room=general&ok=Applied%3A%20I've%20taken%20on%20the%20room's%20voice");
  assert.equal(bot.settings.persona, 'You are {name}, trimmed.');
  assert.ok((await (await get(admin, '/?view=who')).text()).includes("you taught me the room's voice (300 messages)"));
  assert.equal((await post(admin, '/learn/apply', { persona: 'again' })).headers.get('Location'), '/?view=who&room=general&error=there%20is%20no%20proposal%20to%20apply');
});
