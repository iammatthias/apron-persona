import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tally, roll, empty, digest, onepager } from '../src/memory.js';
import { decision, topic } from '../src/core.js';
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
  }, pages: {} });
});
const day = (messages, learned = 0, lean = [0, 0, 0, 0]) => ({ topics: { code: { messages, engaged: 0, replies: 0, chimes: 0 } }, learned, lean });
test('roll keeps 14 days and today, folds older days into Monday weeks, drops weeks past 12, and is idempotent', () => {
  const m = { rooms: {
    general: {
      days: { '2026-10-29': day(1), '2026-10-15': day(2), '2026-10-14': day(3, 1, [.25, 0, 0, 0]), '2026-10-13': day(4, 1, [.5, 0, 0, 0]), '2026-08-02': day(5) },
      weeks: { '2026-10-12': day(10), '2026-08-03': day(6), '2026-07-27': day(7) },
    },
    old: { days: {}, weeks: { '2026-07-20': day(8) } },
  }, pages: {} };
  const once = structuredClone(roll(m, '2026-10-29'));
  assert.deepEqual(once, { rooms: { general: {
    days: { '2026-10-29': day(1), '2026-10-15': day(2) },
    weeks: { '2026-10-12': day(17, 2, [.75, 0, 0, 0]), '2026-08-03': day(6) },
  } }, pages: {} });
  assert.deepEqual(roll(m, '2026-10-29'), once);
  assert.deepEqual(roll(m, '2026-10-30'), { rooms: { general: { days: { '2026-10-29': day(1) }, weeks: { '2026-10-12': day(19, 2, [.75, 0, 0, 0]), '2026-08-03': day(6) } } }, pages: {} });
  assert.deepEqual(roll(m, '2026-11-02'), { rooms: { general: { days: { '2026-10-29': day(1) }, weeks: { '2026-10-12': day(19, 2, [.75, 0, 0, 0]) } } }, pages: {} });
  assert.deepEqual(roll(m, '2027-03-01'), { rooms: {}, pages: {} });
});
const counted = (topics, learned = 0, lean = [0, 0, 0, 0]) => ({ topics: Object.fromEntries(Object.entries(topics).map(([t, messages]) => [t, { messages, engaged: 0, replies: 0, chimes: 0 }])), learned, lean });
// Thursday Oct 29: the last 7 complete days are Oct 22 to 28, the 7 before are Oct 15 to 21, and Oct 26 is a Monday.
const general = {
  days: {
    '2026-10-29': counted({ music: 100 }, 50, [0, 25, 0, 0]),
    '2026-10-28': counted({ code: 6, other: 6 }, 5, [0, -.5, 0, -1]),
    '2026-10-26': counted({ deploys: 8 }),
    '2026-10-24': counted({ code: 6, banter: 4 }, 6, [0, 1.2, 0, 0]),
    '2026-10-20': counted({ code: 20 }),
  },
  weeks: { '2026-10-12': counted({ code: 40 }, 10, [0, 2, 0, 0]) },
};
test('a digest names the last week\'s topics, its pace against the week before, and dated trait shifts, from complete days only', () => {
  const page = digest(general, '2026-10-29');
  assert.deepEqual(page, { day: '2026-10-29', mostly: ['code', 'deploys'], some: ['banter'], pace: 'busier', shifts: [{ since: '2026-10-26', axis: 'playfulness', up: false }, { since: '2026-10-26', axis: 'expressiveness', up: false }] });
  assert.equal(onepager('general', page, 'no spoilers before friday.'), 'In #general lately: mostly code and deploys, some banter; busier than last week. As of Oct 26 the room runs more serious and terser. Norms: no spoilers before friday.');
  assert.equal(onepager('general', page), 'In #general lately: mostly code and deploys, some banter; busier than last week. As of Oct 26 the room runs more serious and terser.');
});
test('a one-pager says only what the counts support', () => {
  const quiet = digest(undefined, '2026-10-29');
  assert.deepEqual(quiet, { day: '2026-10-29', mostly: [], some: [], pace: null, shifts: [] });
  assert.equal(onepager('general', quiet), '');
  assert.equal(onepager('general', quiet, 'english only'), 'Norms: english only');
  const few = { days: { '2026-10-28': counted({ ai: 4 }) }, weeks: {} };
  assert.deepEqual(digest(few, '2026-10-29').mostly, []);
  const even = { days: { '2026-10-28': counted({ ai: 5, help: 5 }), '2026-10-20': counted({ ai: 10 }) }, weeks: {} };
  assert.equal(onepager('dev', digest(even, '2026-10-29')), 'In #dev lately: mostly AI and asking for help; about as busy as last week.');
  const slow = { days: { '2026-10-28': counted({ games: 6 }), '2026-10-20': counted({ games: 10 }) }, weeks: {} };
  assert.equal(onepager('dev', digest(slow, '2026-10-29')), 'In #dev lately: mostly games; quieter than last week.');
  const small = { days: { '2026-10-28': counted({ code: 5 }, 5, [.7, 0, 0, 0]) }, weeks: { '2026-10-12': counted({}, 10, [0, 0, 0, 0]), '2026-10-05': counted({}, 10, [2, 0, 0, 0]) } };
  assert.deepEqual(digest(small, '2026-10-29').shifts, [{ since: '2026-10-12', axis: 'warmth', up: false }]);
  assert.equal(onepager('dev', digest(small, '2026-10-29')), 'In #dev lately: mostly code. As of Oct 12 the room runs cooler.');
});
