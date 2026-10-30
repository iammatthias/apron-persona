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
  const decide = (s, addressed, reply_p, since) => trigger({ ...base, ...s }, { addressed, eligible: true, reply_p, since });
  assert.deepEqual(decide({}, 'mention', .7), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({}, 'reply', .99), { respond: 'reply', outcome: 'replied' });
  assert.deepEqual(decide({}, 'mention', .69), { respond: null, outcome: 'declined', need: .7 });
  assert.deepEqual(decide({ reply_threshold: .75 }, 'reply', .74), { respond: null, outcome: 'declined', need: .75 });
  assert.deepEqual(decide({ reply_mentions: false }, 'mention', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({ reply_replies: false }, 'reply', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({ reply_replies: false }, 'mention', .9), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({ reply_mentions: false, organic: true }, 'mention', .99), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(decide({}, 'mention', .9, 1), { respond: 'mention', outcome: 'replied' });
  assert.deepEqual(decide({}, 'reply', .9, 1), { respond: 'reply', outcome: 'replied' });
  assert.deepEqual(decide({}, 'mention', .5, 1), { respond: null, outcome: 'declined', need: .7 });
  assert.ok(!('cooldown' in base) && !('organic_gap' in base));
});
test('unaddressed messages: organic switch, then its bar, then four messages from others since the bot last posted', () => {
  const decide = (s, reply_p, since) => trigger({ ...base, ...s }, { addressed: undefined, eligible: true, reply_p, point_p: 1, confidence: 'HIGH', since });
  const on = { organic: true };
  assert.deepEqual(decide({}, .99), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide({}, .99, 1), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide(on, .9), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide(on, .89), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide({ ...on, organic_threshold: .95 }, .93), { respond: null, outcome: 'held-back', need: .95 });
  for (const since of [1, 2, 3]) assert.deepEqual(decide(on, .95, since), { respond: null, outcome: 'spoke-last' }, String(since));
  for (const since of [4, 5, 40, Infinity, undefined]) assert.deepEqual(decide(on, .95, since), { respond: 'organic', outcome: 'chimed-in' }, String(since));
  assert.deepEqual(decide(on, .5, 1), { respond: null, outcome: 'held-back', need: .9 });
});
test("after six of a room's last eighteen turns were its own, the bot rests there: no answer, no chime-in, no draft", () => {
  const decide = (addressed, turns, s = {}) => trigger({ ...base, organic: true, ...s }, { addressed, eligible: true, reply_p: .95, point_p: .95, confidence: 'HIGH', since: 4, turns });
  for (const addressed of ['mention', 'reply']) {
    assert.deepEqual(decide(addressed, undefined), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide(addressed, 5), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide(addressed, 6), { respond: null, outcome: 'looping' });
    assert.deepEqual(decide(addressed, 40), { respond: null, outcome: 'looping' });
  }
  assert.deepEqual(decide(undefined, 5), { respond: 'organic', outcome: 'chimed-in' });
  assert.deepEqual(decide(undefined, 6), { respond: null, outcome: 'looping' });
  // A setting that is off is the standing reason; the rest applies only where the bot would otherwise speak.
  assert.deepEqual(decide(undefined, 6, { organic: false }), { respond: null, outcome: 'learned-only' });
  assert.deepEqual(decide('mention', 6, { reply_mentions: false }), { respond: null, outcome: 'trigger-off' });
  // Resting, a message the bot would otherwise have answered or chimed in on is not sized up either, whatever there is to learn from it.
  assert.deepEqual(trigger(base, { addressed: 'mention', eligible: true, turns: 6 }), { respond: null, outcome: 'looping' });
  assert.equal(trigger(base, { addressed: 'mention', eligible: false, turns: 5 }), null);
  assert.deepEqual(trigger(base, { addressed: 'mention', eligible: false, turns: 6 }), { respond: null, outcome: 'looping' });
  assert.deepEqual(trigger({ ...base, reply_mentions: false }, { addressed: 'mention', eligible: false, turns: 6 }), { respond: null, outcome: 'trigger-off' });
  assert.deepEqual(trigger({ ...base, organic: true }, { addressed: undefined, eligible: true, turns: 6 }), { respond: null, outcome: 'looping' });
  assert.deepEqual(trigger({ ...base, organic: true }, { addressed: undefined, eligible: false, turns: 6 }), { respond: null, outcome: 'looping' });
  assert.equal(trigger(base, { addressed: undefined, eligible: true, turns: 6 }), null);
});
test('a chime-in also needs a point that clears the same bar; mentions and replies never ask for one', () => {
  const decide = (s, addressed, reply_p, point_p, since) => trigger({ ...base, organic: true, ...s }, { addressed, eligible: true, reply_p, point_p, confidence: 'HIGH', since });
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
  assert.deepEqual(decide({}, undefined, .95, .1, 1), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide({}, undefined, .95, .95, 1), { respond: null, outcome: 'spoke-last' });
  for (const addressed of ['mention', 'reply']) {
    assert.deepEqual(decide({}, addressed, .7, 0), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide({}, addressed, .7, undefined, 1), { respond: addressed, outcome: 'replied' });
    assert.deepEqual(decide({}, addressed, .69, 1), { respond: null, outcome: 'declined', need: .7 });
  }
});
test('a chime-in needs the model sure of its own call: HIGH or MEDIUM; a mention or reply is answered at any confidence', () => {
  const decide = (confidence, extra = {}) => trigger({ ...base, organic: true }, { addressed: undefined, eligible: true, reply_p: .95, point_p: .95, confidence, since: 4, ...extra });
  for (const c of ['HIGH', 'MEDIUM']) assert.deepEqual(decide(c), { respond: 'organic', outcome: 'chimed-in' }, c);
  for (const c of ['LOW', 'UNCERTAIN', undefined, 'high', 'sure']) assert.deepEqual(decide(c), { respond: null, outcome: 'unsure' }, String(c));
  // The bars and the pacing come first: an unsure message under the bar is held back, and one right after a post is spoke-last.
  assert.deepEqual(decide('LOW', { reply_p: .5 }), { respond: null, outcome: 'held-back', need: .9 });
  assert.deepEqual(decide('LOW', { point_p: .5 }), { respond: null, outcome: 'nothing-to-add', need: .9 });
  assert.deepEqual(decide('LOW', { since: 1 }), { respond: null, outcome: 'spoke-last' });
  assert.deepEqual(decide('LOW', { turns: 6 }), { respond: null, outcome: 'looping' });
  for (const addressed of ['mention', 'reply']) for (const c of ['LOW', 'UNCERTAIN', undefined])
    assert.deepEqual(trigger(base, { addressed, eligible: true, reply_p: .9, point_p: .1, confidence: c, since: 1 }), { respond: addressed, outcome: 'replied' }, `${addressed} ${c}`);
});
