# Apron Persona

A small, dependency-free Cloudflare Worker agent: Mercury Decide classifies human chat; OpenRouter's free router writes replies; a single Durable Object owns the Apron WebSocket; Workers KV stores the aggregate four-dimensional personality.

## Setup

Requires Bun and a Cloudflare account.

1. Run `/invite-bot` in Apron. Keep the returned token secret. Running it again revokes the old token and disconnects that bot.
2. Install and create KV:

```sh
bun install
bunx wrangler login
```

The `PERSONA` KV namespace already exists and its ID is in `wrangler.jsonc`. Set `ROOMS` to comma-separated room IDs. Add your bot to those rooms in Apron with `/invite @bot_<your_user_id>`. Membership permissions depend on the server.

3. In OpenRouter's account privacy settings, disable prompt/output logging and training/data collection for free models, and enforce ZDR for all model groups. **Do this before starting:** Mercury uses the alpha Decisions endpoint; this scaffold relies on account-level policy for that endpoint. Chat requests additionally send `provider: { data_collection: 'deny', zdr: true }`. Endpoint eligibility and free availability can prevent inference; the bot keeps silent on errors and never relaxes privacy automatically.
4. Set secrets interactively:

```sh
bunx wrangler secret put APRON_TOKEN
bunx wrangler secret put OPENROUTER_API_KEY
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put HASH_SECRET
```

Use separate random values for ADMIN_TOKEN and HASH_SECRET. Generate each with `openssl rand -hex 32`. For local development copy `.dev.vars.example` to `.dev.vars` and populate those four values.

5. Verify and deploy. Pushes to `main` also deploy through Workers Builds (build command `bun test`, deploy command `bunx wrangler deploy`):

```sh
bun test
bun run build
bun run deploy
```

6. Start using the deployed URL and your admin secret:

```sh
read -r -p 'Worker URL: ' BOT_URL
read -r -s -p 'Admin token: ' BOT_ADMIN_TOKEN
curl -X POST "$BOT_URL/start" -H "Authorization: Bearer $BOT_ADMIN_TOKEN"
curl "$BOT_URL/status" -H "Authorization: Bearer $BOT_ADMIN_TOKEN"
```

`POST /stop` disables the bot. Endpoints require the bearer secret. The bot starts disabled. Once enabled, a Durable Object alarm polls every `POLL_MINUTES` (default 5): it connects, authenticates, reads the messages logged since the last poll with `history`, replies, and disconnects within 45 seconds. Replies therefore arrive up to `POLL_MINUTES` after a mention. The first poll only records the end of the log. Failures, including authentication, retry on the next poll so replacing the secret can recover. Status exposes only aggregate style, enabled state, budget counts, and generic error codes.

## Behavior

- Learns from permitted rooms, and replies only to mentions or replies to its own recent messages (among the last 60 logged). Bot/system/own messages are excluded.
- Sends six typed questions in one Mercury request: learning eligibility, response eligibility, and four five-level trait choices. Uses probability-weighted trait scores.
- Four axes: warmth, playfulness, curiosity, expressiveness. Each has five quantized positions, giving at most 625 cells. The current personality is their weighted centroid with a neutral prior of ten observations.
- Thirty-day weight half-life. Each participant contributes at most once per poll. Learning requires eligibility probability >= .8; replying requires >= .7. These are initial thresholds, not empirically validated guarantees.
- HMAC fingerprints suppress normalized duplicate messages within a poll. Fingerprints and participant rate-limit keys remain in memory and reset every poll. Hash bits never determine trait coordinates.
- At most 50 new log records per poll, at most 2,000 characters per message. Reply prompts include at most eight entries from the same room, fetched from `history` and held in memory only during the poll. No history backfill, tools, embeddings, framework, or conversation database.
- Fifteen-second reply cooldown. Daily inference budget defaults to 40 total calls, UTC reset, persisted in Durable Object storage; each classification and completion counts separately. Upstream errors also consume the local budget. No automatic inference retries.

## Persistence and privacy

KV key `personality:v1` stores only `{ version, at, cells }`. Durable Object storage holds enabled state, daily call counts, and alarm metadata. Source text, replies, names, user IDs, and content fingerprints are never intentionally written to storage or logs. Worker observability is disabled and code has no console logging. Raw text is sent transiently to inference providers. Apron's server can retain messages and the bot's posted replies under its own policy. Provider/account policies and legal exceptions still apply; numerical aggregation is not a formal anonymity or differential-privacy guarantee.

Snapshots are written at most once every ten minutes, and on `/stop`, by one writer. KV is eventually consistent; a restart can lose recent observations or load a stale snapshot. This intentionally accepts approximate personality weights. Context and duplicate suppression reset every poll. The only stored cursor is the last processed `log_id`.

This implements community style. Facts, personal histories, and shared lore are not retained. Edits/deletions do not retroactively reverse aggregate contributions. Use only rooms whose members agree to this processing.

## Costs

- Inference is free models only, capped at `DAILY_CALLS`. Also set a $0 credit limit on the OpenRouter key so a paid route can never bill.
- The bot never holds a connection between polls, so the Durable Object is active only a few seconds every `POLL_MINUTES`: a few hundred GB-s a day, and at most about 2,200 if every poll hit its 45-second cap, against the 13,000 GB-s daily Free plan limit. There is no cron; a stopped bot uses nothing.
- Each poll costs one alarm, two or three Durable Object storage writes, and at most one KV write every ten minutes (144 a day, against the 1,000-a-day Free limit).
- Workers Builds runs only for `main` and skips Markdown-only changes.

## Files and validation

- `src/index.js`: transport, lifecycle, inference and persistence.
- `src/core.js`: decisions, HMAC, 4D aggregation and decay.
- `test/`: deterministic privacy/persistence, filtering, malformed response, budget and aggregation checks, with no real conversation data.

The Decisions response parser follows the documented `answers`, `noul`, `choice`, and `probabilities` shapes and fails closed on schema changes. Tests mock inference; a real Apron/OpenRouter end-to-end run needs your secrets. The alpha Decisions API may change.

## References

- https://github.com/apron-chat/apron-server-cloudflare/blob/main/src/index.ts
- https://openrouter.ai/inception/mercury-decide:free
- https://openrouter.ai/docs/guides/community/multimodal-decisions
- https://openrouter.ai/docs/guides/routing/routers/free-router
- https://openrouter.ai/docs/guides/features/zdr
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
