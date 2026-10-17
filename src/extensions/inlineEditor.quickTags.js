import { findTagSuggestions, findUsualTagName } from "@tagify/community-contracts";
import { getQuickTagMatches, getQuickTagNameError, getQuickTagTags, getQuickTagTargets } from "../features/tag-data/utils/quickTag";

const MAX_MEMBER_SUGGESTIONS = 3;
let hintCount = 0;

const sameText = (a, b) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const memberCount = (people) => `${people} ${people === 1 ? "member" : "members"}`;

export function createQuickTagSearch({ categories, getCategories = () => categories, getPopularTags = () => [], onApply, onCreate }) {
  const container = document.createElement("div");
  container.className = "tagify-quick-tag-search";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search or create a tag…";
  input.setAttribute("aria-label", "Search tags");
  input.style.cssText = "width:100%;padding:7px;border:1px solid var(--spice-button);border-radius:4px;background:var(--spice-main);color:var(--spice-text);box-sizing:border-box";
  const results = document.createElement("div");
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.style.fontSize = "12px";
  const hintId = `tagify-quick-tag-hint-${++hintCount}`;
  // Says the usual name once while typing; the list below is rebuilt on every key.
  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
  const announce = (message) => { if (announcer.textContent !== message) announcer.textContent = message; };
  let busy = false;
  const run = async (operation) => {
    if (busy) return;
    busy = true;
    input.disabled = true;
    render();
    try { await operation(); input.value = ""; status.textContent = "Tag applied"; }
    catch (error) { status.textContent = error instanceof Error ? error.message : "Tagify couldn't save that tag. Please try again."; }
    finally { busy = false; input.disabled = false; render(); input.focus(); }
  };
  const button = (label, handler, parent = results) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = label;
    element.disabled = busy;
    element.style.cssText = "width:100%;padding:6px;text-align:left;border:0;background:transparent;color:var(--spice-text);cursor:pointer;overflow-wrap:anywhere";
    element.onclick = handler;
    parent.appendChild(element);
    return element;
  };
  let chosenParent = getQuickTagTargets(getCategories())[0]?.id || "";
  // Your tags that match what you typed, your own same tag first; plus names other members use.
  const lookup = () => {
    const current = getCategories();
    const typed = input.value.trim();
    const suggestions = findTagSuggestions(typed, getPopularTags(), { mine: getQuickTagTags(current) });
    const same = suggestions.filter((suggestion) => suggestion.match === "mine").map((suggestion) => suggestion.tag);
    const matches = [...same, ...getQuickTagMatches(current, typed).filter((tag) => !same.some((own) => own.id === tag.id))];
    const exact = matches.filter((tag) => same.includes(tag) || sameText(tag.name, typed));
    return { typed, suggestions, matches, exact };
  };
  const createAndApply = (name) => run(async () => {
    const tag = await onCreate(name, chosenParent);
    await onApply(tag.id, tag.name);
  });
  const render = () => {
    results.replaceChildren();
    if (!input.value.trim()) { announce(""); return; }
    const { typed, suggestions, matches, exact } = lookup();
    matches.forEach((tag) => button(tag.name, () => run(() => onApply(tag.id, tag.name))));

    // Creating a tag stays possible, but the name members usually use is pointed out first.
    const usual = exact.length ? null : findUsualTagName(typed, suggestions);
    const usualText = usual ? `Members usually call this “${usual.name}” (${usual.people})` : "";
    announce(usualText);
    const fromMembers = suggestions
      .filter((suggestion) => suggestion.match !== "mine" && !suggestion.yours && suggestion !== usual && !sameText(suggestion.name, typed))
      .slice(0, MAX_MEMBER_SUGGESTIONS);
    if (fromMembers.length) {
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Used by other members");
      const heading = document.createElement("div");
      heading.textContent = "Used by other members";
      heading.setAttribute("aria-hidden", "true");
      heading.style.cssText = "margin:6px 6px 2px;color:var(--spice-subtext);font-size:11px;font-weight:700";
      group.appendChild(heading);
      fromMembers.forEach((suggestion) => {
        const element = button(suggestion.name, () => createAndApply(suggestion.name), group);
        element.title = `Create and apply “${suggestion.name}”`;
        element.setAttribute("aria-label", `${suggestion.name}, ${memberCount(suggestion.people)}`);
        element.style.display = "flex";
        element.style.gap = "8px";
        element.style.alignItems = "baseline";
        element.textContent = "";
        const name = document.createElement("span");
        name.textContent = suggestion.name;
        name.style.cssText = "flex:1;min-width:0";
        const count = document.createElement("span");
        count.textContent = memberCount(suggestion.people);
        count.style.cssText = "flex:none;color:var(--spice-subtext);font-size:11px";
        element.append(name, count);
      });
      results.appendChild(group);
    }

    if (exact.length && !fromMembers.length) return;
    const select = document.createElement("select");
    select.setAttribute("aria-label", "New tag category or folder");
    select.style.cssText = "width:100%;padding:6px;background:var(--spice-main);color:var(--spice-text)";
    const targets = getQuickTagTargets(getCategories());
    (targets.length ? targets : [{ id: "", name: "Quick tags" }]).forEach((target) => {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.name;
      select.appendChild(option);
    });
    select.value = chosenParent;
    select.disabled = busy;
    select.onchange = () => { chosenParent = select.value; };
    results.appendChild(select);
    if (exact.length) return;

    if (usual) {
      const hint = document.createElement("div");
      hint.style.cssText = "margin:6px 0 2px;padding:6px 8px;border-radius:4px;background:var(--spice-tab-active, rgba(255,255,255,.08));color:var(--spice-text);font-size:12px;overflow-wrap:anywhere";
      const text = document.createElement("span");
      text.id = hintId;
      text.textContent = usualText;
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = "Use this name";
      use.title = `Apply “${usual.name}” instead`;
      use.disabled = busy;
      use.setAttribute("aria-describedby", hintId);
      use.style.cssText = "display:block;margin-top:4px;padding:0;border:0;background:transparent;color:var(--spice-text);font:inherit;font-weight:700;cursor:pointer;text-decoration:underline";
      use.onclick = () => usual.yours
        ? run(() => onApply(usual.yours.id, usual.yours.name))
        : createAndApply(usual.name);
      hint.append(text, use);
      results.appendChild(hint);
    }
    const create = button(`Create and apply “${typed}”`, () => createAndApply(input.value.trim()));
    if (usual) create.setAttribute("aria-describedby", hintId);
    create.disabled = busy || !!getQuickTagNameError(input.value);
  };
  input.oninput = () => { status.textContent = ""; render(); };
  input.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { input.value = ""; render(); }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const { matches, exact } = lookup();
    const tag = exact.length === 1 ? exact[0] : !exact.length && matches.length === 1 ? matches[0] : null;
    if (tag) void run(() => onApply(tag.id, tag.name));
  };
  container.append(input, results, status, announcer);
  return container;
}
