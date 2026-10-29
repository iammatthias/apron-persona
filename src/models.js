// Each role the bot asks a model to play, with the models to try in order, how long one attempt may take, how long to
// wait before a second model is asked alongside the first (null: never), and OpenRouter's reasoning setting. Thinking
// is never shown; for judge and compose it is off as well, since hidden thinking was most of a free model's answer
// time (a 60-token classification billed as 460). learn, the history job's long reads, keeps it for quality.
const quick = { enabled: false, exclude: true }, hidden = { exclude: true };
export const roles = {
  judge: { chain: ['cohere/north-mini-code:free', 'openrouter/free'], timeout: 8000, hedge: 2500, reasoning: quick },
  compose: { chain: ['cohere/north-mini-code:free', 'openrouter/free'], timeout: 10000, hedge: 3000, reasoning: quick },
  learn: { chain: ['openrouter/free'], timeout: 60000, hedge: null, reasoning: hidden },
};
// The table with the environment's overrides: DECISION_MODEL replaces the judge chain's first model, CHAT_MODEL the
// compose and learn chains' first.
export function table(env) {
  const head = (role, model) => model ? { ...role, chain: [model, ...role.chain.slice(1).filter(m => m !== model)] } : role;
  return { judge: head(roles.judge, env.DECISION_MODEL), compose: head(roles.compose, env.CHAT_MODEL), learn: head(roles.learn, env.CHAT_MODEL) };
}
export const real = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id) };
// Asks a role's models until one answer passes `parse`, which returns the value or throws. send(body, signal, why) makes one
// request, why being 'first', 'failover' or 'hedge', and resolves to the response data; a request that fails, times out or returns an answer parse() rejects
// hands over to the next model at once, and one still unanswered at the hedge delay is raced against the next model
// while afford() allows another request, and raced() is told so. The first answer wins and the rest are aborted.
// Resolves { value, model }, where model is the one that answered (the router names the model it chose); rejects
// with the last failure, or the signal's reason once it aborts.
export function ask({ chain, timeout, hedge, reasoning }, body, parse, { send, afford = () => true, raced = () => {}, signal, timers = real }) {
  return new Promise((resolve, reject) => {
    const live = new Set();
    let next = 0, settled = false, pending, failure;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(pending); signal?.removeEventListener('abort', stale);
      for (const stop of live) stop(error ?? Error('lost'));
      error ? reject(error) : resolve(value);
    };
    const stale = () => finish(signal.reason);
    const fire = why => {
      timers.clearTimeout(pending);
      if (settled || next >= chain.length) return;
      if (why === 'hedge' && !afford()) return;
      if (why === 'hedge') raced();
      const model = chain[next++], control = new AbortController();
      const timer = timers.setTimeout(() => stop(Error('timeout')), timeout);
      const stop = reason => { timers.clearTimeout(timer); control.abort(reason); };
      live.add(stop);
      // A chain's tail goes along as OpenRouter's own fallbacks, so a model it can't serve is skipped without a round trip.
      const rest = chain.slice(next - 1);
      send({ ...body, model, ...rest.length > 1 ? { models: rest } : {}, reasoning }, control.signal, why)
        .then(data => ({ value: parse(data), model: typeof data?.model === 'string' ? data.model.slice(0, 100) : model }))
        .then(answer => { live.delete(stop); timers.clearTimeout(timer); finish(null, answer); }, e => {
          live.delete(stop); timers.clearTimeout(timer);
          if (settled) return;
          failure = control.signal.aborted ? control.signal.reason : e;
          if (failure.message === 'budget' || next >= chain.length) { if (!live.size) finish(failure); return; }
          if (!live.size) fire('failover');
        });
      if (hedge !== null && next < chain.length) pending = timers.setTimeout(() => fire('hedge'), hedge);
    };
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', stale);
    fire('first');
  });
}
