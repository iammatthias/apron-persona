# Apron Persona

A Bun bot for Apron that learns a room's conversational style and replies when mentioned. Inference runs on OpenRouter's free models. It runs on the homelab; `server.apron.chat` blocks Cloudflare Workers.

## Run

Put these in `.env`:

```sh
APRON_TOKEN=...          # from /invite-bot in Apron
OPENROUTER_API_KEY=...
HASH_SECRET=...          # openssl rand -hex 32
```

Then:

```sh
ff-deploy apron-persona
add-site persona 8902   # homepage at persona.local
```

Optional: `ROOMS` (default `general`), `BOT_NAME`, `DAILY_CALLS` (default 40).

## Privacy

Messages stay in memory for five minutes. Only the aggregate personality and a daily call count go to `data/state.json`.

## Test

```sh
bun test
```
