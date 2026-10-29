// A clock whose timers fire only when a test advances it, in order, with promises settled between them.
export function clock() {
  const due = new Map();
  let now = 0, id = 0;
  const flush = () => new Promise(r => setTimeout(r, 0));
  return {
    now: () => now,
    setTimeout(f, ms) { due.set(++id, { at: now + ms, f }); return id; },
    clearTimeout(i) { due.delete(i); },
    pending: () => due.size,
    async tick(ms = 0) {
      const end = now + ms;
      await flush();
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; due.delete(next[0]); next[1].f();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
// Requests a test answers by hand. Each holds its body and settles when the test calls answer(data), fail(status) or
// throw(error); an aborted one rejects with the signal's reason and is marked.
export function lab() {
  const calls = [];
  const request = (url, init) => new Promise((resolve, reject) => {
    const c = { body: JSON.parse(init.body), aborted: null, settled: false };
    const settle = f => (...a) => { if (!c.settled) { c.settled = true; f(...a); } };
    c.answer = settle(data => resolve(Response.json(data)));
    c.fail = settle((status, text = '') => resolve(new Response(text, { status })));
    c.throw = settle(reject);
    init.signal?.addEventListener('abort', () => { c.aborted = init.signal.reason?.message ?? 'aborted'; c.throw(init.signal.reason); });
    calls.push(c);
  });
  const sent = role => calls.filter(c => role === 'judge' ? c.body.temperature === 0 : role === 'compose' ? c.body.temperature !== 0 : true);
  return { calls, request, sent };
}
// A fake Apron connection that records sent frames and acknowledges each new post and history read; `emit` delivers
// server frames. Set `history` to the messages a history read returns.
export function socket() {
  const listeners = {}, sent = [];
  return {
    sent, readyState: 1,
    addEventListener(type, f) { (listeners[type] ??= []).push(f); },
    removeEventListener(type, f) { listeners[type] = listeners[type]?.filter(g => g !== f); },
    emit(frame) { listeners.message?.forEach(f => f({ data: JSON.stringify(frame) })); },
    close() { this.readyState = 3; listeners.close?.forEach(f => f({ type: 'close', code: 1006, reason: '' })); },
    send(raw) {
      const frame = JSON.parse(raw); sent.push(frame);
      if (frame.method === 'message' && !frame.params.deleted) queueMicrotask(() => this.emit({ id: frame.id, result: { message_id: `posted-${frame.id}` } }));
      if (frame.method === 'history' && frame.params.room_id) queueMicrotask(() => this.emit({ id: frame.id, result: { messages: this.history ?? [] } }));
    },
  };
}
