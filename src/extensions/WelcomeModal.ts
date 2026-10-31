import packageJson from "@/package";
import { initializeStatsIntroduction } from "@/features/library-stats/model/statsIntroduction";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

const LAST_SEEN_VERSION_KEY = "tagify:lastSeenVersion";
const TAGIFY_BUTTON = 'button[aria-label="Tagify"]';

/**
 * A fresh install: Tagify has never opened on this Spotify and there are no saved songs.
 * Updates and reinstalls over an existing library never see the welcome.
 */
async function isFreshInstall(): Promise<boolean> {
  if (localStorage.getItem(LAST_SEEN_VERSION_KEY)) return false;
  try {
    return (await indexedDBStorage.getTrackCount()) === 0;
  } catch {
    // An unreadable library isn't proof of a new user.
    return false;
  }
}

async function findTagifyButton(timeoutMs = 10_000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const button = document.querySelector<HTMLElement>(TAGIFY_BUTTON);
    if (button || Date.now() >= deadline) return button;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const injectStyles = () => {
  if (document.getElementById("tagify-onboarding-styles")) return;

  const style = document.createElement("style");
  style.id = "tagify-onboarding-styles";
  style.innerHTML = `
    #tagify-welcome-callout {
      position: fixed;
      z-index: 1000;
      width: 280px;
      padding: 16px;
      background: var(--spice-card, #282828);
      color: var(--spice-text, #fff);
      border-radius: 8px;
      box-shadow: 0 16px 32px rgb(0 0 0 / 50%);
      font-family: inherit;
    }

    #tagify-welcome-callout::before {
      content: "";
      position: absolute;
      top: -6px;
      left: var(--tagify-arrow-left, 24px);
      width: 12px;
      height: 12px;
      background: inherit;
      transform: rotate(45deg);
    }

    #tagify-welcome-callout h2 {
      font-size: 16px;
      font-weight: 700;
      margin: 0 24px 6px 0;
    }

    #tagify-welcome-callout p {
      font-size: 14px;
      line-height: 1.45;
      color: var(--spice-subtext, #b3b3b3);
      margin: 0 0 14px;
    }

    #tagify-welcome-callout .tagify-welcome-callout-go {
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      color: #000;
      background: var(--spice-button, #1ed760);
      border: 0;
      border-radius: 500px;
      padding: 8px 18px;
      cursor: pointer;
    }

    #tagify-welcome-callout .tagify-welcome-callout-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      font-size: 18px;
      line-height: 1;
      color: var(--spice-subtext, #b3b3b3);
      background: transparent;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
    }

    #tagify-welcome-callout .tagify-welcome-callout-close:hover,
    #tagify-welcome-callout .tagify-welcome-callout-close:focus-visible {
      color: var(--spice-text, #fff);
      background: rgb(255 255 255 / 10%);
    }
  `;
  document.head.appendChild(style);
};

const openTagify = () => Spicetify.Platform.History.push("/tagify");

/** Points at Spotify's Tagify button so new users learn where Tagify lives. */
function showCallout(anchor: HTMLElement) {
  injectStyles();
  const callout = document.createElement("section");
  callout.id = "tagify-welcome-callout";
  callout.setAttribute("aria-label", "Welcome to Tagify");
  callout.innerHTML = `
    <h2>Tagify is here</h2>
    <p>Tag songs with moods, genres or anything you like, then turn them into playlists. Open it anytime from this tag icon.</p>
    <button type="button" class="tagify-welcome-callout-go">Tag your first song</button>
    <button type="button" class="tagify-welcome-callout-close" aria-label="Close">×</button>
  `;

  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, rect.left + rect.width / 2 - 30);
    callout.style.top = `${rect.bottom + 12}px`;
    callout.style.left = `${left}px`;
    callout.style.setProperty("--tagify-arrow-left", `${rect.left + rect.width / 2 - left - 6}px`);
  };
  const close = () => {
    callout.remove();
    window.removeEventListener("resize", place);
    anchor.removeEventListener("click", close);
  };

  place();
  document.body.appendChild(callout);
  window.addEventListener("resize", place);
  anchor.addEventListener("click", close);
  callout.querySelector(".tagify-welcome-callout-go")?.addEventListener("click", () => { close(); openTagify(); });
  callout.querySelector(".tagify-welcome-callout-close")?.addEventListener("click", close);
}

export const welcomeModal = {
  initialize() {
    initializeStatsIntroduction(packageJson.version);
    const waitForSpicetify = async () => {
      while (!Spicetify?.Platform) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    (async () => {
      await waitForSpicetify();

      const fresh = await isFreshInstall();
      localStorage.setItem(LAST_SEEN_VERSION_KEY, packageJson.version);
      if (!fresh) return;

      // let UI fully render before showing the welcome
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const anchor = await findTagifyButton();
      recordProductInteraction("welcome_popup_shown");
      // Without Spotify's Tagify button there's nothing to point at, so open Tagify instead.
      if (anchor) showCallout(anchor);
      else openTagify();
    })();
  },
};
