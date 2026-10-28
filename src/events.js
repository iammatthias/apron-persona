import { axes, leanings } from './core.js';
// Every kind of event the bot records. Only declared fields are kept: a message's text only when it engages the bot.
export const kinds = {
  connected: { label: 'Connected', fields: ['host', 'user_id'] },
  disconnected: { label: 'Disconnected', fields: ['reason'] },
  'auth-denied': { label: 'Token refused', fields: [] },
  // addressed is 'mention' or 'reply'. need, ago and wait are the bar, the time since the last chime-in, and the cooldown that decided it.
  message: { label: 'Message', fields: ['room', 'message_id', 'reply_to', 'from', 'name', 'addressed', 'text', 'outcome', 'learn_p', 'reply_p', 'style', 'need', 'ago', 'wait', 'detail'] },
  posted: { label: 'Posted', fields: ['room', 'message_id', 'reply_to', 'organic', 'text'] },
  deleted: { label: 'Post deleted', fields: ['room', 'message_id'] },
  // The new value of each changed setting except the persona, whose text stays out of the log.
  settings: { label: 'Settings saved', fields: ['keys', 'paused', 'reply_mentions', 'reply_replies', 'reply_threshold', 'cooldown', 'organic', 'organic_threshold', 'organic_gap'] },
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
  'trigger-off': 'Addressed, but that trigger is off',
  'learned-only': 'Classified; not addressed',
  declined: 'Addressed; reply probability below the bar',
  'held-back': 'Not addressed; below the chime-in bar',
  'quiet-gap': 'Not addressed; chimed in here too recently',
  cooldown: 'Posted too recently',
  budget: 'Skipped: daily calls used up',
  'classify-failed': 'Classification failed',
  'reply-empty': 'The model returned no text',
  'reply-failed': 'Reply request failed',
  replied: 'Replied',
  'chimed-in': 'Chimed in unprompted',
};
const p2 = x => Number(x).toFixed(2);
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const who = e => e.name ?? e.from ?? 'someone';
// The axis a learned style vector leans furthest along, as words.
function lean(style) {
  const i = style.reduce((best, v, j) => Math.abs(v - .5) > Math.abs(style[best] - .5) ? j : best, 0);
  return style[i] === .5 ? 'no lean either way' : `a little ${leanings[axes[i]][style[i] > .5 ? 0 : 1]}`;
}
// The dashboard's margin note for each outcome, in the bot's voice. place is where the message shows: its room's
// transcript, "ignored elsewhere", or nowhere (its own echo, which the posted event already shows). tone colours
// the note; answered marks a mention as handled.
export const margins = {
  'other-room': { place: 'elsewhere', say: () => "not a room I watch." },
  'from-bot': { place: 'elsewhere', say: () => "from a bot or a notice, so I let it be." },
  own: { place: null, say: () => 'my own message.' },
  deleted: { place: 'room', say: () => 'a deletion. nothing to read.' },
  empty: { place: 'room', say: () => 'no text to read.' },
  busy: { place: 'room', tone: 'warn', say: () => 'four messages were already waiting, so I dropped this one.' },
  paused: { place: 'room', say: () => "I'm paused, so I didn't read it." },
  stale: { place: 'room', say: () => 'the connection changed before I got to it.' },
  duplicate: { place: 'room', say: () => "I'd seen this exact text already." },
  'rate-limited': { place: 'room', say: e => `already learned from ${who(e)} in the last 5 min.` },
  'trigger-off': { place: 'room', say: e => `you've turned off answering ${e.addressed === 'reply' ? 'replies to me' : 'mentions'}, so I let it be.` },
  'learned-only': { place: 'room', say: e => e.style ? `learned. ${lean(e.style)}. (${p2(e.learn_p)})` : `didn't learn. learn chance ${p2(e.learn_p)}, I need 0.80.` },
  declined: { place: 'room', tone: 'warn', say: e => `didn't answer. reply chance ${p2(e.reply_p)}, I need ${p2(e.need)}.` },
  'held-back': { place: 'room', say: e => `could have chimed in (${p2(e.reply_p)}), but I hold out for ${p2(e.need)}.` },
  'quiet-gap': { place: 'room', say: e => `would have chimed in, but I spoke up here ${e.ago < 60000 ? 'under a minute' : `${Math.round(e.ago / 60000)} min`} ago.` },
  cooldown: { place: 'room', tone: 'warn', say: e => `${e.addressed ? "didn't answer" : 'would have chimed in'}. I'd posted under ${plural(e.wait, 'second')} before.` },
  budget: { place: 'room', tone: 'warn', say: () => "I'm out of calls for today, so I let it pass." },
  'classify-failed': { place: 'room', tone: 'bad', say: e => `I couldn't size it up. the model call failed (${e.detail}).` },
  'reply-empty': { place: 'room', tone: 'bad', say: () => 'the model returned nothing, so I stayed quiet.' },
  'reply-failed': { place: 'room', tone: 'bad', say: e => `I tried, but the model call failed (${e.detail}).` },
  replied: { place: 'room', tone: 'ok', answered: true, say: e => `answered. I was ${p2(e.reply_p)} sure a reply fit.` },
  'chimed-in': { place: 'room', tone: 'ok', answered: true, say: e => `chimed in unprompted. I was ${p2(e.reply_p)} sure it'd be welcome.` },
};
const toggled = (on, off) => v => v ? on : off;
// What each changed setting reads as in the transcript break.
const changes = {
  persona: () => 'you rewrote who I am',
  paused: toggled('you paused me', 'you resumed me'),
  reply_mentions: toggled('you let me answer mentions', 'you stopped me answering mentions'),
  reply_replies: toggled('you let me answer replies to me', 'you stopped me answering replies to me'),
  reply_threshold: v => `you set my reply bar to ${p2(v)}`,
  cooldown: v => `you set my cooldown to ${plural(v, 'second')}`,
  organic: toggled('you let me chime in on my own', 'you stopped me chiming in'),
  organic_threshold: v => `you set my chime-in bar to ${p2(v)}`,
  organic_gap: v => `you set my chime-in gap to ${v} min`,
};
// The dashed break each connection or owner event draws across every room's transcript.
export const breaks = {
  connected: e => `connected to ${e.host} as ${e.user_id}`,
  disconnected: e => `lost the server (${e.reason})`,
  'auth-denied': () => 'the server refused my token',
  settings: e => e.keys.map(k => changes[k](e[k])).join(', '),
  error: e => `error: ${e.code}`,
};
export function event(kind, fields = {}) {
  if (!Object.hasOwn(kinds, kind)) throw Error(`unknown event ${kind}`);
  if (kind === 'message' && !Object.hasOwn(outcomes, fields.outcome)) throw Error(`unknown outcome ${fields.outcome}`);
  return { kind, ...Object.fromEntries(kinds[kind].fields.filter(f => fields[f] !== undefined).map(f => [f, cap(f, fields[f])])) };
}
// Frames can be up to 1 MiB, so every stored string is bounded: the ring stays small whatever a server sends.
const cap = (f, v) => typeof v === 'string' ? v.slice(0, f === 'text' ? 2000 : 200) : v;
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
