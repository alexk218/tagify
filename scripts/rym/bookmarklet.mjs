import { createRymExporter } from './exporter.mjs';
import { createRymReader } from './reader.mjs';
import { parseRymExport } from '../../src/shared/rym/rymExport.mjs';

export function openExporter(createExporter, createReader, validateExport) {
  if (location.origin !== 'https://rateyourmusic.com') return alert('Open your Rate Your Music profile first.');
  const account = location.pathname.match(/^\/~([a-zA-Z0-9_-]+)\/?$/)?.[1];
  if (!account) return alert('Open your own Rate Your Music profile, then run this bookmark again.');
  if (document.querySelector('#tagify-rym-exporter')) return;
  const panel = document.createElement('dialog');
  panel.id = 'tagify-rym-exporter';
  panel.style.cssText = 'position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(600px,calc(100vw - 32px));max-width:none;max-height:calc(100vh - 32px);overflow:auto;overflow-wrap:anywhere;background:#fff;color:#171717;padding:24px;border:1px solid #777;border-radius:12px;font:16px/1.5 system-ui;text-align:left';
  panel.setAttribute('aria-labelledby', 'tagify-rym-title');
  const heading = document.createElement('h2');
  heading.id = 'tagify-rym-title';
  heading.style.cssText = 'font:600 22px/1.3 system-ui;margin:0 0 12px';
  heading.textContent = 'Export your personal RYM tags';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Choose the tags to take with you. Keep this page open until the export finishes.';
  const choices = document.createElement('fieldset');
  choices.style.cssText = 'margin:16px 0;padding:12px;border:1px solid #bbb;min-width:0';
  const legend = document.createElement('legend');
  legend.textContent = 'Tags to export';
  choices.append(legend);
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  let state = null;
  let controller = null;
  let checkpoint = null;
  const download = (value, name) => {
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  };
  const button = (name, action) => {
    const element = document.createElement('button');
    element.textContent = name;
    element.type = 'button';
    element.style.cssText = 'margin:0;padding:8px 12px;max-width:100%;font:inherit;white-space:normal';
    element.onclick = action;
    actions.append(element);
    return element;
  };
  const read = createReader({
    origin: location.origin, fetchPage: (address, options) => fetch(address, options),
    parseDocument: (html) => new DOMParser().parseFromString(html, 'text/html'),
    storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    now: () => Date.now(), pause: (ms, signal) => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Cancelled. Save your progress to continue later.')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    }),
  });
  const exporter = createExporter({ origin: location.origin, parseDocument: (html) => new DOMParser().parseFromString(html, 'text/html'), read });
  const start = button('Start export', async () => {
    start.disabled = true;
    complete.disabled = true;
    save.disabled = true;
    state = null;
    resume.disabled = true;
    fresh.disabled = true;
    choices.disabled = true;
    controller = new AbortController();
    try {
      const names = [...choices.querySelectorAll('input:checked')].map((input) => input.value);
      state = await exporter.run(account, names, { signal: controller.signal, checkpoint,
        onProgress: (progress) => {
          state = progress;
          save.disabled = false;
          status.textContent = progress.error || `${progress.releases.length} releases read. ${progress.selectedTags.map((tag) => `${tag.name}: ${tag.collected}/${tag.expected}`).join('; ')}`;
        } });
      if (state.status === 'complete') status.textContent = `${state.releases.length} releases ready. Download your export, then choose it in Tagify Community’s Rate Your Music import to review your album matches.`;
      complete.disabled = state.status !== 'complete';
    } catch (error) { status.textContent = error.message; }
    finally { start.disabled = false; resume.disabled = false; fresh.disabled = false; choices.disabled = false; controller = null; }
  });
  button('Cancel', () => controller?.abort());
  const save = button('Save progress', () => state && download(state, 'tagify-rym-progress.json'));
  save.disabled = true;
  const complete = button('Download export', () => state?.status === 'complete' && download(state, 'tagify-rym-export.json'));
  complete.disabled = true;
  const resume = document.createElement('input');
  resume.type = 'file';
  resume.accept = '.json,application/json';
  resume.id = 'tagify-rym-resume';
  resume.style.cssText = 'display:block;width:100%;max-width:100%;margin-top:8px;font:inherit';
  const resumeLabel = document.createElement('label');
  resumeLabel.htmlFor = resume.id;
  resumeLabel.textContent = 'Resume from saved progress';
  resume.onchange = async () => {
    state = null; complete.disabled = true; save.disabled = true;
    try {
      const file = resume.files[0];
      if (!file || file.size > 50 * 1024 * 1024) throw new Error('Choose a progress file smaller than 50 MB.');
      const value = validateExport(JSON.parse(await file.text()), { requireComplete: false });
      if (value.account !== account) throw new Error('This progress file belongs to another account or is unsupported.');
      checkpoint = value;
      fresh.hidden = false;
      for (const input of choices.querySelectorAll('input')) input.checked = value.selectedTags.some((tag) => tag.name === input.value);
      status.textContent = 'Progress loaded. Start export to recheck saved pages and continue.';
    } catch (error) { checkpoint = null; fresh.hidden = true; status.textContent = error.message; }
  };
  const fresh = button('Start fresh', () => {
    checkpoint = null; state = null; resume.value = '';
    save.disabled = true; complete.disabled = true; fresh.hidden = true;
    status.textContent = 'Choose your tags, then start a new export. Your downloaded progress files are kept.';
  });
  fresh.hidden = true;
  button('Close', () => { controller?.abort(); panel.remove(); });
  panel.append(heading, status, choices, actions, document.createElement('hr'), resumeLabel, resume);
  document.body.append(panel);
  panel.addEventListener('cancel', () => { controller?.abort(); panel.remove(); });
  panel.showModal();
  try {
    const tags = exporter.index(document.documentElement.outerHTML, account);
    for (const tag of tags) {
      const label = document.createElement('label');
      label.style.cssText = 'display:block;font:inherit;margin:4px 0;overflow-wrap:anywhere';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = tag.name; input.checked = true;
      label.append(input, document.createTextNode(` ${tag.name} (${tag.expected})`));
      choices.append(label);
    }
    if (!tags.length) { status.textContent = 'No personal tags were found. Open the Tags tab on your profile and try again.'; start.disabled = true; }
  } catch (error) { status.textContent = error.message; start.disabled = true; }
}

export const bookmarklet = `javascript:${encodeURIComponent(`void(${openExporter.toString()})(${createRymExporter.toString()},${createRymReader.toString()},${parseRymExport.toString()});`)}`;
