# Apron Persona

A Bun bot for Apron that learns a room's conversational style and replies when mentioned or replied to. The owner sets these triggers on the admin portal and can let it chime in unprompted, which is off by default and waits for someone else to speak after it has. Inference runs on OpenRouter's free models. It runs on the homelab; `server.apron.chat` blocks Cloudflare Workers.

## Run

Put these in `.env`:

```sh
APRON_TOKEN=...          # from /invite-bot; or set it, and the server, on the admin portal
OPENROUTER_API_KEY=...
HASH_SECRET=...          # openssl rand -hex 32
```

Then `ff-deploy apron-persona`. The admin portal (port 8903) has no login, so expose it only on the tailnet, at `apron-bot.iam.casa`. It shows each watched room as the bot saw it, with its reasoning beside every message, and edits its persona and each room's norms in place; the guardrails stay fixed. The server names the bot after its owner (`/invite-bot`). Port 8902 serves the status page.

Optional: `ROOMS` (default `general`), `BOT_NAME`, `DAILY_CALLS` (default 40), `DECISION_MODEL` and `CHAT_MODEL` (each replaces the first model of its chain in `src/models.js`).

## Speed

A message runs as a pipeline under a 25 s deadline: the room history, the classifier and the reply start together when the bot is addressed, and the classifier's verdict gates only the post, so a decline aborts the draft. Each role asks an ordered chain of free models (`src/models.js`) with the model's thinking turned off for the classifier and the reply, since hidden thinking was most of a free model's answer time: a failed or empty answer moves to the next model at once, and one still unanswered after a few seconds is raced against the next. Every request sent counts against `DAILY_CALLS`, a hedge included, and a hedge is only sent while the budget has room. While a reply is drafted the bot shows as typing, on servers that relay activity. Each reply's stage times are kept in memory only, on the admin portal's margin and its "today" card.

## Privacy

Messages stay in memory for five minutes. Only the aggregate personality, each room's counts by day and topic (from a fixed list, with no speakers), the owner's settings and norms, and a daily call count go to `data/state.json`. Every write is checked against an allowlist of keys and types (`src/disk.js`), which also lists what is never stored.

The admin portal, `/events.json` and `/events` (a live stream) show the last 300 decisions with room, message and user ids, the sender's display name, and the style learned from a message. They keep a message's text only when it mentions the bot, replies to it, or is one the bot chimes in on, plus the bot's own posts, in memory only: never on disk, in `status.json` or in logs. They reset on restart.

"Learn from history" on the admin portal reads a room's recent history once, in memory, to draft a persona and traits; the drafting prompts ask for style, not people. Nothing from it is stored except what the owner applies.

## Test

```sh
bun test
```
