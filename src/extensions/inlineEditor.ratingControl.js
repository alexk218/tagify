const STAR_COUNT = 5;

function getStarFillWidth(starNumber, rating) {
  const fill = Math.max(0, Math.min(1, rating - (starNumber - 1)));
  return `${fill * 100}%`;
}

function updateStarFills(control, rating) {
  control
    .querySelectorAll(".tagify-rating-star-fill")
    .forEach((fill, index) => {
      fill.style.width = getStarFillWidth(index + 1, rating);
    });
}

function formatRating(rating) {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

export function renderStarRatingControl(
  control,
  { rating = 0, compact = false, getActionLabel, onRate },
) {
  control.replaceChildren();

  for (let starNumber = 1; starNumber <= STAR_COUNT; starNumber += 1) {
    const star = document.createElement("span");
    star.className = "tagify-rating-star";
    star.style.position = "relative";
    star.style.display = "inline-block";
    star.style.width = "1em";
    star.style.height = "1em";
    star.style.fontSize = compact ? "12px" : "14px";
    star.style.lineHeight = "1";

    const outline = document.createElement("span");
    outline.textContent = "☆";
    outline.setAttribute("aria-hidden", "true");
    outline.style.color = "var(--spice-subtext)";

    const fill = document.createElement("span");
    fill.className = "tagify-rating-star-fill";
    fill.textContent = "★";
    fill.setAttribute("aria-hidden", "true");
    fill.style.position = "absolute";
    fill.style.inset = "0 auto 0 0";
    fill.style.width = getStarFillWidth(starNumber, rating);
    fill.style.overflow = "hidden";
    fill.style.whiteSpace = "nowrap";
    fill.style.color = "#ffd166";
    fill.style.pointerEvents = "none";

    const actions = document.createElement("span");
    actions.style.position = "absolute";
    actions.style.inset = "0";
    actions.style.display = "flex";

    [starNumber - 0.5, starNumber].forEach((value) => {
      const button = document.createElement("button");
      const formattedValue = formatRating(value);
      const isCurrentRating = value === rating;
      const defaultLabel = isCurrentRating
        ? `Clear ${formattedValue} star rating`
        : `Set rating to ${formattedValue} stars`;
      const updateActionLabel = () => {
        const label =
          getActionLabel?.(value, defaultLabel) || defaultLabel;
        button.title = label;
        button.setAttribute("aria-label", label);
      };

      button.type = "button";
      button.title = defaultLabel;
      button.setAttribute("aria-label", defaultLabel);
      button.setAttribute("aria-pressed", String(isCurrentRating));
      button.style.width = "50%";
      button.style.height = "100%";
      button.style.margin = "0";
      button.style.padding = "0";
      button.style.border = "0";
      button.style.background = "transparent";
      button.style.cursor = "pointer";
      button.addEventListener("mouseenter", () => {
        updateActionLabel();
        updateStarFills(control, value);
      });
      button.addEventListener("focus", () => {
        updateActionLabel();
        updateStarFills(control, value);
      });
      button.addEventListener("mouseleave", () =>
        updateStarFills(control, rating),
      );
      button.addEventListener("blur", () => updateStarFills(control, rating));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onRate(value === rating ? 0 : value);
      });
      actions.appendChild(button);
    });

    star.append(outline, fill, actions);
    control.appendChild(star);
  }
}
