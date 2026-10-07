import { evaluateTrackMatchesCriteria } from "../features/smart-playlists/utils/smartPlaylist.criteria";

export function getSmartPlaylistRatingRemoval({
  playlist,
  trackUris,
  tracks,
  rating,
}) {
  if (!playlist?.isActive || !playlist.criteria.ratingFilters.length) return null;
  const members = new Set(playlist.smartPlaylistTrackUris);
  const removedTrackUris = [...new Set(trackUris)].filter((uri) => {
    const track = tracks[uri];
    return (
      members.has(uri) && track && track.rating !== rating &&
      evaluateTrackMatchesCriteria(track, playlist.criteria) &&
      !evaluateTrackMatchesCriteria({ ...track, rating }, playlist.criteria)
    );
  });
  if (!removedTrackUris.length) return null;
  return {
    playlistName: playlist.playlistName,
    removedTrackUris,
    allowedRatings: [...playlist.criteria.ratingFilters].sort((a, b) => a - b),
    rating,
  };
}

export function confirmSmartPlaylistRatingRemoval(removal) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "tagify-smart-playlist-rating-confirmation";
    dialog.setAttribute("aria-labelledby", "tagify-rating-confirm-title");
    dialog.setAttribute("aria-describedby", "tagify-rating-confirm-description");
    Object.assign(dialog.style, {
      background: "var(--spice-main, #121212)",
      color: "var(--spice-text, #fff)",
      border: "1px solid var(--spice-subtext, #aaa)",
      borderRadius: "12px",
      padding: "24px",
      width: "440px",
      maxWidth: "calc(100vw - 48px)",
      boxSizing: "border-box",
      boxShadow: "0 16px 64px #0009",
    });
    const style = document.createElement("style");
    style.textContent = ".tagify-smart-playlist-rating-confirmation::backdrop{background:rgba(0,0,0,.7)}";
    const title = document.createElement("h2");
    title.id = "tagify-rating-confirm-title";
    title.textContent = "Change rating and remove from playlist?";
    Object.assign(title.style, {
      fontSize: "20px", lineHeight: "1.3", margin: "0 0 16px", fontWeight: "700",
    });
    const description = document.createElement("p");
    description.id = "tagify-rating-confirm-description";
    const count = removal.removedTrackUris.length;
    const subject = count === 1 ? "This song" : `${count} selected songs`;
    const change = removal.rating === 0
      ? "Clearing the rating"
      : `Changing the rating to ${removal.rating} stars`;
    description.textContent =
      `${change} will remove ${count === 1 ? "this song" : `${count} selected songs`} from “${removal.playlistName}”. ` +
      `This smart playlist only includes songs rated ${removal.allowedRatings.join(" or ")} stars. ` +
      `${subject} will no longer match that rule.`;
    Object.assign(description.style, { fontSize: "14px", lineHeight: "1.6", margin: "0 0 24px" });
    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "12px", flexWrap: "wrap" });
    const cancel = document.createElement("button");
    const confirm = document.createElement("button");
    cancel.textContent = "Cancel";
    confirm.textContent = removal.rating === 0 ? "Clear rating and remove" : "Change rating and remove";
    [cancel, confirm].forEach((button) => {
      button.type = "button";
      Object.assign(button.style, {
        border: "0", borderRadius: "24px", padding: "12px 16px", fontSize: "14px",
        fontWeight: "700", cursor: "pointer",
        background: "var(--spice-tab-active, #333)", color: "var(--spice-text, #fff)",
      });
    });
    confirm.style.background = "var(--spice-button, #1ed760)";
    confirm.style.color = "#000";
    cancel.autofocus = true;
    let settled = false;
    const finish = (approved) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(approved);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));
    dialog.addEventListener("click", (event) => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (
        event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom
      )) finish(false);
    });
    actions.append(cancel, confirm);
    dialog.append(style, title, description, actions);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
