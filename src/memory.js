// The room memory: per room, per UTC day, per topic, counts only. No speaker, no text: a topic is one fixed label.
export const topics = ['code', 'deploys', 'design', 'ai', 'crypto', 'hardware', 'games', 'music', 'food', 'news', 'work', 'life', 'plans', 'banter', 'help', 'meta', 'other'];
export const topic = x => {
  const t = typeof x === 'string' ? x.trim().toLowerCase() : '';
  return topics.includes(t) ? t : 'other';
};
export const empty = () => ({ rooms: {} });
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
  return memory;
}
