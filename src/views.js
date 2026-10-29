import { transcript, fold, today } from './transcript.js';
import { margins, churn } from './events.js';
import { promptParts, roomPrompt, recall, list } from './settings.js';
import { axes, leanings } from './core.js';
import { roles } from './models.js';
import { dayOf } from './memory.js';
// The admin portal's view models: plain data computed from one snapshot of the bot, which the dashboard renders.
// A snapshot is { name, now, rooms, events, status, spent, limit, settings, details, lastError, learning, preview,
// memory, posts }: memory holds each watched room's { id, notes, week }, and posts is the bot's live posts or { error }.
const HOUR = 3600000, FLAKY = 3;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const midnight = now => new Date(now).setUTCHours(0, 0, 0, 0);
const memo = (s, id) => s.memory.find(m => m.id === id);
export const href = ({ view, room }) => view === 'now' ? '/' : `/?view=${view}${room ? `&room=${encodeURIComponent(room)}` : ''}`;
// What each role's calls are for.
const purposes = { judge: 'reading messages', compose: 'writing replies', learn: 'reading history' };
// The day's calls by role, which add up to the day's total; unsorted is what was spent before the counter existed.
export function calls({ status, spent, limit, now }) {
  const fresh = status.budget.day === dayOf(now), total = fresh ? status.budget.calls : 0;
  const by = Object.keys(roles).map(role => ({ role, label: purposes[role], calls: 0, hedges: 0, retries: 0, ...fresh ? spent[role] : {} }));
  return { total, limit: Number(limit) || 0, by, unsorted: total - by.reduce((n, r) => n + r.calls, 0) };
}
// The link at a glance. state is paused, up, down (with an error) or connecting; up is how long it has been signed in.
export function link({ events, status, details, now }) {
  const hour = events.filter(e => e.kind === 'disconnected' && e.at > now - HOUR);
  const state = status.paused ? 'paused' : status.connected ? 'up' : status.error ? 'down' : 'connecting';
  return { state, error: status.error, up: details?.since ? now - details.since : null, drops: hour.length, reason: hour.at(-1)?.reason ?? null };
}
// Each watched room's mentions today that got no answer.
function missed(s) {
  const from = midnight(s.now);
  return transcript(s.events, s.rooms).rooms.map(r => ({ id: r.id, rows: r.rows.filter(x => x.unanswered && x.at >= from) }));
}
// The status strip on every page.
export const strip = s => ({ name: s.name, paused: s.status.paused, link: link(s), calls: calls(s), today: today(s.events, s.now) });
// The top navigation: now, one tab per watched room badged with its unanswered mentions today, the bot, and plumbing.
export function tabs(s, place) {
  const badges = new Map(missed(s).map(r => [r.id, r.rows.length]));
  return [
    { view: 'now', label: 'now' },
    ...s.rooms.map(room => ({ view: 'room', room, label: `#${room}`, badge: badges.get(room) })),
    { view: 'bot', label: 'the bot' },
    { view: 'plumbing', label: 'plumbing', end: true },
  ].map(t => ({ ...t, href: href(t), current: t.view === place.view && (t.view !== 'room' || t.room === place.room) }));
}
const where = l => `${list(l.rooms.map(r => `#${r}`))} on ${l.host}`;
const writes = { 'state-refused': 'state.json', 'status-refused': 'status.json' };
// What needs the owner, grouped and in this order: each room's unanswered mentions as one item, a redraft to review,
// a link that is down or flapping, a refused write, and a spent budget. Empty most days. An item has a why, or for a
// room the misses that make it up; at is when it last happened, if that matters.
export function needs(s) {
  const out = [], c = calls(s), l = link(s), learning = s.learning;
  for (const { id, rows } of missed(s)) {
    if (!rows.length) continue;
    out.push({ group: 'room', tone: rows.some(r => r.tone === 'bad') ? 'bad' : 'warn', href: href({ view: 'room', room: id }),
      text: `${plural(rows.length, 'mention')} in #${id} got no answer`, misses: rows.map(r => ({ who: r.who, at: r.at, why: margins[r.outcome].miss ?? r.outcome })) });
  }
  if (learning?.stage === 'ready') out.push({ group: 'persona', tone: 'ok', href: '/?view=bot#persona', text: `a redraft from ${plural(learning.count, 'message')} in ${where(learning)} is ready to review`,
    why: learning.failed ? `${learning.failed} of my readings failed (${learning.detail}), so it leans on the rest.` : 'apply or discard it under who I am.' });
  if (learning?.stage === 'failed') out.push({ group: 'persona', tone: 'bad', href: '/?view=bot#persona', text: `I couldn't redraft from history in ${where(learning)}`, why: learning.detail });
  if (l.state === 'down') out.push({ group: 'link', tone: 'bad', href: '/?view=plumbing', text: `I'm not connected (${l.error})`, why: l.drops ? `${plural(l.drops, 'drop')} in the last hour.` : '' });
  else if (l.drops >= FLAKY) out.push({ group: 'link', tone: 'warn', href: '/?view=plumbing', text: `the link dropped ${l.drops} times in the last hour (${l.reason})`, why: l.up === null ? '' : `up again for ${l.up < 60000 ? 'under a minute' : `${Math.round(l.up / 60000)} min`}.` });
  for (const [code, file] of Object.entries(writes)) {
    const refused = s.events.filter(e => e.kind === 'error' && e.code === code);
    if (refused.length) out.push({ group: 'disk', tone: 'bad', href: '/?view=plumbing', text: `I couldn't save ${file}`, at: refused.at(-1).at, why: `refused ${plural(refused.length, 'time')}. I carry on and try again.` });
  }
  if (c.total >= c.limit) out.push({ group: 'budget', tone: 'warn', href: '/?view=plumbing', text: c.limit ? `I've spent all ${c.limit} calls for today` : 'DAILY_CALLS is 0, so I make no calls today',
    why: c.limit ? `${c.by.filter(r => r.calls).map(r => `${r.calls} ${r.label}`).join(', ') || 'none sorted by role'}. resets at 00:00 UTC.` : '' });
  return out;
}
// How far the traits have moved from the neutral start, in words.
export function drift(personality) {
  const moved = axes.filter(a => Math.abs(personality[a] - .5) >= .01).sort((a, b) => Math.abs(personality[b] - .5) - Math.abs(personality[a] - .5));
  if (!moved.length) return "I'm still where I started, at the tick (0.5).";
  return `This room has made me ${list(moved.map(a => leanings[a][personality[a] > .5 ? 0 : 1]))} than where I started (the tick at 0.5).`;
}
const p2 = x => Number(x).toFixed(2);
// The triggers in one line.
function triggers(s) {
  const asked = s.reply_mentions && s.reply_replies ? 'mentions and replies' : s.reply_mentions ? 'mentions' : s.reply_replies ? 'replies to me' : null;
  return `${asked ? `I answer ${asked} at ${p2(s.reply_threshold)}.` : "I don't answer anyone."} ${s.organic ? `I chime in at ${p2(s.organic_threshold)}.` : 'I never chime in.'}`;
}
// The glance layer: what needs the owner, a card per room with its latest decisions, and the bot in brief. A single
// room has no card: its tab is the room itself.
export function now(s) {
  const t = transcript(s.events, s.rooms), from = midnight(s.now);
  const cards = s.rooms.length < 2 ? [] : t.rooms.map(r => {
    const last = r.rows.filter(x => x.kind !== 'break').at(-1)?.at;
    return { id: r.id, notes: memo(s, r.id).notes, read: r.rows.filter(x => x.kind === 'message' && x.at >= from).length, last: last === undefined ? null : s.now - last,
      rows: r.rows.filter(x => x.kind === 'post' || x.kind === 'message' && x.text !== undefined).slice(-4) };
  });
  const p = s.status.personality;
  return { needs: needs(s), cards, bot: { persona: promptParts(s.settings, p, s.name)[0], personality: p, drift: drift(p), triggers: triggers(s.settings) } };
}
const rowsOf = (s, id) => transcript(s.events, s.rooms).rooms.find(r => r.id === id).rows;
// A room's rows after `at`, folded, as the live page asks for them; or just the post with message_id.
export const after = (s, id, at) => fold(rowsOf(s, id).filter(r => r.at > at));
export const posted = (s, id, message_id) => rowsOf(s, id).filter(r => r.kind === 'post' && r.message_id === message_id);
// One room: its transcript with quiet runs folded, what the bot believes about it, its norms and the bot's posts there.
export function room(s, id) {
  const m = memo(s, id), rows = rowsOf(s, id);
  const posts = s.posts.error ? { error: s.posts.error, list: [] } : { error: null, list: s.posts.filter(p => p.room_id === id).map(p => ({ message_id: p.message_id, at: Number(p.log_id), text: p.body.text })) };
  return { id, rows: fold(rows), notes: m.notes, week: m.week, norms: s.settings.norms[id] ?? '', posts };
}
// A history job's stage for the persona section: null, or where it reads, how far it got and, once ready, the proposal
// beside the traits now and after.
function lesson(s) {
  const l = s.learning;
  if (!l) return null;
  return { stage: l.stage, where: where(l), count: l.count, failed: l.failed, detail: l.detail, persona: l.persona, now: s.status.personality, after: s.preview };
}
// A stand-in exchange, to show the shape of the transcript the model gets.
const sample = [{ name: 'ana', content: 'what they said' }, { name: 'you', content: 'what I said' }];
// How the bot thinks, in the order it uses each part: the gate, then the prompt from top to bottom. Every prompt part is
// `sent`, exactly as the model gets it for `id`, from the functions the bot builds its prompt with.
export function bot(s, id) {
  const m = memo(s, id), p = s.status.personality, set = s.settings, from = midnight(s.now);
  const [persona, style, notes, rules] = promptParts(set, p, s.name, m.notes);
  const day = s.events.filter(e => e.kind === 'message' && e.at >= from && margins[e.outcome].place === 'room');
  const count = (...outcomes) => day.filter(e => outcomes.includes(e.outcome)).length;
  const pick = (...keys) => Object.fromEntries(keys.map(k => [k, set[k]]));
  return { room: id, rooms: s.rooms, sections: [
    { id: 'answer', part: 'gate', title: 'do I answer when asked?', settings: pick('reply_mentions', 'reply_replies', 'reply_threshold'),
      why: "a mention, a reply to me, or the next line from someone I'm talking with. a model call scores how well a reply would fit, and I answer when the score clears the bar. if someone keeps going, I answer their latest.",
      today: { answered: count('replied'), not: today(s.events, s.now).unanswered } },
    { id: 'chime', part: 'gate', title: 'do I speak up unprompted?', settings: pick('organic', 'organic_threshold'),
      why: `I score messages nobody asked me about to learn from them, one per person every 5 minutes. I speak up when the chance it'd be welcome and the chance I have something specific to add both clear the bar, and never while my message is the latest here.`,
      today: { chimed: count('chimed-in'), held: count('held-back', 'nothing-to-add', 'spoke-last') } },
    { id: 'persona', part: 'prompt', title: 'who I am', why: `the first thing the model reads. {name} becomes ${s.name}.`, sent: persona, persona: set.persona, lesson: lesson(s) },
    { id: 'traits', part: 'prompt', title: 'what the room made me', why: 'learned from the messages I read. not editable: it moves as the room talks.', sent: style, personality: p, drift: drift(p) },
    { id: 'room', part: 'prompt', title: 'what I know about the room', why: "only the room I'm answering in. rebuilt daily from what it talks about, plus your norms.", sent: notes, week: m.week, norms: set.norms[id] ?? '' },
    { id: 'rules', part: 'prompt', title: 'the fixed rules', why: 'the same in every room. not editable here.', sent: rules },
    { id: 'lines', part: 'prompt', title: 'the last lines', why: `then, as its own message, up to the last ${recall.lines} messages of the room's history, oldest first, mine as "you". if history takes over ${recall.wait / 1000}s, the last ${recall.own} I saw myself.`,
      sent: roomPrompt(sample, false), chime: roomPrompt(sample, true) },
  ] };
}
// The link in detail: its log of connects, drops and errors (newest first), the day's calls by role, what the server
// said, and what the bot ignored outside its rooms.
export function plumbing(s) {
  const d = s.details ?? {};
  return {
    link: { ...link(s), url: d.url, user: d.you?.user_id ?? null, avatar: d.you?.avatar ?? null, latency: d.latency ?? null, lastError: s.lastError },
    log: s.events.filter(e => Object.hasOwn(churn, e.kind)).reverse().map(e => ({ at: e.at, tone: churn[e.kind].tone, text: churn[e.kind].say(e) })),
    calls: calls(s), speed: today(s.events, s.now).speed,
    server: d.server ?? null, you: d.you ?? null,
    elsewhere: transcript(s.events, s.rooms).elsewhere,
  };
}
