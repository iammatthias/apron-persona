import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tally, empty, digest, onepager, recent } from '../src/memory.js';
import { decision, topic, BLOCK, BLOCKS, FOLD, FOLDS, RECENT } from '../src/core.js';
test('a topic is one label from the fixed taxonomy, and anything else is other', () => {
  assert.deepEqual(['code', ' Deploys ', 'AI', 'banter', 'meta', 'other'].map(topic), ['code', 'deploys', 'ai', 'banter', 'meta', 'other']);
  assert.deepEqual(['kubernetes', 'carol', '', 'code review', 42, null, undefined, ['code']].map(topic), Array(8).fill('other'));
  const reply = t => ({ choices: [{ message: { content: JSON.stringify({ learn: .9, reply: .1, point: .2, topic: t, warmth: 'balanced', playfulness: 'balanced', curiosity: 'balanced', expressiveness: 'balanced' }) } }] });
  assert.equal(decision(reply('food')).topic, 'food');
  assert.equal(decision(reply('Dinner with Carol')).topic, 'other');
  assert.equal(decision(reply(undefined)).topic, 'other');
});
const block = (topics, learned = 0, lean = [0, 0, 0, 0]) => ({ topics: Object.fromEntries(Object.entries(topics).map(([t, messages]) => [t, { messages, engaged: 0, replies: 0, chimes: 0 }])), learned, lean });
test('a tally counts a message by room and topic into the block being filled, and sums how far a learned style leans', () => {
  const m = empty();
  tally(m, 'general', { topic: 'code', engaged: false, outcome: 'learned-only', style: [.75, .5, .25, 1] });
  tally(m, 'general', { topic: 'code', engaged: true, outcome: 'replied' });
  tally(m, 'general', { topic: 'banter', engaged: false, outcome: 'chimed-in', style: [1, 0, .5, .5] });
  tally(m, 'random', { topic: 'other', engaged: true, outcome: 'declined' });
  assert.deepEqual(m, { rooms: {
    general: { open: { topics: { code: { messages: 2, engaged: 1, replies: 1, chimes: 0 }, banter: { messages: 1, engaged: 0, replies: 0, chimes: 1 } }, learned: 2, lean: [.75, -.5, -.25, .5] }, blocks: [], folds: [], closed: 0 },
    random: { open: { topics: { other: { messages: 1, engaged: 1, replies: 0, chimes: 0 } }, learned: 0, lean: [0, 0, 0, 0] }, blocks: [], folds: [], closed: 0 },
  }, pages: {} });
});
// Counts `n` messages of `topic` into the room, each learned with `lean` when given.
const fill = (m, room, n, topic, lean) => { for (let i = 0; i < n; ++i) tally(m, room, { topic, engaged: false, outcome: 'learned-only', style: lean && lean.map(v => v + .5) }); };
test('a block closes at BLOCK messages, the last BLOCKS stay whole, older ones fold FOLD at a time, and FOLDS folds are kept', () => {
  assert.deepEqual([BLOCK, BLOCKS, FOLD, FOLDS], [50, 14, 10, 12]);
  const m = empty();
  fill(m, 'dev', BLOCK - 1, 'code');
  assert.deepEqual([m.rooms.dev.blocks, m.rooms.dev.closed], [[], 0]);
  tally(m, 'dev', { topic: 'ai', engaged: true, outcome: 'replied' });
  assert.deepEqual(m.rooms.dev, { open: { topics: {}, learned: 0, lean: [0, 0, 0, 0] }, blocks: [{ topics: { code: { messages: 49, engaged: 0, replies: 0, chimes: 0 }, ai: { messages: 1, engaged: 1, replies: 1, chimes: 0 } }, learned: 0, lean: [0, 0, 0, 0] }], folds: [], closed: 1 });
  for (let i = 0; i < BLOCKS; ++i) fill(m, 'dev', BLOCK, 'music', [.1, 0, 0, 0]);
  assert.deepEqual([m.rooms.dev.blocks.length, m.rooms.dev.closed, m.rooms.dev.folds], [BLOCKS, BLOCKS + 1, [{ ...m.rooms.dev.blocks[0], topics: { code: { messages: 49, engaged: 0, replies: 0, chimes: 0 }, ai: { messages: 1, engaged: 1, replies: 1, chimes: 0 } }, learned: 0, lean: [0, 0, 0, 0], span: 1 }]]);
  for (let i = 0; i < FOLD - 1; ++i) fill(m, 'dev', BLOCK, 'music', [.1, 0, 0, 0]);
  assert.deepEqual(m.rooms.dev.folds, [{ topics: { code: { messages: 49, engaged: 0, replies: 0, chimes: 0 }, ai: { messages: 1, engaged: 1, replies: 1, chimes: 0 }, music: { messages: 450, engaged: 0, replies: 0, chimes: 0 } }, learned: 450, lean: [45, 0, 0, 0], span: FOLD }]);
  fill(m, 'dev', BLOCK, 'music', [.1, 0, 0, 0]);
  assert.deepEqual(m.rooms.dev.folds.map(f => f.span), [FOLD, 1]);
  // Nine more music blocks fill the second fold; then FOLDS folds' worth of games pushes the first two folds out.
  for (let i = 0; i < FOLD - 1 + FOLD * FOLDS; ++i) fill(m, 'dev', BLOCK, 'games');
  assert.deepEqual([m.rooms.dev.folds.length, m.rooms.dev.folds.map(f => f.span), m.rooms.dev.closed], [FOLDS, Array(FOLDS).fill(FOLD), 1 + BLOCKS + FOLD + FOLD - 1 + FOLD * FOLDS]);
  assert.deepEqual(m.rooms.dev.folds[0].topics, { music: { messages: 250, engaged: 0, replies: 0, chimes: 0 }, games: { messages: 250, engaged: 0, replies: 0, chimes: 0 } });
  assert.deepEqual(m.rooms.dev.folds[1].topics, { games: { messages: 500, engaged: 0, replies: 0, chimes: 0 } });
  assert.deepEqual(m.rooms.dev.folds.at(-1).topics, { games: { messages: 500, engaged: 0, replies: 0, chimes: 0 } });
});
test('a digest names the topics of the last RECENT closed blocks and how the room has turned against the blocks before', () => {
  assert.equal(RECENT, 4);
  const general = { closed: 20, folds: [{ ...block({ code: 400 }, 100, [0, 20, 0, 0]), span: 10 }], blocks: [
    block({ code: 50 }, 10, [0, 2, 0, 0]), block({ code: 50 }, 10, [0, 2, 0, 0]),
    block({ code: 30, deploys: 20 }, 6, [0, -.5, 0, -2]), block({ deploys: 40, other: 10 }), block({ code: 30, banter: 10, other: 10 }, 6, [0, 1.2, 0, 0]), block({ code: 40, banter: 10 }, 5, [0, -.5, 0, -2]),
  ] };
  const page = digest(general);
  assert.deepEqual(page, { closed: 20, mostly: ['code', 'deploys'], some: ['banter'], shifts: [{ axis: 'playfulness', up: false }, { axis: 'expressiveness', up: false }] });
  assert.equal(onepager('general', page, 'no spoilers before friday.'), 'In #general lately: mostly code and deploys, some banter. Lately the room runs more serious and terser. Norms: no spoilers before friday.');
  assert.equal(onepager('general', page), 'In #general lately: mostly code and deploys, some banter. Lately the room runs more serious and terser.');
});
test('a one-pager says only what the closed blocks support, and nothing from the block being filled', () => {
  const quiet = digest(undefined);
  assert.deepEqual(quiet, { closed: 0, mostly: [], some: [], shifts: [] });
  assert.equal(onepager('general', quiet), '');
  assert.equal(onepager('general', quiet, 'english only'), 'Norms: english only');
  const m = empty();
  fill(m, 'dev', BLOCK - 1, 'ai');
  assert.deepEqual(digest(m.rooms.dev).mostly, []);
  const even = { closed: 1, folds: [], blocks: [block({ ai: 25, help: 25 })] };
  assert.equal(onepager('dev', digest(even)), 'In #dev lately: mostly AI and asking for help.');
  // A shift needs 5 learned on each side; with nothing before, nothing has turned.
  const fresh = { closed: 1, folds: [], blocks: [block({ code: 50 }, 50, [35, 0, 0, 0])] };
  assert.deepEqual(digest(fresh).shifts, []);
  // Everything within the last RECENT closed blocks is "lately"; a shift needs something before them.
  const same = { closed: 2, folds: [], blocks: [block({ code: 50 }, 10, [2, 0, 0, 0]), block({ code: 50 }, 10, [0, 0, 0, 0])] };
  assert.deepEqual(digest(same).shifts, []);
  const cooler = { closed: 11, folds: [{ ...block({ code: 50 }, 10, [2, 0, 0, 0]), span: 1 }], blocks: [block({ code: 50 }, 10, [0, 0, 0, 0])] };
  assert.deepEqual(digest(cooler).shifts, [{ axis: 'warmth', up: false }]);
  assert.equal(onepager('dev', digest(cooler)), 'In #dev lately: mostly code. Lately the room runs cooler.');
});
test('the recent table shows the last blocks and the one being filled, oldest first, busiest topic first', () => {
  const m = empty();
  for (let i = 0; i < 8; ++i) fill(m, 'dev', BLOCK, i % 2 ? 'code' : 'music');
  fill(m, 'dev', 3, 'ai');
  assert.deepEqual(recent(m, 'dev'), { labels: ['3', '4', '5', '6', '7', '8', 'now'], rows: [['code', [0, 50, 0, 50, 0, 50, 0]], ['music', [50, 0, 50, 0, 50, 0, 0]], ['ai', [0, 0, 0, 0, 0, 0, 3]]] });
  assert.deepEqual(recent(empty(), 'dev'), { labels: ['now'], rows: [] });
  const one = empty(); fill(one, 'dev', 2, 'food');
  assert.deepEqual(recent(one, 'dev'), { labels: ['now'], rows: [['food', [2]]] });
});
