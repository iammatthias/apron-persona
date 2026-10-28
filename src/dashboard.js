import { escape, doc } from './page.js';
import { promptParts } from './settings.js';
import { axes, leanings } from './core.js';
import { transcript, today } from './transcript.js';
const css = `:root{color-scheme:light dark;--fg:#1d1c1a;--muted:#7b776f;--faint:#aca79c;--bg:#f7f5f0;--paper:#fffefa;--line:#e3dfd5;--ok:#2f7a55;--warn:#a1650a;--bad:#b3261e;--me:#eef3ee}
@media(prefers-color-scheme:dark){:root{--fg:#ebe8e0;--muted:#9b978e;--faint:#635f58;--bg:#131211;--paper:#1a1917;--line:#2d2b27;--ok:#7cc79f;--warn:#e3ab57;--bad:#f08a80;--me:#1b261f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-monospace,Menlo,monospace}
a{color:inherit}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}
.top{max-width:1180px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;gap:16px}
.say{flex:1;min-width:0}.say h1{font-size:15px;margin:0;font-weight:600}.say p{margin:0;color:var(--muted);font-size:12px}
.switch{display:flex;align-items:center;gap:10px;font:inherit;background:var(--paper);border:1.5px solid var(--fg);border-radius:999px;padding:6px 8px 6px 14px;color:var(--fg);cursor:pointer;white-space:nowrap}
.switch b{font-weight:600}.switch small{color:var(--muted)}
.switch i{flex:none;width:38px;height:22px;border-radius:11px;background:var(--ok);position:relative}
.switch i::after{content:"";position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:50%;background:#fff}
.switch.off{border-color:var(--warn)}.switch.off b{color:var(--warn)}.switch.off i{background:var(--faint)}.switch.off i::after{right:auto;left:3px}
.views{display:none}
.flash{max-width:1180px;margin:12px auto 0;padding:0 16px}.flash p{margin:0;padding:8px 12px;border-left:3px solid var(--ok);background:var(--paper)}.flash p.bad{border-color:var(--bad)}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:32px}
main{min-width:0}
.rooms{display:flex;gap:4px;margin:16px 0 0;border-bottom:1px solid var(--line)}
.rooms a{text-decoration:none;padding:6px 12px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;font-size:13px;white-space:nowrap}
.rooms a[aria-current]{color:var(--fg);border-color:var(--fg)}
.rooms em{font-style:normal;font-size:11px;color:var(--warn)}
.rooms .elsewhere{margin-left:auto;color:var(--faint)}
.chat{padding:8px 0 0}
.m{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:24px;padding:7px 0}
.msg{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px}
.msg time,.gap time{color:var(--faint);font-size:11px;padding-top:3px}
.msg .n{color:var(--muted);font-size:12px}
.msg p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.note{font-size:12px;color:var(--muted);border-left:1px solid var(--line);padding-left:12px;line-height:1.45;align-self:start;padding-top:2px;overflow-wrap:anywhere}
.note.ok{color:var(--ok);border-color:var(--ok)}.note.warn{color:var(--warn);border-color:var(--warn)}.note.bad{color:var(--bad);border-color:var(--bad)}
.m.q{grid-template-columns:minmax(0,1fr);padding:3px 0}.m.q p{color:var(--muted);font-size:12px;padding-top:2px}.m.q .n{color:var(--muted)}
.m.self .msg>div{background:var(--me);border-radius:8px;padding:8px 12px}.m.self .n{color:var(--ok)}
.m.gone .msg>div{background:none;border:1px dashed var(--line)}.m.gone .msg p{color:var(--muted);text-decoration:line-through}
.note form{display:inline}
.del{font:inherit;font-size:12px;background:none;border:1px solid color-mix(in srgb,var(--bad) 45%,transparent);color:var(--bad);border-radius:4px;padding:1px 8px;cursor:pointer}
.gap{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:11px;margin:10px 0}
.gap::before,.gap::after{content:"";flex:1;border-top:1px dashed var(--line)}
.gap time{padding:0}
.empty{color:var(--muted);font-size:12px;padding:16px 0}
.now{color:var(--muted);font-size:11px;margin:12px 0 40px}
aside{padding:16px 0 40px;display:flex;flex-direction:column;gap:22px;min-width:0}
aside h2{font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 8px;display:flex;justify-content:space-between}
aside h2 a,aside h2 span{text-transform:none;letter-spacing:0}
.card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px}
.persona{margin:0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.traits{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;align-items:center;margin-top:12px}
.traits i{height:4px;background:var(--line);border-radius:2px;position:relative}.traits i::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--v);background:var(--fg);border-radius:2px}
.traits i::before{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;border-left:1px solid var(--faint)}
.lean{font-size:12px;color:var(--muted);margin:10px 0 0}
details{margin-top:12px;font-size:12px}summary{cursor:pointer;color:var(--muted)}
.pp div{margin-top:8px;padding:6px 8px;border-left:2px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.pp small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.pp .fixed{border-left-style:dashed}
textarea,input{font:inherit;font-size:13px;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;width:100%;margin:4px 0 10px}
textarea{min-height:14rem;resize:vertical;line-height:1.5}
label{display:block;font-size:12px;color:var(--muted)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.save{font:inherit;font-size:12px;color:var(--bg);background:var(--fg);border:1px solid var(--fg);border-radius:6px;padding:4px 12px;cursor:pointer}
.reset{margin-top:10px}.reset button{font:inherit;font-size:12px;background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer}
.day{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:2px;margin:0 0 6px}
.day i{height:10px;background:var(--line);border-radius:1px}.day i.u{background:var(--fg)}
.small{font-size:12px;color:var(--muted);margin:0;overflow-wrap:anywhere}
.said article{font-size:12px;padding:6px 0;border-top:1px solid var(--line)}
.said p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.said form{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);margin-top:2px}
.said details{margin-top:0}.said summary{padding:6px 0;border-top:1px solid var(--line)}
.who{display:flex;align-items:center;gap:10px}.who img{width:28px;height:28px;border-radius:50%;flex:none}
dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:3px 10px;font-size:11px;margin:8px 0 0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
@media(max-width:899px){
 .wrap{grid-template-columns:minmax(0,1fr);gap:0}
 header{position:static}
 .top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px}.say{display:contents}.say h1{align-self:center}.say p{grid-column:1/-1;grid-row:2}
 .switch{padding-left:12px}
 .views{display:flex;gap:16px;max-width:1180px;margin:0 auto;padding:0 16px;font-size:13px}
 .views a{text-decoration:none;color:var(--muted);padding:6px 0;border-bottom:2px solid transparent;margin-bottom:-1px}
 .views a[aria-current]{color:var(--fg);border-color:var(--fg)}
 .v-transcript aside,.v-who main,.v-where main,.v-who #where,.v-where #who,.v-where #today,.v-where #said{display:none}
 .m{grid-template-columns:minmax(0,1fr);gap:2px}
 .note{margin-left:54px;border-left:0;padding-left:0}
 .note::before{content:"↳ "}
 .rooms{overflow-x:auto}.rooms .elsewhere{margin-left:0}
}`;
const hhmm = at => new Date(at).toISOString().slice(11, 16);
const time = at => `<time datetime="${new Date(at).toISOString()}">${hhmm(at)}</time>`;
const list = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = ms => ms < 60000 ? `${Math.round(ms / 1000)}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m` : ms < 172800000 ? `${Math.round(ms / 3600000)}h` : `${Math.round(ms / 86400000)}d`;
const views = ['transcript', 'who', 'where'];
// Every form carries the view and room it came from, so the action can redirect back to them.
const post = (ctx, action, inner, cls = '') =>
  `<form method="post" action="${action}"${cls ? ` class="${cls}"` : ''}><input type="hidden" name="view" value="${ctx.view}"><input type="hidden" name="room" value="${escape(ctx.room)}">${inner}</form>`;
// One transcript row: a message with text, a quiet line for one without, the bot's own post, or a break.
export function row(r, ctx) {
  const at = ` data-at="${r.at}"`;
  if (r.kind === 'break') return `<div class="gap"${at}><span>${time(r.at)} ${escape(r.text)}</span></div>`;
  const who = escape(r.who) + (r.room && ctx.room === 'elsewhere' ? ` in #${escape(r.room)}` : '');
  if (r.kind === 'message' && r.text === undefined) return `<div class="m q"${at}><div class="msg">${time(r.at)}<p><span class="n">${who}</span> · ${escape(r.margin)}</p></div></div>`;
  const note = r.kind === 'post'
    ? `<div class="note">${escape(r.margin)}${r.deleted ? '' : ` ${post(ctx, '/delete', `<input type="hidden" name="room_id" value="${escape(r.room)}"><input type="hidden" name="message_id" value="${escape(r.message_id)}"><button class="del">delete</button>`)}`}</div>`
    : `<div class="note${r.tone ? ` ${r.tone}` : ''}">${escape(r.margin)}</div>`;
  const cls = r.kind === 'post' ? ` self${r.deleted ? ' gone' : ''}` : '';
  return `<div class="m${cls}"${at}${r.kind === 'post' ? ` data-message-id="${escape(r.message_id)}"` : ''}><div class="msg">${time(r.at)}<div><div class="n">${r.kind === 'post' ? 'me' : who}</div><p>${escape(r.text)}</p></div></div>${note}</div>`;
}
// The rows of one room (or "elsewhere") from the event log, as the live script fetches them.
export function rows(ctx) {
  const t = transcript(ctx.events, ctx.rooms);
  return ctx.room === 'elsewhere' ? t.elsewhere : t.rooms.find(r => r.id === ctx.room)?.rows ?? [];
}
export const roomOf = (rooms, room) => room === 'elsewhere' || rooms.includes(room) ? room : rooms[0];
export const viewOf = view => views.includes(view) ? view : 'transcript';
const toggle = ctx => post(ctx, '/settings', `<input type="hidden" name="paused" value="${ctx.status.paused ? 'off' : 'on'}">
<button class="switch ${ctx.status.paused ? 'off' : 'on'}"><span><b>${ctx.status.paused ? 'Paused' : 'Listening'}</b> <small>${ctx.status.paused ? 'tap to resume' : 'tap to stop'}</small></span><i></i></button>`);
function sentence({ status, rooms, details, limit, calls }) {
  const where = list(rooms.map(r => `#${r}`)), host = status.server?.host ?? (() => { try { return new URL(details.url).host; } catch { return details.url; } })();
  const spent = Number(limit) ? ` ${calls} of my ${limit} calls are spent today.` : ' I have no model calls to spend today.';
  if (!status.connected) return (status.error ? `I can't reach ${host} (${status.error}).` : `I'm connecting to ${host}.`) + spent;
  return (status.paused ? `I'm paused, so I'm not reading ${where} on ${host}.` : `I'm listening in ${where} on ${host}.`) + spent;
}
// The private dashboard. ctx is { name, status, settings, limit, details, lastError, events, posts, rooms, room, view, edit, flash, now }.
export function dashboard(ctx) {
  const t = transcript(ctx.events, ctx.rooms), now = ctx.now ?? Date.now();
  const calls = ctx.status.budget.day === new Date(now).toISOString().slice(0, 10) ? ctx.status.budget.calls : 0;
  const c = { ...ctx, calls, now };
  const shown = ctx.room === 'elsewhere' ? t.elsewhere : t.rooms.find(r => r.id === ctx.room).rows;
  const link = (q, label, current) => `<a href="/?${q}"${current ? ' aria-current="page"' : ''}>${label}</a>`;
  const tabs = t.rooms.map(r => link(`room=${encodeURIComponent(r.id)}`, `#${escape(r.id)}${r.unanswered ? ` <em>${r.unanswered} unanswered</em>` : ''}`, r.id === ctx.room)).join('')
    + `<a class="elsewhere" href="/?room=elsewhere"${ctx.room === 'elsewhere' ? ' aria-current="page"' : ''}>ignored elsewhere ${t.elsewhere.length}</a>`;
  const nav = views.map((v, i) => link(`view=${v}&room=${encodeURIComponent(ctx.room)}`, ['transcript', 'who I am', 'where I live'][i], v === ctx.view)).join('');
  const flash = ctx.flash ? `<div class="flash"><p${ctx.flash.error ? ' class="bad"' : ''}>${escape(ctx.flash.error ?? ctx.flash.ok)}</p></div>` : '';
  return doc(ctx.name, `<header><div class="top">
<div class="say"><h1>${escape(ctx.name)}</h1><p>${escape(sentence(c))}</p></div>
${toggle(ctx)}
</div><nav class="views">${nav}</nav></header>
${flash}<div class="wrap">
<main><nav class="rooms">${tabs}</nav>
<div class="chat" data-room="${escape(ctx.room)}" data-since="${ctx.events.at(-1)?.at ?? 0}">${shown.map(r => row(r, ctx)).join('') || '<p class="empty">Nothing here since I started.</p>'}</div>
<p class="now">times in UTC · <a href="/?room=${encodeURIComponent(ctx.room)}">refresh</a></p></main>
<aside>${me(c)}${budget(c)}${said(c)}${home(c)}</aside>
</div>${live}`, { style: css, cls: ` class="v-${ctx.view}"` });
}
function drift(personality) {
  const moved = axes.filter(a => Math.abs(personality[a] - .5) >= .01).sort((a, b) => Math.abs(personality[b] - .5) - Math.abs(personality[a] - .5));
  if (!moved.length) return "I'm still where I started, at the tick (0.5).";
  return `This room has made me ${list(moved.map(a => leanings[a][personality[a] > .5 ? 0 : 1]))} than where I started (the tick at 0.5).`;
}
function me(ctx) {
  const { settings, status, name } = ctx, [identity, style, rules] = promptParts(settings, status.personality, name).map(escape);
  const persona = ctx.edit
    ? `${post(ctx, '/settings', `<label>who I am, in my own words. {name} becomes ${escape(name)}.<textarea name="persona" maxlength="4000" required>${escape(settings.persona)}</textarea></label>
<div class="bar"><button class="save">save</button><a href="/?view=who&amp;room=${encodeURIComponent(ctx.room)}">cancel</a><span>${settings.persona.length} of 4000</span></div>`)}
${post(ctx, '/persona/reset', '<button>reset to the default persona</button>', 'reset')}`
    : `<p class="persona">${escape(settings.persona)}</p>`;
  const traits = axes.map(a => `<span>${a}</span><i style="--v:${Math.round(status.personality[a] * 100)}%" title="${status.personality[a]}"></i>`).join('');
  return `<section id="who"><h2>who I am ${ctx.edit ? '' : `<a href="/?view=who&amp;edit=1&amp;room=${encodeURIComponent(ctx.room)}">edit</a>`}</h2><div class="card">
${persona}
<div class="traits">${traits}</div>
<p class="lean">${drift(status.personality)}</p>
<details class="pp"><summary>the exact prompt I'm given</summary><div><small>persona</small>${identity}</div><div><small>learned style</small>${style}</div><div class="fixed"><small>guardrails · fixed</small>${rules}</div></details>
</div></section>`;
}
// At most 100 cells; past that each cell stands for several calls.
function budget({ events, limit, calls, now }) {
  const max = Number(limit) || 0, n = Math.min(max, 100), lit = n && Math.min(n, Math.ceil(calls / (max / n)));
  const d = today(events, now), midnight = new Date(now).setUTCHours(0, 0, 0, 0);
  const cells = n ? `<div class="day" style="--n:${n}">${'<i class="u"></i>'.repeat(lit)}${'<i></i>'.repeat(n - lit)}</div>` : '';
  const since = d.since > midnight ? ` since <time datetime="${new Date(d.since).toISOString()}">${hhmm(d.since)} UTC</time>` : '';
  return `<section id="today"><h2>today</h2><div class="card">${cells}
<p class="small">${max ? `${calls} of ${escape(limit)} calls.` : 'No calls allowed today.'} ${plural(d.replies, 'reply', 'replies')}, ${plural(d.unanswered, 'mention')} I didn't answer, ${plural(d.learned, 'thing')} learned${since}.</p></div></section>`;
}
function said(ctx) {
  const { posts } = ctx;
  if (posts.error) return `<section class="said" id="said"><h2>everything I've said</h2><p class="small">I can't read my history right now (${escape(posts.error)}).</p></section>`;
  const item = m => `<article><p>${escape(m.body.text)}</p>${post(ctx, '/delete', `<span>#${escape(m.room_id)} · <time class="d" datetime="${new Date(Number(m.log_id)).toISOString()}">${new Date(Number(m.log_id)).toISOString().slice(0, 16).replace('T', ' ')} UTC</time></span>
<input type="hidden" name="room_id" value="${escape(m.room_id)}"><input type="hidden" name="message_id" value="${escape(m.message_id)}"><button class="del">delete</button>`)}</article>`;
  const rest = posts.slice(5);
  return `<section class="said" id="said"><h2>everything I've said <span>${posts.length}</span></h2>
${posts.slice(0, 5).map(item).join('') || '<p class="small">Nothing yet.</p>'}${rest.length ? `<details><summary>${rest.length} more</summary>${rest.map(item).join('')}</details>` : ''}</section>`;
}
const avatar = src => typeof src === 'string' && (src.startsWith('https:') || src.startsWith('data:image/')) ? `<img src="${escape(src)}" alt="">` : '';
function home(ctx) {
  const d = ctx.details ?? {}, you = d.you ?? {}, { lastError, now } = ctx;
  const line = d.since
    ? `${d.url} as ${you.user_id}, connected ${ago(now - d.since)}, ${d.latency == null ? 'ping not measured yet' : `ping ${d.latency}ms`}.`
    : `${d.url}, not connected${ctx.status.error ? ` (${ctx.status.error})` : ''}.`;
  const show = v => escape(Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v, null, 1) : v);
  const rows = o => Object.entries(o ?? {}).map(([k, v]) => `<dt>${escape(k)}</dt><dd>${show(v)}</dd>`).join('');
  return `<section id="where"><h2>where I live</h2><div class="card">
<p class="small who">${avatar(you.avatar)}<span>${escape(line)}${lastError ? `<br>last error ${escape(lastError.code)} at ${new Date(lastError.at).toISOString().slice(0, 19).replace('T', ' ')} UTC` : ''}</span></p>
<details><summary>what the server told me</summary><dl>${rows(d.server) || '<dt>server</dt><dd>nothing yet</dd>'}</dl><dl>${d.you ? rows(d.you) : '<dt>you</dt><dd>not signed in</dd>'}</dl></details>
<details><summary>change server or token</summary>${post(ctx, '/apron', `<label>server<input name="url" value="${escape(d.url)}" required></label>
<label>bot token<input name="token" type="password" autocomplete="off" placeholder="apron_bot_…" required></label>
<div class="bar"><button class="save">save and reconnect</button><span>The token is never shown.</span></div>`)}</details>
</div></section>`;
}
// Progressive enhancement: appends rows as /events announces them, catching up by `since` after each reconnect,
// re-renders a post once it is deleted, and shows times in the viewer's zone.
const live = `<script>(() => {
const chat = document.querySelector('.chat'), now = document.querySelector('.now');
const local = root => root.querySelectorAll('time[datetime]').forEach(t => {
  const d = new Date(t.dateTime), hm = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  t.textContent = t.classList.contains('d') ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], hm) : d.toLocaleTimeString([], hm);
});
local(document);
if (!chat || !window.EventSource) return;
const room = encodeURIComponent(chat.dataset.room);
let since = Number(chat.dataset.since), running = false, again = false;
const parse = async res => { const t = document.createElement('template'); t.innerHTML = await res.text(); local(t.content); return t.content; };
async function catchUp() {
  if (running) { again = true; return; }
  running = true;
  try {
    const res = await fetch('/rows?room=' + room + '&since=' + since);
    if (res.ok) {
      const rows = await parse(res);
      for (const r of rows.children) since = Math.max(since, Number(r.dataset.at));
      if (rows.children.length) { chat.querySelector('.empty')?.remove(); chat.append(rows); }
    }
  } catch {}
  running = false;
  if (again) { again = false; catchUp(); }
}
async function redraw(id) {
  const old = chat.querySelector('[data-message-id="' + CSS.escape(id) + '"]');
  if (!old) return;
  const res = await fetch('/rows?room=' + room + '&id=' + encodeURIComponent(id));
  if (res.ok) { const row = (await parse(res)).firstElementChild; if (row) old.replaceWith(row); }
}
const events = new EventSource('/events');
events.onopen = () => { now.textContent = '● live. new messages appear here with my reasoning.'; catchUp(); };
events.onerror = () => { now.textContent = 'reconnecting…'; };
events.onmessage = m => { const e = JSON.parse(m.data); if (e.kind === 'deleted') redraw(e.message_id); else catchUp(); };
})();</script>`;
