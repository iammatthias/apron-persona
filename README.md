# Apron Persona

A Bun bot for Apron that learns a room's conversational style and replies when mentioned. Inference runs on OpenRouter's free models. It runs on the homelab; `server.apron.chat` blocks Cloudflare Workers.

## Run

Put these in `.env`:

```sh
APRON_TOKEN=...          # from /invite-bot; or set it, and the server, on the admin portal
OPENROUTER_API_KEY=...
HASH_SECRET=...          # openssl rand -hex 32
```

Then `ff-deploy apron-persona`. The admin portal (port 8903) has no login, so expose it only on the tailnet, at `apron-bot.iam.casa`. Its Persona tab edits the bot's base persona and previews the full system prompt; the guardrails stay fixed. The server names the bot after its owner (`/invite-bot`). Port 8902 serves the status page.

Optional: `ROOMS` (default `general`), `BOT_NAME`, `DAILY_CALLS` (default 40).

## Privacy

Messages stay in memory for five minutes. Only the aggregate personality, the owner's settings, and a daily call count go to `data/state.json`.

The admin portal's Activity tab, `/events.json` and `/events` (a live stream) show the last 300 decisions with room, message and user ids, the sender's display name, and the style learned from a message. They keep a message's text only when it mentions the bot or replies to it, plus the bot's own replies, in memory only: never on disk, in `status.json` or in logs. They reset on restart.

## Test

```sh
bun test
```
