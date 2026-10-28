import { chmodSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { Bot } from './bot.js';
import { site, admin } from './http.js';
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
Bun.serve({ port: +env.PORT, fetch: site(bot) });
// The admin portal has no login: bind it only behind a tailnet-only site.
Bun.serve({ port: +env.MOD_PORT, fetch: admin(bot, (url, token) => write('apron.json', { url, token }, 0o600)) });
const stop = () => { if (bot.dirty) bot.save(); bot.ws?.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
