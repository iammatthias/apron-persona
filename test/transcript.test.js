import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { transcript, today } from '../src/transcript.js';
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
  msg(10, 'cooldown', { addressed: 'mention', text: 'again @bot', learn_p: .9, reply_p: .9, wait: 15 }),
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
  msg(33, 'quiet-gap', { learn_p: .9, reply_p: .95, ago: 720000 }),
  msg(34, 'quiet-gap', { learn_p: .9, reply_p: .95, ago: 20000 }),
  msg(35, 'cooldown', { learn_p: .9, reply_p: .95, wait: 1 }),
  { at: 36, kind: 'settings', keys: ['organic', 'reply_threshold', 'cooldown', 'organic_gap', 'reply_mentions', 'reply_replies', 'organic_threshold'], organic: true, reply_threshold: .75, cooldown: 30, organic_gap: 60, reply_mentions: false, reply_replies: true, organic_threshold: .95 },
  { at: 37, kind: 'settings', keys: ['organic', 'reply_mentions', 'reply_replies'], organic: false, reply_mentions: true, reply_replies: false },
];
const quiet = (at, who, margin, tone) => ({ kind: 'message', at, message_id: `m${at}`, who, text: undefined, tone, unanswered: false, margin });
test('the view model turns events into each room\'s rows with a margin per outcome', () => {
  const said = (at, who, text, margin, tone) => ({ kind: 'message', at, message_id: `m${at}`, who, text, tone, unanswered: tone !== 'ok', margin });
  const rows = [
    { kind: 'break', at: 1, text: 'connected to h as bot_me' },
    { ...said(2, 'ana', '@bot morning!', 'answered. I was 0.97 sure a reply fit.', 'ok'), unanswered: false },
    { kind: 'post', at: 3, room: 'general', message_id: 'p3', text: 'Morning!', deleted: true, margin: 'I deleted this.' },
    quiet(5, 'ben', 'learned. a little more playful. (0.91)'),
    quiet(6, 'ben', "didn't learn. learn chance 0.42, I need 0.80."),
    quiet(7, 'ben', 'already learned from ben in the last 5 min.'),
    quiet(8, 'ben', "I'd seen this exact text already."),
    said(9, 'ana', '@bot summarize?', "didn't answer. reply chance 0.42, I need 0.75.", 'warn'),
    said(10, 'ben', 'again @bot', "didn't answer. I'd posted under 15 seconds before.", 'warn'),
    said(11, 'ben', '@bot hi', "I'm out of calls for today, so I let it pass.", 'warn'),
    said(12, 'ben', '@bot one', "I couldn't size it up. the model call failed (inference-500).", 'bad'),
    said(13, 'ben', '@bot two', 'the model returned nothing, so I stayed quiet.', 'bad'),
    said(14, 'lin', '@bot tabs?', 'I tried, but the model call failed (inference-502).', 'bad'),
    { kind: 'break', at: 15, text: 'lost the server (close-1006)' },
    quiet(16, 'ben', 'the connection changed before I got to it.'),
    said(17, 'ben', '@bot five', 'four messages were already waiting, so I dropped this one.', 'warn'),
    quiet(18, 'u_ben', "I'm paused, so I didn't read it."),
    quiet(19, 'ben', 'a deletion. nothing to read.'),
    quiet(20, 'ben', 'no text to read.'),
    { kind: 'break', at: 23, text: 'you rewrote who I am, you paused me' },
    { kind: 'break', at: 25, text: 'the server refused my token' },
    { kind: 'break', at: 26, text: 'error: apron-auth-denied' },
    { kind: 'post', at: 27, room: 'general', message_id: 'p27', text: 'hi', deleted: false, margin: 'my reply.' },
    said(28, 'ben', '@bot hey', "you've turned off answering mentions, so I let it be."),
    said(29, 'ben', 'what do you mean', "you've turned off answering replies to me, so I let it be."),
    quiet(30, 'ben', 'could have chimed in (0.71), but I hold out for 0.90.'),
    { ...said(31, 'ben', 'anyone tried the new ramen place', "chimed in unprompted. I was 0.93 sure it'd be welcome.", 'ok'), unanswered: false },
    { kind: 'post', at: 32, room: 'general', message_id: 'p32', text: 'the broth is the whole point', deleted: false, margin: 'something I chimed in with.' },
    quiet(33, 'ben', 'would have chimed in, but I spoke up here 12 min ago.'),
    quiet(34, 'ben', 'would have chimed in, but I spoke up here under a minute ago.'),
    quiet(35, 'ben', "would have chimed in. I'd posted under 1 second before.", 'warn'),
    { kind: 'break', at: 36, text: 'you let me chime in on my own, you set my reply bar to 0.75, you set my cooldown to 30 seconds, you set my chime-in gap to 60 min, you stopped me answering mentions, you let me answer replies to me, you set my chime-in bar to 0.95' },
    { kind: 'break', at: 37, text: 'you stopped me chiming in, you let me answer mentions, you stopped me answering replies to me' },
  ];
  const breaksOnly = rows.filter(r => r.kind === 'break');
  assert.deepEqual(transcript(events, ['general', 'quiet']), {
    rooms: [{ id: 'general', rows, unanswered: 9 }, { id: 'quiet', rows: breaksOnly, unanswered: 0 }],
    elsewhere: [
      { ...quiet(21, 'ben', 'not a room I watch.'), room: 'random' },
      { kind: 'message', at: 22, message_id: 'm22', who: 'Room notice', text: 'hello @bot', tone: undefined, unanswered: false, margin: 'from a bot or a notice, so I let it be.', room: 'general' },
    ],
  });
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
  assert.deepEqual(today(shifted, at(100)), { since: day, replies: 3, unanswered: 9, learned: 2, speed: null });
  assert.deepEqual(today(shifted.slice(2), at(100)), { since: at(4), replies: 2, unanswered: 9, learned: 2, speed: null });
  assert.deepEqual(today([], at(100)), { since: at(100), replies: 0, unanswered: 0, learned: 0, speed: null });
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
