/** Sequential same-origin reader. A server-requested pause survives reopening the exporter. */
export function createRymReader(environment) {
  const { fetchPage, parseDocument, storage, now, pause, origin } = environment;
  const cooldownKey = 'tagify-rym-export-pause-until';
  let lastRead = null;
  let stopped = null;
  const cancelled = () => new Error('Cancelled. Save your progress to continue later.');
  return async (address, signal) => {
    if (stopped) throw new Error(stopped);
    if (signal?.aborted) throw cancelled();
    const target = new URL(address);
    if (target.origin !== origin || target.username || target.password) throw new Error('Unexpected page address. Export stopped.');
    let pauseUntil;
    try {
      const saved = storage.getItem(cooldownKey);
      pauseUntil = saved === null ? 0 : Number(saved);
      if (!Number.isFinite(pauseUntil)) throw new Error('Invalid pause');
    } catch {
      throw new Error('Your browser cannot remember RYM’s requested pauses. Allow site storage before exporting.');
    }
    if (pauseUntil > now()) throw new Error('RYM asked you to pause. Save your progress and try again after ' + new Date(pauseUntil).toLocaleTimeString() + '.');
    if (lastRead !== null) await pause(Math.max(0, 1500 - (now() - lastRead)), signal);
    if (signal?.aborted) throw cancelled();
    lastRead = now();
    const response = await fetchPage(target.href, { credentials: 'same-origin', signal, redirect: 'error', cache: 'no-store' });
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) : null;
      const date = retry ? Date.parse(retry) : NaN;
      const until = seconds !== null ? now() + seconds * 1000 : Number.isFinite(date) ? date : now() + 15 * 60 * 1000;
      stopped = 'RYM asked you to pause. Save your progress and try again later.';
      try { storage.setItem(cooldownKey, String(Math.max(now() + 1500, until))); } catch {
        stopped += ' Keep this page open; your browser could not remember the pause.';
      }
      throw new Error(stopped);
    }
    if (response.status === 401 || response.status === 403) {
      stopped = 'RYM needs you to sign in or complete a check. Save your progress and visit RYM normally.';
      throw new Error(stopped);
    }
    if (!response.ok) throw new Error('A RYM page could not be loaded. Save your progress and retry later.');
    const html = await response.text();
    const doc = parseDocument(html);
    if (doc.querySelector('form[action*="login"], .g-recaptcha, #challenge-form') || /captcha|just a moment|access denied/i.test(doc.title)) {
      stopped = 'RYM requires a check. Save your progress and visit RYM normally.';
      throw new Error(stopped);
    }
    return html;
  };
}
