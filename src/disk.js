import { chmodSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { axes } from './core.js';
import { topics } from './memory.js';
// What never reaches DATA_DIR, and why. The schemas below leave no slot for any of it.
export const never = {
  'message text': 'people talk to each other in the room, not to a record',
  'sender names': 'a name ties whatever is stored to a person',
  'sender user ids': 'an id is a name that never changes',
  'auth tokens outside apron.json': 'a secret lives only in the one file kept at mode 600',
  prompts: 'every prompt carries the transcript',
  'model output': 'a reply quotes and paraphrases the room',
};
const string = (re, max) => v => typeof v === 'string' && v.length <= max && re.test(v);
const boolean = v => typeof v === 'boolean', number = Number.isFinite, count = v => Number.isInteger(v) && v >= 0;
const date = string(/^\d{4}-\d{2}-\d{2}$/, 10);
// The only free text allowed: what the owner wrote on the admin portal.
const owner = max => string(/^[^]*$/, max);
const object = fields => ({ fields }), map = (key, value) => ({ key, value }), nullable = of => ({ nullable: of });
const list = (of, max, min = 0) => ({ list: of, max, min }), one = xs => v => xs.includes(v);
const room = string(/^\S+$/, 64);
const bucket = object({
  topics: map(one(topics), object({ messages: count, engaged: count, replies: count, chimes: count })),
  learned: count, lean: list(number, 4, 4),
});
const state = object({
  personality: object({ version: count, at: number, cells: map(string(/^[0-4]{4}$/, 4), number) }),
  budget: object({ day: v => v === '' || date(v), calls: count }),
  settings: object({
    persona: owner(4000), paused: boolean, reply_mentions: boolean, reply_replies: boolean, reply_threshold: number,
    cooldown: count, organic: boolean, organic_threshold: number, organic_gap: count,
  }),
  memory: object({ rooms: map(room, object({ days: map(date, bucket), weeks: map(date, bucket) })) }),
});
const status = object({
  connected: boolean, paused: boolean, error: nullable(string(/^[a-z0-9-]+$/, 64)),
  // user_id is the bot's own; agent is the server software's name from its greeting.
  server: nullable(object({ host: string(/^[\w.-]+(:\d+)?$/, 253), agent: nullable(string(/^[^\n\r]*$/, 200)), user_id: string(/^[\w~.:-]+$/, 128) })),
  budget: state.fields.budget,
  personality: object(Object.fromEntries(axes.map(a => [a, number]))),
});
const apron = object({ url: string(/^wss:\/\/\S+$/, 2048), token: string(/^\S+$/, 512) });
export const schemas = { 'state.json': state, 'status.json': status, 'apron.json': apron };
// Throws naming the path, never the value, so a refused value can't leak into a log either.
function walk(schema, v, at) {
  const refuse = () => { throw Error(`refused to store ${at}`); };
  if (typeof schema === 'function') return schema(v) || refuse();
  if (schema.nullable) return v === null || walk(schema.nullable, v, at);
  if (schema.list) {
    if (!Array.isArray(v) || v.length > schema.max || v.length < schema.min) refuse();
    return v.forEach((x, i) => walk(schema.list, x, `${at}.${i}`));
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse();
  if (schema.fields) {
    for (const k of Object.keys(v)) if (!Object.hasOwn(schema.fields, k)) throw Error(`refused to store ${at}.${k}`);
    for (const [k, s] of Object.entries(schema.fields)) walk(s, v[k], `${at}.${k}`);
  } else for (const [k, x] of Object.entries(v)) {
    if (!schema.key(k)) throw Error(`refused to store a key in ${at}`);
    walk(schema.value, x, `${at}.${k}`);
  }
}
export const fits = (schema, value) => { try { walk(schema, value, ''); return true; } catch { return false; } };
export function check(name, value) {
  if (!Object.hasOwn(schemas, name)) throw Error(`refused to store ${name}`);
  walk(schemas[name], value, name);
  return value;
}
// DATA_DIR's files. Every write passes check(), and is atomic: a crash mid-write keeps the previous version.
export function disk(dir) {
  return {
    write(name, value, mode = 0o644) {
      const path = `${dir}/${name}`, text = JSON.stringify(check(name, value));
      writeFileSync(`${path}.tmp`, text, { mode }); chmodSync(`${path}.tmp`, mode); renameSync(`${path}.tmp`, path);
    },
    load(name) { try { return JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')); } catch { return {}; } },
  };
}
