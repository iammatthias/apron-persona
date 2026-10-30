import { axes, leanings, topics, BLOCK, BLOCKS, FOLD, FOLDS, RECENT } from './core.js';
import { list } from './settings.js';
// The room memory: per room, counts only, in blocks of BLOCK messages the bot classified there. No speaker and no text:
// a topic is one fixed label. A room holds the block being filled (open), the last BLOCKS closed blocks whole, before
// them up to FOLDS folds of FOLD blocks each, and closed, how many blocks have closed there. pages holds each room's
// digest as of its last closed block, from which onepager() writes the prompt's room notes.
export const empty = () => ({ rooms: {}, pages: {} });
const round = x => Math.round(x * 1000) / 1000;
const block = () => ({ topics: {}, learned: 0, lean: [0, 0, 0, 0] });
const counts = () => ({ messages: 0, engaged: 0, replies: 0, chimes: 0 });
function merge(into, b) {
  for (const t of Object.keys(b.topics).sort()) {
    const c = into.topics[t] ??= counts();
    for (const k of Object.keys(c)) c[k] += b.topics[t][k];
  }
  into.learned += b.learned;
  into.lean = into.lean.map((x, i) => round(x + b.lean[i]));
  return into;
}
const total = b => Object.values(b.topics).reduce((n, c) => n + c.messages, 0);
// Counts one classified message into the room's open block: its topic, whether it addressed the bot, what the bot did,
// and how far the style learned from it leans from neutral on each axis. The BLOCKth message closes the block.
export function tally(memory, room, { topic, engaged, outcome, style }) {
  const r = memory.rooms[room] ??= { open: block(), blocks: [], folds: [], closed: 0 };
  const c = r.open.topics[topic] ??= counts();
  ++c.messages;
  if (engaged) ++c.engaged;
  if (outcome === 'replied') ++c.replies;
  if (outcome === 'chimed-in') ++c.chimes;
  if (style) merge(r.open, { topics: {}, learned: 1, lean: style.map(v => v - .5) });
  if (total(r.open) >= BLOCK) close(r);
  return memory;
}
// The open block joins the closed ones; past BLOCKS of those, the oldest joins the newest fold until it spans FOLD.
function close(r) {
  r.blocks.push(r.open); r.open = block(); ++r.closed;
  while (r.blocks.length > BLOCKS) {
    const oldest = r.blocks.shift(), fold = r.folds.at(-1);
    if (fold && fold.span < FOLD) { merge(fold, oldest); ++fold.span; } else r.folds.push({ ...oldest, span: 1 });
    while (r.folds.length > FOLDS) r.folds.shift();
  }
}
const sum = blocks => blocks.reduce(merge, block());
// A room's digest as of its last closed block, so it can't move until the next one closes: the topics that filled the
// last RECENT closed blocks, and the axes on which they lean .15 or more from everything before them, where each side
// has 5 or more learned messages. Only fixed labels and counts.
export function digest(r = { closed: 0, blocks: [], folds: [] }) {
  const lately = sum(r.blocks.slice(-RECENT)), before = sum([...r.folds, ...r.blocks.slice(0, -RECENT)]);
  const n = total(lately);
  const ranked = Object.keys(lately.topics).filter(t => t !== 'other').sort((a, b) => lately.topics[b].messages - lately.topics[a].messages || topics.indexOf(a) - topics.indexOf(b));
  const share = at => n < 5 ? [] : ranked.filter(t => lately.topics[t].messages / n >= at);
  const mostly = share(.25).slice(0, 2), some = share(.1).filter(t => !mostly.includes(t)).slice(0, 2);
  const shifts = lately.learned < 5 || before.learned < 5 ? [] : axes.flatMap((axis, i) => {
    const d = lately.lean[i] / lately.learned - before.lean[i] / before.learned;
    return Math.abs(d) >= .15 ? [{ axis, up: d > 0 }] : [];
  });
  return { closed: r.closed, mostly, some, shifts };
}
const said = { ai: 'AI', help: 'asking for help', meta: 'talk about the room itself' };
// The room notes for the prompt, or '' when there is nothing to say.
export function onepager(room, page, norms = '') {
  const named = ts => list(ts.map(t => said[t] ?? t));
  const what = [page.mostly.length && `mostly ${named(page.mostly)}`, page.some.length && `some ${named(page.some)}`].filter(Boolean).join(', ');
  const runs = page.shifts.length && `Lately the room runs ${list(page.shifts.map(s => leanings[s.axis][s.up ? 0 : 1]))}.`;
  return [what && `In #${room} lately: ${what}.`, runs, norms && `Norms: ${norms}`].filter(Boolean).join(' ');
}
// A room's last closed blocks, up to `shown` columns with the block being filled ("now") last, oldest first: each
// topic's message count per block, busiest topic first. Closed blocks are labelled by their number in the room.
export function recent(memory, room, shown = 7) {
  const r = memory.rooms[room] ?? { open: block(), blocks: [], closed: 0 };
  const closed = r.blocks.slice(-(shown - 1));
  const columns = [...closed.map((b, i) => ({ label: String(r.closed - closed.length + i + 1), block: b })), { label: 'now', block: r.open }];
  const all = n => n.reduce((a, b) => a + b, 0);
  const rows = topics.map(t => [t, columns.map(c => c.block.topics[t]?.messages ?? 0)]).filter(([, n]) => all(n));
  return { labels: columns.map(c => c.label), rows: rows.sort((a, b) => all(b[1]) - all(a[1])) };
}
