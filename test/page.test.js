import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { page, portal, tabs } from '../src/page.js';
import { guardrails } from '../src/settings.js';
const status = { connected: true, paused: false, error: null, budget: { calls: 3 }, personality: { warmth: .5 }, server: { host: 'h', user_id: 'bot_x', agent: 'a/9' } };
const ctx = { tab: 'overview', name: 'P<i>', status, settings: { persona: 'canary-persona </textarea><script>x</script> {name}', paused: false }, limit: '40', details: { url: 'wss://h/', since: 0, server: { agent: 'a/9', capabilities: ['history', 'edit'], welcome: '<b>hi</b>' }, you: { user_id: 'bot_x', name: 'P', roles: ['bot'], avatar: 'https://h/a.png' } }, url: 'wss://a"b/', posts: null, flash: null };
const nav = '<nav><a href="/?tab=overview">Overview</a><a href="/?tab=activity">Activity</a><a href="/?tab=persona" aria-current="page">Persona</a><a href="/?tab=moderation">Moderation</a><a href="/?tab=connection">Connection</a></nav>';
test('the portal has five tabs and marks the active one', () => {
  assert.deepEqual(tabs.map(t => t.id), ['overview', 'activity', 'persona', 'moderation', 'connection']);
  const html = portal({ ...ctx, tab: 'persona', flash: { ok: 'Saved <now>' } });
  assert.ok(html.includes(nav));
  assert.ok(html.includes('<title>P&#60;i&#62; · Persona</title>') && html.includes('<h1>P&#60;i&#62;</h1>'));
  assert.ok(html.includes('<main><p class="flash">Saved &#60;now&#62;</p>'));
  assert.ok(portal({ ...ctx, tab: 'nope' }).includes('<a href="/?tab=overview" aria-current="page">Overview</a>'));
});
test('the persona tab escapes the editor and previews the full prompt with fixed guardrails', () => {
  const html = portal({ ...ctx, tab: 'persona' });
  assert.ok(html.includes('<textarea name="persona" maxlength="4000" required>canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; {name}</textarea>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<p><small>persona</small>canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; P&#60;i&#62;</p>'));
  assert.ok(html.includes(`<p class="fixed"><small>guardrails · fixed, not editable</small>${guardrails}</p>`));
  assert.ok(html.includes('<input type="hidden" name="tab" value="persona">') && html.includes('action="/persona/reset"'));
});
test('overview shows status, budget and the server details; moderation and connection escape their data', () => {
  const html = portal(ctx);
  assert.ok(html.includes('3 of 40 calls today') && html.includes('<button class="primary">Pause</button>'));
  assert.ok(html.includes('<dd>history, edit</dd>') && html.includes('&#60;b&#62;hi') && !html.includes('<b>hi'));
  assert.ok(html.includes('<dt>avatar</dt><dd>https://h/a.png</dd>') && !html.includes('<img'));
  const mod = portal({ ...ctx, tab: 'moderation', posts: [{ room_id: 'general', message_id: '9', log_id: '1793214835055', body: { text: '<script>x</script>' } }] });
  assert.ok(mod.includes('<p>&#60;script&#62;x&#60;/script&#62;</p>') && mod.includes('<input type="hidden" name="message_id" value="9">'));
  const conn = portal({ ...ctx, tab: 'connection' });
  assert.ok(conn.includes('value="wss://a&#34;b/"') && conn.includes('type="password"'));
});
test('the public page carries no persona or admin content', () => {
  const html = page('P', { ...status, paused: true });
  assert.ok(html.includes('paused · h · bot_x · a/9 · 3 calls today'));
  for (const s of ['canary-persona', guardrails, '<form', '<nav', 'Persona', 'token', 'Moderation']) assert.ok(!html.includes(s), s);
});
test('overview shows the last error and when, even while connected', () => {
  const html = portal({ ...ctx, lastError: { code: 'inference-<429>', at: Date.UTC(2026, 9, 28, 12, 0, 5) } });
  assert.ok(html.includes('<p class="big"><span class="dot on"></span>online</p>'));
  assert.ok(html.includes('3 of 40 calls today<br>last error inference-&#60;429&#62; at 2026-10-28 12:00:05 UTC</p>'));
  assert.ok(!portal(ctx).includes('last error'));
});
test('the activity tab lists events with their labels and escaped fields', () => {
  const events = [
    { at: Date.UTC(2026, 9, 28, 12, 0, 2), kind: 'message', room: 'general', message_id: '9', from: '<b>', mentioned: true, outcome: 'declined', learn_p: .9, reply_p: .4 },
    { at: Date.UTC(2026, 9, 28, 12, 0, 1), kind: 'settings', keys: ['persona', 'paused'] },
    { at: Date.UTC(2026, 9, 28, 12, 0, 0), kind: 'auth-denied' },
  ];
  const html = portal({ ...ctx, tab: 'activity', events });
  assert.ok(html.includes('<h3>Last 3 events</h3><dl><dt>2026-10-28 12:00:02 UTC</dt><dd>Mentioned; reply probability below 0.7<br><span class="note">room general · message_id 9 · from &#60;b&#62; · mentioned true · learn_p 0.9 · reply_p 0.4</span></dd>'
    + '<dt>2026-10-28 12:00:01 UTC</dt><dd>Settings saved<br><span class="note">keys persona, paused</span></dd><dt>2026-10-28 12:00:00 UTC</dt><dd>Token refused</dd></dl>'));
  assert.ok(portal({ ...ctx, tab: 'activity', events: [] }).includes('<p>Nothing yet since the bot started.</p>'));
});
