import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { addressing, trigger } from '../src/core.js';
import { restore } from '../src/settings.js';
const base = restore({}), now = 10_000_000;
const quietClocks = { now, lastReply: 0, lastOrganic: 0 };
test('a message that is both a mention and a reply counts as a reply only when mentions are off and replies on', () => {
  const s = (m, r) => ({ reply_mentions: m, reply_replies: r });
  assert.deepEqual([[true, true], [true, false], [false, true], [false, false]].map(([m, r]) => addressing(s(m, r), true, true)), ['mention', 'mention', 'reply', 'mention']);
  assert.equal(addressing(s(false, false), true, false), 'mention');
  assert.equal(addressing(s(true, true), false, true), 'reply');
  assert.equal(addressing(s(true, true), false, false), undefined);
});
test('before classification it asks for the classifier only when learning or an open trigger needs it', () => {
  const pre = (s, addressed, eligible) => trigger({ ...base, ...s }, { addressed, eligible }, quietClocks);
  assert.equal(pre({}, undefined, true), null);
  assert.equal(pre({}, 'mention', false), null);
  assert.equal(pre({}, 'reply', false), null);
  assert.deepEqual(pre({}, undefined, false), { respond: null, outcome: 'rate-limited' });
  assert.deepEqual(pre({ organic: true }, undefined, false), { respond: null, outcome: 'rate-limited' });
  assert.deepEqual(pre({ reply_mentions: false }, 'mention', false), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(pre({ reply_replies: false }, 'reply', false), { respond: null, outcome: 'trigger-off' });
  assert.equal(pre({ reply_mentions: false }, 'mention', true), null);
});
test('addressed messages: trigger, then the reply bar, then the cooldown', () => {
  const decide = (s, addressed, reply_p, clocks = quietClocks) => trigger({ ...base, ...s }, { addressed, eligible: true, reply_p }, clocks);
  assert.deepEqual(decide({}, 'mention', .7), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({}, 'reply', .99), { respond: 'reply', outcome: 'replied' });
  assert.deepEqual(decide({}, 'mention', .69), { respond: null, outcome: 'declined', need: .7 });
  assert.deepEqual(decide({ reply_threshold: .75 }, 'reply', .74), { respond: null, outcome: 'declined', need: .75 });
  assert.deepEqual(decide({ reply_mentions: false }, 'mention', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({ reply_replies: false }, 'reply', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({ reply_replies: false }, 'mention', .9), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({ reply_mentions: false, organic: true }, 'mention', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({}, 'mention', .9, { now, lastReply: now - 14999, lastOrganic: 0 }), { respond: null, outcome: 'cooldown', wait: 15 });
  assert.deepEqual(decide({}, 'mention', .9, { now, lastReply: now - 15000, lastOrganic: 0 }), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({ cooldown: 0 }, 'mention', .9, { now, lastReply: now, lastOrganic: 0 }), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({ organic: true }, 'mention', .9, { now, lastReply: 0, lastOrganic: now - 1 }), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({}, 'mention', .5, { now, lastReply: now, lastOrganic: 0 }), { respond: null, outcome: 'declined', need: .7 });
});
test('unaddressed messages: organic switch, then its bar, then the room gap, then the cooldown', () => {
  const decide = (s, reply_p, clocks = quietClocks) => trigger({ ...base, ...s }, { addressed: undefined, eligible: true, reply_p, point_p: 1 }, clocks);
  const on = { organic: true };
  assert.deepEqual(decide({}, .99), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide(on, .9), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide(on, .89), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide({ ...on, organic_threshold: .95 }, .93), { respond: null, outcome: 'held-back', need: .95 });
  assert.deepEqual(decide(on, .95, { now, lastReply: 0, lastOrganic: now - 12 * 60000 }), { respond: null, outcome: 'quiet-gap', ago: 720000 });
  assert.deepEqual(decide(on, .95, { now, lastReply: 0, lastOrganic: now - 30 * 60000 }), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide({ ...on, organic_gap: 5 }, .95, { now, lastReply: 0, lastOrganic: now - 6 * 60000 }), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide(on, .95, { now, lastReply: now - 1000, lastOrganic: 0 }), { respond: null, outcome: 'cooldown', wait: 15 });
  assert.deepEqual(decide(on, .5, { now, lastReply: now, lastOrganic: now }), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide(on, .95, { now, lastReply: now, lastOrganic: now }), { respond: null, outcome: 'quiet-gap', ago: 0 });
});
test('a chime-in also needs a point that clears the same bar; mentions and replies never ask for one', () => {
  const decide = (s, addressed, reply_p, point_p, clocks = quietClocks) => trigger({ ...base, organic: true, ...s }, { addressed, eligible: true, reply_p, point_p }, clocks);
  assert.deepEqual(decide({}, undefined, .95, .9), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide({}, undefined, .95, .42), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({}, undefined, .95, .89), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({ organic_threshold: .6 }, undefined, .7, .6), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide({ organic_threshold: .6 }, undefined, .7, .59), { respond: null, outcome: 'nothing-to-add', need: .6 });
  assert.deepEqual(decide({}, undefined, .95, undefined), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({}, undefined, .95, NaN), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({}, undefined, .5, 1), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide({}, undefined, .5, 0), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide({ organic: false }, undefined, .99, 0), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide({}, undefined, .95, .1, { now, lastReply: 0, lastOrganic: now }), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({}, undefined, .95, .95, { now, lastReply: 0, lastOrganic: now }), { respond: null, outcome: 'quiet-gap', ago: 0 });
  assert.deepEqual(decide({}, undefined, .95, .95, { now, lastReply: now, lastOrganic: 0 }), { respond: null, outcome: 'cooldown', wait: 15 });
  for (const addressed of ['mention', 'reply']) {
    assert.deepEqual(decide({}, addressed, .7, 0), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide({}, addressed, .7, undefined), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide({}, addressed, .69, 1), { respond: null, outcome: 'declined', need: .7 });
  }
});
