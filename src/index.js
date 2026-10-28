import { renameSync, writeFileSync, readFileSync } from 'node:fs';
import { Bot } from './bot.js';
import { page } from './page.js';
import { timingSafeEqual, createHash } from 'node:crypto';
const defaults = {
  APRON_URL: 'wss://server.apron.chat/', ROOMS: 'general', BOT_NAME: 'Apron Persona',
  DECISION_MODEL: 'openrouter/free', CHAT_MODEL: 'openrouter/free', DAILY_CALLS: '40', HALF_LIFE_DAYS: '30',
  DATA_DIR: '/data', PORT: '8080', MOD_PORT: '8081',
};
const env = { ...defaults, ...process.env };
for (const k of ['APRON_TOKEN', 'OPENROUTER_API_KEY', 'HASH_SECRET']) if (!env[k]) throw Error(`missing ${k}`);
// Atomic JSON files: a crash mid-write keeps the previous version.
const write = (name, value) => {
  const path = `${env.DATA_DIR}/${name}`;
  writeFileSync(`${path}.tmp`, JSON.stringify(value)); renameSync(`${path}.tmp`, path);
};
const store = {
  load() { try { return JSON.parse(readFileSync(`${env.DATA_DIR}/state.json`, 'utf8')); } catch { return {}; } },
  save(state) { write('state.json', state); },
};
const bot = new Bot(env, store);
let last;
const tick = () => {
  bot.tick();
  const status = bot.status();
  write('status.json', status);
  const line = status.connected ? 'connected' : status.error ?? 'connecting';
  if (line !== last) console.log(`apron-persona: ${last = line}`);
};
tick();
setInterval(tick, 60000);
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
Bun.serve({
  port: +env.PORT,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/status.json') return Response.json(bot.status());
    if (path === '/') return html(page(env.BOT_NAME, bot.status()));
    return new Response('Not found', { status: 404 });
  },
});
// Moderation: bind only behind a private site, behind Basic auth with MOD_PASSWORD
// (any user name). Without a password it does not start. Deletes also require a
// same-origin form post.
const digest = s => createHash('sha256').update(s).digest();
const authorized = req => {
  const [scheme, value] = (req.headers.get('Authorization') ?? '').split(' ');
  let password = '';
  try { if (scheme === 'Basic') password = atob(value).split(':').slice(1).join(':'); } catch {}
  return timingSafeEqual(digest(password), digest(env.MOD_PASSWORD));
};
if (env.MOD_PASSWORD) Bun.serve({
  port: +env.MOD_PORT,
  async fetch(req) {
    if (!authorized(req)) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="moderation"' } });
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/') {
      const posts = await bot.posts().catch(e => ({ error: e.message }));
      return html(page(env.BOT_NAME, bot.status(), posts));
    }
    if (req.method === 'POST' && path === '/delete') {
      if (req.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response('Forbidden', { status: 403 });
      const form = await req.formData();
      const room_id = form.get('room_id'), message_id = form.get('message_id');
      if (!bot.rooms.includes(room_id) || typeof message_id !== 'string') return new Response('Bad request', { status: 400 });
      const mine = (await bot.posts().catch(() => [])).some(m => m.message_id === message_id && m.room_id === room_id);
      if (!mine) return new Response('Not found', { status: 404 });
      await bot.remove(room_id, message_id).catch(() => {});
      return new Response(null, { status: 303, headers: { Location: '/' } });
    }
    return new Response('Not found', { status: 404 });
  },
});
const stop = () => { if (bot.dirty) bot.save(); bot.ws?.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
