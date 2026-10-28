import { page } from './page.js';
import { dashboard, row, rows, roomOf, viewOf } from './dashboard.js';
import { settings } from './settings.js';
// Never framed, so a hostile page can't overlay the admin forms and trick a click.
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' } });
const missing = () => new Response('Not found', { status: 404 });
// The public status page and its JSON.
export function site(bot) {
  return req => {
    const path = new URL(req.url).pathname;
    if (path === '/status.json') return Response.json(bot.status());
    if (path === '/') return html(page(bot.name, bot.status()));
    return missing();
  };
}
// Server-Sent Events from the log. At most 32 chunks wait unread; a client further behind is cut off
// rather than buffered, and can catch up from /events.json.
function stream(log, signal, every) {
  const enc = new TextEncoder();
  let stop;
  return new ReadableStream({
    start(c) {
      let open = true;
      const send = s => {
        if (!open) return;
        if (c.desiredSize <= 0) return stop();
        c.enqueue(enc.encode(s));
      };
      const listener = e => send(`data: ${JSON.stringify(e)}\n\n`);
      const timer = setInterval(() => send(': ping\n\n'), every);
      stop = () => {
        if (!open) return;
        open = false; clearInterval(timer); log.unsubscribe(listener); signal.removeEventListener('abort', stop);
        try { c.close(); } catch {}
      };
      log.subscribe(listener); signal.addEventListener('abort', stop);
      send(': ping\n\n');
    },
    cancel() { stop(); },
  }, new CountQueuingStrategy({ highWaterMark: 32 }));
}
// The admin dashboard. Writes require a same-origin form post, and each reports its outcome on the view and room it came from.
// saveApron(url, token) persists a new server and token; ping is the event stream's keepalive interval.
export function admin(bot, saveApron, { ping = 25000 } = {}) {
  const place = q => ({ view: viewOf(q.get('view')), room: roomOf(bot.rooms, q.get('room')) });
  const back = ({ view, room }, key, text) => new Response(null, { status: 303, headers: { Location: `/?view=${view}&room=${encodeURIComponent(room)}&${key}=${encodeURIComponent(text)}` } });
  const actions = {
    async '/apron'(form) {
      const url = String(form.get('url') ?? '').trim(), token = String(form.get('token') ?? '').trim();
      let valid = false; try { valid = new URL(url).protocol === 'wss:'; } catch {}
      if (!valid || !token || token.length > 512) throw Error('a wss:// URL and a token are required');
      saveApron(url, token);
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
    async '/learn'(form) {
      const url = String(form.get('url') ?? '').trim(), token = String(form.get('token') ?? '').trim(), cap = Number(form.get('cap'));
      const rooms = String(form.get('rooms') ?? '').split(',').map(r => r.trim().replace(/^#/, '')).filter(Boolean);
      let valid = false; try { valid = new URL(url).protocol === 'wss:'; } catch {}
      if (!valid) throw Error('a wss:// URL is required');
      if (token.length > 512) throw Error('that token is too long');
      if (!rooms.length || rooms.length > 8 || rooms.some(r => r.length > 64)) throw Error('name 1 to 8 rooms');
      if (!Number.isInteger(cap) || cap < 1 || cap > 1000) throw Error('messages is a whole number from 1 to 1000');
      bot.study({ url, token, rooms, cap });
      return 'Reading history. This takes about a minute';
    },
    async '/learn/apply'(form) { bot.adopt(form.get('persona')); return "Applied: I've taken on the room's voice"; },
    async '/learn/discard'() { bot.discard(); return 'Discarded'; },
    async '/persona/reset'() { bot.configure({ persona: settings.persona.default() }); return 'Reset to the default persona'; },
  };
  return async (req, server) => {
    const url = new URL(req.url), action = actions[url.pathname];
    if (req.method === 'GET' && url.pathname === '/events.json') return Response.json(bot.log.list(Number(url.searchParams.get('since')) || 0));
    if (req.method === 'GET' && url.pathname === '/events') {
      // Bun closes a connection idle for 10 seconds, longer than a ping apart.
      server?.timeout(req, 0);
      return new Response(stream(bot.log, req.signal, ping), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
    }
    const q = url.searchParams, ctx = { ...place(q), events: bot.log.list(), rooms: bot.rooms };
    if (req.method === 'GET' && url.pathname === '/rows') {
      const all = rows(ctx), since = Number(q.get('since')) || 0;
      const shown = q.has('id') ? all.filter(r => r.kind === 'post' && r.message_id === q.get('id')) : all.filter(r => r.at > since);
      return html(shown.map(r => row(r, ctx)).join(''));
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const posts = await bot.posts().catch(e => ({ error: e.message }));
      const flash = q.get('error') ? { error: q.get('error') } : q.get('ok') ? { ok: q.get('ok') } : null;
      return html(dashboard({ ...ctx, edit: q.has('edit'), name: bot.name, status: bot.status(), lastError: bot.lastError, settings: bot.settings, learning: bot.learning, preview: bot.learning?.stage === 'ready' ? bot.preview() : null, limit: bot.env.DAILY_CALLS, details: bot.details(), posts, flash }));
    }
    if (req.method === 'POST' && action) {
      if (req.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response('Forbidden', { status: 403 });
      let from = place(new URLSearchParams());
      try { const form = await req.formData(); from = place(form); return back(from, 'ok', await action(form)); }
      catch (e) { return back(from, 'error', e.message || 'failed'); }
    }
    return missing();
  };
}
