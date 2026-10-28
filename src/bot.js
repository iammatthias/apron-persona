import { classify, decision, fresh, decay, learn, persona, fingerprint, incoming } from './core.js';
import { settings, restore, systemPrompt } from './settings.js';
import { Log, event } from './events.js';
const TTL = 300000;
// One live Apron connection: learns community style and replies when addressed.
export class Bot {
  constructor(env, store, { connect = url => new WebSocket(url), request = fetch, log = new Log() } = {}) {
    this.env = env; this.store = store; this.connectTo = connect; this.request = request; this.log = log;
    this.rooms = env.ROOMS.split(',').map(s => s.trim()).filter(Boolean);
    const saved = store.load();
    this.state = saved.personality ?? fresh();
    this.budget = saved.budget ?? { day: '', calls: 0 };
    this.settings = restore(saved);
    this.context = []; this.seen = new Map(); this.people = new Map();
    this.bots = new Set(); this.own = new Set(); this.lastReply = 0; this.error = null; this.lastError = null;
    this.seq = 0; this.waiting = new Map(); this.ready = false; this.pending = 0; this.queue = Promise.resolve();
  }
  save() {
    this.store.save({ personality: this.state, budget: this.budget, settings: this.settings });
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
    else if (this.ready) this.send('ping', {});
  }
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
  // Applies owner settings only when every key in the patch parses.
  configure(patch) {
    const parsed = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!Object.hasOwn(settings, k)) throw Error(`unknown setting ${k}`);
      parsed[k] = settings[k].parse(v);
    }
    if (!Object.keys(parsed).length) throw Error('nothing to save');
    this.settings = { ...this.settings, ...parsed }; this.save();
    this.record('settings', { keys: Object.keys(parsed) });
  }
  async remove(room_id, message_id) {
    await this.call('message', { room_id, message_id, deleted: true });
    this.record('deleted', { room: room_id, message_id });
  }
  mentioned(p) {
    const text = typeof p?.body?.text === 'string' ? p.body.text.slice(0, 2000) : '';
    return !!this.self && (p?.body?.mentions?.includes(this.self) === true || text.includes(`@${this.self}`)) || this.own.has(p?.reply_to?.message_id);
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
      const p = frame.params, mentioned = this.mentioned(p);
      // Text is kept, in memory only, just for messages that engage the bot.
      const seen = { room: p?.room_id, message_id: p?.message_id, reply_to: p?.reply_to?.message_id, from: p?.from?.user_id, mentioned,
        text: mentioned && typeof p.body?.text === 'string' ? p.body.text.slice(0, 2000) : undefined };
      const skip = incoming(p, this.self, this.bots, this.rooms) ?? (!this.ready ? 'stale' : this.settings.paused ? 'paused' : this.pending >= 4 ? 'busy' : null);
      if (skip) return this.record('message', { ...seen, outcome: skip });
      ++this.pending;
      this.queue = this.queue.then(() => this.ws === ws ? this.handle(p) : { outcome: 'stale' })
        .then(({ posted, ...result }) => {
          this.record('message', { ...seen, ...result });
          if (posted) this.record('posted', { room: p.room_id, reply_to: p.message_id, ...posted });
        }, () => this.fail('message-processing-failed'))
        .finally(() => --this.pending);
    });
  }
  // Switches to another Apron server or token, reconnecting now.
  use(url, token) {
    this.env.APRON_URL = url; this.env.APRON_TOKEN = token;
    if (this.ws) this.drop('switched');
    this.bots.clear(); this.own.clear(); this.self = this.you = this.server = undefined; this.error = null;
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
  async api(body) {
    const day = new Date().toISOString().slice(0, 10);
    if (this.budget.day !== day) this.budget = { day, calls: 0 };
    if (this.budget.calls >= +this.env.DAILY_CALLS) throw Error('budget');
    ++this.budget.calls; this.save();
    const res = await this.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(20000),
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
    const mentioned = this.mentioned(p);
    this.context.push({ room: p.room_id, at: now, role: 'user', content: text });
    const participant = await fingerprint(this.env.HASH_SECRET, p.from.user_id);
    // One learning contribution per participant per five minutes.
    const eligible = !this.people.has(participant);
    if (!eligible && !mentioned) return { outcome: 'rate-limited' };
    const failed = (outcome, e, scores) => e.message === 'budget' ? { outcome: 'budget', ...scores } : { outcome, detail: e.name === 'TimeoutError' ? 'timeout' : e.message, ...scores };
    let result;
    try { result = decision(await this.api({ model: this.env.DECISION_MODEL, max_tokens: 1500, temperature: 0, messages: classify(text) })); }
    catch (e) { return failed('classify-failed', e); }
    if (connection !== this.ws) return { outcome: 'stale' };
    if (eligible && result.learn >= .8) {
      this.people.set(participant, now);
      learn(this.state, result.vector, result.learn, now, +this.env.HALF_LIFE_DAYS); this.dirty = true;
    }
    const scores = { learn_p: result.learn, reply_p: result.reply };
    if (!mentioned) return { outcome: 'learned-only', ...scores };
    if (result.reply < .7) return { outcome: 'declined', ...scores };
    if (now - this.lastReply < 15000) return { outcome: 'cooldown', ...scores };
    this.prune();
    let output;
    try {
      output = await this.api({
        model: this.env.CHAT_MODEL, max_tokens: 1500,
        messages: [{ role: 'system', content: systemPrompt(this.settings, this.traits(), this.name) },
          ...this.context.filter(x => x.room === p.room_id).slice(-8).map(({ role, content }) => ({ role, content }))],
      });
    } catch (e) { return failed('reply-failed', e, scores); }
    const reply = output?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) return { outcome: 'reply-empty', ...scores };
    if (!this.ready || connection !== this.ws) return { outcome: 'stale', ...scores };
    const content = reply.trim().slice(0, 1800);
    const sent = this.call('message', { room_id: p.room_id, body: { text: content }, reply_to: { message_id: p.message_id } });
    this.lastReply = Date.now();
    this.context.push({ room: p.room_id, at: this.lastReply, role: 'assistant', content });
    try { return { outcome: 'replied', ...scores, posted: { message_id: (await sent)?.message_id, text: content } }; }
    catch (e) { return { outcome: 'reply-failed', ...scores, detail: `post-${e.message}` }; }
  }
  // What the server's greeting and the auth result said, for the private page.
  details() {
    return { url: this.env.APRON_URL, since: this.ready ? this.since : null, server: this.server ?? null, you: this.you ?? null };
  }
  // The server names a bot after its owner; the environment's name stands in before sign-in.
  get name() { return this.you?.name ?? this.env.BOT_NAME; }
  traits() { return persona(decay(this.state, Date.now(), +this.env.HALF_LIFE_DAYS)); }
  status() {
    const server = this.ready ? { host: new URL(this.env.APRON_URL).host, agent: this.server?.agent ?? null, user_id: this.self } : null;
    return { connected: this.ready, paused: this.settings.paused, error: this.error, server, budget: this.budget, personality: this.traits() };
  }
}
