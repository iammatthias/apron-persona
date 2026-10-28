const escape = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
// `posts` is set only on the private moderation listener.
export function page(name, status, posts) {
  const traits = Object.entries(status.personality).map(([trait, v]) =>
    `<li><span>${trait}</span><meter min="0" max="1" value="${v}"></meter><b>${Math.round(v * 100)}</b></li>`).join('');
  const state = status.connected ? 'online' : escape(status.error ?? 'connecting');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>${escape(name)}</title>
<style>
:root{color-scheme:light dark;--fg:#1a1a1a;--muted:#777;--bg:#fafaf7;--accent:#3a7d5c}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e3;--muted:#999;--bg:#151515;--accent:#6fbf94}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 ui-monospace,Menlo,monospace;max-width:28rem;margin:4rem auto;padding:0 16px}
h1{font-size:1.25rem;margin:0}p{color:var(--muted);margin:.25rem 0 2rem}
.dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:${status.connected ? 'var(--accent)' : 'var(--muted)'};margin-right:.4em}
ul{list-style:none;padding:0}li{display:grid;grid-template-columns:9rem 1fr 2.5rem;gap:.75rem;align-items:center;margin:.5rem 0}
meter{width:100%}b{text-align:right;font-weight:normal;color:var(--muted)}
h2{font-size:1rem;margin:2.5rem 0 .5rem}article{border-top:1px solid color-mix(in srgb,var(--fg) 15%,transparent);padding:.75rem 0}
article p{color:var(--fg);margin:0 0 .5rem;white-space:pre-wrap;overflow-wrap:anywhere}form{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:.85rem}
button{font:inherit;color:#b3261e;background:none;border:1px solid currentColor;border-radius:4px;padding:.15rem .6rem;cursor:pointer}
</style></head><body>
<h1>${escape(name)}</h1>
<p><span class="dot"></span>${state} · ${status.budget.calls} calls today</p>
<ul>${traits}</ul>
<p>Learns the room's style. Mention it in Apron to chat.</p>
${posts ? feed(posts) : ''}
</body></html>`;
}
function feed(posts) {
  if (posts.error) return `<h2>Moderation</h2><p>${escape(posts.error)}</p>`;
  const items = posts.map(m => `<article><p>${escape(m.body.text)}</p>
<form method="post" action="/delete"><span>#${escape(m.room_id)} · ${new Date(Number(m.log_id)).toISOString().slice(0, 16).replace('T', ' ')}</span>
<input type="hidden" name="room_id" value="${escape(m.room_id)}"><input type="hidden" name="message_id" value="${escape(m.message_id)}"><button>Delete</button></form></article>`).join('');
  return `<h2>Moderation · ${posts.length} posts</h2>${items || '<p>Nothing posted yet.</p>'}`;
}
