import { promptParts } from './settings.js';
const escape = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const css = `:root{color-scheme:light dark;--fg:#1a1a1a;--muted:#777;--bg:#fafaf7;--accent:#3a7d5c;--bad:#b3261e;--line:color-mix(in srgb,var(--fg) 14%,transparent);--card:color-mix(in srgb,var(--fg) 3%,var(--bg))}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e3;--muted:#999;--bg:#151515;--accent:#6fbf94;--bad:#f2867d}}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:16px/1.5 ui-monospace,Menlo,monospace;max-width:28rem;margin:4rem auto;padding:0 16px}
h1{font-size:1.25rem;margin:0}p{color:var(--muted);margin:.25rem 0 2rem}
.dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--muted);margin-right:.5em}.dot.on{background:var(--accent)}.dot.bad{background:var(--bad)}
ul{list-style:none;padding:0;margin:0}li{display:grid;grid-template-columns:9rem 1fr 2.5rem;gap:.75rem;align-items:center;margin:.5rem 0}
meter{width:100%}b{text-align:right;font-weight:normal;color:var(--muted)}
button{font:inherit;color:var(--bad);background:none;border:1px solid currentColor;border-radius:4px;padding:.2rem .7rem;cursor:pointer}
.primary{color:var(--bg);background:var(--accent);border-color:var(--accent);padding:.45rem 1.1rem}
input,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid color-mix(in srgb,var(--fg) 25%,transparent);border-radius:4px;padding:.4rem .6rem;width:100%;margin:.35rem 0 1rem}
body.admin{max-width:none;margin:0;padding:0}
.shell{max-width:72rem;margin:0 auto;padding:2.5rem 16px;display:grid;grid-template-columns:13rem minmax(0,1fr);gap:2.5rem;align-items:start}
aside{position:sticky;top:2.5rem}aside p{margin:.35rem 0 1.5rem;font-size:.85rem}
nav{display:flex;flex-direction:column;gap:.15rem}
nav a{color:var(--muted);text-decoration:none;padding:.4rem .75rem;border-left:2px solid transparent;border-radius:0 4px 4px 0}
nav a:hover{color:var(--fg)}nav a[aria-current]{color:var(--fg);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
main{min-width:0}main>h2{font-size:1.1rem;margin:0 0 1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem;align-items:start}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem;align-items:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1.25rem;min-width:0}
.card h3{font-size:.75rem;font-weight:normal;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 1rem}
.card p{margin:0 0 1rem}.card li{grid-template-columns:8.5rem 1fr 2.5rem}
.big{font-size:1.25rem;color:var(--fg);margin:0 0 .25rem}
.note{font-size:.8rem;color:var(--muted)}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;font-size:.85rem;color:var(--muted)}
label{display:block;font-size:.85rem;color:var(--muted)}
textarea{min-height:22rem;resize:vertical;font-size:.875rem;line-height:1.55;color:var(--fg)}
dl{display:grid;grid-template-columns:7.5rem minmax(0,1fr);gap:.35rem .75rem;margin:0;font-size:.8rem}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.flash{color:var(--fg);border-left:3px solid var(--accent);padding:.5rem .75rem;margin:0 0 1.25rem;background:var(--card)}.flash.bad{border-color:var(--bad)}
.prompt p{color:var(--fg);font-size:.8rem;margin:0 0 .75rem;padding:.5rem .75rem;border-left:3px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.prompt p.fixed{border-left-style:dashed;background:color-mix(in srgb,var(--fg) 5%,transparent)}
.prompt small{display:block;color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem}
.posts{display:grid;gap:.75rem}.posts .card p{color:var(--fg);white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 .75rem}
.narrow{max-width:34rem}form{margin:0}hr{border:0;border-top:1px solid var(--line);margin:1.25rem 0}
@media(max-width:899px){
.shell{grid-template-columns:minmax(0,1fr);gap:1.25rem;padding:1rem 16px}
aside{position:static;border-bottom:1px solid var(--line)}aside p{margin-bottom:.5rem}
nav{flex-direction:row;flex-wrap:wrap;gap:0 1rem}
nav a{padding:.5rem 0;border-left:0;border-bottom:2px solid transparent;border-radius:0;margin-bottom:-1px}
nav a[aria-current]{background:none}
.split{grid-template-columns:minmax(0,1fr)}textarea{min-height:16rem}}`;
const doc = (title, body, head = '', cls = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}<title>${escape(title)}</title><style>${css}</style></head><body${cls}>
${body}
</body></html>`;
const state = status => status.paused ? 'paused' : status.connected ? 'online' : escape(status.error ?? 'connecting');
const dot = status => `<span class="dot${status.paused ? '' : status.connected ? ' on' : status.error ? ' bad' : ''}"></span>`;
const meters = personality => `<ul>${Object.entries(personality).map(([trait, v]) =>
  `<li><span>${escape(trait)}</span><meter min="0" max="1" value="${v}"></meter><b>${Math.round(v * 100)}</b></li>`).join('')}</ul>`;
// The public status page: no admin data.
export function page(name, status) {
  return doc(name, `<h1>${escape(name)}</h1>
<p>${dot(status)}${state(status)}${status.server ? ` · ${escape(status.server.host)} · ${escape(status.server.user_id)}${status.server.agent ? ` · ${escape(status.server.agent)}` : ''}` : ''} · ${status.budget.calls} calls today</p>
${meters(status.personality)}
<p>Learns the room's style. Mention it in Apron to chat.</p>`, '<meta http-equiv="refresh" content="60">');
}
// Every form names its tab, so the action can redirect back to it.
const post = (tab, action, inner) =>
  `<form method="post" action="${action}"><input type="hidden" name="tab" value="${tab}">${inner}</form>`;
const card = (title, body, cls = '') => `<section class="card${cls}"><h3>${title}</h3>${body}</section>`;
export const tabs = [
  { id: 'overview', title: 'Overview', render: overview },
  { id: 'persona', title: 'Persona', render: persona },
  { id: 'moderation', title: 'Moderation', render: ({ posts }) => feed(posts) },
  { id: 'connection', title: 'Connection', render: ({ url }) => connection(url) },
];
// The private admin portal; ctx is { tab, name, status, settings, limit, details, url, posts, flash }.
export function portal(ctx) {
  const tab = tabs.find(t => t.id === ctx.tab) ?? tabs[0];
  const nav = tabs.map(t => `<a href="/?tab=${t.id}"${t === tab ? ' aria-current="page"' : ''}>${t.title}</a>`).join('');
  return doc(`${ctx.name} · ${tab.title}`, `<div class="shell">
<aside><h1>${escape(ctx.name)}</h1><p>${dot(ctx.status)}${state(ctx.status)}</p><nav>${nav}</nav></aside>
<main>${flash(ctx.flash)}${tab.render(ctx)}</main>
</div>`, '', ' class="admin"');
}
function overview({ status, limit, details }) {
  const toggle = post('overview', '/settings', `<input type="hidden" name="paused" value="${status.paused ? 'off' : 'on'}"><button class="primary">${status.paused ? 'Resume' : 'Pause'}</button>`);
  return `<h2>Overview</h2><div class="grid">
${card('Status', `<p class="big">${dot(status)}${state(status)}</p>
<p class="note">${status.server ? `${escape(status.server.host)} · ${escape(status.server.user_id)}` : 'not signed in'}<br>${status.budget.calls} of ${escape(limit)} calls today</p>
<div class="bar">${toggle}<span>${status.paused ? 'Not reading or replying.' : 'Reading the room; replies when mentioned.'}</span></div>`)}
${card('Learned traits', meters(status.personality))}
${server(details)}
</div>`;
}
function persona({ name, status, settings }) {
  const [identity, style, rules] = promptParts(settings, status.personality, name).map(escape);
  return `<h2>Persona</h2><div class="split">
${card('Editor', `<p class="note">Who the bot is. {name} becomes its server name, now ${escape(name)}.</p>
${post('persona', '/settings', `<label>Persona<textarea name="persona" maxlength="4000" required>${escape(settings.persona)}</textarea></label>
<div class="bar"><button class="primary">Save</button><span>${settings.persona.length} of 4000 characters saved</span></div>`)}
<hr>${post('persona', '/persona/reset', '<div class="bar"><button>Reset to default</button><span>Restores the original persona.</span></div>')}`)}
${card('What the model gets', `<p class="note">The full system message, sent before the recent conversation.</p>
<div class="prompt"><p><small>persona</small>${identity}</p><p><small>learned style · updates as it learns</small>${style}</p><p class="fixed"><small>guardrails · fixed, not editable</small>${rules}</p></div>`)}
</div>`;
}
function feed(posts) {
  if (posts.error) return `<h2>Moderation</h2>${card('Unavailable', `<p>${escape(posts.error)}</p>`)}`;
  const items = posts.map(m => `<article class="card"><p>${escape(m.body.text)}</p>
${post('moderation', '/delete', `<div class="bar"><span>#${escape(m.room_id)} · ${new Date(Number(m.log_id)).toISOString().slice(0, 16).replace('T', ' ')}</span>
<input type="hidden" name="room_id" value="${escape(m.room_id)}"><input type="hidden" name="message_id" value="${escape(m.message_id)}"><button>Delete</button></div>`)}</article>`).join('');
  return `<h2>Moderation · ${posts.length} posts</h2><div class="posts">${items || card('Feed', '<p>Nothing posted yet.</p>')}</div>`;
}
function connection(url) {
  return `<h2>Connection</h2>${card('Apron server', post('connection', '/apron', `<label>Server<input name="url" value="${escape(url)}" required></label>
<label>Bot token<input name="token" type="password" autocomplete="off" placeholder="apron_bot_…" required></label>
<div class="bar"><button class="primary">Save and reconnect</button><span>The token is never shown.</span></div>`), ' narrow')}`;
}
function flash(f) {
  if (!f) return '';
  return f.error ? `<p class="flash bad">${escape(f.error)}</p>` : `<p class="flash">${escape(f.ok)}</p>`;
}
// Every field of the server greeting and the bot's user object, as returned.
function server(d = {}) {
  const show = v => escape(Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v, null, 1) : v);
  const rows = (o, prefix = '') => Object.entries(o ?? {}).map(([k, v]) => `<dt>${escape(prefix + k)}</dt><dd>${show(v)}</dd>`).join('');
  const since = d.since ? new Date(d.since).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'not connected';
  return `${card('Server', `<dl><dt>url</dt><dd>${escape(d.url)}</dd><dt>connected</dt><dd>${since}</dd>${rows(d.server)}</dl>`)}
${card('Signed in as', `<p class="note">The server sets the name and avatar; the owner changes the name with /invite-bot.</p><dl>${d.you ? rows(d.you) : '<dt>—</dt><dd>not signed in</dd>'}</dl>`)}`;
}
