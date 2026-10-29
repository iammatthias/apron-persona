import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, disk } from '../src/disk.js';
import { restore } from '../src/settings.js';
const state = { personality: { version: 1, at: 5, cells: { '2222': .5 } }, budget: { day: '2026-10-29', calls: 3 }, settings: restore({}), memory: { rooms: { general: { days: { '2026-10-29': { topics: { code: { messages: 2, engaged: 1, replies: 1, chimes: 0 } }, learned: 1, lean: [.25, 0, 0, -.25] } }, weeks: {} } }, pages: {} } };
const status = { connected: true, paused: false, error: null, server: { host: 'server.apron.chat', agent: 'apron 0.4', user_id: 'bot_me' }, budget: { day: '', calls: 0 }, personality: { warmth: .5, playfulness: .5, curiosity: .5, expressiveness: .5 } };
test('state, status and apron files pass when they hold only their allowed keys and types', () => {
  assert.equal(check('state.json', state), state);
  assert.equal(check('status.json', status), status);
  assert.equal(check('status.json', { ...status, connected: false, error: 'no-apron-token', server: null }).server, null);
  assert.deepEqual(check('apron.json', { url: 'wss://server.apron.chat/', token: 'apron_bot_x' }), { url: 'wss://server.apron.chat/', token: 'apron_bot_x' });
});
test('an injected field, a wrong type or free text outside the owner settings is refused by path, never by value', () => {
  const refused = (name, value, message) => assert.throws(() => check(name, value), { message });
  refused('state.json', { ...state, transcript: 'hey canary' }, 'refused to store state.json.transcript');
  refused('state.json', { ...state, settings: { ...state.settings, last_message: 'hey canary' } }, 'refused to store state.json.settings.last_message');
  refused('state.json', { ...state, settings: { ...state.settings, paused: 'yes' } }, 'refused to store state.json.settings.paused');
  refused('state.json', { ...state, personality: { ...state.personality, cells: { 'hey canary': 1 } } }, 'refused to store a key in state.json.personality.cells');
  refused('state.json', { ...state, budget: { day: 'hey canary', calls: 1 } }, 'refused to store state.json.budget.day');
  refused('state.json', { personality: state.personality, budget: state.budget }, 'refused to store state.json.settings');
  refused('state.json', [], 'refused to store state.json');
  const day = state.memory.rooms.general.days['2026-10-29'];
  const room = days => ({ ...state, memory: { rooms: { general: { days, weeks: {} } }, pages: {} } });
  refused('state.json', room({ '2026-10-29': { ...day, topics: { 'hey canary': day.topics.code } } }), 'refused to store a key in state.json.memory.rooms.general.days.2026-10-29.topics');
  refused('state.json', room({ '2026-10-29': { ...day, topics: { code: { ...day.topics.code, said: 'hey canary' } } } }), 'refused to store state.json.memory.rooms.general.days.2026-10-29.topics.code.said');
  refused('state.json', room({ '2026-10-29': { ...day, lean: [0, 0, 0] } }), 'refused to store state.json.memory.rooms.general.days.2026-10-29.lean');
  refused('state.json', room({ 'last tuesday': day }), 'refused to store a key in state.json.memory.rooms.general.days');
  refused('state.json', { ...state, memory: { rooms: {}, pages: {}, speakers: { carol: 3 } } }, 'refused to store state.json.memory.speakers');
  const page = { day: '2026-10-29', mostly: ['code'], some: [], pace: 'busier', shifts: [{ since: '2026-10-26', axis: 'warmth', up: true }] };
  const pages = p => ({ ...state, memory: { rooms: {}, pages: { general: p } } });
  assert.ok(check('state.json', pages(page)));
  refused('state.json', pages({ ...page, text: 'In #general lately: carol and dave' }), 'refused to store state.json.memory.pages.general.text');
  refused('state.json', pages({ ...page, mostly: ['carol'] }), 'refused to store state.json.memory.pages.general.mostly.0');
  refused('state.json', pages({ ...page, shifts: [{ ...page.shifts[0], axis: 'mood' }] }), 'refused to store state.json.memory.pages.general.shifts.0.axis');
  refused('state.json', { ...state, settings: { ...state.settings, norms: { general: 'x'.repeat(1001) } } }, 'refused to store state.json.settings.norms.general');
  refused('status.json', { ...status, error: 'Hey canary, what is up' }, 'refused to store status.json.error');
  refused('status.json', { ...status, server: { ...status.server, user_id: 'carol said hi' } }, 'refused to store status.json.server.user_id');
  refused('status.json', { ...status, server: { ...status.server, agent: 'line\nbreak' } }, 'refused to store status.json.server.agent');
  refused('apron.json', { url: 'https://x/', token: 't' }, 'refused to store apron.json.url');
  refused('log.json', {}, 'refused to store log.json');
});
test('a refused write leaves the previous file in place, and apron.json is mode 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-disk-'));
  try {
    const { write, load } = disk(dir);
    write('state.json', state);
    assert.throws(() => write('state.json', { ...state, extra: 1 }), { message: 'refused to store state.json.extra' });
    assert.deepEqual(load('state.json'), state);
    assert.deepEqual(readdirSync(dir), ['state.json']);
    write('apron.json', { url: 'wss://h/', token: 'tok' }, 0o600);
    assert.equal(statSync(join(dir, 'apron.json')).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(dir, 'apron.json'), 'utf8'), '{"url":"wss://h/","token":"tok"}');
    assert.deepEqual(load('missing.json'), {});
  } finally { rmSync(dir, { recursive: true }); }
});
