import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { addressing, trigger } from '../src/core.js';
import { restore } from '../src/settings.js';
const base = restore({});
test('a message that is both a mention and a reply counts as a reply only when mentions are off and replies on', () => {
  const s = (m, r) => ({ reply_mentions: m, reply_replies: r });
  assert.deepEqual([[true, true], [true, false], [false, true], [false, false]].map(([m, r]) => addressing(s(m, r), true, true)), ['mention', 'mention', 'reply', 'mention']);
  assert.equal(addressing(s(false, false), true, false), 'mention');
  assert.equal(addressing(s(true, true), false, true), 'reply');
  assert.equal(addressing(s(true, true), false, false), undefined);
});
test('before classification it asks for the classifier only when learning or an open trigger needs it', () => {
  const pre = (s, addressed, eligible) => trigger({ ...base, ...s }, { addressed, eligible });
  assert.equal(pre({}, undefined, true), null);
  assert.equal(pre({}, 'mention', false), null);
  assert.equal(pre({}, 'reply', false), null);
  assert.deepEqual(pre({}, undefined, false), { respond: null, outcome: 'rate-limited' });
  assert.deepEqual(pre({ organic: true }, undefined, false), { respond: null, outcome: 'rate-limited' });
  assert.deepEqual(pre({ reply_mentions: false }, 'mention', false), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(pre({ reply_replies: false }, 'reply', false), { respond: null, outcome: 'trigger-off' });
  assert.equal(pre({ reply_mentions: false }, 'mention', true), null);
});
test('addressed messages: the trigger, then the reply bar, and never the clock', () => {
  const decide = (s, addressed, reply_p, spokeLast) => trigger({ ...base, ...s }, { addressed, eligible: true, reply_p, spokeLast });
  assert.deepEqual(decide({}, 'mention', .7), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({}, 'reply', .99), { respond: 'reply', outcome: 'replied' });
  assert.deepEqual(decide({}, 'mention', .69), { respond: null, outcome: 'declined', need: .7 });
  assert.deepEqual(decide({ reply_threshold: .75 }, 'reply', .74), { respond: null, outcome: 'declined', need: .75 });
  assert.deepEqual(decide({ reply_mentions: false }, 'mention', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({ reply_replies: false }, 'reply', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({ reply_replies: false }, 'mention', .9), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({ reply_mentions: false, organic: true }, 'mention', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({}, 'mention', .9, true), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({}, 'reply', .9, true), { respond: 'reply', outcome: 'replied' });
  assert.deepEqual(decide({}, 'mention', .5, true), { respond: null, outcome: 'declined', need: .7 });
  assert.ok(!('cooldown' in base) && !('organic_gap' in base));
});
test('unaddressed messages: organic switch, then its bar, then whether the bot spoke last', () => {
  const decide = (s, reply_p, spokeLast) => trigger({ ...base, ...s }, { addressed: undefined, eligible: true, reply_p, point_p: 1, spokeLast });
  const on = { organic: true };
  assert.deepEqual(decide({}, .99), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide({}, .99, true), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide(on, .9), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide(on, .89), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide({ ...on, organic_threshold: .95 }, .93), { respond: null, outcome: 'held-back', need: .95 });
  assert.deepEqual(decide(on, .95, true), { respond: null, outcome: 'spoke-last' });
  assert.deepEqual(decide(on, .95, false), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide(on, .5, true), { respond: null, outcome: 'held-back', need: .9 });
});
test('a chime-in also needs a point that clears the same bar; mentions and replies never ask for one', () => {
  const decide = (s, addressed, reply_p, point_p, spokeLast) => trigger({ ...base, organic: true, ...s }, { addressed, eligible: true, reply_p, point_p, spokeLast });
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
  assert.deepEqual(decide({}, undefined, .95, .1, true), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({}, undefined, .95, .95, true), { respond: null, outcome: 'spoke-last' });
  for (const addressed of ['mention', 'reply']) {
    assert.deepEqual(decide({}, addressed, .7, 0), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide({}, addressed, .7, undefined, true), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide({}, addressed, .69, 1), { respond: null, outcome: 'declined', need: .7 });
  }
});
