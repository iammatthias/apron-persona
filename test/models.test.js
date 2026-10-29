import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { roles, table, ask } from '../src/models.js';
import { clock } from './clock.js';
const content = text => ({ choices: [{ message: { content: text } }] });
// The outcome of an ask as a value, so a rejection waited on later is never unhandled.
const outcome = p => p.then(value => ({ value }), e => ({ error: e.message }));
const text = data => { const s = data?.choices?.[0]?.message?.content; if (typeof s !== 'string' || !s.trim()) throw Error('reply-empty'); return s.trim(); };
// A transport whose requests the test settles by hand; each records its body and whether it was aborted.
function bench(role = roles.compose, { afford, signal, timers = clock() } = {}) {
  const sent = [];
  const send = (body, signal) => new Promise((resolve, reject) => {
    if (afford && !afford()) return reject(Error('budget'));
    const r = { body, aborted: null, resolve, reject };
    signal.addEventListener('abort', () => { r.aborted = signal.reason.message; reject(signal.reason); });
    sent.push(r);
  });
  return { sent, timers, run: (body = {}) => ask(role, body, text, { send, afford, signal, timers }) };
}
test('the table heads a chain with the environment model and keeps the router behind it', () => {
  assert.deepEqual(table({}), roles);
  assert.deepEqual(table({ DECISION_MODEL: 'x/y', CHAT_MODEL: 'openrouter/free' }).judge.chain, ['x/y', 'cohere/north-mini-code:free', 'openrouter/free']);
  assert.deepEqual(table({ CHAT_MODEL: 'openrouter/free' }).compose.chain, ['openrouter/free', 'cohere/north-mini-code:free']);
  assert.deepEqual(table({ CHAT_MODEL: 'c' }).learn, { chain: ['c', 'openrouter/free'], timeout: 60000, hedge: null });
  assert.deepEqual(table({ DECISION_MODEL: 'd' }).judge, { chain: ['d', 'cohere/north-mini-code:free', 'openrouter/free'], timeout: 8000, hedge: 2500 });
});
test('the first model answers before the hedge delay: one request, its answer, no race', async () => {
  const b = bench();
  const p = b.run({ max_tokens: 5 });
  assert.deepEqual(b.sent.map(r => r.body), [{ max_tokens: 5, model: 'cohere/north-mini-code:free', models: ['cohere/north-mini-code:free', 'openrouter/free'] }]);
  await b.timers.tick(2999);
  b.sent[0].resolve({ ...content(' hi '), model: 'cohere/north-mini-code' });
  assert.deepEqual(await p, { value: 'hi', model: 'cohere/north-mini-code', hedged: false });
  assert.equal(b.timers.pending(), 0);
});
test('a hedge fires at the delay, the first answer wins and the loser is aborted', async () => {
  const b = bench();
  const p = b.run();
  await b.timers.tick(3000);
  assert.deepEqual(b.sent.map(r => r.body.model), ['cohere/north-mini-code:free', 'openrouter/free']);
  assert.equal(b.sent[1].body.models, undefined);
  b.sent[1].resolve(content('second'));
  assert.deepEqual(await p, { value: 'second', model: 'openrouter/free', hedged: true });
  assert.equal(b.sent[0].aborted, 'lost');
  assert.equal(b.timers.pending(), 0);
});
test('a failed, empty or invalid answer hands over to the next model at once', async () => {
  for (const [why, fail] of [['error', r => r.reject(Error('inference-503'))], ['empty', r => r.resolve(content('  '))], ['invalid', r => r.resolve({ nope: 1 })]]) {
    const b = bench();
    const p = b.run();
    fail(b.sent[0]);
    await b.timers.tick(0);
    assert.equal(b.sent.length, 2, why);
    assert.equal(b.timers.now(), 0);
    b.sent[1].resolve(content('ok'));
    assert.deepEqual(await p, { value: 'ok', model: 'openrouter/free', hedged: false });
  }
  const b = bench();
  const p = b.run();
  b.sent[0].reject(Error('inference-503'));
  await b.timers.tick(0);
  b.sent[1].resolve(content(''));
  await assert.rejects(p, { message: 'reply-empty' });
  assert.equal(b.sent.length, 2);
});
test('an attempt times out on its own budget and the chain moves on, then fails with the last reason', async () => {
  const b = bench(roles.judge);
  const p = outcome(b.run());
  await b.timers.tick(2500);
  assert.equal(b.sent.length, 2);
  await b.timers.tick(5500);
  assert.equal(b.sent[0].aborted, 'timeout');
  await b.timers.tick(2500);
  assert.equal(b.sent[1].aborted, 'timeout');
  assert.deepEqual(await p, { error: 'timeout' });
  assert.equal(b.timers.pending(), 0);
});
test('no hedge is sent without budget, and a failover that cannot pay ends with budget', async () => {
  let room = true;
  const b = bench(roles.compose, { afford: () => room });
  const p = outcome(b.run());
  room = false;
  await b.timers.tick(3000);
  assert.equal(b.sent.length, 1);
  await b.timers.tick(7000);
  assert.equal(b.sent[0].aborted, 'timeout');
  assert.equal(b.sent.length, 1);
  assert.deepEqual(await p, { error: 'budget' });
  assert.equal(b.timers.pending(), 0);
});
test('the caller\'s signal aborts every attempt with its reason', async () => {
  const control = new AbortController();
  const b = bench(roles.compose, { signal: control.signal });
  const p = outcome(b.run());
  await b.timers.tick(3000);
  control.abort(Error('deadline'));
  assert.deepEqual(await p, { error: 'deadline' });
  assert.deepEqual(b.sent.map(r => r.aborted), ['deadline', 'deadline']);
  assert.equal(b.timers.pending(), 0);
  control.abort();
  await assert.rejects(bench(roles.compose, { signal: control.signal }).run(), { message: 'deadline' });
});
test('learn asks one model, once, and never hedges', async () => {
  const b = bench(roles.learn);
  const p = b.run();
  await b.timers.tick(59999);
  assert.equal(b.sent.length, 1);
  assert.equal(b.sent[0].body.models, undefined);
  b.sent[0].resolve(content('done'));
  assert.equal((await p).value, 'done');
});
