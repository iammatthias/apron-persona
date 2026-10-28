// Every kind of event the bot records. Only declared fields are kept: a message's text only when it engages the bot.
export const kinds = {
  connected: { label: 'Connected', fields: ['host', 'user_id'] },
  disconnected: { label: 'Disconnected', fields: ['reason'] },
  'auth-denied': { label: 'Token refused', fields: [] },
  message: { label: 'Message', fields: ['room', 'message_id', 'reply_to', 'from', 'mentioned', 'text', 'outcome', 'learn_p', 'reply_p', 'detail'] },
  posted: { label: 'Posted a reply', fields: ['room', 'message_id', 'reply_to', 'text'] },
  deleted: { label: 'Post deleted', fields: ['room', 'message_id'] },
  settings: { label: 'Settings saved', fields: ['keys'] },
  error: { label: 'Error', fields: ['code'] },
};
// What became of one incoming message.
export const outcomes = {
  'other-room': 'Ignored: not a watched room',
  'from-bot': 'Ignored: from a bot or a notice',
  own: 'Ignored: its own message',
  deleted: 'Ignored: a deletion',
  empty: 'Ignored: no text',
  busy: 'Dropped: four messages already queued',
  paused: 'Ignored: paused',
  stale: 'Dropped: the connection changed first',
  duplicate: 'Ignored: repeats a recent message',
  'rate-limited': 'Ignored: sender already counted in the last five minutes',
  'learned-only': 'Classified; not mentioned',
  declined: 'Mentioned; reply probability below 0.7',
  cooldown: 'Mentioned; replied under 15 seconds ago',
  budget: 'Skipped: daily calls used up',
  'classify-failed': 'Classification failed',
  'reply-empty': 'The model returned no text',
  'reply-failed': 'Reply request failed',
  replied: 'Replied',
};
export function event(kind, fields = {}) {
  if (!Object.hasOwn(kinds, kind)) throw Error(`unknown event ${kind}`);
  if (kind === 'message' && !Object.hasOwn(outcomes, fields.outcome)) throw Error(`unknown outcome ${fields.outcome}`);
  return { kind, ...Object.fromEntries(kinds[kind].fields.filter(f => fields[f] !== undefined).map(f => [f, fields[f]])) };
}
export const label = e => e.kind === 'message' ? outcomes[e.outcome] : kinds[e.kind].label;
// The newest events in memory, with listeners for the live stream.
export class Log {
  constructor(size = 300) { this.size = size; this.events = []; this.listeners = new Set(); }
  push(e) {
    // Strictly increasing, so ?since=<at> never skips an event that shares a millisecond.
    const stamped = Object.freeze({ at: Math.max(Date.now(), (this.events.at(-1)?.at ?? 0) + 1), ...e });
    this.events.push(stamped);
    if (this.events.length > this.size) this.events.shift();
    for (const f of this.listeners) try { f(stamped); } catch {}
    return stamped;
  }
  list(since = 0) { return this.events.filter(e => e.at > since); }
  subscribe(f) { this.listeners.add(f); }
  unsubscribe(f) { this.listeners.delete(f); }
}
