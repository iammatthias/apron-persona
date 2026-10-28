import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { transcript, today } from '../src/transcript.js';
import { margins, outcomes } from '../src/events.js';
const msg = (at, outcome, extra = {}) => ({ at, kind: 'message', room: 'general', message_id: `m${at}`, from: 'u_ben', name: 'ben', mentioned: false, outcome, ...extra });
const events = [
  { at: 1, kind: 'connected', host: 'h', user_id: 'bot_me' },
  msg(2, 'replied', { name: 'ana', mentioned: true, text: '@bot morning!', learn_p: .9, reply_p: .97, style: [.75, .5, .5, .5] }),
  { at: 3, kind: 'posted', room: 'general', message_id: 'p3', reply_to: 'm2', text: 'Morning!' },
  msg(4, 'own', { from: 'bot_me', message_id: 'p3' }),
  msg(5, 'learned-only', { learn_p: .91, reply_p: .1, style: [.5, .75, .5, .25] }),
  msg(6, 'learned-only', { learn_p: .42, reply_p: .1 }),
  msg(7, 'rate-limited'),
  msg(8, 'duplicate'),
  msg(9, 'declined', { name: 'ana', mentioned: true, text: '@bot summarize?', learn_p: .2, reply_p: .42 }),
  msg(10, 'cooldown', { mentioned: true, text: 'again @bot', learn_p: .9, reply_p: .9 }),
  msg(11, 'budget', { mentioned: true, text: '@bot hi' }),
  msg(12, 'classify-failed', { mentioned: true, text: '@bot one', detail: 'inference-500' }),
  msg(13, 'reply-empty', { mentioned: true, text: '@bot two', learn_p: .9, reply_p: .9 }),
  msg(14, 'reply-failed', { name: 'lin', mentioned: true, text: '@bot tabs?', learn_p: .9, reply_p: .9, detail: 'inference-502' }),
  { at: 15, kind: 'disconnected', reason: 'close-1006' },
  msg(16, 'stale'),
  msg(17, 'busy', { mentioned: true, text: '@bot five' }),
  msg(18, 'paused', { name: undefined }),
  msg(19, 'deleted'),
  msg(20, 'empty'),
  msg(21, 'other-room', { room: 'random' }),
  msg(22, 'from-bot', { from: '~notice', name: 'Room notice', mentioned: true, text: 'hello @bot' }),
  { at: 23, kind: 'settings', keys: ['persona', 'paused'], paused: true },
  { at: 24, kind: 'deleted', room: 'general', message_id: 'p3' },
  { at: 25, kind: 'auth-denied' },
  { at: 26, kind: 'error', code: 'apron-auth-denied' },
  { at: 27, kind: 'posted', room: 'general', message_id: 'p27', reply_to: 'gone', text: 'hi' },
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
    said(9, 'ana', '@bot summarize?', "didn't answer. reply chance 0.42, I need 0.70.", 'warn'),
    said(10, 'ben', 'again @bot', "didn't answer. I'd replied under 15 seconds before.", 'warn'),
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
  ];
  const breaksOnly = rows.filter(r => r.kind === 'break');
  assert.deepEqual(transcript(events, ['general', 'quiet']), {
    rooms: [{ id: 'general', rows, unanswered: 7 }, { id: 'quiet', rows: breaksOnly, unanswered: 0 }],
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
});
test('a post deleted later loses its delete, and a message that did not engage the bot has no text', () => {
  const [general] = transcript(events, ['general']).rooms;
  assert.ok(general.rows.filter(r => r.kind === 'message' && !r.text).every(r => r.tone === undefined));
  assert.equal(general.rows.filter(r => r.message_id === 'p3').length, 1);
});
test('today counts replies, unanswered mentions and things learned since midnight UTC', () => {
  const day = Date.UTC(2026, 9, 28), at = n => day + n;
  const shifted = [{ ...events[1], at: day - 1 }, ...events.slice(2).map(e => ({ ...e, at: at(e.at) }))];
  assert.deepEqual(today(shifted, at(100)), { since: day, replies: 2, unanswered: 7, learned: 1 });
  assert.deepEqual(today(shifted.slice(2), at(100)), { since: at(4), replies: 1, unanswered: 7, learned: 1 });
  assert.deepEqual(today([], at(100)), { since: at(100), replies: 0, unanswered: 0, learned: 0 });
});
