import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { read, chunk, synthesize, reading, draft, average } from '../src/learn.js';
// A fake Apron server holding `log`: it greets, signs in, and pages history backwards with an inclusive `before`.
function server(log, { silent = false, refuse = false } = {}) {
  const listeners = {}, sent = [];
  const ws = {
    sent, closed: false,
    addEventListener(type, f) { (listeners[type] ??= []).push(f); },
    emit(frame) { listeners.message?.forEach(f => f({ data: JSON.stringify(frame) })); },
    close() { this.closed = true; },
    send(raw) {
      const f = JSON.parse(raw); sent.push(f);
      if (f.method === 'auth') queueMicrotask(() => ws.emit(refuse ? { id: 'auth', error: { message: 'no' } } : { id: 'auth', result: { you: { user_id: 'u_guest' } } }));
      if (f.method !== 'history' || silent) return;
      const pool = log.filter(m => m.room_id === f.params.room_id && (f.params.before === undefined || BigInt(m.log_id) <= BigInt(f.params.before)));
      const page = pool.slice(-f.params.limit);
      queueMicrotask(() => ws.emit({ id: f.id, result: { more: pool.length > page.length, messages: page, first_log_id: page[0]?.log_id } }));
    },
  };
  queueMicrotask(() => ws.emit({ method: 'server', params: {} }));
  return ws;
}
const say = (log_id, user_id, text, extra) => ({ room_id: 'general', message_id: `m${log_id}`, log_id: String(log_id), from: { user_id, name: user_id }, body: { text }, ...extra });
const filler = (n, from = 1) => Array.from({ length: n }, (_, i) => say(from + i, `u${(from + i) % 3}`, `line ${from + i}`));
const befores = ws => ws.sent.filter(f => f.method === 'history').map(f => f.params.before);
test('the reader pages history backwards below each page and closes the socket', async () => {
  const ws = server(filler(250));
  const lines = await read(() => ws, { url: 'wss://x/', token: '', rooms: ['general'], cap: 1000 });
  assert.deepEqual(befores(ws), [undefined, '150', '50']);
  assert.equal(lines.length, 250);
  assert.deepEqual(lines[0], { name: 'u1', text: 'line 1' });
  assert.deepEqual(lines.at(-1), { name: 'u1', text: 'line 250' });
  assert.deepEqual(ws.sent[0], { method: 'auth', id: 'auth', params: { scheme: 'guest', name: 'reader' } });
  assert.equal(ws.closed, true);
});
test('the reader keeps the newest snapshot and skips tombstones, bots, notices, its own bot and blanks', async () => {
  const log = [
    say(1, 'ana', 'first draft'), say(2, 'ben', 'gone soon'), say(3, 'bot_x', 'beep'), say(4, '~private', 'welcome'),
    say(5, 'bot_me', 'my own'), say(6, 'custom', 'a bot by role', { from: { user_id: 'custom', roles: ['bot'] } }), say(7, 'cy', '   '),
    { ...say(8, 'zed', 'elsewhere'), room_id: 'random' },
    ...filler(120, 10),
    { ...say(200, 'ana', 'edited'), message_id: 'm1' }, { ...say(201, 'ben', undefined), message_id: 'm2', deleted: true, body: undefined },
  ];
  const ws = server(log);
  const lines = await read(() => ws, { url: 'wss://x/', token: 'tok', rooms: ['general'], cap: 1000, self: 'bot_me' });
  assert.deepEqual(ws.sent[0].params, { scheme: 'token', token: 'tok' });
  assert.deepEqual(befores(ws), [undefined, '31']);
  assert.equal(lines.length, 121);
  assert.deepEqual(lines.filter(l => !l.text.startsWith('line ')), [{ name: 'ana', text: 'edited' }]);
});
test('the reader stops paging at the cap and keeps the newest', async () => {
  const ws = server(filler(250));
  const lines = await read(() => ws, { url: 'wss://x/', token: '', rooms: ['general'], cap: 120 });
  assert.deepEqual(befores(ws), [undefined, '150']);
  assert.equal(lines.length, 120);
  assert.deepEqual([lines[0].text, lines.at(-1).text], ['line 131', 'line 250']);
});
test('the reader gives up after its time limit, or when the server refuses it, and closes the socket', async () => {
  const slow = server(filler(5), { silent: true });
  await assert.rejects(read(() => slow, { url: 'wss://x/', token: '', rooms: ['general'], cap: 10, limit: 20 }), { message: 'history-timeout' });
  assert.equal(slow.closed, true);
  const refused = server([], { refuse: true });
  await assert.rejects(read(() => refused, { url: 'wss://x/', token: 'bad', rooms: ['general'], cap: 10 }), { message: 'auth-denied' });
  assert.equal(refused.closed, true);
});
test('chunks fill to the size limit with the newest lines and stop at the maximum', () => {
  const lines = ['1', '2', '3', '4', '5'].map(n => ({ name: 'a', text: `xxxx${n}` }));
  assert.deepEqual(chunk(lines, 17), [{ text: 'a: xxxx1', count: 1 }, { text: 'a: xxxx2\na: xxxx3', count: 2 }, { text: 'a: xxxx4\na: xxxx5', count: 2 }]);
  assert.deepEqual(chunk(lines, 16), lines.slice(1).map(l => ({ text: `a: ${l.text}`, count: 1 })));
  assert.deepEqual(chunk(lines, 17, 2), [{ text: 'a: xxxx2\na: xxxx3', count: 2 }, { text: 'a: xxxx4\na: xxxx5', count: 2 }]);
  assert.deepEqual(chunk([{ name: 'b', text: 'two\nlines' }, { name: 'c', text: 'y'.repeat(30) }], 10), [{ text: 'b: two\n  l', count: 1 }, { text: 'c: yyyyyyy', count: 1 }]);
  assert.equal(chunk(Array.from({ length: 1000 }, (_, i) => ({ name: 'n', text: 'z'.repeat(100 + i % 7) }))).length, 4);
  assert.deepEqual(chunk([]), []);
});
const content = x => ({ choices: [{ message: { content: typeof x === 'string' ? x : JSON.stringify(x) } }] });
const voice = (v, warmth = 'high') => content({ voice: v, warmth, playfulness: 'low', curiosity: 'balanced', expressiveness: 'elevated' });
test('readings and drafts parse fail-closed, and levels average to a vector', () => {
  assert.deepEqual(reading(voice('short, dry')), { voice: 'short, dry', vector: [1, 0, .5, .75] });
  assert.deepEqual(reading(content('```json\n' + JSON.stringify({ voice: ' ok ', warmth: 'low', playfulness: 'low', curiosity: 'low', expressiveness: 'low' }) + '\n```')).voice, 'ok');
  for (const bad of [content('nope'), content({ voice: '', warmth: 'high' }), voice('x', 'toString'), content({ warmth: 'high', playfulness: 'low', curiosity: 'low', expressiveness: 'low' }), {}])
    assert.throws(() => reading(bad), { message: 'invalid-reading' });
  assert.equal(draft(content({ persona: ' You are {name}. \r\n' })), 'You are {name}.');
  for (const bad of [content('nope'), content({ persona: '' }), content({ persona: 'x'.repeat(4001) }), content({ persona: 7 })]) assert.throws(() => draft(bad), { message: 'invalid-draft' });
  assert.deepEqual(average([[1, 0, .5, .75], [0, 0, .25, .75], [.5, .5, .5, .5]]), [.5, .167, .417, .667]);
});
test('synthesis reads each chunk, merges the voices, and counts a failed reading without failing', async () => {
  const asked = [];
  const ask = replies => async messages => { asked.push(messages); const r = replies[asked.length - 1]; if (r instanceof Error) throw r; return r; };
  const chunks = [{ text: 'a: one', count: 3 }, { text: 'b: two', count: 2 }];
  assert.deepEqual(await synthesize(chunks, ask([voice('dry'), voice('loud', 'low'), content({ persona: 'You are {name}, dry and loud.' })])),
    { persona: 'You are {name}, dry and loud.', vector: [.5, 0, .5, .75], count: 5, failed: 0 });
  assert.deepEqual(asked.map(m => m[1].content), ['a: one', 'b: two', '- dry\n- loud']);
  assert.ok(asked[0][0].content.includes('never name, quote or paraphrase anyone') && asked[2][0].content.includes('never name, quote or paraphrase anyone'));
  asked.length = 0;
  assert.deepEqual(await synthesize(chunks, ask([Error('inference-429'), voice('loud', 'low'), content({ persona: 'You are {name}.' })])),
    { persona: 'You are {name}.', vector: [0, 0, .5, .75], count: 2, failed: 1, detail: 'inference-429' });
  asked.length = 0;
  await assert.rejects(synthesize(chunks, ask([content('x'), content('y')])), { message: 'invalid-reading' });
  assert.equal(asked.length, 2);
  asked.length = 0;
  await assert.rejects(synthesize(chunks, ask([voice('a'), voice('b'), content('not json')])), { message: 'invalid-draft' });
});
