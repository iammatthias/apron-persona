import { named, conversing, classify, decision, fresh, decay, learn, seed, persona, fingerprint, incoming, addressing, trigger } from './core.js';
import { settings, restore, systemPrompt, roomPrompt, line } from './settings.js';
import { Log, event, stages } from './events.js';
import { read, chunk, synthesize } from './learn.js';
import { empty, tally, roll, dayOf, digest, onepager } from './memory.js';
import { schemas, fits } from './disk.js';
import * as models from './models.js';
const TTL = 300000;
// A message is answered within DEADLINE or not at all; the room history gets CONTEXT ms before the bot's own memory
// stands in; a typing notice is renewed every TYPING ms while a reply is drafted.
const DEADLINE = 25000, CONTEXT = 3000, TYPING = 6000;
// Failures that are outcomes in their own right, with no detail to add.
const plain = new Set(['budget', 'stale', 'reply-empty', 'superseded']);
// One live Apron connection: learns community style, replies when addressed, and may chime in when the owner allows.
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
    this.settings = restore(saved);
    this.memory = roll(ok('memory', saved.memory) ? saved.memory : empty(), dayOf(Date.now()));
    this.context = []; this.seen = new Map(); this.people = new Map();
    this.bots = new Set(); this.own = new Set(); this.spoke = new Set(); this.newest = new Map(); this.drafting = new Map(); this.heard = new Map(); this.answered = new Map(); this.error = null; this.lastError = null;
    this.seq = 0; this.waiting = new Map(); this.ready = false; this.pending = 0; this.queue = Promise.resolve(); this.learning = null;
  }
  // A refused write is recorded and the bot carries on; the next save tries again.
  save() {
    try { this.store.save({ personality: this.state, budget: this.budget, settings: this.settings, memory: roll(this.memory, dayOf(Date.now())) }); }
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
    this.ws = null; this.ready = false; this.context = [];
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
  send(method, params, id = String(++this.seq)) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ method, id, params }));
  }
  // A request whose response resolves the returned promise, within 10 s or the signal.
  call(method, params, signal) {
    if (!this.ready || this.ws?.readyState !== 1) return Promise.reject(Error('not-connected'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const end = (error, value) => { this.timers.clearTimeout(timer); signal?.removeEventListener('abort', abort); this.waiting.delete(id); error ? reject(error) : resolve(value); };
      const abort = () => end(signal.reason);
      const timer = this.timers.setTimeout(() => end(Error('timeout')), 10000);
      signal?.addEventListener('abort', abort);
      this.waiting.set(id, frame => end(frame.error ? Error(frame.error.message || 'apron-request-failed') : null, frame.result));
      this.send(method, params, id);
    });
  }
  // The bot's own live messages, newest first, read from Apron and never stored.
  async posts() {
    const pages = await Promise.all(this.rooms.map(room_id => this.call('history', { room_id, limit: 200 })));
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
  addressed(p) {
    const text = typeof p?.body?.text === 'string' ? p.body.text.slice(0, 2000) : '';
    const mention = !!this.self && (p?.body?.mentions?.includes(this.self) === true || text.includes(`@${this.self}`) || named(text, [this.name, this.self]));
    // Who spoke when, per room, in memory only: a sender alone with the bot, or just answered by it, is talking to it.
    const room = p?.room_id, user = p?.from?.user_id, now = Date.now();
    let talking = false;
    if (!incoming(p, this.self, this.bots, this.rooms)) {
      const heard = this.heard.get(room) ?? new Map();
      talking = conversing(heard, this.answered.get(room) ?? new Map(), user, now);
      heard.set(user, now); this.heard.set(room, heard);
      for (const [id, at] of heard) if (now - at > 30 * 60000) heard.delete(id);
    }
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
      const p = frame.params, addressed = this.addressed(p);
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
      this.queue = this.queue.then(() => this.ws === ws ? this.handle(p) : { outcome: 'stale' })
        .then(({ posted, respond, topic, ...result }) => {
          this.record('message', { ...seen, text: text(addressed || respond), ...result });
          if (topic) { tally(this.memory, p.room_id, dayOf(Date.now()), { topic, engaged: !!addressed, outcome: result.outcome, style: result.style }); this.dirty = true; }
          if (posted) this.record('posted', { room: p.room_id, ...posted });
        }, () => this.fail('message-processing-failed'))
        .finally(() => --this.pending);
    });
  }
  // Switches to another Apron server or token, reconnecting now.
  use(url, token) {
    this.env.APRON_URL = url; this.env.APRON_TOKEN = token;
    if (this.ws) this.drop('switched');
    this.bots.clear(); this.own.clear(); this.self = this.you = this.server = this.latency = undefined; this.error = null;
    this.connect();
  }
  authed(you) {
    this.self = you.user_id; this.you = you; this.ready = true; this.error = null; this.since = Date.now();
    this.record('connected', { host: new URL(this.env.APRON_URL).host, user_id: this.self });
    for (const room_id of this.rooms) this.send('room_join', { room_id });
  }
  prune() {
    const now = Date.now();
    this.context = this.context.filter(x => now - x.at < TTL).slice(-12);
    for (const map of [this.seen, this.people]) for (const [k, v] of map) if (now - v > TTL) map.delete(k);
    while (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value);
  }
  // Calls left today.
  left() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.budget.day !== day) this.budget = { day, calls: 0 };
    return +this.env.DAILY_CALLS - this.budget.calls;
  }
  // One request to OpenRouter, counted against the day's calls before it is sent.
  async api(body, signal) {
    if (this.left() <= 0) throw Error('budget');
    ++this.budget.calls; this.save();
    const res = await this.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, provider: { data_collection: 'deny' } }),
    });
    if (!res.ok) throw Error(`inference-${res.status}`);
    return res.json();
  }
  // Asks the models of one role, in the table's order, while the day's calls last; raced() hears of a hedge.
  ask(role, body, parse, signal, raced) {
    return models.ask(this.models[role], body, parse, { send: (b, s) => this.api(b, s), afford: () => this.left() > 0, raced, signal, timers: this.timers });
  }
  // What became of one message that passed incoming(): an outcome, the classifier's probabilities once known, and the
  // time each stage took. Everything the message starts stops when it is settled or when the deadline or the
  // connection ends it.
  async handle(p) {
    const connection = this.ws, began = performance.now();
    this.prune();
    const text = p.body.text.slice(0, 2000), now = Date.now();
    const hash = await fingerprint(this.env.HASH_SECRET, text);
    if (this.seen.has(hash)) return { outcome: 'duplicate' };
    this.seen.set(hash, now);
    const addressed = this.addressed(p);
    const speaker = (typeof p.from.name === 'string' && p.from.name.replace(/\s+/g, ' ').trim().slice(0, 64)) || p.from.user_id;
    this.context.push({ room: p.room_id, at: now, name: speaker, content: text });
    const participant = await fingerprint(this.env.HASH_SECRET, p.from.user_id);
    // One learning contribution per participant per five minutes.
    const eligible = !this.people.has(participant);
    // The bot spoke last here until this message; a chime-in waits for that.
    const spokeLast = this.spoke.delete(p.room_id);
    const early = trigger(this.settings, { addressed, eligible });
    if (early) return { outcome: early.outcome };
    const latest = this.newest.get(p.room_id)?.get(p.from.user_id);
    if (addressed && latest !== undefined && latest !== p.message_id) return { outcome: 'superseded' };
    const run = new AbortController(), ms = {}, via = {}, hedged = [];
    const timed = async (stage, work) => { const from = performance.now(); try { return await work(); } finally { ms[stage] = Math.round(performance.now() - from); } };
    const asked = async (role, body, parse) => {
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
      const result = await this.pipeline(p, { text, addressed, eligible, participant, spokeLast, now, connection, signal: run.signal, timed, asked, post: () => posting = true });
      const spans = Object.fromEntries(stages.filter(k => ms[k] !== undefined).map(k => [k, ms[k]]));
      return { ...result, ms: { ...spans, total: Math.round(performance.now() - began) }, ...Object.keys(via).length ? { via } : {}, ...hedged.length ? { hedged } : {} };
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
  async pipeline(p, { text, addressed, eligible, participant, spokeLast, now, connection, signal, timed, asked, post }) {
    const failed = (outcome, e, scores = {}) => plain.has(e.message) ? { outcome: e.message, ...scores } : { outcome, ...scores, detail: e.message };
    // Would the surest possible verdict post? If not (a trigger off, chiming in off, the bot spoke last), nothing is read or drafted ahead.
    const hopeful = !!trigger(this.settings, { addressed, eligible, reply_p: 1, point_p: 1, spokeLast }).respond;
    const within = (budget, work) => {
      const c = new AbortController(), timer = this.timers.setTimeout(() => c.abort(Error('timeout')), budget), relay = () => c.abort(signal.reason);
      signal.addEventListener('abort', relay);
      return work(c.signal).finally(() => { this.timers.clearTimeout(timer); signal.removeEventListener('abort', relay); });
    };
    const own = () => this.context.filter(x => x.room === p.room_id).slice(-8);
    const context = hopeful ? timed('context', () => within(CONTEXT, s => this.recent(p, s))).then(lines => lines ?? own(), own) : null;
    const draft = organic => context.then(lines => {
      if (signal.aborted) throw signal.reason;
      const stop = this.typing(p.room_id, connection);
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
    if (learned) {
      this.people.set(participant, now);
      learn(this.state, result.vector, result.learn, now, +this.env.HALF_LIFE_DAYS); this.dirty = true;
    }
    // style is present only when the message was learned from.
    const scores = unsized ? { detail: unsized } : { learn_p: result.learn, reply_p: result.reply, point_p: result.point, topic: result.topic, style: learned ? result.vector : undefined };
    const { respond, ...verdict } = trigger(this.settings, { addressed, eligible, reply_p: result.reply, point_p: result.point, spokeLast });
    if (!respond) return { ...verdict, ...scores };
    const organic = respond === 'organic';
    compose ??= draft(organic);
    let reply;
    try { reply = await compose; } catch (e) { return failed('reply-failed', e, { respond, ...scores }); }
    if (!this.ready || connection !== this.ws) return { outcome: 'stale', respond, ...scores };
    const content = reply.slice(0, 1800);
    post();
    // A chime-in is a plain message, not a reply to the one that prompted it.
    const sent = timed('post', () => this.call('message', { room_id: p.room_id, body: { text: content }, ...organic ? {} : { reply_to: { message_id: p.message_id } } }, signal));
    const at = Date.now();
    this.spoke.add(p.room_id);
    if (!organic) {
      const answered = this.answered.get(p.room_id) ?? new Map();
      answered.set(p.from.user_id, at); this.answered.set(p.room_id, answered);
      for (const [id, when] of answered) if (at - when > 10 * 60000) answered.delete(id);
    }
    this.context.push({ room: p.room_id, at, name: 'you', content });
    try { return { ...verdict, respond, ...scores, posted: { message_id: (await sent)?.message_id, ...organic ? { organic: true } : { reply_to: p.message_id }, text: content } }; }
    catch (e) { return { outcome: 'reply-failed', respond, ...scores, detail: `post-${e.message}` }; }
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
  async recent(p, signal, size = 20) {
    const page = await this.call('history', { room_id: p.room_id, limit: 40 }, signal);
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
  traits() { return persona(decay(this.state, Date.now(), +this.env.HALF_LIFE_DAYS)); }
  status() {
    const agent = typeof this.server?.agent === 'string' ? this.server.agent.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null;
    const server = this.ready ? { host: new URL(this.env.APRON_URL).host, agent, user_id: this.self } : null;
    return { connected: this.ready, paused: this.settings.paused, error: this.error, server, budget: this.budget, personality: this.traits() };
  }
}
