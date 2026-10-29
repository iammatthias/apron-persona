import { escape, doc } from './page.js';
import * as model from './views.js';
import { secs } from './events.js';
import { axes } from './core.js';
const css = `:root{color-scheme:light dark;--fg:#1d1c1a;--muted:#7b776f;--faint:#aca79c;--bg:#f7f5f0;--paper:#fffefa;--line:#e3dfd5;--ok:#2f7a55;--warn:#a1650a;--bad:#b3261e;--me:#eef3ee}
@media(prefers-color-scheme:dark){:root{--fg:#ebe8e0;--muted:#9b978e;--faint:#635f58;--bg:#131211;--paper:#1a1917;--line:#2d2b27;--ok:#7cc79f;--warn:#e3ab57;--bad:#f08a80;--me:#1b261f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-monospace,Menlo,monospace}
a{color:inherit}em{font-style:normal}
h2{font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 8px;display:flex;justify-content:space-between;gap:8px}h2 a,h2 span{text-transform:none;letter-spacing:0}
h3{font-size:13px;margin:4px 0;font-weight:600}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.faint{color:var(--faint)}
.small{font-size:12px;color:var(--muted);margin:0;overflow-wrap:anywhere}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}
.strip{max-width:1280px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:12px 28px;font-size:12px;color:var(--muted)}
.strip .nm{color:var(--fg);font-size:14px;white-space:nowrap;margin-right:-16px}
.strip .id,.strip .kv,.calls{display:flex;align-items:center;gap:8px 14px;white-space:nowrap}.strip .id{gap:8px}.strip .kv b{color:var(--fg);font-weight:600}.strip .kv .warn b{color:var(--warn)}
.cells{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:1px;width:120px}.cells i{height:10px;background:var(--line)}.cells i.u{background:var(--fg)}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--faint)}.dot.up{background:var(--ok)}.dot.down{background:var(--bad)}
.strip form{margin-left:auto}
.switch{display:flex;align-items:center;gap:10px;font:inherit;font-size:12px;background:var(--paper);border:1.5px solid var(--fg);border-radius:999px;padding:4px 6px 4px 12px;color:var(--fg);cursor:pointer;white-space:nowrap}
.switch small{color:var(--muted)}.switch i{flex:none;width:32px;height:18px;border-radius:9px;background:var(--ok);position:relative}.switch i::after{content:"";position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#fff}
.switch.off{border-color:var(--warn)}.switch.off b{color:var(--warn)}.switch.off i{background:var(--faint)}.switch.off i::after{right:auto;left:2px}
nav.top{max-width:1280px;margin:0 auto;padding:0 20px;display:flex;gap:4px;font-size:13px;overflow-x:auto}
nav.top a{text-decoration:none;padding:6px 12px;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap}nav.top a[aria-current]{color:var(--fg);border-color:var(--fg)}nav.top em{font-size:11px;color:var(--warn)}nav.top .end{margin-left:auto}
.flash{max-width:1280px;margin:12px auto 0;padding:0 20px}.flash p{margin:0;padding:8px 12px;border-left:3px solid var(--ok);background:var(--paper);font-size:12px}.flash p.bad{border-color:var(--bad);color:var(--fg)}
.page{max-width:1280px;margin:0 auto;padding:16px 20px 24px}
.foot{max-width:1280px;margin:0 auto;padding:0 20px 32px;font-size:11px;color:var(--faint)}
.card{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0}
.needs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.needs a{display:flex;flex-wrap:wrap;gap:0 12px;align-items:baseline;text-decoration:none;padding:6px 12px;background:var(--paper);border:1px solid var(--line);border-left:3px solid var(--warn);border-radius:0 8px 8px 0;overflow-wrap:anywhere}
.needs .warn a{color:var(--warn)}.needs .bad a{color:var(--bad);border-left-color:var(--bad)}.needs .ok a{color:var(--ok);border-left-color:var(--ok)}.needs small{color:var(--muted);font-size:12px}
.now{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:28px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:18px}
.room{display:flex;flex-direction:column;gap:8px}.room .head{display:flex;flex-wrap:wrap;gap:0 12px;justify-content:space-between;align-items:baseline}.room .head a{font-weight:600;text-decoration:none}
.room .m{grid-template-columns:minmax(0,1fr);gap:0;padding:3px 0}.room .note{border:0;padding:0 0 0 54px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.room .msg p{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.room .m.self .msg>div{padding:2px 8px}.room .open{font-size:12px;color:var(--muted);margin-top:auto}
.botcard{display:flex;flex-direction:column;gap:12px}.botcard .persona{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:12px}
.persona{margin:0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.m{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:24px;padding:6px 0}
.msg{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px}.msg time,.fold time,.gap time{color:var(--faint);font-size:11px;padding-top:3px}.gap time{padding:0}
.n{color:var(--muted);font-size:12px}.msg p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.note{font-size:12px;color:var(--muted);border-left:1px solid var(--line);padding-left:12px;line-height:1.45;align-self:start;padding-top:2px;overflow-wrap:anywhere}
.note.ok{color:var(--ok);border-color:var(--ok)}.note.warn{color:var(--warn);border-color:var(--warn)}.note.bad{color:var(--bad);border-color:var(--bad)}.note form{display:inline}
.m.q{grid-template-columns:minmax(0,1fr);padding:2px 0}.m.q p{color:var(--muted);font-size:12px;padding-top:2px}
.m.self .msg>div{background:var(--me);border-radius:8px;padding:6px 12px}.m.self .n{color:var(--ok)}
.m.gone .msg>div{background:none;border:1px dashed var(--line)}.m.gone .msg p{color:var(--muted);text-decoration:line-through}
.m.ua .msg>div>p{box-shadow:inset 3px 0 0 var(--warn);padding-left:8px}
.del{font:inherit;font-size:11px;background:none;border:1px solid color-mix(in srgb,var(--bad) 45%,transparent);color:var(--bad);border-radius:4px;padding:0 6px;cursor:pointer}
.gap{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:11px;margin:8px 0}.gap::before,.gap::after{content:"";flex:1;border-top:1px dashed var(--line)}.gap.warn{color:var(--warn)}
.fold{font-size:12px;color:var(--faint);padding:2px 0}.fold summary{cursor:pointer;list-style:none;display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;align-items:baseline}.fold summary::-webkit-details-marker{display:none}.fold summary span{border-bottom:1px dotted var(--line);justify-self:start}.fold[open]{padding-left:12px;border-left:1px dotted var(--line)}
.empty{color:var(--muted);font-size:12px;padding:16px 0}
.roomv{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:32px}
.rail{position:sticky;top:96px;align-self:start;display:flex;flex-direction:column;gap:18px;max-height:calc(100vh - 110px);overflow:auto}
.jump{display:none}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}.cols>div{display:flex;flex-direction:column;gap:18px;min-width:0}
.connlog{font-size:12px;max-height:260px;overflow:auto}.connlog div{display:grid;grid-template-columns:60px minmax(0,1fr);gap:8px;padding:2px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.think{display:grid;grid-template-columns:220px minmax(0,1fr);gap:36px}
.toc{position:sticky;top:96px;align-self:start;font-size:12px;display:flex;flex-direction:column;gap:2px}
.toc a{text-decoration:none;color:var(--muted);padding:3px 0 3px 12px;border-left:1px solid var(--line)}.toc b{display:block;font-weight:400;color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:12px 0 4px}.toc b:first-child{margin-top:0}
.stage{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding-bottom:22px;position:relative;scroll-margin-top:96px}
.stage::before{content:"";position:absolute;left:13px;top:28px;bottom:0;border-left:1px dashed var(--line)}
.stage>.k{width:28px;height:28px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:12px;color:var(--muted);background:var(--bg);position:relative}
.stage>div{min-width:0}.why{font-size:12px;color:var(--muted);margin:0 0 10px}
.sent{margin-top:10px;padding:6px 8px;border-left:2px dashed var(--line);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.sent small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.rtabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;font-size:12px}.rtabs a{text-decoration:none;padding:2px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}.rtabs a[aria-current]{color:var(--fg);border-color:var(--fg)}
.traits{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 10px;font-size:12px;align-items:center}
.traits i{height:4px;background:var(--line);border-radius:2px;position:relative}.traits i::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--v);background:var(--fg);border-radius:2px}
.traits i::before{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;border-left:1px solid var(--faint)}.traits small{color:var(--muted);font-variant-numeric:tabular-nums}
textarea,input{font:inherit;font-size:13px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;width:100%;margin:4px 0 10px}
textarea{min-height:9rem;resize:vertical;line-height:1.5}.short{min-height:5rem}input[type=number]{max-width:12rem;display:block}.card>.small+.small{margin-top:6px}
label{display:block;font-size:12px;color:var(--muted)}
.tick{display:flex;align-items:center;gap:8px;color:var(--fg);font-size:13px;margin:0 0 8px;cursor:pointer}.tick input{width:auto;margin:0;accent-color:var(--fg)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.save{font:inherit;font-size:12px;color:var(--bg);background:var(--fg);border:1px solid var(--fg);border-radius:6px;padding:4px 12px;cursor:pointer}
.link{font:inherit;font-size:12px;background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer}
.sub{border-top:1px solid var(--line);margin-top:12px;padding-top:10px}
.vs{display:grid;grid-template-columns:1fr auto auto;gap:2px 16px;font-size:12px;margin:0 0 10px}.vs small{color:var(--muted)}.vs b{font-weight:600}
.week{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;font-variant-numeric:tabular-nums}.week th,.week td{padding:2px 3px;text-align:right;font-weight:400;border-bottom:1px solid var(--line)}.week th:first-child{text-align:left;color:var(--muted)}.week thead th{color:var(--faint)}.week td.z{color:var(--faint)}
dl{display:grid;grid-template-columns:140px minmax(0,1fr);gap:3px 10px;font-size:12px;margin:0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
details>summary{cursor:pointer;color:var(--muted);font-size:12px}
.who{display:flex;align-items:center;gap:8px}.who img{width:20px;height:20px;border-radius:50%}
.said article{font-size:12px;padding:6px 0;border-top:1px solid var(--line)}.said p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.said form{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--muted);margin-top:2px}
@media(max-width:899px){
 header{position:static}
 .strip{flex-wrap:wrap;gap:6px 14px;padding:10px 16px}.strip .nm{flex:1;margin:0}.strip form{order:1;margin:0}.switch small{display:none}.strip .id{order:2}.strip .calls{order:3}.strip .kv{order:4;flex:1 0 100%}.cells{width:80px}.strip .kv .faint{display:none}
 nav.top{padding:0 8px;flex-wrap:wrap}nav.top a{padding:6px 8px}
 .flash,.foot{padding-left:16px;padding-right:16px}.page{padding:12px 16px 24px}
 .now,.roomv,.cols,.think,.pair{grid-template-columns:minmax(0,1fr)}.cards{grid-template-columns:minmax(0,1fr)}
 .rail,.toc{position:static;max-height:none}.toc{display:none}.jump{display:block;margin:0 0 8px}
 .m{grid-template-columns:minmax(0,1fr);gap:2px}.note,.room .note{margin-left:54px;border:0;padding-left:0}.note::before{content:"↳ "}
}`;
const time = at => `<time datetime="${new Date(at).toISOString()}">${new Date(at).toISOString().slice(11, 16)}</time>`;
const stamp = at => new Date(at).toISOString().slice(0, 19).replace('T', ' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = ms => ms < 60000 ? `${Math.round(ms / 1000)}s` : ms < 3600000 ? `${Math.round(ms / 60000)}m` : ms < 172800000 ? `${Math.round(ms / 3600000)}h` : `${Math.round(ms / 86400000)}d`;
const p2 = x => Number(x).toFixed(2);
const back = place => escape(model.href(place));
// Every form carries the view and room it came from, so the action can redirect back to them.
const post = (place, action, inner, cls = '') =>
  `<form method="post" action="${action}"${cls ? ` class="${cls}"` : ''}><input type="hidden" name="view" value="${place.view}"><input type="hidden" name="room" value="${escape(place.room)}">${inner}</form>`;
const remove = (place, room, id) => post(place, '/delete', `<input type="hidden" name="room_id" value="${escape(room)}"><input type="hidden" name="message_id" value="${escape(id)}"><button class="del">delete</button>`);
// One transcript row: a message with text, a quiet line for one without, the bot's own post, a fold of quiet lines, or
// a break. A quiet line or a fold carries data-from, its first row's time, so the live script can fold new ones into it.
export function row(r, place) {
  const at = ` data-at="${r.at}"`;
  if (r.kind === 'break') return `<div class="gap${r.tone ? ` ${r.tone}` : ''}"${at}><span>${time(r.at)} ${escape(r.text)}</span></div>`;
  if (r.kind === 'fold') return `<details class="fold"${at} data-from="${r.from}"><summary>${time(r.from)}<span>${plural(r.rows.length, 'message')} read, ${r.learned} learned from</span></summary>${r.rows.map(x => row(x, place)).join('')}</details>`;
  if (r.kind === 'message' && r.text === undefined) return `<div class="m q"${at}${r.quiet ? ` data-from="${r.at}"` : ''}><div class="msg">${time(r.at)}<p><span class="n">${escape(r.who)}</span> · ${escape(r.margin)}</p></div></div>`;
  const note = r.kind === 'post'
    ? `<div class="note">${escape(r.margin)}${r.deleted ? '' : ` ${remove(place, r.room, r.message_id)}`}</div>`
    : `<div class="note${r.tone ? ` ${r.tone}` : ''}"${r.title ? ` title="${escape(r.title)}"` : ''}>${escape(r.margin)}</div>`;
  const cls = r.kind === 'post' ? ` self${r.deleted ? ' gone' : ''}` : r.unanswered ? ' ua' : '';
  return `<div class="m${cls}"${at}${r.kind === 'post' ? ` data-message-id="${escape(r.message_id)}"` : ''}><div class="msg">${time(r.at)}<div><div class="n">${r.kind === 'post' ? 'me' : escape(r.who)}</div><p>${escape(r.text)}</p></div></div>${note}</div>`;
}
const rows = (list, place) => list.map(r => row(r, place)).join('');
const toggle = (place, paused) => post(place, '/settings', `<input type="hidden" name="paused" value="${paused ? 'off' : 'on'}"><button class="switch ${paused ? 'off' : 'on'}"><span><b>${paused ? 'Paused' : 'Listening'}</b> <small>${paused ? 'tap to resume' : 'tap to stop'}</small></span><i></i></button>`);
const states = { paused: () => 'paused', up: l => `up ${ago(l.up)}`, down: l => `down (${l.error})`, connecting: () => 'connecting' };
const extra = r => `${r.hedges ? `, ${plural(r.hedges, 'hedge')}` : ''}${r.retries ? `, ${plural(r.retries, 'retry', 'retries')}` : ''}`;
const spend = r => `${r.calls} ${r.label}${extra(r)}`;
const ledger = c => [...c.by.map(spend), ...c.unsorted ? [`${c.unsorted} from before calls were sorted`] : []].join(' · ');
// At most 100 cells; past that each cell stands for several calls.
function cells({ total, limit }) {
  const n = Math.min(limit, 100), lit = Math.min(n, Math.ceil(total / (limit / n)));
  return n ? `<span class="cells" style="--n:${n}">${'<i class="u"></i>'.repeat(lit)}${'<i></i>'.repeat(n - lit)}</span>` : '';
}
function strip(m, place) {
  const { link: l, calls: c, today: d } = m;
  const speed = d.speed ? ` title="median ${secs(d.speed.median)}, p90 ${secs(d.speed.p90)}"` : '';
  return `<div class="strip" id="strip" data-live><b class="nm">${escape(m.name)}</b>
<span class="id"><i class="dot ${l.state}"></i><span>${escape(states[l.state](l))}${l.drops ? ` · <em class="warn">${l.drops} drops/h</em>` : ''}</span></span>
<span class="calls" title="${escape(ledger(c))}">${c.limit ? cells(c) : ''}<span>${c.limit === null ? `${c.total} calls today` : c.limit ? `${c.total}/${c.limit} calls` : 'no calls today'}</span></span>
<span class="kv"><span${speed}><b>${d.replies}</b> replies</span><span${d.unanswered ? ' class="warn"' : ''}><b>${d.unanswered}</b> unanswered</span><span><b>${d.learned}</b> learned</span><span class="faint">of ${d.read} read today</span></span>
${toggle(place, m.paused)}</div>`;
}
const nav = tabs => `<nav class="top" id="nav" data-live>${tabs.map(t => `<a href="${escape(t.href)}"${t.end ? ' class="end"' : ''}${t.current ? ' aria-current="page"' : ''}>${escape(t.label)}${t.badge ? ` <em>${t.badge} unanswered</em>` : ''}</a>`).join('')}</nav>`;
const bars = p => `<div class="traits">${axes.map(a => `<span>${a}</span><i style="--v:${Math.round(p[a] * 100)}%"></i><small>${p2(p[a])}</small>`).join('')}</div>`;
function needs(items) {
  const why = x => x.misses ? x.misses.map(m => `${escape(m.who)} ${time(m.at)}, ${escape(m.why)}`).join(' · ') : `${x.at ? `last at ${time(x.at)}. ` : ''}${escape(x.why)}`;
  const list = items.map(x => [x, why(x)]).map(([x, w]) => `<li class="${x.tone}"><a href="${escape(x.href)}">${escape(x.text)}${w ? ` <small>${w}</small>` : ''}</a></li>`).join('');
  return `<section id="needs" data-live><h2>needs you <span>${items.length}</span></h2>${list ? `<ul class="needs">${list}</ul>` : '<p class="small">nothing needs you.</p>'}</section>`;
}
function now(m, place) {
  const cards = m.cards.map(c => `<section class="card room"><div class="head"><a href="${back({ view: 'room', room: c.id })}">#${escape(c.id)}</a><span class="small">${c.read} read today${c.last === null ? '' : ` · last ${ago(c.last)} ago`}</span></div>
<p class="small">${c.notes ? escape(c.notes) : 'nothing to note yet.'}</p><div>${rows(c.rows, place) || '<p class="empty">nothing here since I started.</p>'}</div><a class="open" href="${back({ view: 'room', room: c.id })}">open #${escape(c.id)}, its notes and norms</a></section>`).join('');
  return `<div class="now"><div>${needs(m.needs)}${cards ? `<div class="cards" id="cards" data-live>${cards}</div>` : ''}</div>
<aside><h2>the bot <a href="/?view=bot">tune</a></h2><div class="card botcard"><p class="persona">${escape(m.bot.persona)}</p>${bars(m.bot.personality)}<p class="small">${escape(m.bot.drift)}</p><p class="small">${escape(m.bot.triggers)}</p></div></aside></div>`;
}
function week({ days, rows: topics }) {
  if (!topics.length) return '<p class="small">no messages counted in the last 7 days.</p>';
  const head = days.map(d => `<th title="${d}">${+d.slice(8)}</th>`).join('');
  const body = topics.map(([t, n]) => `<tr><th>${escape(t)}</th>${n.map(x => x ? `<td>${x}</td>` : '<td class="z">·</td>').join('')}</tr>`).join('');
  return `<details><summary>last 7 days by topic</summary><table class="week"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></details>`;
}
const norms = (place, id, text) => post(place, '/norms', `<input type="hidden" name="room_id" value="${escape(id)}"><label>norms for #${escape(id)}, which I'll honour<textarea class="short" name="norms" maxlength="1000">${escape(text)}</textarea></label>
<div class="bar"><button class="save">save</button><span>${text.length} of 1000</span></div>`);
function room(m, place, events) {
  const said = m.posts.error ? `<p class="small">I can't read my history right now (${escape(m.posts.error)}).</p>`
    : m.posts.list.length ? `<details><summary>show all, with delete</summary>${m.posts.list.map(p => `<article><p>${escape(p.text)}</p>${post(place, '/delete', `<span>${stamp(p.at).slice(0, 16)} UTC</span><input type="hidden" name="room_id" value="${escape(m.id)}"><input type="hidden" name="message_id" value="${escape(p.message_id)}"><button class="del">delete</button>`)}</article>`).join('')}</details>` : '<p class="small">nothing yet.</p>';
  return `<div class="roomv"><div><h2>#${escape(m.id)} through my eyes</h2><p class="jump small"><a href="#rail">what I believe about #${escape(m.id)}, its norms, my posts here</a></p>
<div class="chat" data-room="${escape(m.id)}" data-since="${events.at(-1)?.at ?? 0}">${rows(m.rows, place) || '<p class="empty">nothing here since I started.</p>'}</div></div>
<aside class="rail" id="rail"><section><h2>what I believe about #${escape(m.id)}</h2><div class="card"><p class="small">${m.notes ? escape(m.notes) : 'nothing to note yet.'}</p><p class="small faint">rebuilt daily from the counts below. this goes into my prompt here.</p>${week(m.week)}</div></section>
<section><h2>norms for #${escape(m.id)}</h2><div class="card">${norms(place, m.id, m.norms)}</div></section>
<section class="said"><h2>what I've said here <span>${m.posts.list.length}</span></h2>${said}</section></aside></div>`;
}
const sent = (text, label = 'sent') => `<div class="sent"><small>${escape(label)}</small>${escape(text)}</div>`;
// An unchecked box sends nothing, so a hidden "off" follows each one; the route reads the first value.
const check = (s, k, label) => `<label class="tick"><input type="checkbox" name="${k}" value="on"${s[k] ? ' checked' : ''}><input type="hidden" name="${k}" value="off">${label}</label>`;
const bar = (s, k, label) => `<label>${label}<input type="number" name="${k}" min="0.5" max="0.99" step="0.05" value="${p2(s[k])}" required></label>`;
const vs = (now, after) => `<div class="vs"><span></span><small>now</small><small>after</small>${axes.map(a => `<span>${a}</span><span>${p2(now[a])}</span><b>${p2(after[a])}</b>`).join('')}</div>`;
// The history job by stage, or the folded form that starts one. The live script swaps #lesson on each stage.
const lessons = {
  none: (l, place, d) => `<details><summary>redraft from history</summary>${post(place, '/learn', `<label>server<input name="url" value="${escape(d.url)}" required></label>
<label>token, blank to read as a guest<input name="token" type="password" autocomplete="off"></label>
<div class="pair"><label>rooms<input name="rooms" value="${escape(d.rooms.join(', '))}" required></label><label>messages<input type="number" name="cap" min="1" max="1000" step="1" value="500" required></label></div>
<div class="bar"><button class="save">read and draft</button><span>History stays in memory.</span></div>`)}</details>`,
  reading: (l, place) => `<p class="small">reading history in ${escape(l.where)}… <a href="${back(place)}#persona">refresh</a></p>`,
  thinking: (l, place) => `<p class="small">thinking about ${plural(l.count, 'message')} from ${escape(l.where)}… <a href="${back(place)}#persona">refresh</a></p>`,
  failed: (l, place, d) => `<p class="small bad">I couldn't redraft from history in ${escape(l.where)} (${escape(l.detail)}).</p>${post(place, '/learn/discard', '<button class="link">dismiss</button>')}${lessons.none(l, place, d)}`,
  ready: (l, place) => `<h3>redraft from history <span class="ok">· ready</span></h3><p class="small">${plural(l.count, 'message')} from ${escape(l.where)}${l.failed ? `. ${l.failed} of my readings failed (${escape(l.detail)}), so this leans on the rest` : ''}.</p>
${post(place, '/learn/apply', `<label>who I'd be. edit before applying.<textarea name="persona" maxlength="4000" required>${escape(l.persona)}</textarea></label>${vs(l.now, l.after)}
<div class="bar"><button class="save">apply</button><span>a head start worth 10 messages</span></div>`)}${post(place, '/learn/discard', '<button class="link">discard</button>')}`,
};
const thinking = {
  answer: (x, place) => `<div class="card">${post(place, '/settings', `${check(x.settings, 'reply_mentions', 'answer when mentioned')}${check(x.settings, 'reply_replies', 'answer replies to my messages')}${bar(x.settings, 'reply_threshold', 'reply bar')}
<div class="bar"><button class="save">save</button><span>today: ${x.today.answered} answered, ${x.today.not} not</span></div>`)}</div>`,
  chime: (x, place) => `<div class="card">${post(place, '/settings', `${check(x.settings, 'organic', 'chime in unprompted')}${bar(x.settings, 'organic_threshold', 'chime-in bar')}
<div class="bar"><button class="save">save</button><span>today: ${plural(x.today.chimed, 'chime-in')}, ${x.today.held} held back</span></div>`)}</div>`,
  persona: (x, place, d) => `<div class="card">${post(place, '/settings', `<label>who I am, in my own words<textarea name="persona" maxlength="4000" required>${escape(x.persona)}</textarea></label>
<div class="bar"><button class="save">save</button><span>${x.persona.length} of 4000</span></div>`)}${post(place, '/persona/reset', '<button class="link">reset to the default persona</button>')}
<details><summary>exactly as sent</summary>${sent(x.sent)}</details>
<div class="sub" id="lesson">${lessons[x.lesson?.stage ?? 'none'](x.lesson, place, d)}</div></div>`,
  traits: x => `<div class="card">${bars(x.personality)}<p class="small" style="margin-top:8px">${escape(x.drift)}</p>${sent(x.sent)}</div>`,
  room: (x, place, d) => `<div class="card"><div class="rtabs">${d.rooms.map(r => `<a href="${back({ view: 'bot', room: r })}#room"${r === d.room ? ' aria-current="page"' : ''}>#${escape(r)}</a>`).join('')}</div>
${sent(x.sent || 'nothing yet, so this part is left out.', `sent in #${d.room}`)}${week(x.week)}<div class="sub">${norms(place, d.room, x.norms)}</div></div>`,
  rules: x => `<div class="card">${sent(x.sent)}</div>`,
  lines: x => `<div class="card">${sent(x.sent, 'sent when I answer')}${sent(x.chime, 'sent when I chime in')}</div>`,
};
function bot(m, place, d) {
  const toc = m.sections.map((x, i) => `${i === 0 || x.part !== m.sections[i - 1].part ? `<b>${x.part === 'gate' ? 'the gate' : 'the prompt, in order'}</b>` : ''}<a href="#${x.id}">${i + 1} ${escape(x.title)}</a>`).join('');
  const ctx = { ...d, rooms: m.rooms, room: m.room };
  return `<div class="think"><nav class="toc">${toc}</nav><div>${m.sections.map((x, i) => `<section class="stage" id="${x.id}"><span class="k">${i + 1}</span><div><h3>${escape(x.title)}</h3><p class="why">${escape(x.why)}</p>${thinking[x.id](x, place, ctx)}</div></section>`).join('')}</div></div>`;
}
const avatar = src => typeof src === 'string' && (src.startsWith('https:') || src.startsWith('data:image/')) ? `<img src="${escape(src)}" alt="">` : '';
const show = v => escape(Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v, null, 1) : v);
const pairs = o => Object.entries(o ?? {}).map(([k, v]) => `<dt>${escape(k)}</dt><dd>${show(v)}</dd>`).join('');
function plumbing(m, place) {
  const l = m.link, c = m.calls;
  const log = m.log.map(e => `<div>${time(e.at)}<span${e.tone ? ` class="${e.tone}"` : ''}>${escape(e.text)}</span></div>`).join('');
  const by = c.by.map(r => `<dt>${escape(r.label)}</dt><dd>${r.calls}${extra(r)}</dd>`).join('');
  return `<div class="cols"><div>
<section><h2>the link</h2><div class="card"><dl><dt>server</dt><dd>${escape(l.url)}</dd><dt>signed in as</dt><dd class="who">${l.user === null ? 'not signed in' : `${avatar(l.avatar)}${escape(l.user)}`}</dd>
<dt>state</dt><dd>${escape(states[l.state](l))}${l.latency === null ? '' : `, ping ${l.latency}ms`}</dd><dt>last hour</dt><dd${l.drops ? ' class="warn"' : ''}>${plural(l.drops, 'drop')}${l.reason ? ` (${escape(l.reason)})` : ''}</dd>
<dt>last error</dt><dd>${l.lastError ? `${escape(l.lastError.code)} at ${stamp(l.lastError.at)} UTC` : 'none'}</dd></dl></div></section>
<section><h2>connection log <span>${m.log.length}</span></h2><div class="card connlog">${log || '<p class="small">nothing since I started.</p>'}</div></section>
<section><h2>what the server told me</h2><div class="card"><details><summary>greeting and sign-in</summary><dl>${pairs(m.server) || '<dt>server</dt><dd>nothing yet</dd>'}</dl><dl>${m.you ? pairs(m.you) : '<dt>you</dt><dd>not signed in</dd>'}</dl></details></div></section>
</div><div>
<section><h2>calls today <span>${c.limit === null ? c.total : `${c.total} of ${c.limit}`}</span></h2><div class="card"><dl>${by}${c.unsorted ? `<dt>before sorting</dt><dd>${c.unsorted}</dd>` : ''}</dl>
<p class="small" style="margin-top:8px">counted since 00:00 UTC, across restarts. ${m.speed ? `replies took a median ${secs(m.speed.median)}, p90 ${secs(m.speed.p90)}, over ${plural(m.speed.n, 'reply', 'replies')}.` : 'no replies yet today.'}</p></div></section>
<section><h2>ignored elsewhere <span>${m.elsewhere.length}</span></h2><div class="card">${m.elsewhere.map(r => `<p class="small">${time(r.at)} ${escape(r.who)}${r.room ? ` in #${escape(r.room)}` : ''}: ${escape(r.margin)}</p>`).join('') || '<p class="small">nothing.</p>'}</div></section>
<section><h2>change server or token</h2><div class="card">${post(place, '/apron', `<label>server<input name="url" value="${escape(l.url)}" required></label>
<label>bot token<input name="token" type="password" autocomplete="off" placeholder="apron_bot_…" required></label>
<div class="bar"><button class="save">save and reconnect</button><span>The token is never shown.</span></div>`)}</div></section>
</div></div>`;
}
// Each view: its model from the snapshot and place, and its markup. posts marks the one view that reads Apron history.
export const views = {
  now: { render: (s, place) => now(model.now(s), place) },
  room: { posts: true, render: (s, place) => room(model.room(s, place.room), place, s.events) },
  bot: { render: (s, place) => bot(model.bot(s, place.room), place, { url: s.details?.url ?? '', rooms: s.rooms }) },
  plumbing: { render: (s, place) => plumbing(model.plumbing(s), place) },
};
export const viewOf = view => Object.hasOwn(views, view) ? view : 'now';
export const roomOf = (rooms, room) => rooms.includes(room) ? room : rooms[0];
// The private dashboard for one snapshot (see views.js) at place, { view, room }, with the last action's flash.
export function dashboard(s, place, flash = null) {
  const note = flash ? `<div class="flash"><p${flash.error ? ' class="bad"' : ''}>${escape(flash.error ?? flash.ok)}</p></div>` : '';
  return doc(s.name, `<header>${strip(model.strip(s), place)}${nav(model.tabs(s, place))}</header>${note}
<main class="page">${views[place.view].render(s, place)}</main>
<p class="foot"><span id="live">times in UTC</span> · <a href="${back(place)}">refresh</a></p>${live}`, { style: css });
}
// Progressive enhancement: shows times in the viewer's zone; on a room page appends rows as /events announces them,
// catching up by `since` after each reconnect and folding new quiet rows into a trailing fold; re-renders a post once
// it is deleted; swaps #lesson when the history job moves; and refreshes the [data-live] regions, which hold no input.
const live = `<script>(() => {
const chat = document.querySelector('.chat'), status = document.querySelector('#live');
const local = root => root.querySelectorAll('time[datetime]').forEach(t => {
  t.textContent = new Date(t.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
});
local(document);
if (!window.EventSource) return;
const parse = async res => { const t = document.createElement('template'); t.innerHTML = await res.text(); local(t.content); return t.content; };
const swap = async selector => {
  const res = await fetch(location.href);
  if (!res.ok) return;
  const fresh = await parse(res);
  for (const el of document.querySelectorAll(selector)) { const next = fresh.getElementById(el.id); if (next) el.replaceWith(next); }
};
const room = chat && encodeURIComponent(chat.dataset.room);
let since = chat ? Number(chat.dataset.since) : 0, running = false, again = false, timer;
async function catchUp() {
  if (!chat) return;
  if (running) { again = true; return; }
  running = true;
  try {
    const tail = chat.lastElementChild, quiet = tail?.dataset.from !== undefined;
    const res = await fetch('/rows?room=' + room + '&since=' + (quiet ? Number(tail.dataset.from) - 1 : since));
    if (res.ok) {
      const rows = await parse(res);
      for (const r of rows.children) since = Math.max(since, Number(r.dataset.at));
      if (rows.children.length) {
        if (quiet) { if (tail.open && rows.firstElementChild.matches('details')) rows.firstElementChild.open = true; tail.remove(); }
        chat.querySelector('.empty')?.remove(); chat.append(rows);
      }
    }
  } catch {}
  running = false;
  if (again) { again = false; catchUp(); }
}
async function redraw(id) {
  const old = chat?.querySelector('[data-message-id="' + CSS.escape(id) + '"]');
  if (!old) return;
  const res = await fetch('/rows?room=' + room + '&id=' + encodeURIComponent(id));
  if (res.ok) { const row = (await parse(res)).firstElementChild; if (row) old.replaceWith(row); }
}
const events = new EventSource('/events');
events.onopen = () => { status.textContent = '● live · local times'; catchUp(); };
events.onerror = () => { status.textContent = 'reconnecting…'; };
events.onmessage = m => {
  const e = JSON.parse(m.data);
  if (e.kind === 'deleted') redraw(e.message_id); else if (e.kind === 'learning') swap('#lesson'); else catchUp();
  clearTimeout(timer); timer = setTimeout(() => swap('[data-live]'), 1000);
};
})();</script>`;
