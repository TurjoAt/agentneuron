/**
 * Flags paths touched by >= 2 distinct agent sessions within a time window.
 * @param {{windowMs?:number, now?:()=>number}} [opts]
 */
export function createConflictRadar({ windowMs = 120000, now = Date.now } = {}) {
  /** @type {Map<string, Map<string, {agent:object, ts:number}>>} */
  const touches = new Map();

  function prune(t) {
    for (const [p, sessions] of touches) {
      for (const [k, v] of sessions) if (v.ts < t - windowMs) sessions.delete(k);
      if (!sessions.size) touches.delete(p);
    }
  }

  return {
    note(event) {
      if (!event || !event.path || !event.agent || !event.agent.sessionId) return;
      const ts = Number(event.ts) || now();
      const key = `${event.agent.tool || 'claude'}:${event.agent.sessionId}`;
      let s = touches.get(event.path);
      if (!s) touches.set(event.path, (s = new Map()));
      const prev = s.get(key);
      if (!prev || ts >= prev.ts) s.set(key, { agent: event.agent, ts });
    },
    active(at = now()) {
      prune(at);
      const out = [];
      for (const [path, sessions] of touches) {
        const live = [...sessions.values()].filter((v) => v.ts <= at + windowMs);
        if (live.length < 2) continue;
        out.push({
          path,
          agents: live.sort((a, b) => b.ts - a.ts).map((v) => v.agent),
          lastTs: Math.max(...live.map((v) => v.ts)),
        });
      }
      return out.sort((a, b) => b.lastTs - a.lastTs);
    },
  };
}
