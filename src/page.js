export const escape = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const css = `:root{color-scheme:light dark;--fg:#1a1a1a;--muted:#777;--bg:#fafaf7;--accent:#3a7d5c;--bad:#b3261e;--line:color-mix(in srgb,var(--fg) 14%,transparent);--card:color-mix(in srgb,var(--fg) 3%,var(--bg))}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e3;--muted:#999;--bg:#151515;--accent:#6fbf94;--bad:#f2867d}}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:16px/1.5 ui-monospace,Menlo,monospace;max-width:28rem;margin:4rem auto;padding:0 16px}
h1{font-size:1.25rem;margin:0}p{color:var(--muted);margin:.25rem 0 2rem}
.dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--muted);margin-right:.5em}.dot.on{background:var(--accent)}.dot.bad{background:var(--bad)}
ul{list-style:none;padding:0;margin:0}li{display:grid;grid-template-columns:9rem 1fr 2.5rem;gap:.75rem;align-items:center;margin:.5rem 0}
meter{width:100%}b{text-align:right;font-weight:normal;color:var(--muted)}
`;
export const doc = (title, body, { head = '', style = css, cls = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}<title>${escape(title)}</title><style>${style}</style></head><body${cls}>
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
<p>Learns the room's style. Mention it in Apron to chat.</p>`, { head: '<meta http-equiv="refresh" content="60">' });
}
