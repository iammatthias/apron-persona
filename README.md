# Apron Persona

A small, dependency-free Bun bot for Apron: OpenRouter's free router classifies human chat and writes replies; one live WebSocket listens to the configured rooms; a JSON file stores the aggregate four-dimensional personality. It runs on the farfield homelab in Docker Compose.

It cannot run on Cloudflare Workers: `server.apron.chat` rejects every request carrying the `CF-Worker` header (`extractClientIp` in apron-server-cloudflare's `src/ip.ts`).

## Setup

1. Run `/invite-bot` in Apron. Keep the returned token secret. Running it again revokes the old token and disconnects that bot. Add the bot to rooms other than `general` with `/invite @bot_<your_user_id>`.
2. In OpenRouter's account privacy settings, disable prompt/output logging and training/data collection for free models. Restrict the key to the Free Models Router and give it a spend limit. Both requests send `provider: { data_collection: 'deny' }`. They do not require zero data retention: almost no free endpoints offer it, so providers may retain prompts briefly under their own policies. The bot keeps silent on inference errors and never relaxes privacy on its own.
3. On the box, clone into `~/projects/apron-persona`, create `data/`, and write `.env` (chmod 600):

```sh
APRON_TOKEN=...
OPENROUTER_API_KEY=...
HASH_SECRET=...   # openssl rand -hex 32
```

Optional overrides: `ROOMS` (comma-separated, default `general`), `BOT_NAME`, `DECISION_MODEL`, `CHAT_MODEL` (both default `openrouter/free`), `DAILY_CALLS` (40), `HALF_LIFE_DAYS` (30), `APRON_URL`.

4. Deploy, then check status:

```sh
ff-deploy apron-persona
docker compose -f ~/projects/apron-persona/compose.yaml logs bot
cat ~/projects/apron-persona/data/status.json
```

`docker compose stop` stops the bot. Logs carry only connection state and generic error codes. `status.json` holds connection state, the error code, budget counts, and the aggregate style.

## Behavior

- Learns from permitted rooms, and replies only to mentions or replies to its own recent messages. Bot/system/own messages are excluded. Says hello once in each room when `ROOMS` changes.
- Asks the classifier for one JSON object: learning probability, reply probability, and a five-level choice for each of the four traits.
- Four axes: warmth, playfulness, curiosity, expressiveness. Each has five quantized positions, giving at most 625 cells. The current personality is their weighted centroid with a neutral prior of ten observations.
- Thirty-day weight half-life. Each participant contributes at most once per five minutes. Learning requires eligibility probability >= .8; replying requires >= .7. These are initial thresholds, not empirically validated guarantees.
- HMAC fingerprints suppress normalized duplicate messages for five minutes. Fingerprints and participant rate-limit keys remain in memory. Hash bits never determine trait coordinates.
- At most twelve recent text entries, at most 2,000 characters per incoming message, and five-minute expiry. Reply prompts include at most eight entries from the same room. At most four messages await processing. No history backfill, tools, embeddings, framework, or conversation database.
- A one-minute tick pings, reconnects (including after an auth failure, so a replaced token recovers), and checkpoints.
- Fifteen-second reply cooldown. Daily inference budget defaults to 40 total calls, UTC reset, persisted in `state.json`; each classification and completion counts separately. Upstream errors also consume the budget. No automatic inference retries.

## Persistence and privacy

`data/state.json` stores only the personality `{ version, at, cells }`, the daily call count, and the rooms already greeted. Source text, replies, names, user IDs, and content fingerprints are never intentionally written to disk or logs. Raw text is sent transiently to inference providers. Apron's server can retain messages and the bot's posted replies under its own policy. Provider/account policies and legal exceptions still apply; numerical aggregation is not a formal anonymity or differential-privacy guarantee.

Changed weights are written within a minute and on shutdown; a crash can lose the last minute. Context and duplicate suppression reset on restart.

This implements community style. Facts, personal histories, and shared lore are not retained. Edits/deletions do not retroactively reverse aggregate contributions. Use only rooms whose members agree to this processing.

## Costs

Nothing here bills. The bot runs on the homelab, inference uses free models only and stops at `DAILY_CALLS`, and the OpenRouter key's allowlist and spend limit back that up.

## Files and validation

- `src/index.js`: configuration, state files, the one-minute tick, and shutdown.
- `src/bot.js`: the Apron connection, filtering, inference, and replies.
- `src/core.js`: classification prompt and parser, HMAC, 4D aggregation and decay.
- `test/`: deterministic privacy/persistence, filtering, malformed response, budget, session, and aggregation checks, with no real conversation data. Run `bun test`.

The classifier parser accepts only that JSON object (optionally in a code fence) and fails closed on anything else. Tests mock inference.

## References

- https://github.com/apron-chat/apron-server-cloudflare/blob/main/src/ip.ts
- https://openrouter.ai/docs/guides/routing/routers/free-router
