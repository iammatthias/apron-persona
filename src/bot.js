import { named, classify, decision, fresh, decay, learn, seed, persona, fingerprint, incoming, addressing, trigger } from './core.js';
import { settings, restore, systemPrompt, roomPrompt, line } from './settings.js';
import { Log, event } from './events.js';
import { read, chunk, synthesize } from './learn.js';
import { empty, tally, roll, dayOf, digest, onepager } from './memory.js';
import { schemas, fits } from './disk.js';
const TTL = 300000;
// One live Apron connection: learns community style, replies when addressed, and may chime in when the owner allows.
export class Bot {
  constructor(env, store, { connect = url => new WebSocket(url), request = fetch, log = new Log() } = {}) {
    this.env = env; this.store = store; this.connectTo = connect; this.request = request; this.log = log;
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
    this.bots = new Set(); this.own = new Set(); this.lastReply = 0; this.organic = new Map(); this.error = null; this.lastError = null;
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
  drop(reason) {
    const ws = this.ws;
    this.ws = null; this.ready = false; this.context = [];
    this.record('disconnected', { reason });
    ws.close();
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
  // A request whose response resolves the returned promise.
  call(method, params) {
    if (!this.ready || this.ws?.readyState !== 1) return Promise.reject(Error('not-connected'));
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(Error('timeout')); }, 10000);
      this.waiting.set(id, frame => { clearTimeout(timer); frame.error ? reject(Error(frame.error.message || 'apron-request-failed')) : resolve(frame.result); });
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
      const result = await synthesize(chunks, messages => this.api({ model: this.env.CHAT_MODEL, max_tokens: 6000, messages }, 60000));
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
    return addressing(this.settings, mention, this.own.has(p?.reply_to?.message_id));
  }
  connect() {
    const ws = this.connectTo(this.env.APRON_URL);
    this.ws = ws; this.connectedAt = this.lastFrame = Date.now(); this.ready = false;
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
      if (frame.method === 'server') this.server = frame.params ?? {};
      if (frame.method === 'server') this.send('auth', { scheme: 'token', token: this.env.APRON_TOKEN }, 'auth');
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
  async api(body, wait = 45000) {
    if (this.left() <= 0) throw Error('budget');
    ++this.budget.calls; this.save();
    const res = await this.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(wait),
      headers: { Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, reasoning: { exclude: true }, provider: { data_collection: 'deny' } }),
    });
    if (!res.ok) throw Error(`inference-${res.status}`);
    return res.json();
  }
  // What became of one message that passed incoming(): an outcome, plus the classifier's probabilities once known.
  async handle(p) {
    const connection = this.ws;
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
    const clocks = { now, lastReply: this.lastReply, lastOrganic: this.organic.get(p.room_id) ?? 0 };
    const early = trigger(this.settings, { addressed, eligible }, clocks);
    if (early) return { outcome: early.outcome };
    const failed = (outcome, e, scores) => e.message === 'budget' ? { outcome: 'budget', ...scores } : { outcome, ...scores, detail: e.name === 'TimeoutError' ? 'timeout' : e.message };
    let result, unsized;
    try { result = decision(await this.api({ model: this.env.DECISION_MODEL, max_tokens: 1500, temperature: 0, messages: classify(text) })); }
    catch (e) {
      // Someone talking to the bot gets an answer even when sizing the message up failed; it just learns nothing.
      if (!addressed || e.message === 'budget') return failed('classify-failed', e);
      unsized = failed('classify-failed', e).detail;
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
    const { respond, ...verdict } = trigger(this.settings, { addressed, eligible, reply_p: result.reply, point_p: result.point }, { ...clocks, lastReply: this.lastReply });
    if (!respond) return { ...verdict, ...scores };
    const organic = respond === 'organic';
    this.prune();
    const lines = await this.recent(p).catch(() => null) ?? this.context.filter(x => x.room === p.room_id).slice(-8);
    if (connection !== this.ws) return { outcome: 'stale', respond, ...scores };
    const body = {
      model: this.env.CHAT_MODEL, max_tokens: 1500,
      messages: [{ role: 'system', content: systemPrompt(this.settings, this.traits(), this.name, this.notes(p.room_id)) },
        { role: 'user', content: roomPrompt(lines, organic) }],
    };
    // The free router picks a model per call, so one retry usually lands on a different one.
    let reply = '', error;
    for (let attempt = 0; attempt < 2 && !reply; ++attempt) {
      try {
        const raw = (await this.api(body))?.choices?.[0]?.message?.content;
        reply = typeof raw === 'string' ? line(raw, ['you', this.name, this.self]) : '';
        error = undefined;
      } catch (e) { error = e; if (e.message === 'budget') break; }
      if (connection !== this.ws) return { outcome: 'stale', respond, ...scores };
    }
    if (error) return failed('reply-failed', error, { respond, ...scores });
    if (!reply) return { outcome: 'reply-empty', respond, ...scores };
    if (!this.ready || connection !== this.ws) return { outcome: 'stale', respond, ...scores };
    const content = reply.slice(0, 1800);
    // A chime-in is a plain message, not a reply to the one that prompted it.
    const sent = this.call('message', { room_id: p.room_id, body: { text: content }, ...organic ? {} : { reply_to: { message_id: p.message_id } } });
    this.lastReply = Date.now();
    if (organic) this.organic.set(p.room_id, this.lastReply);
    this.context.push({ room: p.room_id, at: this.lastReply, name: 'you', content });
    try { return { ...verdict, respond, ...scores, posted: { message_id: (await sent)?.message_id, ...organic ? { organic: true } : { reply_to: p.message_id }, text: content } }; }
    catch (e) { return { outcome: 'reply-failed', respond, ...scores, detail: `post-${e.message}` }; }
  }
  // The room's last messages up to and including p, read from Apron just for this reply and never kept:
  // what the bot saw live since its last restart is too little to answer from.
  async recent(p, size = 20) {
    const page = await this.call('history', { room_id: p.room_id, limit: 40 });
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
