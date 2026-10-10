import { getQuickTagMatches, getQuickTagNameError, getQuickTagTargets } from "../features/tag-data/utils/quickTag";

export function createQuickTagSearch({ categories, getCategories = () => categories, onApply, onCreate }) {
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
  const button = (label, handler) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = label;
    element.disabled = busy;
    element.style.cssText = "width:100%;padding:6px;text-align:left;border:0;background:transparent;color:var(--spice-text);cursor:pointer;overflow-wrap:anywhere";
    element.onclick = handler;
    results.appendChild(element);
    return element;
  };
  let chosenParent = getQuickTagTargets(getCategories())[0]?.id || "";
  const render = () => {
    results.replaceChildren();
    if (!input.value.trim()) return;
    const matches = getQuickTagMatches(getCategories(), input.value);
    matches.forEach((tag) => button(tag.name, () => run(() => onApply(tag.id, tag.name))));
    const exact = matches.filter((tag) => tag.name.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase());
    if (!exact.length) {
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
      const create = button(`Create and apply “${input.value.trim()}”`, () => {
        const name = input.value.trim();
        return run(async () => {
          const tag = await onCreate(name, chosenParent);
          await onApply(tag.id, tag.name);
        });
      });
      create.disabled = busy || !!getQuickTagNameError(input.value);
    }
  };
  input.oninput = () => { status.textContent = ""; render(); };
  input.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { input.value = ""; render(); }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    const matches = getQuickTagMatches(getCategories(), input.value);
    const exact = matches.filter((tag) => tag.name.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase());
    const tag = exact.length === 1 ? exact[0] : !exact.length && matches.length === 1 ? matches[0] : null;
    if (tag) void run(() => onApply(tag.id, tag.name));
  };
  container.append(input, results, status);
  return container;
}
