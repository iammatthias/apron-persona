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
    c.fail = settle(status => resolve(new Response('', { status })));
    c.throw = settle(reject);
    init.signal?.addEventListener('abort', () => { c.aborted = init.signal.reason?.message ?? 'aborted'; c.throw(init.signal.reason); });
    calls.push(c);
  });
  const sent = role => calls.filter(c => role === 'judge' ? c.body.temperature === 0 : role === 'compose' ? c.body.temperature !== 0 : true);
  return { calls, request, sent };
}
