import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { transcript, fold, today } from '../src/transcript.js';
import { margins, outcomes } from '../src/events.js';
const msg = (at, outcome, extra = {}) => ({ at, kind: 'message', room: 'general', message_id: `m${at}`, from: 'u_ben', name: 'ben', outcome, ...extra });
const events = [
  { at: 1, kind: 'connected', host: 'h', user_id: 'bot_me' },
  msg(2, 'replied', { name: 'ana', addressed: 'mention', text: '@bot morning!', learn_p: .9, reply_p: .97, style: [.75, .5, .5, .5] }),
  { at: 3, kind: 'posted', room: 'general', message_id: 'p3', reply_to: 'm2', text: 'Morning!' },
  msg(4, 'own', { from: 'bot_me', message_id: 'p3' }),
  msg(5, 'learned-only', { learn_p: .91, reply_p: .1, style: [.5, .75, .5, .25] }),
  msg(6, 'learned-only', { learn_p: .42, reply_p: .1 }),
  msg(7, 'rate-limited'),
  msg(8, 'duplicate'),
  msg(9, 'declined', { name: 'ana', addressed: 'mention', text: '@bot summarize?', learn_p: .2, reply_p: .42, need: .75 }),
  msg(11, 'budget', { addressed: 'mention', text: '@bot hi' }),
  msg(12, 'classify-failed', { addressed: 'mention', text: '@bot one', detail: 'inference-500' }),
  msg(13, 'reply-empty', { addressed: 'mention', text: '@bot two', learn_p: .9, reply_p: .9 }),
  msg(14, 'reply-failed', { name: 'lin', addressed: 'mention', text: '@bot tabs?', learn_p: .9, reply_p: .9, detail: 'inference-502' }),
  { at: 15, kind: 'disconnected', reason: 'close-1006' },
  msg(16, 'stale'),
  msg(17, 'busy', { addressed: 'mention', text: '@bot five' }),
  msg(18, 'paused', { name: undefined }),
  msg(19, 'deleted'),
  msg(20, 'empty'),
  msg(21, 'other-room', { room: 'random' }),
  msg(22, 'from-bot', { from: '~notice', name: 'Room notice', addressed: 'mention', text: 'hello @bot' }),
  { at: 23, kind: 'settings', keys: ['persona', 'paused'], paused: true },
  { at: 24, kind: 'deleted', room: 'general', message_id: 'p3' },
  { at: 25, kind: 'auth-denied' },
  { at: 26, kind: 'error', code: 'apron-auth-denied' },
  { at: 27, kind: 'posted', room: 'general', message_id: 'p27', reply_to: 'gone', text: 'hi' },
  msg(28, 'trigger-off', { addressed: 'mention', text: '@bot hey' }),
  msg(29, 'trigger-off', { addressed: 'reply', text: 'what do you mean' }),
  msg(30, 'held-back', { learn_p: .9, reply_p: .71, style: [.5, .5, .5, .5], need: .9 }),
  msg(31, 'chimed-in', { text: 'anyone tried the new ramen place', learn_p: .9, reply_p: .93 }),
  { at: 32, kind: 'posted', room: 'general', message_id: 'p32', organic: true, text: 'the broth is the whole point' },
  msg(33, 'spoke-last', { learn_p: .9, reply_p: .95, point_p: .95 }),
  msg(34, 'superseded', { name: 'ana', addressed: 'mention', text: '@bot wait', learn_p: .9, reply_p: .9 }),
  { at: 36, kind: 'settings', keys: ['organic', 'reply_threshold', 'reply_mentions', 'reply_replies', 'organic_threshold'], organic: true, reply_threshold: .75, reply_mentions: false, reply_replies: true, organic_threshold: .95 },
  { at: 37, kind: 'settings', keys: ['organic', 'reply_mentions', 'reply_replies'], organic: false, reply_mentions: true, reply_replies: false },
];
const row = (at, outcome, who, margin, extra = {}) => ({ kind: 'message', at, message_id: `m${at}`, who, text: undefined, tone: undefined, quiet: false, learned: false, unanswered: false, outcome, margin, ...extra });
const quiet = (at, outcome, who, margin, extra) => row(at, outcome, who, margin, { quiet: true, ...extra });
const said = (at, outcome, who, text, margin, tone, extra) => row(at, outcome, who, margin, { text, tone, unanswered: tone !== 'ok', ...extra });
test('the view model turns events into each room\'s rows with a margin per outcome, and leaves connecting and dropping out', () => {
  const rows = [
    said(2, 'replied', 'ana', '@bot morning!', 'answered. I was 0.97 sure a reply fit.', 'ok', { learned: true }),
    { kind: 'post', at: 3, room: 'general', message_id: 'p3', text: 'Morning!', deleted: true, margin: 'I deleted this.' },
    quiet(5, 'learned-only', 'ben', 'learned. a little more playful. (0.91)', { learned: true }),
    quiet(6, 'learned-only', 'ben', "didn't learn. learn chance 0.42, I need 0.80."),
    quiet(7, 'rate-limited', 'ben', 'already learned from ben in the last 5 min.'),
    quiet(8, 'duplicate', 'ben', "I'd seen this exact text already."),
    said(9, 'declined', 'ana', '@bot summarize?', "didn't answer. reply chance 0.42, I need 0.75.", 'warn'),
    said(11, 'budget', 'ben', '@bot hi', "I'm out of calls for today, so I let it pass.", 'warn'),
    said(12, 'classify-failed', 'ben', '@bot one', "I couldn't size it up. the model call failed (inference-500).", 'bad'),
    said(13, 'reply-empty', 'ben', '@bot two', 'the model returned nothing, so I stayed quiet.', 'bad'),
    said(14, 'reply-failed', 'lin', '@bot tabs?', 'I tried, but the model call failed (inference-502).', 'bad'),
    quiet(16, 'stale', 'ben', 'the connection changed before I got to it.'),
    said(17, 'busy', 'ben', '@bot five', 'four messages were already waiting, so I dropped this one.', 'warn'),
    quiet(18, 'paused', 'u_ben', "I'm paused, so I didn't read it."),
    quiet(19, 'deleted', 'ben', 'a deletion. nothing to read.'),
    quiet(20, 'empty', 'ben', 'no text to read.'),
    { kind: 'break', at: 23, text: 'you rewrote who I am, you paused me' },
    { kind: 'post', at: 27, room: 'general', message_id: 'p27', text: 'hi', deleted: false, margin: 'my reply.' },
    said(28, 'trigger-off', 'ben', '@bot hey', "you've turned off answering mentions, so I let it be."),
    said(29, 'trigger-off', 'ben', 'what do you mean', "you've turned off answering replies to me, so I let it be."),
    quiet(30, 'held-back', 'ben', 'could have chimed in (0.71), but I hold out for 0.90.', { learned: true }),
    said(31, 'chimed-in', 'ben', 'anyone tried the new ramen place', "chimed in unprompted. I was 0.93 sure it'd be welcome.", 'ok'),
    { kind: 'post', at: 32, room: 'general', message_id: 'p32', text: 'the broth is the whole point', deleted: false, margin: 'something I chimed in with.' },
    row(33, 'spoke-last', 'ben', "I'd just said something here, so I let others talk."),
    { ...said(34, 'superseded', 'ana', '@bot wait', 'you kept going, so I answered your latest.'), unanswered: false },
    { kind: 'break', at: 36, text: 'you let me chime in on my own, you set my reply bar to 0.75, you stopped me answering mentions, you let me answer replies to me, you set my chime-in bar to 0.95' },
    { kind: 'break', at: 37, text: 'you stopped me chiming in, you let me answer mentions, you stopped me answering replies to me' },
  ];
  assert.deepEqual(transcript(events, ['general', 'quiet']), {
    rooms: [{ id: 'general', rows }, { id: 'quiet', rows: rows.filter(r => r.kind === 'break') }],
    elsewhere: [
      { ...row(21, 'other-room', 'ben', 'not a room I watch.'), room: 'random' },
      { ...row(22, 'from-bot', 'Room notice', 'from a bot or a notice, so I let it be.', { text: 'hello @bot' }), room: 'general' },
    ],
  });
});
test('a span offline long enough to miss messages is one break in every room, and a short one is none', () => {
  const t = Date.UTC(2026, 9, 28, 11, 40);
  const churn = [{ at: t, kind: 'disconnected', reason: 'close-1006' }, { at: t + 1000, kind: 'disconnected', reason: 'error' }, { at: t + 240000, kind: 'connected', host: 'h', user_id: 'bot_me' },
    { at: t + 300000, kind: 'disconnected', reason: 'close-1006' }, { at: t + 330000, kind: 'connected', host: 'h', user_id: 'bot_me' }, { at: t + 340000, kind: 'auth-denied' }, { at: t + 350000, kind: 'error', code: 'apron-auth-denied' }];
  const gap = { kind: 'break', at: t + 240000, tone: 'warn', text: 'offline 11:40 to 11:44. anything said then I missed.' };
  assert.deepEqual(transcript(churn, ['general', 'builds']).rooms, [{ id: 'general', rows: [gap] }, { id: 'builds', rows: [gap] }]);
});
test('runs of quiet rows fold into one, which counts what was learned; rows with text, posts and breaks stay', () => {
  const rows = transcript(events, ['general']).rooms[0].rows, folded = fold(rows);
  const at = r => r.kind === 'fold' ? `fold ${r.from}-${r.at} of ${r.rows.length}, ${r.learned} learned` : r.at;
  assert.deepEqual(folded.map(at), [2, 3, 'fold 5-8 of 4, 1 learned', 9, 11, 12, 13, 14, 16, 17, 'fold 18-20 of 3, 0 learned', 23, 27, 28, 29, 30, 31, 32, 33, 34, 36, 37]);
  assert.deepEqual(folded[2].rows, rows.slice(2, 6));
  assert.deepEqual(fold([]), []);
});
test('every outcome has a margin, and a learned style names its strongest lean', () => {
  assert.deepEqual(Object.keys(margins), Object.keys(outcomes));
  const learned = style => margins['learned-only'].say({ learn_p: .8, style });
  assert.equal(learned([.75, .5, .5, .5]), 'learned. a little warmer. (0.80)');
  assert.equal(learned([.5, .5, .5, 0]), 'learned. a little terser. (0.80)');
  assert.equal(learned([.5, .5, .5, .5]), 'learned. no lean either way. (0.80)');
  assert.equal(margins['nothing-to-add'].say({ reply_p: .95, point_p: .42, need: .9 }), 'could have chimed in, but I had nothing specific to add (0.42).');
  assert.equal(outcomes['nothing-to-add'], 'Not addressed; nothing specific to add');
});
test('a post deleted later loses its delete, and a message that did not engage the bot has no text', () => {
  const [general] = transcript(events, ['general']).rooms;
  const engaged = new Set(events.filter(e => e.addressed || e.outcome === 'chimed-in').map(e => e.message_id));
  assert.deepEqual(general.rows.filter(r => r.kind === 'message' && !engaged.has(r.message_id) && r.text !== undefined), []);
  assert.equal(general.rows.filter(r => r.message_id === 'p3').length, 1);
});
test('today counts replies, unanswered mentions and things learned since midnight UTC', () => {
  const day = Date.UTC(2026, 9, 28), at = n => day + n;
  const shifted = [{ ...events[1], at: day - 1 }, ...events.slice(2).map(e => ({ ...e, at: at(e.at) }))];
  assert.deepEqual(today(shifted, at(100)), { since: day, replies: 3, unanswered: 8, learned: 2, read: 20, speed: null });
  assert.deepEqual(today(shifted.slice(2), at(100)), { since: at(4), replies: 2, unanswered: 8, learned: 2, read: 20, speed: null });
  assert.deepEqual(today([], at(100)), { since: at(100), replies: 0, unanswered: 0, learned: 0, read: 0, speed: null });
});
test('a reply with spans says how long it took, carries the breakdown as a tooltip, and feeds the day\'s median and p90', () => {
  const spans = { ms: { context: 310, judge: 640, compose: 920, post: 80, total: 1400 }, via: { judge: 'cohere/north-mini-code', compose: 'openrouter/free' }, hedged: ['compose'] };
  const answered = [
    msg(2, 'replied', { name: 'ana', addressed: 'mention', text: '@bot morning!', learn_p: .9, reply_p: .97, ...spans }),
    msg(3, 'chimed-in', { text: 'ramen?', learn_p: .9, reply_p: .93, ms: { judge: 500, context: 200, compose: 1800, post: 100, total: 2600 }, via: { judge: 'x', compose: 'y' } }),
    msg(4, 'replied', { addressed: 'mention', text: '@bot again', detail: 'timeout', ms: { context: 200, compose: 700, post: 100, total: 11000 }, via: { compose: 'y' } }),
    msg(5, 'declined', { addressed: 'mention', text: '@bot no', learn_p: .9, reply_p: .2, need: .7, ms: { context: 200, judge: 500, total: 520 } }),
  ];
  const rows = transcript(answered, ['general']).rooms[0].rows;
  assert.deepEqual(rows.map(r => [r.margin, r.title]), [
    ['answered in 1.4s. I was 0.97 sure a reply fit.', 'context 0.3s · judge 0.6s · compose 0.9s · post 0.1s · judge by cohere/north-mini-code · compose by openrouter/free, hedged'],
    ["chimed in unprompted in 2.6s. I was 0.93 sure it'd be welcome.", 'context 0.2s · judge 0.5s · compose 1.8s · post 0.1s · judge by x · compose by y'],
    ["answered in 11.0s, though I couldn't size it up first (timeout).", 'context 0.2s · compose 0.7s · post 0.1s · compose by y'],
    ["didn't answer. reply chance 0.20, I need 0.70.", undefined],
  ]);
  assert.ok(!Object.hasOwn(rows[3], 'title'));
  const day = Date.UTC(2026, 9, 28);
  assert.deepEqual(today(answered.map(e => ({ ...e, at: day + e.at })), day + 100).speed, { median: 2600, p90: 11000, n: 3 });
  const ten = Array.from({ length: 10 }, (_, i) => msg(10 + i, 'replied', { addressed: 'mention', text: 'x', reply_p: .9, ms: { total: (i + 1) * 100 } }));
  assert.deepEqual(today(ten.map(e => ({ ...e, at: day + e.at })), day + 100).speed, { median: 500, p90: 900, n: 10 });
});
