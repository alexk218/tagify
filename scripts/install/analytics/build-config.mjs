import { readFile, writeFile } from 'node:fs/promises';
import { configuration } from './posthog.mjs';
const source = JSON.parse(await readFile(new URL('./posthog-config.json', import.meta.url), 'utf8'));
const token = process.env.TAGIFY_POSTHOG_TOKEN ?? source.token;
const host = process.env.TAGIFY_POSTHOG_HOST ?? source.host;
if (!token) {
  if (process.env.TAGIFY_REQUIRE_ANALYTICS === '1') throw new Error('This release requires a configured PostHog project.');
  console.log('Analytics unavailable in this development build; no project token is configured.');
} else {
  const config = configuration({ TAGIFY_POSTHOG_TOKEN: token, TAGIFY_POSTHOG_HOST: host });
  await writeFile(process.argv[2], JSON.stringify(config) + '\n');
  console.log('Public analytics project configuration embedded; sharing remains off by default.');
}
