import { named, conversing, classify, decision, fresh, decay, learn, seed, persona, fingerprint, incoming, addressing, trigger, LOOP_WINDOW } from './core.js';
import { settings, restore, systemPrompt, roomPrompt, line, recall } from './settings.js';
import { Log, event, stages } from './events.js';
import { read, chunk, synthesize } from './learn.js';
import { empty, tally, roll, dayOf, digest, onepager } from './memory.js';
import { schemas, fits } from './disk.js';
import * as models from './models.js';
const TTL = 300000;
// A message is answered within DEADLINE or not at all; a typing notice is renewed every TYPING ms while a reply is drafted.
const DEADLINE = 25000, TYPING = 6000;
// Failures that are outcomes in their own right, with no detail to add.
const plain = new Set(['budget', 'stale', 'reply-empty', 'superseded']);
// One live Apron connection: learns community style, replies when addressed, and may chime in when the owner allows.
// DAILY_CALLS as a whole number of calls, or null for no cap when it is unset, blank or not a number.
export function dailyCap(value) {
  const n = Number(String(value ?? '').trim() || NaN);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
export class Bot {
  constructor(env, store, { connect = url => new WebSocket(url), request = fetch, log = new Log(), retry = 2000, timers = models.real } = {}) {
    this.env = env; this.store = store; this.connectTo = connect; this.request = request; this.log = log; this.retry = retry; this.timers = timers;
    this.models = models.table(env);
    this.rooms = env.ROOMS.split(',').map(s => s.trim()).filter(Boolean);
    const saved = store.load();
    // Each section is checked as it loads: one that wouldn't pass the write check falls back to its default,
    // so a save can't be refused for something already on disk. Retention applies straight away.
    const ok = (key, value) => fits(schemas['state.json'].fields[key], value);
    this.state = ok('personality', saved.personality) ? saved.personality : fresh();
    this.budget = ok('budget', saved.budget) ? saved.budget : { day: '', calls: 0 };
    // A state.json from before the counter has none, so the day's earlier calls stay unsorted.
    this.spent = ok('spent', saved.spent) ? saved.spent : {};
    this.settings = restore(saved);
    this.memory = roll(ok('memory', saved.memory) ? saved.memory : empty(), dayOf(Date.now()));
    this.context = []; this.seen = new Map(); this.people = new Map();
    this.bots = new Set(); this.own = new Set(); this.newest = new Map(); this.drafting = new Map(); this.heard = new Map(); this.answered = new Map(); this.error = null; this.lastError = null;
    // Per room: who took each of its last LOOP_WINDOW turns, oldest first. null is a message from someone else; a string
    // is a turn of the bot's own (a post, or a draft its sender talked over), naming whom it answered ('' for a
    // chime-in). A message dropped before it is handled (busy, paused) takes no turn. Turns answering the owner never
    // rest the room; they still pace chime-ins.
    this.turns = new Map();
    // Watched rooms the server refused this sign-in, with what it said. Asking again for a room it refused drew
    // "Repeated policy violations" and a dropped connection, so one is left alone until the next sign-in tries it again.
    this.unavailable = new Map();
    // Servers deduplicate requests by (user_id, id) across reconnects and restarts (§1.2), so ids carry a prefix
    // fresh to this process: a restarted bot must never reuse an id the server still remembers.
    this.seq = 0; this.boot = crypto.randomUUID().slice(0, 8); this.waiting = new Map(); this.ready = false; this.pending = 0; this.queue = Promise.resolve(); this.learning = null;
  }
  // A refused write is recorded and the bot carries on; the next save tries again.
  save() {
    try { this.store.save({ personality: this.state, budget: this.budget, spent: this.spent, settings: this.settings, memory: roll(this.memory, dayOf(Date.now())) }); }
    catch { this.fail('state-refused'); }
    this.dirty = false;
  }
  record(kind, fields) { this.log.push(event(kind, fields)); }
  // Unlike `error`, `lastError` survives reconnecting. A repeat of the current error is not recorded again.
  fail(code) {
    if (this.error === code) return;
    this.error = code; this.lastError = { code, at: Date.now() };
    this.record('error', { code });
  }
  // Only a connection that was signed in is lost; an attempt that ends sooner is tried again next tick.
  drop(reason) {
    const ws = this.ws, up = this.ready;
    // What was queued on this connection is dropped as stale, so nothing it was the newest of remains.
    this.ws = null; this.ready = false; this.context = []; this.newest.clear();
    if (up) this.record('disconnected', { reason });
    ws.close();
    // A signed-in socket that the network broke comes back in seconds, not at the next minute tick.
    if (up && /^close-|^error$/.test(reason)) setTimeout(() => this.ws || this.connect(), this.retry).unref?.();
  }
  // Runs every minute: reconnects, pings, expires context, and checkpoints.
  tick() {
    this.prune();
    if (this.dirty) this.save();
    if (this.ws && !this.ready && Date.now() - this.connectedAt > 30000) this.drop('auth-timeout');
    if (!this.ws && !this.env.APRON_TOKEN) this.fail('no-apron-token');
    else if (!this.ws) this.connect();
    else if (this.ready && Date.now() - this.lastFrame > 120000) this.drop('silent');
    else if (this.ready) this.ping();
  }
  // The server answers a ping with a pong frame, never a response, so the round trip is timed by hand.
  ping() { this.pingedAt = Date.now(); this.send('ping', {}); }
  send(method, params, id = `${this.boot}.${++this.seq}`) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ method, id, params }));
  }
  // A request whose response resolves the returned promise, within 10 s or the signal.
  call(method, params, signal) {
    if (!this.ready || this.ws?.readyState !== 1) return Promise.reject(Error('not-connected'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = `${this.boot}.${++this.seq}`;
    return new Promise((resolve, reject) => {
      const end = (error, value) => { this.timers.clearTimeout(timer); signal?.removeEventListener('abort', abort); this.waiting.delete(id); error ? reject(error) : resolve(value); };
      const abort = () => end(signal.reason);
      const timer = this.timers.setTimeout(() => end(Error('timeout')), 10000);
      signal?.addEventListener('abort', abort);
      this.waiting.set(id, frame => end(frame.error ? Object.assign(Error(frame.error.message || 'apron-request-failed'), { refused: true, code: frame.error.code }) : null, frame.result));
      this.send(method, params, id);
    });
  }
  // Remembers a room the server answered with an error, as opposed to a request that timed out or found no connection.
  // Only invalid_params (the answer for an unknown or invisible room) marks it; a passing server error doesn't.
  refuse(room_id, e) {
    if (e.refused && e.code === -32602) this.unavailable.set(room_id, e.message.slice(0, 200));
  }
  // The bot's own live messages, newest first, read from Apron and never stored. A room whose history the server
  // refuses is left out from then on; any other failure fails the read.
  async posts() {
    const open = this.rooms.filter(room_id => !this.unavailable.has(room_id));
    const pages = await Promise.all(open.map(room_id => this.call('history', { room_id, limit: 200 }).catch(e => { this.refuse(room_id, e); if (!e.refused) throw e; return null; })));
    // History holds every snapshot of a message; only the newest one counts.
    const latest = new Map();
    for (const m of pages.flatMap(p => p?.messages ?? [])) {
      const seen = latest.get(m.message_id);
      if (!seen || BigInt(m.log_id) > BigInt(seen.log_id)) latest.set(m.message_id, m);
    }
    return [...latest.values()]
      .filter(m => m.from?.user_id === this.self && !m.deleted && typeof m.body?.text === 'string')
      .sort((a, b) => (BigInt(b.log_id) > BigInt(a.log_id) ? 1 : -1));
  }
  // Applies owner settings only when every key in the patch parses, and returns the keys whose values moved.
  set(patch) {
    const parsed = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.hasOwn(settings, k)) throw Error(`unknown setting ${k}`);
      parsed[k] = settings[k].parse(v);
    }
    if (!Object.keys(parsed).length) throw Error('nothing to save');
    const keys = Object.keys(parsed).filter(k => JSON.stringify(parsed[k]) !== JSON.stringify(this.settings[k]));
    this.settings = { ...this.settings, ...parsed }; this.save();
    return keys;
  }
  // One form saves every trigger at once, so only the values that moved are recorded.
  configure(patch) {
    const keys = this.set(patch);
    if (keys.length) this.record('settings', { keys, ...Object.fromEntries(keys.map(k => [k, this.settings[k]])) });
  }
  // Drafts a persona and traits from a room's history, in memory only. this.learning moves through reading and thinking
  // to ready, which holds the proposal, or failed. One job runs at a time; the promise never rejects.
  study({ url, token, rooms, cap }) {
    if (this.studying) throw Error('already learning from history');
    const host = new URL(url).host;
    const stage = (stage, fields) => { this.learning = { stage, host, rooms, ...fields }; this.record('learning', this.learning); };
    stage('reading');
    return (async () => {
      const lines = await read(this.connectTo, { url, token, rooms, cap, self: this.self });
      if (!lines.length) return stage('failed', { detail: 'no-messages' });
      const chunks = chunk(lines), count = chunks.reduce((n, c) => n + c.count, 0);
      // Each reading and the merge is one call; a job that can't afford them all makes none.
      if (this.left() < chunks.length + 1) return stage('failed', { count, detail: 'budget' });
      stage('thinking', { count });
      const result = await synthesize(chunks, messages => this.ask('learn', { max_tokens: 6000, messages }, data => data).then(r => r.value));
      stage('ready', { ...result, at: Date.now() });
    })().catch(e => stage('failed', { detail: e.message }));
  }
  get studying() { return ['reading', 'thinking'].includes(this.learning?.stage); }
  // The traits a proposal would leave: what the room has taught so far plus the proposal's head start.
  preview() { return persona(seed(structuredClone(this.state), this.learning.vector, Date.now(), +this.env.HALF_LIFE_DAYS)); }
  adopt(text) {
    const l = this.learning;
    if (l?.stage !== 'ready') throw Error('there is no proposal to apply');
    this.set({ persona: text });
    seed(this.state, l.vector, Date.now(), +this.env.HALF_LIFE_DAYS);
    this.learning = null; this.save();
    this.record('taught', { count: l.count, rooms: l.rooms, host: l.host });
  }
  discard() {
    if (this.studying) throw Error('still learning from history');
    this.learning = null;
  }
  async remove(room_id, message_id) {
    await this.call('message', { room_id, message_id, deleted: true });
    this.record('deleted', { room: room_id, message_id });
  }
  // Who spoke when, per room, in memory only. Recorded once per message, as it arrives.
  hear(p) {
    if (incoming(p, this.self, this.bots, this.rooms)) return;
    const now = Date.now(), heard = this.heard.get(p.room_id) ?? new Map();
    heard.set(p.from.user_id, now); this.heard.set(p.room_id, heard);
    for (const [id, at] of heard) if (now - at > 30 * 60000) heard.delete(id);
  }
  // How a message reaches the bot, from the room as it stands: a sender alone with the bot, or just answered by it,
  // is talking to it. Reads who spoke when; hear() writes it.
  addressed(p) {
    const text = typeof p?.body?.text === 'string' ? p.body.text.slice(0, 2000) : '';
    const mention = !!this.self && (p?.body?.mentions?.includes(this.self) === true || text.includes(`@${this.self}`) || named(text, [this.name, this.self]));
    const room = p?.room_id, user = p?.from?.user_id;
    const talking = !incoming(p, this.self, this.bots, this.rooms) && conversing(this.heard.get(room) ?? new Map(), this.answered.get(room) ?? new Map(), user, Date.now());
    return addressing(this.settings, mention || talking, this.own.has(p?.reply_to?.message_id));
  }
  connect() {
    const ws = this.connectTo(this.env.APRON_URL);
    this.ws = ws; this.connectedAt = this.lastFrame = Date.now(); this.ready = false;
    let greeted = false;
    const closed = e => { if (this.ws === ws) this.drop(e.reason || (e.code ? `close-${e.code}` : e.type ?? 'closed')); };
    ws.addEventListener('close', closed); ws.addEventListener('error', closed);
    ws.addEventListener('message', event => {
      if (this.ws !== ws || typeof event.data !== 'string' || event.data.length > 1048576) return;
      this.lastFrame = Date.now();
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      const waiter = frame.id != null && this.waiting.get(frame.id);
      if (frame.result?.message_id) {
        this.own.add(frame.result.message_id);
        while (this.own.size > 64) this.own.delete(this.own.values().next().value);
      }
      if (waiter) { this.waiting.delete(frame.id); return waiter(frame); }
      if (frame.method === 'pong' && this.pingedAt) { this.latency = Date.now() - this.pingedAt; this.pingedAt = 0; }
      // Each `server` frame replaces the last; only the first is the greeting that sign-in answers.
      if (frame.method === 'server') this.server = frame.params ?? {};
      if (frame.method === 'server' && !greeted) { greeted = true; this.send('auth', { scheme: 'token', token: this.env.APRON_TOKEN }, 'auth'); }
      if (frame.id === 'auth' && frame.error) { this.record('auth-denied'); this.fail('apron-auth-denied'); this.drop('auth-denied'); }
      if (frame.id === 'auth' && frame.result?.you) this.authed(frame.result.you);
      if (frame.method === 'user') {
        if (frame.params?.you) this.you = frame.params.you;
        const u = frame.params?.new ?? frame.params?.you;
        if (u?.roles?.includes('bot')) this.bots.add(u.user_id);
      }
      if (frame.method !== 'message') return;
      const p = frame.params;
      this.hear(p);
      const addressed = this.addressed(p);
      const seen = { room: p?.room_id, message_id: p?.message_id, reply_to: p?.reply_to?.message_id, from: p?.from?.user_id,
        name: typeof p?.from?.name === 'string' ? p.from.name.slice(0, 64) : undefined, addressed };
      // Text is kept, in memory only, just for messages that engage the bot: addressed, or ones it set out to chime in on.
      const text = engaged => engaged && typeof p.body?.text === 'string' ? p.body.text.slice(0, 2000) : undefined;
      const skip = incoming(p, this.self, this.bots, this.rooms) ?? (!this.ready ? 'stale' : this.settings.paused ? 'paused' : this.pending >= 4 ? 'busy' : null);
      if (skip) return this.record('message', { ...seen, text: text(addressed), outcome: skip });
      // A sender's latest message to the bot is the one answered: an older one still being drafted is superseded.
      if (addressed) {
        const latest = this.newest.get(p.room_id) ?? new Map();
        latest.set(p.from.user_id, p.message_id); this.newest.set(p.room_id, latest);
        this.drafting.get(p.room_id)?.(p.from.user_id);
      }
      ++this.pending;
      this.queue = this.queue.then(() => this.ws === ws ? this.handle(p, addressed) : { outcome: 'stale' })
        .then(({ posted, respond, topic, ...result }) => {
          const e = { ...seen, ...result };
          this.record('message', { ...e, text: text(e.addressed || respond) });
          if (topic) { tally(this.memory, p.room_id, dayOf(Date.now()), { topic, engaged: !!e.addressed, outcome: e.outcome, style: e.style }); this.dirty = true; }
          if (posted) this.record('posted', { room: p.room_id, ...posted });
        }, () => this.fail('message-processing-failed'))
        .finally(() => --this.pending);
    });
  }
  // Switches to another Apron server or token, reconnecting now.
  use(url, token) {
    this.env.APRON_URL = url; this.env.APRON_TOKEN = token;
    if (this.ws) this.drop('switched');
    this.bots.clear(); this.own.clear(); this.turns.clear(); this.self = this.you = this.server = this.latency = undefined; this.error = null;
    this.connect();
  }
  authed(you) {
    this.self = you.user_id; this.you = you; this.ready = true; this.error = null; this.since = Date.now();
    this.record('connected', { host: new URL(this.env.APRON_URL).host, user_id: this.self });
    this.unavailable.clear();
    for (const room_id of this.rooms) this.call('room_join', { room_id }).catch(e => this.refuse(room_id, e));
  }
  prune() {
    const now = Date.now();
    this.context = this.context.filter(x => now - x.at < TTL).slice(-12);
    for (const map of [this.seen, this.people]) for (const [k, v] of map) if (now - v > TTL) map.delete(k);
    while (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value);
  }
  // Calls left today. spent sorts the same day's calls by role: every request, and which of them were hedges or retries.
  left() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.budget.day !== day) { this.budget = { day, calls: 0 }; this.spent = {}; }
    // No cap unless the owner sets one: the key allows only free models, and OpenRouter's own rate limit answers 429.
    const cap = dailyCap(this.env.DAILY_CALLS);
    return cap === null ? Infinity : cap - this.budget.calls;
  }
  // One request to OpenRouter, counted against the day's calls before it is sent. An endpoint that refuses to have
  // its thinking turned off ("Reasoning is mandatory") is asked again at once with the thinking merely hidden.
  async api(role, body, signal, why = 'first') {
    if (this.left() <= 0) throw Error('budget');
    const s = this.spent[role] ??= { calls: 0, hedges: 0, retries: 0 };
    ++this.budget.calls; ++s.calls;
    if (why === 'hedge') ++s.hedges; else if (why !== 'first') ++s.retries;
    this.save();
    const res = await this.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, provider: { data_collection: 'deny' } }),
    });
    if (res.status === 400 && body.reasoning?.enabled === false && /reasoning/i.test(await res.text())) return this.api(role, { ...body, reasoning: { exclude: true } }, signal, 'reask');
    if (!res.ok) throw Error(`inference-${res.status}`);
    return res.json();
  }
  // Asks the models of one role, in the table's order, while the day's calls last; raced() hears of a hedge.
  ask(role, body, parse, signal, raced) {
    return models.ask(this.models[role], body, parse, { send: (b, s, why) => this.api(role, b, s, why), afford: () => this.left() > 0, raced, signal, timers: this.timers });
  }
  // What became of one message that passed incoming(): an outcome, how it addressed the bot, the classifier's
  // probabilities once known, and the time each stage took. `addressed` is how the message read when it arrived;
  // one that read as nothing then may have become a follow-up since, once the bot answered its sender, so it is
  // read again now. It is never read down: what the arrival decided (the newest, the draft it superseded) stands.
  async handle(p, addressed) {
    addressed ??= this.addressed(p);
    return { addressed, ...await this.consider(p, addressed) };
  }
  // Everything the message starts stops when it is settled or when the deadline or the connection ends it.
  async consider(p, addressed) {
    const connection = this.ws, began = performance.now();
    this.prune();
    // This message is no longer pending, so it is no longer anyone's newest; a newer one from its sender supersedes it.
    const pending = this.newest.get(p.room_id), mine = pending?.get(p.from.user_id) === p.message_id;
    if (mine) pending.delete(p.from.user_id);
    const text = p.body.text.slice(0, 2000), now = Date.now();
    const hash = await fingerprint(this.env.HASH_SECRET, text);
    if (this.seen.has(hash)) return { outcome: 'duplicate' };
    this.seen.set(hash, now);
    const speaker = (typeof p.from.name === 'string' && p.from.name.replace(/\s+/g, ' ').trim().slice(0, 64)) || p.from.user_id;
    this.context.push({ room: p.room_id, at: now, name: speaker, content: text });
    const participant = await fingerprint(this.env.HASH_SECRET, p.from.user_id);
    // One learning contribution per participant per five minutes.
    const eligible = !this.people.has(participant);
    // The room's last turns as they stand, before this message takes one: how many are the bot's own (none, to its
    // owner), and how many messages have followed its last post, this one included.
    const log = this.turns.get(p.room_id) ?? [], last = log.findLastIndex(x => x !== null);
    const turns = p.from.user_id === this.owner ? 0 : log.filter(x => x !== null && x !== this.owner).length;
    const since = last < 0 ? Infinity : log.length - last;
    // What this message left in the room: a turn of its sender's, and one of the bot's where its post went out. A
    // message its sender talked over took no turn of theirs; the draft it ended, if one had started, took one of the
    // bot's, so a burst that talks over every draft rests the room as surely as one that draws every reply. So does an
    // addressed message that spent calls and posted nothing (declined or failed): with no daily cap, those add up too.
    const took = (result, spent = false) => {
      if (result.outcome !== 'superseded') log.push(null);
      if (result.posted || (spent && (addressed || result.outcome === 'superseded'))) log.push(result.posted?.organic ? '' : p.from.user_id);
      this.turns.set(p.room_id, log.slice(-LOOP_WINDOW));
      return result;
    };
    if (addressed && !mine && pending?.has(p.from.user_id)) return took({ outcome: 'superseded' });
    const early = trigger(this.settings, { addressed, eligible, since, turns });
    if (early) return took({ outcome: early.outcome });
    const run = new AbortController(), ms = {}, via = {}, hedged = [];
    let spent = false;
    const timed = async (stage, work) => { const from = performance.now(); try { return await work(); } finally { ms[stage] = Math.round(performance.now() - from); } };
    const asked = async (role, body, parse) => {
      spent = true;
      const r = await timed(role, () => this.ask(role, body, parse, run.signal, () => hedged.includes(role) || hedged.push(role)));
      via[role] = r.model;
      return r.value;
    };
    const deadline = this.timers.setTimeout(() => run.abort(Error('deadline')), DEADLINE);
    const stale = () => run.abort(Error('stale'));
    connection.addEventListener('close', stale); connection.addEventListener('error', stale);
    // This room's one draft in flight, which the sender's next message supersedes until the reply is on its way.
    let posting = false;
    const slot = user => { if (user === p.from.user_id && !posting) run.abort(Error('superseded')); };
    this.drafting.set(p.room_id, slot);
    try {
      const result = await this.pipeline(p, { text, addressed, eligible, participant, since, turns, now, connection, signal: run.signal, timed, asked, post: () => posting = true });
      const spans = Object.fromEntries(stages.filter(k => ms[k] !== undefined).map(k => [k, ms[k]]));
      return took({ ...result, ms: { ...spans, total: Math.round(performance.now() - began) }, ...Object.keys(via).length ? { via } : {}, ...hedged.length ? { hedged } : {} }, spent);
    } finally {
      run.abort(Error('settled'));
      if (this.drafting.get(p.room_id) === slot) this.drafting.delete(p.room_id);
      this.timers.clearTimeout(deadline);
      connection.removeEventListener('close', stale); connection.removeEventListener('error', stale);
    }
  }
  // The stages: context (the room's history), judge (the classifier) and compose (the reply) run together for a
  // message that addresses the bot, and the judge's verdict gates only the post, so a decline aborts the draft.
  // For any other message the judge decides first whether a reply is drafted at all.
  async pipeline(p, { text, addressed, eligible, participant, since, turns, now, connection, signal, timed, asked, post }) {
    const failed = (outcome, e, scores = {}) => plain.has(e.message) ? { outcome: e.message, ...scores } : { outcome, ...scores, detail: e.message };
    // Would the surest possible verdict post? If not (a trigger off, chiming in off, the bot posted too lately or is resting), nothing is read or drafted ahead.
    const hopeful = !!trigger(this.settings, { addressed, eligible, reply_p: 1, point_p: 1, since, turns }).respond;
    const within = (budget, work) => {
      const c = new AbortController(), timer = this.timers.setTimeout(() => c.abort(Error('timeout')), budget), relay = () => c.abort(signal.reason);
      signal.addEventListener('abort', relay);
      return work(c.signal).finally(() => { this.timers.clearTimeout(timer); signal.removeEventListener('abort', relay); });
    };
    const own = () => this.context.filter(x => x.room === p.room_id).slice(-recall.own);
    const context = hopeful ? timed('context', () => within(recall.wait, s => this.recent(p, s))).then(lines => lines ?? own(), own) : null;
    const draft = organic => context.then(lines => {
      if (signal.aborted) throw signal.reason;
      const body = {
        max_tokens: 1500,
        messages: [{ role: 'system', content: systemPrompt(this.settings, this.traits(), this.name, this.notes(p.room_id)) },
          { role: 'user', content: roomPrompt(lines, organic) }],
      };
      const spoken = data => {
        const raw = data?.choices?.[0]?.message?.content, s = typeof raw === 'string' ? line(raw, ['you', this.name, this.self]) : '';
        if (!s) throw Error('reply-empty');
        return s;
      };
      // The notice starts only once the request is sure to be made, so whatever ends the request ends it.
      const stop = this.typing(p.room_id, connection);
      return asked('compose', body, spoken).finally(stop);
    });
    let compose = addressed && hopeful ? draft(false) : null;
    // A draft nobody posts rejects once aborted; that is expected, not an error to report.
    compose?.catch(() => {});
    let result, unsized;
    try { result = await asked('judge', { max_tokens: 1500, temperature: 0, messages: classify(text) }, decision); }
    catch (e) {
      // Someone talking to the bot gets an answer even when sizing the message up failed; it just learns nothing.
      if (!addressed || plain.has(e.message)) return failed('classify-failed', e);
      unsized = e.message;
      result = { learn: 0, reply: 1, vector: null };
    }
    if (connection !== this.ws) return { outcome: 'stale' };
    const learned = eligible && !unsized && result.learn >= .8;
    // Any classification spends this sender's turn to be learned from, not only one that learned, so an eligible
    // sender isn't judged on every message until one clears the learning bar.
    if (eligible && !unsized) this.people.set(participant, now);
    if (learned) {
      learn(this.state, result.vector, result.learn, now, +this.env.HALF_LIFE_DAYS); this.dirty = true;
    }
    // style is present only when the message was learned from.
    const scores = unsized ? { detail: unsized } : { learn_p: result.learn, reply_p: result.reply, point_p: result.point, topic: result.topic, style: learned ? result.vector : undefined };
    const { respond, ...verdict } = trigger(this.settings, { addressed, eligible, reply_p: result.reply, point_p: result.point, since, turns });
    if (!respond) return { ...verdict, ...scores };
    const organic = respond === 'organic';
    compose ??= draft(organic);
    let reply;
    try { reply = await compose; } catch (e) { return failed('reply-failed', e, { respond, ...scores }); }
    if (!this.ready || connection !== this.ws) return { outcome: 'stale', respond, ...scores };
    // Nothing below is remembered unless the post goes out, and call() refuses an aborted run before sending.
    if (signal.aborted) return failed('reply-failed', signal.reason, { respond, ...scores });
    const content = reply.slice(0, 1800);
    post();
    // A chime-in is a plain message, not a reply to the one that prompted it.
    const sent = timed('post', () => this.call('message', { room_id: p.room_id, body: { text: content }, ...organic ? {} : { reply_to: { message_id: p.message_id } } }, signal));
    // What the room holds once the post has gone out: the bot answered this sender, and said this. consider() records the turn.
    const spoke = () => {
      const at = Date.now();
      if (!organic) {
        const answered = this.answered.get(p.room_id) ?? new Map();
        answered.set(p.from.user_id, at); this.answered.set(p.room_id, answered);
        for (const [id, when] of answered) if (at - when > 10 * 60000) answered.delete(id);
      }
      this.context.push({ room: p.room_id, at, name: 'you', content });
    };
    const where = organic ? { organic: true } : { reply_to: p.message_id };
    let ack;
    try { ack = await sent; } catch (e) {
      // call() sends before anything but a closed socket can fail it. A server error is a post turned away; any other
      // failure is a post the server never confirmed: it went out, and is recorded as posted without the id only the
      // acknowledgement carries.
      if (e.refused || e.message === 'not-connected') return { outcome: 'reply-failed', respond, ...scores, detail: `post-${e.message}` };
      spoke();
      return { ...verdict, respond, ...scores, detail: `post-${e.message}`, posted: { ...where, text: content } };
    }
    spoke();
    return { ...verdict, respond, ...scores, posted: { message_id: ack?.message_id, ...where, text: content } };
  }
  // Shows the room that the bot is typing while a reply is drafted, where the server relays activity: on at once, again
  // every TYPING ms, and off when the draft ends. Returns what ends it; a second call does nothing.
  typing(room_id, connection) {
    if (!Array.isArray(this.server?.capabilities) || !this.server.capabilities.includes('activity')) return () => {};
    let timer, over = false;
    const on = () => { if (this.ws === connection) this.send('activity', { room_id, typing: 8 }); timer = this.timers.setTimeout(on, TYPING); };
    on();
    return () => {
      if (over) return;
      over = true; this.timers.clearTimeout(timer);
      if (this.ws === connection) this.send('activity', { room_id, typing: 0 });
    };
  }
  // The room's last messages up to and including p, read from Apron just for this reply and never kept:
  // what the bot saw live since its last restart is too little to answer from.
  async recent(p, signal, size = recall.lines) {
    if (this.unavailable.has(p.room_id)) return null;
    const page = await this.call('history', { room_id: p.room_id, limit: 40 }, signal).catch(e => { this.refuse(p.room_id, e); throw e; });
    const latest = new Map();
    for (const m of page?.messages ?? []) {
      const seen = latest.get(m.message_id);
      if (!seen || BigInt(m.log_id) > BigInt(seen.log_id)) latest.set(m.message_id, m);
    }
    const rows = [...latest.values()]
      .filter(m => !m.deleted && typeof m.body?.text === 'string' && m.body.text.trim() && !m.from?.user_id?.startsWith('~'))
      .sort((a, b) => (BigInt(a.log_id) < BigInt(b.log_id) ? -1 : 1));
    if (!rows.length) return null;
    const upTo = rows.findIndex(m => m.message_id === p.message_id);
    const window = (upTo < 0 ? [...rows, p] : rows.slice(0, upTo + 1)).slice(-size);
    return window.map(m => ({
      name: m.from?.user_id === this.self ? 'you' : (typeof m.from?.name === 'string' && m.from.name.trim().slice(0, 64)) || m.from?.user_id,
      content: m.body.text.slice(0, 1000),
    }));
  }
  // A room's notes for the prompt. Its digest is rebuilt on the first use after UTC midnight and kept all day, in
  // memory and state.json, so the prompt stays byte-stable between turns; the norms are the owner's current words.
  notes(room, now = Date.now()) {
    const today = dayOf(now), pages = this.memory.pages;
    if (pages[room]?.day !== today) { roll(this.memory, today); pages[room] = digest(this.memory.rooms[room], today); this.dirty = true; }
    return onepager(room, pages[room], this.settings.norms[room]);
  }
  // What the server's greeting and the auth result said, for the private page.
  details() {
    return { url: this.env.APRON_URL, since: this.ready ? this.since : null, latency: this.ready ? this.latency ?? null : null, server: this.server ?? null, you: this.you ?? null };
  }
  // The server names a bot after its owner; the environment's name stands in before sign-in.
  get name() { return this.you?.name ?? this.env.BOT_NAME; }
  // The account the bot belongs to: what the auth result says, or failing that the account its user_id is made
  // from. Apron's /invite-bot makes a bot `bot_<owner's user_id>` and sends no owner field; the user_id stays when
  // the owner is renamed, so after a rename this names the old id.
  get owner() {
    if (this.settings.owner) return this.settings.owner;
    if (typeof this.you?.owner === 'string' && this.you.owner) return this.you.owner;
    return typeof this.self === 'string' && this.self.startsWith('bot_') && this.self.length > 4 ? this.self.slice(4) : undefined;
  }
  traits() { return persona(decay(this.state, Date.now(), +this.env.HALF_LIFE_DAYS)); }
  status() {
    const agent = typeof this.server?.agent === 'string' ? this.server.agent.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null;
    const server = this.ready ? { host: new URL(this.env.APRON_URL).host, agent, user_id: this.self } : null;
    return { connected: this.ready, paused: this.settings.paused, error: this.error, server, budget: this.budget, personality: this.traits() };
  }
}
