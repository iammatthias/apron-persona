import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { page } from '../src/page.js';
import { dashboard } from '../src/dashboard.js';
import { guardrails, restore } from '../src/settings.js';
const now = Date.UTC(2026, 9, 28, 14, 31);
const status = { connected: true, paused: false, error: null, budget: { day: '2026-10-28', calls: 3 }, personality: { warmth: .62, playfulness: .5, curiosity: .45, expressiveness: .5 }, server: { host: 'h', user_id: 'bot_x', agent: 'a/9' } };
const at = m => now - m * 60000;
const events = [
  { at: at(9), kind: 'message', room: 'general', message_id: '1', from: 'u_ben', name: 'ben', outcome: 'learned-only', learn_p: .91, reply_p: .1, style: [.75, .5, .5, .5] },
  { at: at(8), kind: 'message', room: 'general', message_id: '2', from: 'u_ana', name: 'ana<i>', addressed: 'mention', text: '@bot </p><script>x</script>', outcome: 'replied', learn_p: .5, reply_p: .97, ms: { context: 310, judge: 640, compose: 920, post: 80, total: 1400 }, via: { judge: 'cohere/north-mini-code', compose: 'a"b' } },
  { at: at(7), kind: 'posted', room: 'general', message_id: 'p"1', reply_to: '2', text: '<img src=x onerror=alert(1)>' },
  { at: at(6), kind: 'message', room: 'general', message_id: '3', from: 'u_lin', name: 'lin', addressed: 'mention', text: '@bot one', outcome: 'declined', learn_p: .5, reply_p: .42 },
  { at: at(5), kind: 'message', room: 'random', message_id: '4', from: 'u_lin', name: 'lin', addressed: 'mention', text: '@bot two', outcome: 'budget' },
  { at: at(4), kind: 'message', room: 'general', message_id: '5', from: 'u_lin', name: 'lin', addressed: 'mention', text: '@bot three', outcome: 'reply-failed', learn_p: .5, reply_p: .9, detail: 'inference-502' },
  { at: at(3), kind: 'message', room: 'elsewhere-room', message_id: '6', from: 'u_zed', name: 'zed', outcome: 'other-room' },
];
const ctx = {
  name: 'P<i>', status, now, events, rooms: ['general', 'random'], room: 'general', view: 'transcript', edit: false, flash: null, lastError: null, limit: '40',
  settings: restore({ settings: { persona: 'canary-persona </textarea><script>x</script> {name}', norms: { general: '</textarea><script>n</script> be kind' } } }),
  memory: [
    { id: 'general', notes: 'In #general lately: mostly code. Norms: </textarea><script>n</script> be kind', week: { days: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'], rows: [['code', [0, 1, 0, 2, 0, 0, 3]], ['banter', [1, 0, 0, 0, 0, 0, 0]]] } },
    { id: 'random', notes: '', week: { days: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'], rows: [] } },
  ],
  details: { url: 'wss://h/', since: at(14), latency: 45, server: { agent: 'a/9', capabilities: ['history', 'edit'], welcome: '<b>hi</b>' }, you: { user_id: 'bot_x', name: 'P', roles: ['bot'], avatar: 'https://h/a.png' } },
  posts: [{ room_id: 'general', message_id: '9', log_id: String(at(7)), body: { text: '<script>said</script>' } }],
};
test('the header says what the bot is doing, and its control reads as stop or resume', () => {
  const html = dashboard(ctx);
  assert.ok(html.includes("<h1>P&#60;i&#62;</h1><p>I'm listening in #general and #random on h. 3 of my 40 calls are spent today.</p>"));
  assert.ok(html.includes('<input type="hidden" name="paused" value="on">\n<button class="switch on"><span><b>Listening</b> <small>tap to stop</small></span><i></i></button>'));
  const paused = dashboard({ ...ctx, status: { ...status, paused: true } });
  assert.ok(paused.includes("<p>I'm paused, so I'm not reading #general and #random on h. 3 of my 40 calls are spent today.</p>"));
  assert.ok(paused.includes('<input type="hidden" name="paused" value="off">\n<button class="switch off"><span><b>Paused</b> <small>tap to resume</small></span><i></i></button>'));
  assert.ok(dashboard({ ...ctx, status: { ...status, connected: false, server: null, error: 'no-apron-token', budget: { day: '2026-10-27', calls: 9 } } })
    .includes("<p>I can't reach h (no-apron-token). 0 of my 40 calls are spent today.</p>"));
});
test('room tabs badge unanswered mentions, and other rooms collect under ignored elsewhere', () => {
  const html = dashboard(ctx);
  assert.ok(html.includes('<nav class="rooms"><a href="/?room=general" aria-current="page">#general <em>2 unanswered</em></a><a href="/?room=random">#random <em>1 unanswered</em></a><a class="elsewhere" href="/?room=elsewhere">ignored elsewhere 1</a></nav>'));
  const elsewhere = dashboard({ ...ctx, room: 'elsewhere' });
  assert.ok(elsewhere.includes("<p><span class=\"n\">zed in #elsewhere-room</span> · not a room I watch.</p>"));
  assert.ok(dashboard({ ...ctx, events: [] }).includes('<p class="empty">Nothing here since I started.</p>'));
});
test('a message that did not engage the bot is one quiet line with no text', () => {
  const html = dashboard(ctx);
  assert.ok(html.includes(`<div class="m q" data-at="${at(9)}"><div class="msg"><time datetime="2026-10-28T14:22:00.000Z">14:22</time><p><span class="n">ben</span> · learned. a little warmer. (0.91)</p></div></div>`));
});
test('hostile text in a mention and in the bot\'s reply is escaped', () => {
  const html = dashboard(ctx);
  assert.ok(html.includes('<div class="n">ana&#60;i&#62;</div><p>@bot &#60;/p&#62;&#60;script&#62;x&#60;/script&#62;</p>'));
  assert.ok(html.includes('<div class="n">me</div><p>&#60;img src=x onerror=alert(1)&#62;</p></div></div><div class="note">my reply to ana&#60;i&#62;. <form method="post" action="/delete">'));
  assert.ok(html.includes('<input type="hidden" name="message_id" value="p&#34;1">'));
  assert.ok(html.includes('<p>&#60;script&#62;said&#60;/script&#62;</p>'));
  assert.equal(html.match(/<script>/g).length, 1);
  assert.ok(!html.includes('<img src=x') && !html.includes('<b>hi'));
});
test('who I am shows the persona, the drift from the start, and the exact prompt; edit escapes the editor', () => {
  const html = dashboard({ ...ctx, view: 'who' });
  assert.ok(html.includes('<body class="v-who">') && html.includes('<a href="/?view=who&room=general" aria-current="page">who I am</a>'));
  assert.ok(html.includes('<p class="persona">canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; {name}</p>'));
  assert.ok(html.includes('<span>warmth</span><i style="--v:62%" title="0.62"></i>'));
  assert.ok(html.includes('<p class="lean">This room has made me warmer and more matter-of-fact than where I started (the tick at 0.5).</p>'));
  assert.ok(html.includes('<div><small>persona</small>canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; P&#60;i&#62;</div>'));
  assert.ok(html.includes(`<div class="fixed"><small>guardrails · fixed</small>${guardrails}</div><div class="fixed"><small>then the room · fixed</small>the last 8 lines here, one "name: text" each, with mine as "you", then: Write your next line in the room. Just the text: no name in front, no quotes. When I chime in unprompted, instead: Nobody asked you anything: you're speaking up on your own, so make it an aside that fits the flow, not an answer to anyone. Write your next line in the room. Just the text: no name in front, no quotes.</div></details>`));
  assert.ok(html.includes("<div><small>learned style</small>Match the room's temperament: it runs a little warmer than a typical chat.</div>"));
  const edit = dashboard({ ...ctx, view: 'who', edit: true });
  assert.ok(edit.includes('<textarea name="persona" maxlength="4000" required>canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; {name}</textarea>'));
  assert.ok(edit.includes('<input type="hidden" name="view" value="who">') && edit.includes('action="/persona/reset"'));
  assert.ok(dashboard({ ...ctx, status: { ...status, personality: { warmth: .5, playfulness: .5, curiosity: .5, expressiveness: .5 } } }).includes("I'm still where I started, at the tick (0.5)."));
});
test('a replied message says how long it took, with the stages in its tooltip', () => {
  const html = dashboard(ctx);
  assert.ok(html.includes('<div class="note ok" title="context 0.3s · judge 0.6s · compose 0.9s · post 0.1s · judge by cohere/north-mini-code · compose by a&#34;b">answered in 1.4s. I was 0.97 sure a reply fit.</div>'));
});
test('today counts calls as cells and sums up the day', () => {
  const html = dashboard(ctx);
  assert.ok(html.includes('<p class="small">speed today: median 1.4s, p90 1.4s, over 1 reply.</p>'));
  assert.ok(dashboard({ ...ctx, events: ctx.events.filter(e => !e.ms) }).includes('<p class="small">speed today: no replies yet.</p>'));
  assert.ok(html.includes(`<div class="day" style="--n:40">${'<i class="u"></i>'.repeat(3)}${'<i></i>'.repeat(37)}</div>`));
  assert.ok(html.includes(`3 of 40 calls. 1 reply, 3 mentions I didn't answer, 1 thing learned since <time datetime="${new Date(at(9)).toISOString()}">14:22 UTC</time>.</p>`));
  const none = dashboard({ ...ctx, limit: '0' });
  assert.ok(!none.includes('class="day"') && none.includes('<p class="small">No calls allowed today. 1 reply,'));
  assert.ok(none.includes("on h. I have no model calls to spend today.</p>"));
});
test('where I live names the server, connection and ping, and previews only https or data:image avatars', () => {
  const html = dashboard({ ...ctx, lastError: { code: 'inference-<429>', at: Date.UTC(2026, 9, 28, 12, 0, 5) } });
  assert.ok(html.includes('<img src="https://h/a.png" alt=""><span>wss://h/ as bot_x, connected 14m, ping 45ms.<br>last error inference-&#60;429&#62; at 2026-10-28 12:00:05 UTC</span>'));
  assert.ok(html.includes('<dt>capabilities</dt><dd>history, edit</dd>') && html.includes('<dt>welcome</dt><dd>&#60;b&#62;hi&#60;/b&#62;</dd>'));
  assert.ok(html.includes('<input name="url" value="wss://h/" required>') && html.includes('type="password"'));
  for (const avatar of ['javascript:alert(1)', 'http://h/a.png', 'data:text/html,x']) assert.ok(!dashboard({ ...ctx, details: { ...ctx.details, you: { ...ctx.details.you, avatar } } }).includes('<img'), avatar);
  assert.ok(dashboard({ ...ctx, details: { ...ctx.details, you: { ...ctx.details.you, avatar: 'data:image/png;base64,AA' } } }).includes('<img src="data:image/png;base64,AA" alt="">'));
  assert.ok(dashboard({ ...ctx, details: { url: 'wss://h/', since: null }, status: { ...status, connected: false, error: 'connecting' } }).includes('wss://h/, not connected (connecting).'));
});
test('the public page carries no transcript, persona or admin content', () => {
  const html = page('P', { ...status, paused: true });
  assert.ok(html.includes('paused · h · bot_x · a/9 · 3 calls today'));
  for (const s of ['canary-persona', guardrails, '<form', '<nav', 'who I am', 'token', 'answered', 'class="chat"', '<script']) assert.ok(!html.includes(s), s);
});
test('how I respond shows each trigger as saved, and the header names chiming in when it is on', () => {
  const html = dashboard({ ...ctx, view: 'who' });
  assert.ok(html.includes('<section id="respond"><h2>how I respond</h2><div class="card"><form method="post" action="/settings"><input type="hidden" name="view" value="who"><input type="hidden" name="room" value="general">'));
  assert.ok(html.includes('<label class="tick"><input type="checkbox" name="reply_mentions" value="on" checked><input type="hidden" name="reply_mentions" value="off">answer when mentioned</label>'));
  assert.ok(html.includes('<label>reply bar<input type="number" name="reply_threshold" min="0.5" max="0.99" step="0.05" value="0.70" required></label>'));
  assert.ok(!html.includes('cooldown') && !html.includes('organic_gap'));
  assert.ok(html.includes('<label class="tick"><input type="checkbox" name="organic" value="on"><input type="hidden" name="organic" value="off">chime in unprompted</label>'));
  assert.ok(html.includes('<label>chime-in bar<input type="number" name="organic_threshold" min="0.5" max="0.99" step="0.05" value="0.90" required></label>\n<p class="small">only on messages I already read to learn from, and never twice in a row: I wait for someone else to speak first.</p>'));
  assert.ok(html.indexOf('id="who"') < html.indexOf('id="respond"') && html.indexOf('id="respond"') < html.indexOf('id="today"'));
  assert.ok(html.includes("<p>I'm listening in #general and #random on h. 3 of my 40 calls are spent today.</p>"));
  const loose = dashboard({ ...ctx, settings: { ...ctx.settings, reply_replies: false, organic: true, organic_threshold: .95 } });
  assert.ok(loose.includes('<input type="checkbox" name="reply_replies" value="on"><input type="hidden" name="reply_replies" value="off">'));
  assert.ok(loose.includes('<input type="checkbox" name="organic" value="on" checked>') && loose.includes('name="organic_threshold" min="0.5" max="0.99" step="0.05" value="0.95"'));
  assert.ok(loose.includes("<p>I'm listening in #general and #random on h, and I chime in unprompted now and then. 3 of my 40 calls are spent today.</p>"));
  assert.ok(dashboard({ ...ctx, status: { ...status, paused: true }, settings: { ...ctx.settings, organic: true } }).includes("<p>I'm paused, so I'm not reading #general and #random on h. 3"));
});
test('who I am shows each room\'s notes, its last 7 days by topic and a norms editor, all escaped, and the prompt shows the notes', () => {
  const html = dashboard({ ...ctx, view: 'who' });
  assert.ok(html.includes('<div class="mem"><h3>#general</h3><p class="small">In #general lately: mostly code. Norms: &#60;/textarea&#62;&#60;script&#62;n&#60;/script&#62; be kind</p>'));
  assert.ok(html.includes('<table class="week"><thead><tr><th>last 7 days</th><th title="2026-10-22">22</th><th title="2026-10-23">23</th><th title="2026-10-24">24</th><th title="2026-10-25">25</th><th title="2026-10-26">26</th><th title="2026-10-27">27</th><th title="2026-10-28">28</th></tr></thead><tbody><tr><th>code</th><td class="z">·</td><td>1</td><td class="z">·</td><td>2</td><td class="z">·</td><td class="z">·</td><td>3</td></tr><tr><th>banter</th><td>1</td>'));
  assert.ok(html.includes('<form method="post" action="/norms"><input type="hidden" name="view" value="who"><input type="hidden" name="room" value="general"><input type="hidden" name="room_id" value="general"><label>norms for #general, which I\'ll honour<textarea name="norms" maxlength="1000">&#60;/textarea&#62;&#60;script&#62;n&#60;/script&#62; be kind</textarea></label>\n<div class="bar"><button class="save">save</button><span>37 of 1000</span></div></form></div>'));
  assert.ok(html.includes('<div class="mem"><h3>#random</h3><p class="small">nothing to note yet.</p>\n<p class="small">no messages counted in the last 7 days.</p>'));
  assert.ok(html.includes('<textarea name="norms" maxlength="1000"></textarea></label>\n<div class="bar"><button class="save">save</button><span>0 of 1000</span></div>'));
  assert.ok(html.includes("<div><small>learned style</small>Match the room's temperament: it runs a little warmer than a typical chat.</div><div><small>room notes · #general, rebuilt daily</small>In #general lately: mostly code. Norms: &#60;/textarea&#62;&#60;script&#62;n&#60;/script&#62; be kind</div><div class=\"fixed\"><small>guardrails · fixed</small>"));
  assert.ok(dashboard({ ...ctx, view: 'who', room: 'random' }).includes('<div><small>room notes · #random, rebuilt daily</small>nothing yet.</div>'));
  assert.ok(dashboard({ ...ctx, view: 'who', room: 'elsewhere' }).includes('<small>room notes · #general, rebuilt daily</small>In #general'));
  assert.equal(html.match(/<script>/g).length, 1);
});
