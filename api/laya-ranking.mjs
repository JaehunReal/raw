// Only public catalogue metadata is sent. No document bodies or user drafts.
export async function rankWithLaya(payload, query, env = process.env, send = fetch) {
  const fallback = (status) => ({ ...payload, ranking: { engine: 'database', laya: status } });
  if (!query || !Array.isArray(payload.items) || !payload.items.length) return fallback('not_needed');
  if (!env.RULECRAFT_LAYA_URL) return fallback('not_configured');
  if (env.RULECRAFT_LAYA_ENABLED !== 'true') return fallback('evaluation_required');
  try {
    const url = new URL(env.RULECRAFT_LAYA_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
    const signal = AbortSignal.timeout(1500);
    const candidates = payload.items.slice(0, 8);
    const scores = await Promise.all(candidates.map(async (item, index) => {
      const response = await send(url, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(env.RULECRAFT_LAYA_TOKEN ? { Authorization: `Bearer ${env.RULECRAFT_LAYA_TOKEN}` } : {}) },
        body: JSON.stringify({ model: 'multilingual', lang: 'ko', max_len: 512,
          state: { query: query.slice(0, 200), title: item.title, source: item.source },
          questions: { relevant: { type: 'noul', instructions: 'Does this law title directly match the search query? Judge relevance only, not legal validity.' } } }),
      });
      if (!response.ok) throw Error();
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      while (true) { const {done, value} = await reader.read(); if(done) break; bytes += value.length;
        if(bytes > 64000) { await reader.cancel(); throw Error(); } chunks.push(Buffer.from(value)); }
      const answer = JSON.parse(Buffer.concat(chunks).toString()).answers?.relevant;
      if (answer?.abstention || typeof answer?.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw Error();
      return { item, index, score: answer.noul };
    }));
    scores.sort((a,b) => b.score-a.score || a.index-b.index);
    return { ...payload, items: [...scores.map(s => s.item), ...payload.items.slice(8)], ranking: {engine:'laya', laya:'applied', scope:'first_8_titles_on_current_page'} };
  } catch { return fallback('unavailable'); }
}
