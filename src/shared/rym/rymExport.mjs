/**
 * Shared, standalone validator; serialized into the bookmarklet as well as used by Tagify and Tagify Community.
 * `compact` accepts a completed export whose pages were already checked and removed (`pages: []`),
 * so a server can recheck the releases without receiving every collection page again.
 */
export function parseRymExport(value, { requireComplete = true, compact = false } = {}) {
  const fail = (message = 'This RYM export could not be read. Download a new export and try again.') => { throw new Error(message); };
  const object = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  const string = (item, max = 2000) => typeof item === 'string' && item.length > 0 && item.length <= max && item.trim().length > 0;
  const list = (items, maximum) => Array.isArray(items) && items.length <= maximum;
  const unique = (items) => new Set(items).size === items.length;
  const address = (item) => {
    if (!string(item, 8000)) fail();
    let result;
    try { result = new URL(item); } catch { fail(); }
    if (result.origin !== 'https://rateyourmusic.com' || result.username || result.password || result.search || result.hash) fail();
    return result;
  };
  if (!object(value) || value.format !== 'tagify-rym-personal-tags' || value.version !== 1) {
    fail('This file is not a supported RYM export. Use the exporter supplied by Tagify to download a new file.');
  }
  if (!string(value.account, 100) || !/^[a-zA-Z0-9_-]+$/.test(value.account) ||
      !['complete', 'incomplete'].includes(value.status)) fail();
  if (requireComplete && value.status !== 'complete') {
    fail('This export is unfinished. Resume it in RYM, then download the completed export.');
  }
  if (!list(value.selectedTags, 10000) || !value.selectedTags.length || !list(value.releases, 250000) ||
      !list(value.pages, 100000) || !(value.error === null || string(value.error, 4000))) fail();
  if (value.status === 'complete' && value.error !== null) fail();
  if (compact && (value.status !== 'complete' || value.pages.length)) fail();
  const prefix = `/collection/${value.account}/stag/`;
  const tagNames = new Set();
  const tagPaths = new Map();
  const paths = new Set();
  const selectedTags = value.selectedTags.map((tag) => {
    if (!object(tag) || !string(tag.name, 1000) || tagNames.has(tag.name) ||
        !Number.isSafeInteger(tag.expected) || tag.expected < 0 || tag.expected > 250000 ||
        !Number.isSafeInteger(tag.collected) || tag.collected < 0 || tag.collected > tag.expected ||
        (value.status === 'complete' && tag.collected !== tag.expected)) fail();
    const url = address(tag.url);
    let path;
    try { path = decodeURIComponent(url.pathname).replace(/\/$/, ''); } catch { fail(); }
    if (!path.startsWith(prefix) || path.length <= prefix.length) fail();
    if (paths.has(path)) fail();
    paths.add(path);
    tagNames.add(tag.name); tagPaths.set(tag.name, path);
    return { name: tag.name, url: url.href, expected: tag.expected, collected: tag.collected };
  });
  const release = (item) => {
    if (!object(item) || !string(item.id, 30) || !/^[1-9]\d*$/.test(item.id) ||
        !string(item.title) || !list(item.artists, 100) || !item.artists.length ||
        item.artists.some((artist) => !string(artist)) || !unique(item.artists) ||
        !(item.year === null || Number.isInteger(item.year) && item.year >= 1000 && item.year <= 9999) ||
        !string(item.releaseType, 100) || !list(item.tags, 10000) || !item.tags.length ||
        !unique(item.tags) || item.tags.some((name) => !tagNames.has(name))) fail();
    const url = address(item.url);
    if (url.pathname.match(/^\/release\/([^/]+)\/[^/]+\/[^/]+\/?$/)?.[1] !== item.releaseType) fail();
    return { id: item.id, url: url.href, title: item.title, artists: [...item.artists], year: item.year,
      releaseType: item.releaseType, tags: [...item.tags] };
  };
  const releases = value.releases.map(release);
  const byId = new Map(releases.map((item) => [item.id, item]));
  if (byId.size !== releases.length) fail();
  const identity = ({ tags: _tags, ...item }) => JSON.stringify(item);
  const pagesSeen = new Set();
  const perTag = new Map(selectedTags.map((tag) => [tag.name, new Set()]));
  const covered = new Set();
  const assignments = new Map(selectedTags.map((tag) => [tag.name, 0]));
  for (const item of releases) for (const name of item.tags) assignments.set(name, assignments.get(name) + 1);
  const pages = compact ? [] : value.pages.map((page) => {
    if (!object(page) || !tagNames.has(page.tag) || !string(page.path, 8000) || !string(page.signature, 5000000)) fail();
    const base = tagPaths.get(page.tag);
    if (page.path !== base && !(page.path.startsWith(`${base}/`) && /^\/[2-9]\d*$|^\/1\d+$/.test(page.path.slice(base.length)))) fail();
    const key = JSON.stringify([page.tag, page.path]);
    if (pagesSeen.has(key)) fail();
    pagesSeen.add(key);
    let records;
    try { records = JSON.parse(page.signature); } catch { fail(); }
    if (!list(records, 10000) || !records.length) fail();
    for (const raw of records) {
      const item = release(raw);
      const saved = byId.get(item.id);
      if (!saved || !item.tags.includes(page.tag) || identity(saved) !== identity(item) ||
          item.tags.some((name) => !saved.tags.includes(name)) || perTag.get(page.tag).has(item.id)) fail();
      perTag.get(page.tag).add(item.id); covered.add(item.id);
    }
    return { tag: page.tag, path: page.path, signature: page.signature };
  });
  if (!compact && covered.size !== releases.length) fail();
  for (const tag of selectedTags) {
    if (!compact && perTag.get(tag.name).size !== tag.collected) fail();
    if (value.status === 'complete' && assignments.get(tag.name) !== tag.expected) fail();
  }
  return { format: 'tagify-rym-personal-tags', version: 1, account: value.account, status: value.status,
    selectedTags, pages, releases, error: value.error };
}
