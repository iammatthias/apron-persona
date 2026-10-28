import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Log, event } from '../src/events.js';
test('an event keeps only its kind\'s declared fields and rejects unknown kinds and outcomes', () => {
  assert.deepEqual(event('message', { room: 'general', message_id: '1', from: 'alice', mentioned: true, outcome: 'declined', reply_p: .4, body: 'secret' }),
    { kind: 'message', room: 'general', message_id: '1', from: 'alice', mentioned: true, outcome: 'declined', reply_p: .4 });
  assert.throws(() => event('chat', {}), { message: 'unknown event chat' });
  assert.throws(() => event('message', { outcome: 'ignored' }), { message: 'unknown outcome ignored' });
});
test('the log keeps the newest 300 events with strictly increasing times', () => {
  const log = new Log();
  for (let i = 0; i < 301; ++i) log.push(event('error', { code: `e${i}` }));
  const all = log.list();
  assert.equal(all.length, 300);
  assert.equal(all[0].code, 'e1'); assert.equal(all.at(-1).code, 'e300');
  assert.ok(all.every((e, i) => i === 0 || e.at > all[i - 1].at));
  assert.deepEqual(log.list(all.at(-2).at).map(e => e.code), ['e300']);
});
test('subscribers get each new event until they unsubscribe', () => {
  const log = new Log(), got = [], f = e => got.push(e.code);
  log.subscribe(f); log.subscribe(() => { throw Error('broken listener'); });
  log.push(event('error', { code: 'one' }));
  log.unsubscribe(f);
  log.push(event('error', { code: 'two' }));
  assert.deepEqual(got, ['one']);
  assert.equal(log.list().length, 2);
});
