# Apron Persona

A Bun bot for Apron that learns a room's conversational style and replies when mentioned. Inference runs on OpenRouter's free models. It runs on the homelab; `server.apron.chat` blocks Cloudflare Workers.

## Run

Put these in `.env`:

```sh
APRON_TOKEN=...          # from /invite-bot; or set it, and the server, on the moderation page
OPENROUTER_API_KEY=...
HASH_SECRET=...          # openssl rand -hex 32
```

Then `ff-deploy apron-persona`. The moderation page (port 8903) has no login, so expose it only on the tailnet, at `apron-bot.iam.casa`. Port 8902 serves the status page.

Optional: `ROOMS` (default `general`), `BOT_NAME`, `DAILY_CALLS` (default 40).

## Privacy

Messages stay in memory for five minutes. Only the aggregate personality and a daily call count go to `data/state.json`.

## Test

```sh
bun test
```
