import { chmodSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { Bot } from './bot.js';
import { page, portal, tabs } from './page.js';
import { settings } from './settings.js';
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
    if (path === '/') return html(page(bot.name, bot.status()));
    return new Response('Not found', { status: 404 });
  },
});
// The admin portal has no login: bind it only behind a tailnet-only site. Writes
// require a same-origin form post, and each reports its outcome on the tab it came from.
const tabOf = id => tabs.some(t => t.id === id) ? id : 'overview';
const back = (tab, key, text) => new Response(null, { status: 303, headers: { Location: `/?tab=${tab}&${key}=${encodeURIComponent(text)}` } });
const actions = {
  async '/apron'(form) {
    const url = String(form.get('url') ?? '').trim(), token = String(form.get('token') ?? '').trim();
    let valid = false; try { valid = new URL(url).protocol === 'wss:'; } catch {}
    if (!valid || !token || token.length > 512) throw Error('a wss:// URL and a token are required');
    write('apron.json', { url, token }, 0o600);
    bot.use(url, token);
    return 'Saved; reconnecting';
  },
  async '/delete'(form) {
    const room_id = form.get('room_id'), message_id = form.get('message_id');
    if (!bot.rooms.includes(room_id) || typeof message_id !== 'string') throw Error('unknown message');
    if (!(await bot.posts()).some(m => m.message_id === message_id && m.room_id === room_id)) throw Error('not one of the bot\'s live posts');
    await bot.remove(room_id, message_id);
    return 'Deleted';
  },
  async '/settings'(form) {
    bot.configure(Object.fromEntries(Object.keys(settings).filter(k => form.has(k)).map(k => [k, form.get(k)])));
    if (!form.has('paused')) return 'Saved';
    return bot.settings.paused ? 'Paused: not reading or replying' : 'Resumed';
  },
  async '/persona/reset'() { bot.configure({ persona: settings.persona.default() }); return 'Reset to the default persona'; },
};
Bun.serve({
  port: +env.MOD_PORT,
  async fetch(req) {
    const url = new URL(req.url), action = actions[url.pathname];
    if (req.method === 'GET' && url.pathname === '/') {
      const tab = tabOf(url.searchParams.get('tab')), q = url.searchParams;
      const posts = tab === 'moderation' ? await bot.posts().catch(e => ({ error: e.message })) : null;
      const flash = q.get('error') ? { error: q.get('error') } : q.get('ok') ? { ok: q.get('ok') } : null;
      return html(portal({ tab, name: bot.name, status: bot.status(), settings: bot.settings, limit: env.DAILY_CALLS, details: bot.details(), url: env.APRON_URL, posts, flash }));
    }
    if (req.method === 'POST' && action) {
      if (req.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response('Forbidden', { status: 403 });
      let tab = 'overview';
      try { const form = await req.formData(); tab = tabOf(form.get('tab')); return back(tab, 'ok', await action(form)); }
      catch (e) { return back(tab, 'error', e.message || 'failed'); }
    }
    return new Response('Not found', { status: 404 });
  },
});
const stop = () => { if (bot.dirty) bot.save(); bot.ws?.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
