import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { strip, tabs, needs, calls, now, room, bot, plumbing } from '../src/views.js';
import { restore, guardrails, cue, chime } from '../src/settings.js';
const t = Date.UTC(2026, 9, 28, 14, 31), at = m => t - m * 60000;
const msg = (m, room, outcome, extra = {}) => ({ at: at(m), kind: 'message', room, message_id: `m${m}`, from: 'u_ben', name: 'ben', outcome, ...extra });
const events = [
  { at: at(60 * 15), kind: 'disconnected', reason: 'close-1006' },
  msg(50, 'general', 'learned-only', { learn_p: .9, style: [.75, .5, .5, .5] }),
  msg(49, 'general', 'declined', { name: 'theo', addressed: 'mention', text: '@bot hi', reply_p: .41, need: .7 }),
  msg(48, 'builds', 'budget', { name: 'mei', addressed: 'mention', text: '@bot deploy?' }),
  { at: at(45), kind: 'disconnected', reason: 'close-1006' },
  { at: at(44), kind: 'connected', host: 'h', user_id: 'bot_me' },
  { at: at(30), kind: 'disconnected', reason: 'error' },
  { at: at(29), kind: 'connected', host: 'h', user_id: 'bot_me' },
  msg(20, 'general', 'replied', { name: 'ana', addressed: 'mention', text: '@bot yo', reply_p: .9, ms: { total: 1400 } }),
  { at: at(19), kind: 'posted', room: 'general', message_id: 'p1', reply_to: 'm20', text: 'yo' },
  msg(15, 'general', 'classify-failed', { name: 'kofi', addressed: 'mention', text: '@bot <b>', detail: 'timeout' }),
  { at: at(12), kind: 'error', code: 'state-refused' },
  { at: at(11), kind: 'disconnected', reason: 'close-1006' },
  { at: at(10), kind: 'connected', host: 'h', user_id: 'bot_me' },
  msg(9, 'general', 'rate-limited'),
  msg(8, 'general', 'learned-only', { learn_p: .5 }),
  msg(7, 'nowhere', 'other-room', { name: 'zed' }),
];
const week = { days: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'], rows: [['code', [0, 1, 0, 2, 0, 0, 3]]] };
const s = {
  name: 'P', now: t, rooms: ['general', 'builds'], events, limit: '40',
  status: { connected: true, paused: false, error: null, budget: { day: '2026-10-28', calls: 40 }, personality: { warmth: .62, playfulness: .5, curiosity: .45, expressiveness: .5 } },
  spent: { judge: { calls: 30, hedges: 2, retries: 1 }, compose: { calls: 6, hedges: 1, retries: 0 } },
  settings: restore({ settings: { persona: 'You are {name}.', norms: { general: 'be kind' } } }),
  details: { url: 'wss://h/', since: at(10), latency: 45, server: { agent: 'a/9' }, you: { user_id: 'bot_me', avatar: 'https://h/a.png' } },
  lastError: { code: 'state-refused', at: at(12) }, learning: null, preview: null,
  memory: [{ id: 'general', notes: 'In #general lately: mostly code. Norms: be kind', week }, { id: 'builds', notes: '', week: { days: week.days, rows: [] } }],
  posts: [{ room_id: 'general', message_id: 'p1', log_id: String(at(19)), body: { text: 'yo' } }, { room_id: 'builds', message_id: 'p0', log_id: '5', body: { text: 'old' } }],
};
test('calls by role add up to the day\'s total, with what came before the counter left unsorted', () => {
  const by = (judge, compose, learn) => [
    { role: 'judge', label: 'reading messages', calls: judge, hedges: judge && 2, retries: judge && 1 },
    { role: 'compose', label: 'writing replies', calls: compose, hedges: compose && 1, retries: 0 },
    { role: 'learn', label: 'reading history', calls: learn, hedges: 0, retries: 0 }];
  assert.deepEqual(calls(s), { total: 40, limit: 40, by: by(30, 6, 0), unsorted: 4 });
  assert.deepEqual(calls({ ...s, status: { ...s.status, budget: { day: '2026-10-27', calls: 12 } } }), { total: 0, limit: 40, by: by(0, 0, 0), unsorted: 0 });
  assert.deepEqual(calls({ ...s, spent: {} }).unsorted, 40);
});
test('the strip says how the link is, what the day cost and what the bot did', () => {
  assert.deepEqual(strip(s), {
    name: 'P', paused: false,
    link: { state: 'up', error: null, up: 600000, drops: 3, reason: 'close-1006' },
    calls: calls(s),
    today: { since: Date.UTC(2026, 9, 28), replies: 1, unanswered: 3, learned: 1, read: 7, speed: { median: 1400, p90: 1400, n: 1 } },
  });
  assert.equal(strip({ ...s, status: { ...s.status, paused: true } }).link.state, 'paused');
  assert.equal(strip({ ...s, status: { ...s.status, connected: false, error: 'apron-auth-denied' } }).link.state, 'down');
});
test('the nav badges each room with its unanswered mentions today and marks the current tab', () => {
  assert.deepEqual(tabs(s, { view: 'room', room: 'builds' }), [
    { view: 'now', label: 'now', href: '/', current: false },
    { view: 'room', room: 'general', label: '#general', badge: 2, href: '/?view=room&room=general', current: false },
    { view: 'room', room: 'builds', label: '#builds', badge: 1, href: '/?view=room&room=builds', current: true },
    { view: 'bot', label: 'the bot', href: '/?view=bot', current: false },
    { view: 'plumbing', label: 'plumbing', end: true, href: '/?view=plumbing', current: false },
  ]);
  const tomorrow = { ...s, now: t + 86400000 };
  assert.deepEqual(tabs(tomorrow, { view: 'now' }).map(x => [x.badge, x.current]), [[undefined, true], [0, false], [0, false], [undefined, false], [undefined, false]]);
});
test('needs you groups each room\'s unanswered mentions with their reasons, then the redraft, the link, refused writes and the budget', () => {
  const learning = { stage: 'ready', host: 'h', rooms: ['general'], count: 500, failed: 1, detail: 'timeout', persona: 'x', vector: [1, 0, .5, .5] };
  assert.deepEqual(needs({ ...s, learning }), [
    { group: 'room', tone: 'bad', href: '/?view=room&room=general', text: '2 mentions in #general got no answer', misses: [{ who: 'theo', at: at(49), why: 'below the bar' }, { who: 'kofi', at: at(15), why: 'model failed' }] },
    { group: 'room', tone: 'warn', href: '/?view=room&room=builds', text: '1 mention in #builds got no answer', misses: [{ who: 'mei', at: at(48), why: 'out of calls' }] },
    { group: 'persona', tone: 'ok', href: '/?view=bot#persona', text: 'a redraft from 500 messages in #general on h is ready to review', why: '1 of my readings failed (timeout), so it leans on the rest.' },
    { group: 'link', tone: 'warn', href: '/?view=plumbing', text: 'the link dropped 3 times in the last hour (close-1006)', why: 'up again for 10 min.' },
    { group: 'disk', tone: 'bad', href: '/?view=plumbing', text: "I couldn't save state.json", at: at(12), why: 'refused 1 time. I carry on and try again.' },
    { group: 'budget', tone: 'warn', href: '/?view=plumbing', text: "I've spent all 40 calls for today", why: '30 reading messages, 6 writing replies. resets at 00:00 UTC.' },
  ]);
  const down = needs({ ...s, events: [], learning: { stage: 'failed', host: 'h', rooms: ['a', 'b'], detail: 'history-closed' }, status: { ...s.status, connected: false, error: 'apron-auth-denied', budget: { day: '2026-10-28', calls: 3 } } });
  assert.deepEqual(down, [
    { group: 'persona', tone: 'bad', href: '/?view=bot#persona', text: "I couldn't redraft from history in #a and #b on h", why: 'history-closed' },
    { group: 'link', tone: 'bad', href: '/?view=plumbing', text: "I'm not connected (apron-auth-denied)", why: '' },
  ]);
  assert.deepEqual(needs({ ...s, events: [], limit: '0', status: { ...s.status, budget: { day: '', calls: 0 } } }), [{ group: 'budget', tone: 'warn', href: '/?view=plumbing', text: 'DAILY_CALLS is 0, so I make no calls today', why: '' }]);
  assert.deepEqual(needs({ ...s, events: [], status: { ...s.status, budget: { day: '', calls: 0 } } }), []);
});
test('now has a card per room with its latest decisions, and with one room only the needs and the bot', () => {
  const view = now(s);
  assert.deepEqual(view.cards.map(c => [c.id, c.notes, c.read, c.last, c.rows.map(r => r.message_id)]), [
    ['general', 'In #general lately: mostly code. Norms: be kind', 6, 480000, ['m49', 'm20', 'p1', 'm15']],
    ['builds', '', 1, 2880000, ['m48']],
  ]);
  assert.deepEqual(view.bot, { persona: 'You are P.', personality: s.status.personality, drift: 'This room has made me warmer and more matter-of-fact than where I started (the tick at 0.5).', triggers: 'I answer mentions and replies at 0.70. I never chime in.' });
  const one = now({ ...s, rooms: ['general'] });
  assert.deepEqual(one.cards, []);
  assert.deepEqual(one.needs.map(n => n.text), ['2 mentions in #general got no answer', 'the link dropped 3 times in the last hour (close-1006)', "I couldn't save state.json", "I've spent all 40 calls for today"]);
  assert.equal(now({ ...s, settings: { ...s.settings, reply_mentions: false, organic: true } }).bot.triggers, 'I answer replies to me at 0.70. I chime in at 0.90.');
});
test('a room page folds quiet runs, holds only its own posts, and keeps churn out', () => {
  const view = room(s, 'general');
  assert.deepEqual(view.rows.map(r => r.kind === 'fold' ? `fold of ${r.rows.length}, ${r.learned} learned` : r.message_id ?? r.text), ['m50', 'm49', 'back after 856 min offline. anything said then I missed.', 'm20', 'p1', 'm15', 'fold of 2, 0 learned']);
  assert.deepEqual(view.rows.filter(r => r.kind === 'message').map(r => r.who), ['ben', 'theo', 'ana', 'kofi']);
  assert.deepEqual([view.notes, view.norms, view.posts], ['In #general lately: mostly code. Norms: be kind', 'be kind', { error: null, list: [{ message_id: 'p1', at: at(19), text: 'yo' }] }]);
  assert.deepEqual(room({ ...s, posts: { error: 'not-connected' } }, 'builds').posts, { error: 'not-connected', list: [] });
});
test('how I think lists the gate, then each prompt part as it is sent, for the chosen room', () => {
  const view = bot({ ...s, settings: { ...s.settings, organic: true } }, 'general');
  assert.deepEqual(view.sections.map(x => [x.id, x.part, x.title]), [
    ['answer', 'gate', 'do I answer when asked?'], ['chime', 'gate', 'do I speak up unprompted?'], ['persona', 'prompt', 'who I am'], ['traits', 'prompt', 'what the room made me'],
    ['room', 'prompt', 'what I know about the room'], ['rules', 'prompt', 'the fixed rules'], ['lines', 'prompt', 'the last lines']]);
  const [answer, chimes, persona, traits, notes, rules, lines] = view.sections;
  assert.deepEqual([answer.settings, answer.today], [{ reply_mentions: true, reply_replies: true, reply_threshold: .7 }, { answered: 1, not: 3 }]);
  assert.deepEqual([chimes.settings, chimes.today], [{ organic: true, organic_threshold: .9 }, { chimed: 0, held: 0 }]);
  assert.deepEqual([persona.persona, persona.sent, persona.lesson], ['You are {name}.', 'You are P.', null]);
  assert.equal(traits.sent, "Match the room's temperament: it runs a little warmer than a typical chat.");
  assert.deepEqual([notes.sent, notes.norms], ['In #general lately: mostly code. Norms: be kind', 'be kind']);
  assert.equal(rules.sent, guardrails);
  assert.deepEqual([lines.sent, lines.chime], [`ana: what they said\nyou: what I said\n\n${cue}`, `ana: what they said\nyou: what I said\n\n${chime}`]);
  assert.equal(lines.why, 'then, as its own message, up to the last 20 messages of the room\'s history, oldest first, mine as "you". if history takes over 3s, the last 8 I saw myself.');
  assert.equal(bot(s, 'builds').sections[4].sent, '');
});
test('plumbing logs connects, drops and errors newest first, and lists what was ignored elsewhere', () => {
  const view = plumbing(s);
  assert.deepEqual(view.link, { state: 'up', error: null, up: 600000, drops: 3, reason: 'close-1006', url: 'wss://h/', user: 'bot_me', avatar: 'https://h/a.png', latency: 45, lastError: s.lastError });
  assert.deepEqual(view.log.map(l => [l.at, l.tone, l.text]), [
    [at(10), undefined, 'connected to h as bot_me'], [at(11), 'warn', 'lost the server (close-1006)'], [at(12), 'bad', 'error: state-refused'],
    [at(29), undefined, 'connected to h as bot_me'], [at(30), 'warn', 'lost the server (error)'], [at(44), undefined, 'connected to h as bot_me'],
    [at(45), 'warn', 'lost the server (close-1006)'], [at(900), 'warn', 'lost the server (close-1006)']]);
  assert.deepEqual(view.elsewhere.map(r => [r.who, r.room, r.margin]), [['zed', 'nowhere', 'not a room I watch.']]);
  assert.deepEqual([view.server, view.you, view.speed], [{ agent: 'a/9' }, { user_id: 'bot_me', avatar: 'https://h/a.png' }, { median: 1400, p90: 1400, n: 1 }]);
});
