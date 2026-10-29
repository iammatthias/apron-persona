import { axes, leanings, topics } from './core.js';
import { list } from './settings.js';
// The room memory: per room, per UTC day, per topic, counts only. No speaker and no text: a topic is one fixed label.
// pages holds each room's digest for the day, from which onepager() writes the prompt's room notes.
export const empty = () => ({ rooms: {}, pages: {} });
const DAY = 86400000;
export const dayOf = now => new Date(now).toISOString().slice(0, 10);
export const shift = (date, days) => dayOf(Date.parse(date) + days * DAY);
const monday = date => shift(date, -((new Date(date).getUTCDay() + 6) % 7));
const round = x => Math.round(x * 1000) / 1000;
const bucket = () => ({ topics: {}, learned: 0, lean: [0, 0, 0, 0] });
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
// Counts one classified message on its day: its topic, whether it addressed the bot, what the bot did, and how far
// the style learned from it leans from neutral on each axis.
export function tally(memory, room, date, { topic, engaged, outcome, style }) {
  const b = (memory.rooms[room] ??= { days: {}, weeks: {} }).days[date] ??= bucket();
  const c = b.topics[topic] ??= counts();
  ++c.messages;
  if (engaged) ++c.engaged;
  if (outcome === 'replied') ++c.replies;
  if (outcome === 'chimed-in') ++c.chimes;
  if (style) merge(b, { topics: {}, learned: 1, lean: style.map(v => v - .5) });
  return memory;
}
// Keeps today and the 14 days before it, folds older days into their week (starting Monday), and drops weeks that
// started 12 or more weeks before this one. Running it again changes nothing.
export function roll(memory, today) {
  const days = shift(today, -14), weeks = shift(monday(today), -84);
  for (const [id, r] of Object.entries(memory.rooms)) {
    for (const d of Object.keys(r.days).sort()) {
      if (d >= days) continue;
      if (monday(d) >= weeks) r.weeks[monday(d)] = merge(r.weeks[monday(d)] ?? bucket(), r.days[d]);
      delete r.days[d];
    }
    for (const w of Object.keys(r.weeks)) if (w < weeks) delete r.weeks[w];
    if (!Object.keys(r.days).length && !Object.keys(r.weeks).length) delete memory.rooms[id];
  }
  for (const [id, p] of Object.entries(memory.pages)) if (p.day < days) delete memory.pages[id];
  return memory;
}
const sum = buckets => buckets.filter(Boolean).reduce(merge, bucket());
const total = b => Object.values(b.topics).reduce((n, c) => n + c.messages, 0);
// The latest week each axis moved .15 or more from the week before, among complete days in weeks with 5 or more
// learned messages, as { since: that Monday, axis, up }.
function shifts(r, today) {
  const weeks = {};
  for (const w of Object.keys(r.weeks).sort()) weeks[w] = merge(weeks[w] ?? bucket(), r.weeks[w]);
  for (const d of Object.keys(r.days).sort()) if (d < today) weeks[monday(d)] = merge(weeks[monday(d)] ?? bucket(), r.days[d]);
  const series = Object.keys(weeks).sort().filter(w => weeks[w].learned >= 5).map(w => [w, weeks[w].lean.map(x => x / weeks[w].learned)]);
  const out = [];
  axes.forEach((axis, i) => {
    for (let k = series.length - 1; k > 0; --k) {
      const d = series[k][1][i] - series[k - 1][1][i];
      if (Math.abs(d) >= .15) { out.push({ since: series[k][0], axis, up: d > 0 }); break; }
    }
  });
  return out.sort((a, b) => a.since < b.since ? -1 : a.since > b.since ? 1 : 0);
}
// A room's digest as of today, from complete days only, so it can't move until tomorrow: the topics that filled the
// last 7 days, how busy they were next to the 7 before, and dated trait shifts. Only fixed labels and dates.
export function digest(r = { days: {}, weeks: {} }, today) {
  const span = (from, n) => sum(Array.from({ length: n }, (_, i) => r.days[shift(today, from - i)]));
  const last = span(-1, 7), n = total(last), m = total(span(-8, 7));
  const ranked = Object.keys(last.topics).filter(t => t !== 'other').sort((a, b) => last.topics[b].messages - last.topics[a].messages || topics.indexOf(a) - topics.indexOf(b));
  const share = at => n < 5 ? [] : ranked.filter(t => last.topics[t].messages / n >= at);
  const mostly = share(.25).slice(0, 2), some = share(.1).filter(t => !mostly.includes(t)).slice(0, 2);
  return { day: today, mostly, some, pace: m < 5 ? null : n > m * 1.25 ? 'busier' : n < m * .8 ? 'quieter' : 'steady', shifts: shifts(r, today) };
}
const paces = { busier: 'busier than last week', quieter: 'quieter than last week', steady: 'about as busy as last week' };
const said = { ai: 'AI', help: 'asking for help', meta: 'talk about the room itself' };
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dated = d => `${months[+d.slice(5, 7) - 1]} ${+d.slice(8)}`;
// The room notes for the prompt, or '' when there is nothing to say.
export function onepager(room, page, norms = '') {
  const named = ts => list(ts.map(t => said[t] ?? t));
  const what = [page.mostly.length && `mostly ${named(page.mostly)}`, page.some.length && `some ${named(page.some)}`].filter(Boolean).join(', ');
  const lately = [what, paces[page.pace]].filter(Boolean).join('; ');
  const since = [...new Set(page.shifts.map(s => s.since))].map(d => `As of ${dated(d)} the room runs ${list(page.shifts.filter(s => s.since === d).map(s => leanings[s.axis][s.up ? 0 : 1]))}.`);
  return [lately && `In #${room} lately: ${lately}.`, ...since, norms && `Norms: ${norms}`].filter(Boolean).join(' ');
}
// A room's last 7 days to today, oldest first, with each topic's message count per day, busiest topic first.
export function week(memory, room, today) {
  const days = Array.from({ length: 7 }, (_, i) => shift(today, i - 6)), r = memory.rooms[room]?.days ?? {};
  const all = n => n.reduce((a, b) => a + b, 0);
  const rows = topics.map(t => [t, days.map(d => r[d]?.topics[t]?.messages ?? 0)]).filter(([, n]) => all(n));
  return { days, rows: rows.sort((a, b) => all(b[1]) - all(a[1])) };
}
