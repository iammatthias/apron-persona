import { margins, breaks, secs, stages } from './events.js';
const who = e => e.name ?? e.from ?? 'someone';
// What a reply's time went on and who answered, for its margin's tooltip.
const timing = e => [
  ...stages.filter(k => e.ms[k] !== undefined).map(k => `${k} ${secs(e.ms[k])}`),
  ...Object.entries(e.via ?? {}).map(([role, m]) => `${role} by ${m}${e.hedged?.includes(role) ? ', hedged' : ''}`),
].join(' · ');
// A mention or reply in a watched room that got no answer.
const unanswered = e => !!e.addressed && margins[e.outcome].place === 'room' && !margins[e.outcome].answered;
// Offline for longer than this, messages may have been missed, so the transcript says so.
const MISSED = 60000;
// Each watched room's transcript as the bot saw it, oldest first, plus the messages it ignored elsewhere. A row is a
// message (text only when it engaged the bot; quiet when it is a routine outcome without text), one of the bot's posts,
// or a break across every room: an owner change, or a span offline long enough to miss messages. Connecting and
// dropping are not rows; the connection log has them.
export function transcript(events, rooms) {
  const out = { rooms: rooms.map(id => ({ id, rows: [] })), elsewhere: [] };
  const room = id => out.rooms.find(r => r.id === id);
  const all = row => { for (const r of out.rooms) r.rows.push(row); };
  const senders = new Map(), posts = new Map();
  let down = null;
  for (const e of events) {
    if (e.kind === 'message') {
      const m = margins[e.outcome];
      senders.set(e.message_id, who(e));
      if (!m.place) continue;
      const row = { kind: 'message', at: e.at, message_id: e.message_id, who: who(e), text: e.text, tone: m.tone, quiet: !!m.fold && e.text === undefined, learned: !!e.style, unanswered: unanswered(e), outcome: e.outcome, margin: m.say(e), ...m.answered && e.ms ? { title: timing(e) } : {} };
      const target = m.place === 'room' ? room(e.room) : null;
      if (target) target.rows.push(row); else out.elsewhere.push({ ...row, room: e.room });
    } else if (e.kind === 'posted') {
      const to = senders.get(e.reply_to), row = { kind: 'post', at: e.at, room: e.room, message_id: e.message_id, text: e.text, deleted: false, margin: e.organic ? 'something I chimed in with.' : to ? `my reply to ${to}.` : 'my reply.' };
      posts.set(e.message_id, row);
      room(e.room)?.rows.push(row);
    } else if (e.kind === 'deleted') {
      const row = posts.get(e.message_id);
      if (row) Object.assign(row, { deleted: true, margin: 'I deleted this.' });
    } else if (Object.hasOwn(breaks, e.kind)) {
      all({ kind: 'break', at: e.at, text: breaks[e.kind](e) });
    } else if (e.kind === 'disconnected') {
      down ??= e.at;
    } else if (e.kind === 'connected') {
      if (down !== null && e.at - down > MISSED) all({ kind: 'break', at: e.at, tone: 'warn', text: `back after ${Math.round((e.at - down) / 60000)} min offline. anything said then I missed.` });
      down = null;
    }
  }
  return out;
}
// Runs of quiet rows as one fold each, which holds them; a lone quiet row stays as it is. A fold sits at its last row's
// time, so a live page asking for rows since then misses none, and `from` is its first row's.
export function fold(rows) {
  const out = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (r.quiet && last?.kind === 'fold') { last.rows.push(r); last.at = r.at; }
    else if (r.quiet && last?.quiet) out[out.length - 1] = { kind: 'fold', from: last.at, at: r.at, rows: [last, r] };
    else out.push(r);
  }
  return out.map(r => r.kind === 'fold' ? { ...r, learned: r.rows.filter(x => x.learned).length } : r);
}
// The nearest-rank percentile of a sorted list.
const rank = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];
// What the bot did since the later of midnight UTC and the oldest event it remembers: replies, unanswered mentions
// and messages learned from among those it read in a watched room. speed is how long its replies took, median and
// 90th percentile in milliseconds over n of them, or null before the first.
export function today(events, now = Date.now()) {
  const midnight = new Date(now).setUTCHours(0, 0, 0, 0), recent = events.filter(e => e.at >= midnight);
  const messages = recent.filter(e => e.kind === 'message');
  const totals = messages.filter(e => margins[e.outcome].answered && e.ms?.total !== undefined).map(e => e.ms.total).sort((a, b) => a - b);
  return {
    since: Math.max(midnight, events[0]?.at ?? now),
    replies: recent.filter(e => e.kind === 'posted').length,
    unanswered: messages.filter(unanswered).length,
    learned: messages.filter(e => e.style).length,
    read: messages.filter(e => margins[e.outcome].place === 'room').length,
    speed: totals.length ? { median: rank(totals, .5), p90: rank(totals, .9), n: totals.length } : null,
  };
}
