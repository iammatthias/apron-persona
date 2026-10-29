import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { page } from '../src/page.js';
import { dashboard } from '../src/dashboard.js';
import { guardrails, cue, chime, restore } from '../src/settings.js';
const t = Date.UTC(2026, 9, 28, 14, 31), at = m => t - m * 60000;
const status = { connected: true, paused: false, error: null, budget: { day: '2026-10-28', calls: 3 }, personality: { warmth: .62, playfulness: .5, curiosity: .45, expressiveness: .5 }, server: { host: 'h', user_id: 'bot_x', agent: 'a/9' } };
const events = [
  { at: at(30), kind: 'disconnected', reason: 'close-1006' },
  { at: at(26), kind: 'connected', host: 'h', user_id: 'bot_x' },
  { at: at(12), kind: 'message', room: 'general', message_id: '0', from: 'u_ben', name: 'ben', outcome: 'rate-limited' },
  { at: at(10), kind: 'message', room: 'general', message_id: '1', from: 'u_ben', name: 'ben', outcome: 'learned-only', learn_p: .91, reply_p: .1, style: [.75, .5, .5, .5] },
  { at: at(8), kind: 'message', room: 'general', message_id: '2', from: 'u_ana', name: 'ana<i>', addressed: 'mention', text: '@bot </p><script>x</script>', outcome: 'replied', learn_p: .5, reply_p: .97, ms: { context: 310, judge: 640, compose: 920, post: 80, total: 1400 }, via: { judge: 'cohere/north-mini-code', compose: 'a"b' } },
  { at: at(7), kind: 'posted', room: 'general', message_id: 'p"1', reply_to: '2', text: '<img src=x onerror=alert(1)>' },
  { at: at(6), kind: 'message', room: 'general', message_id: '3', from: 'u_lin', name: 'lin', addressed: 'mention', text: '@bot one', outcome: 'declined', learn_p: .5, reply_p: .42, need: .7 },
  { at: at(5), kind: 'message', room: 'random', message_id: '4', from: 'u_lin', name: 'lin', addressed: 'mention', text: '@bot two', outcome: 'budget' },
  { at: at(4), kind: 'message', room: 'general', message_id: '5', from: 'u_lin', name: 'lin', outcome: 'spoke-last', learn_p: .9, reply_p: .95, point_p: .95 },
  { at: at(3), kind: 'message', room: 'elsewhere-room', message_id: '6', from: 'u_zed', name: 'zed<b>', outcome: 'other-room' },
  { at: at(2), kind: 'settings', keys: ['reply_threshold'], reply_threshold: .75 },
];
const week = { days: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'], rows: [['code', [0, 1, 0, 2, 0, 0, 3]]] };
const s = {
  name: 'P<i>', now: t, rooms: ['general', 'random'], events, limit: '40', status, spent: { judge: { calls: 2, hedges: 1, retries: 0 }, compose: { calls: 1, hedges: 0, retries: 0 } },
  settings: restore({ settings: { persona: 'canary-persona </textarea><script>x</script> {name}', norms: { general: '</textarea><script>n</script> be kind' } } }),
  lastError: null, learning: null, preview: null,
  memory: [{ id: 'general', notes: 'In #general lately: mostly code. Norms: </textarea><script>n</script> be kind', week }, { id: 'random', notes: '', week: { days: week.days, rows: [] } }],
  details: { url: 'wss://h/', since: at(26), latency: 45, server: { agent: 'a/9', capabilities: ['history', 'edit'], welcome: '<b>hi</b>' }, you: { user_id: 'bot_x', name: 'P', roles: ['bot'], avatar: 'https://h/a.png' } },
  posts: [{ room_id: 'general', message_id: '9', log_id: String(at(7)), body: { text: '<script>said</script>' } }],
};
const view = (v, extra = {}, room = 'general') => dashboard({ ...s, ...extra }, { view: v, room });
const scripts = html => html.match(/<script>/g).length;
test('the strip on every page says how the link is, what the day cost and did, and pauses in one tap', () => {
  for (const v of ['now', 'room', 'bot', 'plumbing']) {
    const html = view(v);
    assert.ok(html.includes('<b class="nm">P&#60;i&#62;</b>\n<span class="id"><i class="dot up"></i><span>up 26m · <em class="warn">1 drops/h</em></span></span>'), v);
    assert.ok(html.includes(`<span class="calls" title="2 reading messages, 1 hedge · 1 writing replies · 0 reading history"><span class="cells" style="--n:40">${'<i class="u"></i>'.repeat(3)}${'<i></i>'.repeat(37)}</span><span>3/40 calls</span></span>`), v);
    assert.ok(html.includes('<span class="kv"><span title="median 1.4s, p90 1.4s"><b>1</b> replies</span><span class="warn"><b>2</b> unanswered</span><span><b>1</b> learned</span><span class="faint">of 6 read today</span></span>'), v);
    assert.ok(html.includes(`<input type="hidden" name="view" value="${v}"><input type="hidden" name="room" value="general"><input type="hidden" name="paused" value="on"><button class="switch on"><span><b>Listening</b> <small>tap to stop</small></span><i></i></button>`), v);
  }
  const paused = view('now', { status: { ...status, paused: true } });
  assert.ok(paused.includes('<i class="dot paused"></i><span>paused · ') && paused.includes('<input type="hidden" name="paused" value="off"><button class="switch off"><span><b>Paused</b> <small>tap to resume</small></span>'));
  const down = view('now', { events: [], status: { ...status, connected: false, error: 'no-apron-token', budget: { day: '2026-10-27', calls: 9 } }, limit: '0' });
  assert.ok(down.includes('<i class="dot down"></i><span>down (no-apron-token)</span>') && down.includes('<span class="calls" title="0 reading messages · 0 writing replies · 0 reading history"><span>no calls today</span></span>'));
});
test('the nav has now, a tab per room badged with its unanswered mentions, the bot and plumbing at the end', () => {
  assert.ok(view('room', {}, 'random').includes('<nav class="top" id="nav" data-live><a href="/">now</a><a href="/?view=room&#38;room=general">#general <em>1 unanswered</em></a><a href="/?view=room&#38;room=random" aria-current="page">#random <em>1 unanswered</em></a><a href="/?view=bot">the bot</a><a href="/?view=plumbing" class="end">plumbing</a></nav>'));
  assert.ok(view('plumbing').includes('<a href="/?view=plumbing" class="end" aria-current="page">plumbing</a>'));
});
test('now lists what needs the owner, a card per room, and the bot in brief; one room drops the card', () => {
  const html = view('now');
  assert.ok(html.includes('<section id="needs" data-live><h2>needs you <span>2</span></h2><ul class="needs"><li class="warn"><a href="/?view=room&#38;room=general">1 mention in #general got no answer <small>lin <time datetime="2026-10-28T14:25:00.000Z">14:25</time>, below the bar</small></a></li><li class="warn"><a href="/?view=room&#38;room=random">1 mention in #random got no answer <small>lin <time datetime="2026-10-28T14:26:00.000Z">14:26</time>, at your cap</small></a></li></ul></section>'));
  assert.ok(html.includes('<div class="cards" id="cards" data-live><section class="card room"><div class="head"><a href="/?view=room&#38;room=general">#general</a><span class="small">5 read today · last 4m ago</span></div>'));
  assert.ok(html.includes('<aside><h2>the bot <a href="/?view=bot">tune</a></h2><div class="card botcard"><p class="persona">canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; P&#60;i&#62;</p>'));
  assert.ok(html.includes('<p class="small">I answer mentions and replies at 0.70. I never chime in.</p>'));
  const one = view('now', { rooms: ['general'], events: events.filter(e => e.room !== 'random') });
  assert.ok(!one.includes('class="cards"') && one.includes('<h2>needs you <span>1</span></h2>') && one.includes('class="card botcard"'));
  assert.ok(view('now', { events: [] }).includes('<h2>needs you <span>0</span></h2><p class="small">nothing needs you.</p>'));
});
test('a room is its transcript with reasons in the margin, quiet runs folded, and churn left out', () => {
  const html = view('room');
  assert.ok(!html.includes('lost the server') && !html.includes('connected to h'));
  assert.ok(html.includes(`<details class="fold" data-at="${at(10)}" data-from="${at(12)}"><summary><time datetime="2026-10-28T14:19:00.000Z">14:19</time><span>2 messages read, 1 learned from</span></summary><div class="m q" data-at="${at(12)}" data-from="${at(12)}">`));
  assert.ok(html.includes('<div class="note ok" title="context 0.3s · judge 0.6s · compose 0.9s · post 0.1s · judge by cohere/north-mini-code · compose by a&#34;b">answered in 1.4s. I was 0.97 sure a reply fit.</div>'));
  assert.ok(html.includes(`<div class="m ua" data-at="${at(6)}"><div class="msg"><time datetime="2026-10-28T14:25:00.000Z">14:25</time><div><div class="n">lin</div><p>@bot one</p></div></div><div class="note warn">didn't answer. reply chance 0.42, I need 0.70.</div></div>`));
  assert.ok(html.includes(`<div class="m q" data-at="${at(4)}"><div class="msg"><time datetime="2026-10-28T14:27:00.000Z">14:27</time><p><span class="n">lin</span> · I'd said something here only a few messages ago, so I let others talk.</p></div></div>`));
  assert.ok(html.includes(`<div class="gap" data-at="${at(2)}"><span><time datetime="2026-10-28T14:29:00.000Z">14:29</time> you set my reply bar to 0.75</span></div>`));
  assert.ok(html.includes(`<div class="chat" data-room="general" data-since="${at(2)}">`));
});
test('a room\'s side column holds only its notes, topics, norms and posts', () => {
  const html = view('room');
  assert.ok(html.includes('<h2>what I believe about #general</h2><div class="card"><p class="small">In #general lately: mostly code. Norms: &#60;/textarea&#62;&#60;script&#62;n&#60;/script&#62; be kind</p>'));
  assert.ok(html.includes('<table class="week"><thead><tr><th></th><th title="2026-10-22">22</th><th title="2026-10-23">23</th><th title="2026-10-24">24</th><th title="2026-10-25">25</th><th title="2026-10-26">26</th><th title="2026-10-27">27</th><th title="2026-10-28">28</th></tr></thead><tbody><tr><th>code</th><td class="z">·</td><td>1</td><td class="z">·</td><td>2</td><td class="z">·</td><td class="z">·</td><td>3</td></tr></tbody></table>'));
  assert.ok(html.includes('<form method="post" action="/norms"><input type="hidden" name="view" value="room"><input type="hidden" name="room" value="general"><input type="hidden" name="room_id" value="general"><label>norms for #general, which I\'ll honour<textarea class="short" name="norms" maxlength="1000">&#60;/textarea&#62;&#60;script&#62;n&#60;/script&#62; be kind</textarea></label>\n<div class="bar"><button class="save">save</button><span>37 of 1000</span></div></form>'));
  assert.ok(html.includes('<h2>what I\'ve said here <span>1</span></h2><details><summary>show all, with delete</summary><article><p>&#60;script&#62;said&#60;/script&#62;</p><form method="post" action="/delete"><input type="hidden" name="view" value="room"><input type="hidden" name="room" value="general"><span>2026-10-28 14:24 UTC</span><input type="hidden" name="room_id" value="general"><input type="hidden" name="message_id" value="9"><button class="del">delete</button></form></article></details>'));
  const random = view('room', { posts: { error: 'not-connected' } }, 'random');
  assert.ok(random.includes("<p class=\"small\">I can't read my history right now (not-connected).</p>") && random.includes('<p class="small">nothing to note yet.</p>') && random.includes('no messages counted in the last 7 days.'));
  assert.ok(!random.includes('In #general lately'));
});
test('hostile text is escaped on every view', () => {
  const html = view('room');
  assert.ok(html.includes('<div class="n">ana&#60;i&#62;</div><p>@bot &#60;/p&#62;&#60;script&#62;x&#60;/script&#62;</p>'));
  assert.ok(html.includes('<div class="n">me</div><p>&#60;img src=x onerror=alert(1)&#62;</p></div></div><div class="note">my reply to ana&#60;i&#62;. <form method="post" action="/delete">'));
  assert.ok(html.includes('<input type="hidden" name="message_id" value="p&#34;1">'));
  for (const v of ['now', 'room', 'bot', 'plumbing']) {
    const page = view(v);
    assert.equal(scripts(page), 1, v);
    assert.ok(!page.includes('<img src=x') && !page.includes('<b>hi') && !page.includes('zed<b>') && !page.includes('</textarea><script>'), v);
  }
  assert.ok(view('plumbing').includes('zed&#60;b&#62; in #elsewhere-room: not a room I watch.'));
});
test('the bot is how it thinks: the gate, then each prompt part exactly as sent, with a table of contents', () => {
  const html = view('bot');
  assert.ok(html.includes('<nav class="toc"><b>the gate</b><a href="#answer">1 do I answer when asked?</a><a href="#chime">2 do I speak up unprompted?</a><b>the prompt, in order</b><a href="#persona">3 who I am</a><a href="#traits">4 what the room made me</a><a href="#room">5 what I know about the room</a><a href="#rules">6 the fixed rules</a><a href="#lines">7 the last lines</a></nav>'));
  assert.ok(html.includes('<label class="tick"><input type="checkbox" name="reply_mentions" value="on" checked><input type="hidden" name="reply_mentions" value="off">answer when mentioned</label>'));
  assert.ok(html.includes('<label>reply bar<input type="number" name="reply_threshold" min="0.5" max="0.99" step="0.05" value="0.70" required></label>\n<div class="bar"><button class="save">save</button><span>today: 1 answered, 2 not</span></div>'));
  assert.ok(html.includes('<label>chime-in bar<input type="number" name="organic_threshold" min="0.5" max="0.99" step="0.05" value="0.90" required></label>\n<div class="bar"><button class="save">save</button><span>today: 0 chime-ins, 1 held back</span></div>'));
  assert.ok(!html.includes('cooldown') && !html.includes('organic_gap') && !html.includes('already read'));
  assert.ok(html.includes('<textarea name="persona" maxlength="4000" required>canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; {name}</textarea>'));
  assert.ok(html.includes('<details><summary>exactly as sent</summary><div class="sent"><small>sent</small>canary-persona &#60;/textarea&#62;&#60;script&#62;x&#60;/script&#62; P&#60;i&#62;</div></details>'));
  assert.ok(html.includes("<div class=\"sent\"><small>sent</small>Match the room's temperament: it runs a little warmer than a typical chat.</div>"));
  assert.ok(html.includes('<div class="rtabs"><a href="/?view=bot&#38;room=general#room" aria-current="page">#general</a><a href="/?view=bot&#38;room=random#room">#random</a></div>\n<div class="sent"><small>sent in #general</small>In #general lately: mostly code. Norms: &#60;/textarea&#62;&#60;script&#62;n&#60;/script&#62; be kind</div>'));
  assert.ok(view('bot', {}, 'random').includes('<div class="sent"><small>sent in #random</small>nothing yet, so this part is left out.</div>'));
  assert.ok(html.includes(`<div class="sent"><small>sent</small>${guardrails}</div>`));
  assert.ok(html.includes(`<div class="sent"><small>sent when I answer</small>ana: what they said\nyou: what I said\n\n${cue}</div><div class="sent"><small>sent when I chime in</small>ana: what they said\nyou: what I said\n\n${chime}</div>`));
  assert.ok(html.includes('<div class="sub" id="lesson"><details><summary>redraft from history</summary><form method="post" action="/learn"><input type="hidden" name="view" value="bot">'));
});
test('a redraft ready to review is escaped beside the traits it would leave', () => {
  const hostile = '</textarea><script>alert(1)</script> You are {name} & "co"';
  const learning = { stage: 'ready', host: 'h', rooms: ['general'], persona: hostile, vector: [1, 0, .5, .75], count: 300, failed: 1, detail: 'inference-<429>' };
  const preview = { warmth: .75, playfulness: .25, curiosity: .5, expressiveness: .63 };
  const html = view('bot', { learning, preview });
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('<h3>redraft from history <span class="ok">· ready</span></h3><p class="small">300 messages from #general on h. 1 of my readings failed (inference-&#60;429&#62;), so this leans on the rest.</p>'));
  assert.ok(html.includes('<textarea name="persona" maxlength="4000" required>&#60;/textarea&#62;&#60;script&#62;alert(1)&#60;/script&#62; You are {name} &#38; &#34;co&#34;</textarea>'));
  assert.ok(html.includes('<div class="vs"><span></span><small>now</small><small>after</small><span>warmth</span><span>0.62</span><b>0.75</b><span>playfulness</span><span>0.50</span><b>0.25</b>'));
  assert.ok(view('now', { learning, preview }).includes('<li class="ok"><a href="/?view=bot#persona">a redraft from 300 messages in #general on h is ready to review <small>1 of my readings failed (inference-&#60;429&#62;), so it leans on the rest.</small></a></li>'));
});
test('plumbing shows the link, its log, calls by purpose, the greeting and the token form, and previews only https or data:image avatars', () => {
  const html = view('plumbing', { lastError: { code: 'inference-<429>', at: Date.UTC(2026, 9, 28, 12, 0, 5) } });
  assert.ok(html.includes('<dt>server</dt><dd>wss://h/</dd><dt>signed in as</dt><dd class="who"><img src="https://h/a.png" alt="">bot_x</dd>'));
  assert.ok(html.includes('<dt>state</dt><dd>up 26m, ping 45ms</dd><dt>last hour</dt><dd class="warn">1 drop (close-1006)</dd>\n<dt>last error</dt><dd>inference-&#60;429&#62; at 2026-10-28 12:00:05 UTC</dd>'));
  assert.ok(html.includes(`<h2>connection log <span>2</span></h2><div class="card connlog"><div><time datetime="2026-10-28T14:05:00.000Z">14:05</time><span>connected to h as bot_x</span></div><div><time datetime="2026-10-28T14:01:00.000Z">14:01</time><span class="warn">lost the server (close-1006)</span></div></div>`));
  assert.ok(html.includes('<h2>calls today <span>3 of 40</span></h2><div class="card"><dl><dt>reading messages</dt><dd>2, 1 hedge</dd><dt>writing replies</dt><dd>1</dd><dt>reading history</dt><dd>0</dd></dl>'));
  assert.ok(view('plumbing', { spent: {} }).includes('<dt>reading history</dt><dd>0</dd><dt>before sorting</dt><dd>3</dd></dl>'));
  assert.ok(html.includes('<dt>capabilities</dt><dd>history, edit</dd>') && html.includes('<dt>welcome</dt><dd>&#60;b&#62;hi&#60;/b&#62;</dd>'));
  assert.ok(html.includes('<input name="url" value="wss://h/" required>') && html.includes('<input name="token" type="password" autocomplete="off" placeholder="apron_bot_…" required>'));
  for (const avatar of ['javascript:alert(1)', 'http://h/a.png', 'data:text/html,x']) assert.ok(!view('plumbing', { details: { ...s.details, you: { ...s.details.you, avatar } } }).includes('<img'), avatar);
  assert.ok(view('plumbing', { details: { ...s.details, you: { ...s.details.you, avatar: 'data:image/png;base64,AA' } } }).includes('<img src="data:image/png;base64,AA" alt="">'));
  assert.ok(view('plumbing', { details: { url: 'wss://h/', since: null, server: null, you: null }, status: { ...status, connected: false, error: 'connecting' } }).includes('<dt>signed in as</dt><dd class="who">not signed in</dd>'));
});
test('the public page carries no transcript, persona or admin content', () => {
  const html = page('P', { ...status, paused: true });
  assert.equal(html, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>P</title><style>${html.match(/<style>([^]*)<\/style>/)[1]}</style></head><body>
<h1>P</h1>
<p><span class="dot"></span>paused · h · bot_x · a/9 · 3 calls today</p>
<ul><li><span>warmth</span><meter min="0" max="1" value="0.62"></meter><b>62</b></li><li><span>playfulness</span><meter min="0" max="1" value="0.5"></meter><b>50</b></li><li><span>curiosity</span><meter min="0" max="1" value="0.45"></meter><b>45</b></li><li><span>expressiveness</span><meter min="0" max="1" value="0.5"></meter><b>50</b></li></ul>
<p>Learns the room's style. Mention it in Apron to chat.</p>
</body></html>`);
  for (const x of ['canary-persona', guardrails, '<form', '<nav', 'who I am', 'token', 'answered', 'class="chat"', '<script']) assert.ok(!html.includes(x), x);
});
