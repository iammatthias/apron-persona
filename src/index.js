import { Bot } from './bot.js';
import { disk } from './disk.js';
import { site, admin } from './http.js';
const defaults = {
  APRON_URL: 'wss://server.apron.chat/', ROOMS: 'general', BOT_NAME: 'Apron Persona',
  DECISION_MODEL: 'openrouter/free', CHAT_MODEL: 'openrouter/free', DAILY_CALLS: '40', HALF_LIFE_DAYS: '30',
  DATA_DIR: '/data', PORT: '8080', MOD_PORT: '8081',
};
const env = { ...defaults, ...process.env };
for (const k of ['OPENROUTER_API_KEY', 'HASH_SECRET']) if (!env[k]) throw Error(`missing ${k}`);
const { write, load } = disk(env.DATA_DIR);
// The Apron server and token set on the moderation page override the environment.
const saved = load('apron.json');
if (saved.url && saved.token) Object.assign(env, { APRON_URL: saved.url, APRON_TOKEN: saved.token });
const store = { load: () => load('state.json'), save: state => write('state.json', state) };
const bot = new Bot(env, store);
let last;
const tick = () => {
  bot.tick();
  const status = bot.status();
  // A refused status write is logged and skipped: the minute timer must not take the bot down.
  try { write('status.json', status); } catch { status.error = 'status-refused'; }
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
