import { margins, breaks } from './events.js';
const who = e => e.name ?? e.from ?? 'someone';
// A mention in a watched room that got no reply.
const unanswered = e => !!e.mentioned && margins[e.outcome].place === 'room' && !margins[e.outcome].answered;
// Each watched room's transcript as the bot saw it, oldest first, plus the messages it ignored elsewhere.
// A row is a message (text only when it engaged the bot), one of the bot's posts, or a break across every room.
export function transcript(events, rooms) {
  const out = { rooms: rooms.map(id => ({ id, rows: [], unanswered: 0 })), elsewhere: [] };
  const room = id => out.rooms.find(r => r.id === id);
  const senders = new Map(), posts = new Map();
  for (const e of events) {
    if (e.kind === 'message') {
      const m = margins[e.outcome];
      senders.set(e.message_id, who(e));
      if (!m.place) continue;
      const row = { kind: 'message', at: e.at, message_id: e.message_id, who: who(e), text: e.text, tone: m.tone, unanswered: unanswered(e), margin: m.say(e) };
      const target = m.place === 'room' ? room(e.room) : null;
      if (!target) { out.elsewhere.push({ ...row, room: e.room }); continue; }
      target.rows.push(row);
      if (row.unanswered) ++target.unanswered;
    } else if (e.kind === 'posted') {
      const to = senders.get(e.reply_to), row = { kind: 'post', at: e.at, room: e.room, message_id: e.message_id, text: e.text, deleted: false, margin: to ? `my reply to ${to}.` : 'my reply.' };
      posts.set(e.message_id, row);
      room(e.room)?.rows.push(row);
    } else if (e.kind === 'deleted') {
      const row = posts.get(e.message_id);
      if (row) Object.assign(row, { deleted: true, margin: 'I deleted this.' });
    } else if (Object.hasOwn(breaks, e.kind)) {
      for (const r of out.rooms) r.rows.push({ kind: 'break', at: e.at, text: breaks[e.kind](e) });
    }
  }
  return out;
}
// What the bot did since the later of midnight UTC and the oldest event it remembers.
export function today(events, now = Date.now()) {
  const midnight = new Date(now).setUTCHours(0, 0, 0, 0), recent = events.filter(e => e.at >= midnight);
  const messages = recent.filter(e => e.kind === 'message');
  return {
    since: Math.max(midnight, events[0]?.at ?? now),
    replies: recent.filter(e => e.kind === 'posted').length,
    unanswered: messages.filter(unanswered).length,
    learned: messages.filter(e => e.style).length,
  };
}
