import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, disk } from '../src/disk.js';
import { restore } from '../src/settings.js';
const state = { personality: { version: 1, at: 5, cells: { '2222': .5 } }, budget: { day: '2026-10-29', calls: 3 }, settings: restore({}) };
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
