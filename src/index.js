import { chmodSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { Bot } from './bot.js';
import { page } from './page.js';
const defaults = {
  APRON_URL: 'wss://server.apron.chat/', ROOMS: 'general', BOT_NAME: 'Apron Persona',
  DECISION_MODEL: 'openrouter/free', CHAT_MODEL: 'openrouter/free', DAILY_CALLS: '40', HALF_LIFE_DAYS: '30',
  DATA_DIR: '/data', PORT: '8080', MOD_PORT: '8081',
};
const env = { ...defaults, ...process.env };
for (const k of ['OPENROUTER_API_KEY', 'HASH_SECRET']) if (!env[k]) throw Error(`missing ${k}`);
// The Apron server and token set on the moderation page override the environment.
const apronFile = `${env.DATA_DIR}/apron.json`;
try { const { url, token } = JSON.parse(readFileSync(apronFile, 'utf8')); Object.assign(env, { APRON_URL: url, APRON_TOKEN: token }); } catch {}
// Atomic JSON files: a crash mid-write keeps the previous version.
const write = (name, value, mode = 0o644) => {
  const path = `${env.DATA_DIR}/${name}`;
  writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode }); chmodSync(`${path}.tmp`, mode); renameSync(`${path}.tmp`, path);
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
// Moderation has no login: bind it only behind a tailnet-only site. Writes
// require a same-origin form post.
Bun.serve({
  port: +env.MOD_PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/') {
      const posts = await bot.posts().catch(e => ({ error: e.message }));
      return html(page(env.BOT_NAME, bot.status(), { posts, url: env.APRON_URL }));
    }
    if (req.method === 'POST' && path === '/apron') {
      if (req.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response('Forbidden', { status: 403 });
      const form = await req.formData();
      const url = String(form.get('url') ?? '').trim(), token = String(form.get('token') ?? '').trim();
      let valid = false; try { valid = new URL(url).protocol === 'wss:'; } catch {}
      if (!valid || !token || token.length > 512) return new Response('Bad request: a wss:// URL and a token are required', { status: 400 });
      write('apron.json', { url, token }, 0o600);
      bot.use(url, token);
      return new Response(null, { status: 303, headers: { Location: '/' } });
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
