import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { topic, tally, roll, empty } from '../src/memory.js';
import { decision } from '../src/core.js';
test('a topic is one label from the fixed taxonomy, and anything else is other', () => {
  assert.deepEqual(['code', ' Deploys ', 'AI', 'banter', 'meta', 'other'].map(topic), ['code', 'deploys', 'ai', 'banter', 'meta', 'other']);
  assert.deepEqual(['kubernetes', 'carol', '', 'code review', 42, null, undefined, ['code']].map(topic), Array(8).fill('other'));
  const reply = t => ({ choices: [{ message: { content: JSON.stringify({ learn: .9, reply: .1, point: .2, topic: t, warmth: 'balanced', playfulness: 'balanced', curiosity: 'balanced', expressiveness: 'balanced' }) } }] });
  assert.equal(decision(reply('food')).topic, 'food');
  assert.equal(decision(reply('Dinner with Carol')).topic, 'other');
  assert.equal(decision(reply(undefined)).topic, 'other');
});
test('a tally counts a message by room, day and topic, and sums how far a learned style leans', () => {
  const m = empty();
  tally(m, 'general', '2026-10-29', { topic: 'code', engaged: false, outcome: 'learned-only', style: [.75, .5, .25, 1] });
  tally(m, 'general', '2026-10-29', { topic: 'code', engaged: true, outcome: 'replied' });
  tally(m, 'general', '2026-10-29', { topic: 'banter', engaged: false, outcome: 'chimed-in', style: [1, 0, .5, .5] });
  tally(m, 'random', '2026-10-28', { topic: 'other', engaged: true, outcome: 'declined' });
  assert.deepEqual(m, { rooms: {
    general: { days: { '2026-10-29': { topics: { code: { messages: 2, engaged: 1, replies: 1, chimes: 0 }, banter: { messages: 1, engaged: 0, replies: 0, chimes: 1 } }, learned: 2, lean: [.75, -.5, -.25, .5] } }, weeks: {} },
    random: { days: { '2026-10-28': { topics: { other: { messages: 1, engaged: 1, replies: 0, chimes: 0 } }, learned: 0, lean: [0, 0, 0, 0] } }, weeks: {} },
  } });
});
const day = (messages, learned = 0, lean = [0, 0, 0, 0]) => ({ topics: { code: { messages, engaged: 0, replies: 0, chimes: 0 } }, learned, lean });
test('roll keeps 14 days and today, folds older days into Monday weeks, drops weeks past 12, and is idempotent', () => {
  const m = { rooms: {
    general: {
      days: { '2026-10-29': day(1), '2026-10-15': day(2), '2026-10-14': day(3, 1, [.25, 0, 0, 0]), '2026-10-13': day(4, 1, [.5, 0, 0, 0]), '2026-08-02': day(5) },
      weeks: { '2026-10-12': day(10), '2026-08-03': day(6), '2026-07-27': day(7) },
    },
    old: { days: {}, weeks: { '2026-07-20': day(8) } },
  } };
  const once = structuredClone(roll(m, '2026-10-29'));
  assert.deepEqual(once, { rooms: { general: {
    days: { '2026-10-29': day(1), '2026-10-15': day(2) },
    weeks: { '2026-10-12': day(17, 2, [.75, 0, 0, 0]), '2026-08-03': day(6) },
  } } });
  assert.deepEqual(roll(m, '2026-10-29'), once);
  assert.deepEqual(roll(m, '2026-10-30'), { rooms: { general: { days: { '2026-10-29': day(1) }, weeks: { '2026-10-12': day(19, 2, [.75, 0, 0, 0]), '2026-08-03': day(6) } } } });
  assert.deepEqual(roll(m, '2026-11-02'), { rooms: { general: { days: { '2026-10-29': day(1) }, weeks: { '2026-10-12': day(19, 2, [.75, 0, 0, 0]) } } } });
  assert.deepEqual(roll(m, '2027-03-01'), { rooms: {} });
});
