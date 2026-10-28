import { renameSync, writeFileSync, readFileSync } from 'node:fs';
import { Bot } from './bot.js';
const defaults = {
  APRON_URL: 'wss://server.apron.chat/', ROOMS: 'general', BOT_NAME: 'Apron Persona',
  DECISION_MODEL: 'openrouter/free', CHAT_MODEL: 'openrouter/free', DAILY_CALLS: '40', HALF_LIFE_DAYS: '30',
  DATA_DIR: '/data',
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
const stop = () => { if (bot.dirty) bot.save(); bot.ws?.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
