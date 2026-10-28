import { page, portal, tabs } from './page.js';
import { settings } from './settings.js';
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
// The admin portal. Writes require a same-origin form post, and each reports its outcome on the tab it came from.
// saveApron(url, token) persists a new server and token.
export function admin(bot, saveApron) {
  const tabOf = id => tabs.some(t => t.id === id) ? id : 'overview';
  const back = (tab, key, text) => new Response(null, { status: 303, headers: { Location: `/?tab=${tab}&${key}=${encodeURIComponent(text)}` } });
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
    async '/persona/reset'() { bot.configure({ persona: settings.persona.default() }); return 'Reset to the default persona'; },
  };
  return async req => {
    const url = new URL(req.url), action = actions[url.pathname];
    if (req.method === 'GET' && url.pathname === '/') {
      const tab = tabOf(url.searchParams.get('tab')), q = url.searchParams;
      const posts = tab === 'moderation' ? await bot.posts().catch(e => ({ error: e.message })) : null;
      const flash = q.get('error') ? { error: q.get('error') } : q.get('ok') ? { ok: q.get('ok') } : null;
      return html(portal({ tab, name: bot.name, status: bot.status(), settings: bot.settings, limit: bot.env.DAILY_CALLS, details: bot.details(), url: bot.env.APRON_URL, posts, flash }));
    }
    if (req.method === 'POST' && action) {
      if (req.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response('Forbidden', { status: 403 });
      let tab = 'overview';
      try { const form = await req.formData(); tab = tabOf(form.get('tab')); return back(tab, 'ok', await action(form)); }
      catch (e) { return back(tab, 'error', e.message || 'failed'); }
    }
    return missing();
  };
}
