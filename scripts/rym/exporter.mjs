/** Personal-tag exporter run by the RYM bookmarklet; reads ordinary collection pages in the signed-in browser. */
export function createRymExporter(environment) {
  const { parseDocument, read, origin } = environment;
  const fail = (message) => { throw new Error(message); };
  const text = (node) => node?.textContent?.trim() || '';
  const url = (value) => {
    const result = new URL(value, origin);
    if (result.origin !== origin || result.username || result.password || result.search || result.hash) {
      fail('Unexpected page address. Export stopped.');
    }
    return result;
  };
  const path = (value) => decodeURIComponent(url(value).pathname).replace(/\/$/, '');
  const pageKey = (value, tag) => path(value) === `${path(tag.url)}/1` ? path(tag.url) : path(value);
  const collection = (value, account) => {
    const address = url(value);
    if (!path(address.href).startsWith(`/collection/${account}/stag/`)) fail('Unexpected collection page.');
    return address.href;
  };
  function index(html, account) {
    if (!/^[a-zA-Z0-9_-]+$/.test(account)) fail('Unsupported account name.');
    const doc = parseDocument(html);
    const root = doc.querySelector('#musictag');
    if (!root) fail('Personal tags could not be read. Open your profile and sign in before retrying.');
    const tags = Array.from(root.querySelectorAll('a[href]')).map((anchor) => {
      const count = text(anchor.nextElementSibling).match(/^\(([\d,]+)\)$/);
      if (!count || !text(anchor)) fail('A personal-tag count could not be read.');
      const expected = Number(count[1].replaceAll(',', ''));
      if (!Number.isSafeInteger(expected) || expected < 0) fail('Invalid personal-tag count.');
      return { name: text(anchor), url: collection(anchor.getAttribute('href'), account), expected };
    });
    if (new Set(tags.map((tag) => tag.name)).size !== tags.length) fail('Repeated personal tag in index.');
    return tags;
  }
  function page(html, address, tag, account) {
    collection(address, account);
    const doc = parseDocument(html);
    const rows = Array.from(doc.querySelectorAll('tr')).filter((row) => row.querySelector('[id^="tagl"]'));
    if (!rows.length) fail('A collection page is empty or unavailable. Export stopped.');
    const records = rows.map((row) => {
      const cloud = row.querySelector('[id^="tagl"]');
      const id = cloud.id.match(/^tagl([1-9]\d*)$/)?.[1];
      const album = row.querySelector('a.album');
      const artists = Array.from(row.querySelectorAll('a.artist')).map(text);
      const releaseUrl = album && url(album.getAttribute('href'));
      const releaseType = releaseUrl?.pathname.match(/^\/release\/([^/]+)\//)?.[1];
      if (!id || !text(album) || !artists.length || !releaseType) fail('A release could not be identified.');
      const tags = Array.from(cloud.querySelectorAll('a[href]')).map((a) => {
        collection(a.getAttribute('href'), account);
        return text(a);
      });
      if (!tags.includes(tag.name)) fail('A page does not contain the selected personal tag.');
      const yearText = text(row.querySelector('.or_q_albumartist .smallgray'));
      const year = yearText.match(/^\((\d{4})\)$/)?.[1];
      return { id, url: releaseUrl.href, title: text(album), artists,
        year: year ? Number(year) : null, releaseType, tags: [...new Set(tags)] };
    });
    if (new Set(records.map((record) => record.id)).size !== records.length) fail('A collection page repeats a release.');
    const base = path(tag.url);
    const links = new Map();
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      // Only pagination for this exact selected tag; ignore filters and other tags.
      let candidate;
      try { candidate = url(href); } catch { continue; }
      const candidatePath = path(candidate.href);
      const suffix = candidatePath.slice(base.length);
      if (candidatePath === base || (candidatePath.startsWith(base + '/') && /^\/[1-9]\d*$/.test(suffix))) {
        links.set(candidatePath, candidate.href);
      }
    }
    return { records, links: [...links.values()] };
  }
  function initial(account, tags) {
    return { format: 'tagify-rym-personal-tags', version: 1, account,
      status: 'incomplete', selectedTags: tags.map((tag) => ({ ...tag, collected: 0 })),
      pages: [], releases: [], error: null };
  }
  async function run(account, selectedNames, options = {}) {
    let state;
    const notify = () => options.onProgress?.(JSON.parse(JSON.stringify(state)));
    const checkCancel = () => { if (options.signal?.aborted) fail('Cancelled. Save your progress to continue later.'); };
    const readPage = async (address) => { checkCancel(); return read(url(address).href, options.signal); };
    const profileUrl = `${origin}/~${account}`;
    const tags = index(await readPage(profileUrl), account).filter((tag) => selectedNames.includes(tag.name));
    if (!tags.length || tags.length !== new Set(selectedNames).size) fail('Selected tags are missing. Select your tags again.');
    state = initial(account, tags);
    try {
      const prior = options.checkpoint;
      if (prior && (prior.format !== state.format || prior.version !== 1 || prior.account !== account ||
          !Array.isArray(prior.selectedTags) || !Array.isArray(prior.pages) ||
          JSON.stringify(prior.selectedTags.map(({ name, expected }) => ({ name, expected }))) !==
          JSON.stringify(tags.map(({ name, expected }) => ({ name, expected }))))) {
        fail('The collection or selected tags changed. Start a new export.');
      }
      const releases = new Map();
      for (const tag of state.selectedTags) {
        const queue = tag.expected === 0 ? [] : [tag.url];
        const visited = new Set();
        const ids = new Set();
        while (queue.length) {
          checkCancel();
          const address = queue.shift();
          const key = pageKey(address, tag);
          if (visited.has(key)) continue;
          if (visited.size >= 10000) fail('Too many collection pages. Export stopped.');
          const result = page(await readPage(address), address, tag, account);
          result.records = result.records.map((release) => ({ ...release,
            tags: release.tags.filter((name) => selectedNames.includes(name)) }));
          const signature = JSON.stringify(result.records);
          const previous = prior?.pages.find((item) => item.tag === tag.name && item.path === key);
          if (previous && previous.signature !== signature) fail('A previously exported page changed. Start a new export.');
          for (const record of result.records) {
            if (ids.has(record.id)) fail('Different pages repeat a release. Export stopped.');
            ids.add(record.id);
            const existing = releases.get(record.id);
            if (existing) {
              const identity = ({ tags: _ignored, ...rest }) => rest;
              if (JSON.stringify(identity(existing)) !== JSON.stringify(identity(record))) fail('A release changed during export.');
              existing.tags = [...new Set([...existing.tags, ...record.tags])];
            } else releases.set(record.id, record);
          }
          visited.add(key);
          queue.push(...result.links.filter((link) => !visited.has(pageKey(link, tag))));
          state.pages.push({ tag: tag.name, path: key, signature });
          tag.collected = ids.size;
          state.releases = [...releases.values()];
          if (tag.collected > tag.expected) fail('The personal-tag count changed. Start a new export.');
          notify();
        }
        if (tag.collected !== tag.expected) fail('Some releases or pages are missing. Start a new export.');
      }
      const finalTags = index(await readPage(profileUrl), account);
      for (const tag of tags) {
        if (finalTags.find((item) => item.name === tag.name)?.expected !== tag.expected) {
          fail('The personal-tag count changed. Start a new export.');
        }
      }
      if (prior?.pages.some((old) => !state.pages.some((item) => item.tag === old.tag && item.path === old.path))) {
        fail('A previously exported page is missing. Start a new export.');
      }
      checkCancel();
      // Only selected assignments belong in the migration file.
      state.releases = state.releases.map((release) => ({ ...release, tags: release.tags.filter((tag) => selectedNames.includes(tag)) }));
      state.status = 'complete';
    } catch (error) {
      state.error = options.signal?.aborted ? 'Cancelled. Save your progress to continue later.' :
        error instanceof Error ? error.message : 'Export stopped. Save your progress and retry later.';
    }
    notify();
    return state;
  }
  return { index, page, run };
}
