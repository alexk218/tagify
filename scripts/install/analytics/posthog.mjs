import { createHash } from 'node:crypto';

export function configuration(env = process.env) {
  const token = env.TAGIFY_POSTHOG_TOKEN;
  const host = env.TAGIFY_POSTHOG_HOST;
  if (!/^phc_[A-Za-z0-9_-]+$/.test(token ?? '') || !['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(host)) {
    throw new Error('Set TAGIFY_POSTHOG_TOKEN and TAGIFY_POSTHOG_HOST to the project token and approved ingestion host.');
  }
  return { token, host };
}

export function eventUUID(key) {
  const hex = createHash('sha256').update(key).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

export async function capture(events, config, request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let offset = 0; offset < events.length; offset += 50) {
    const body = JSON.stringify({ api_key: config.token, batch: events.slice(offset, offset + 50) });
    let delivered = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await request(`${config.host}/batch/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          redirect: 'error', signal: AbortSignal.timeout(10_000),
        });
        const result = await response.json();
        if (response.ok && (result?.status === 1 || result?.status === 'Ok') && !(result.quota_limited?.length)) { delivered = true; break; }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
      } catch { /* A bounded retry reuses the same UUIDs and payload. Never print keys or response bodies. */ }
      if (attempt < 2) await sleep(1000 * 2 ** attempt);
    }
    if (!delivered) throw new Error('PostHog did not acknowledge the download snapshot. Check project settings, quota and connectivity; replay the saved snapshot to retry.');
  }
}
