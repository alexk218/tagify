import packageJson from "@/package";

const LAST_SEEN_VERSION_KEY = "tagify:lastSeenVersion";

export const welcomeModal = {
  initialize() {
    const waitForSpicetify = async () => {
      while (!Spicetify?.PopupModal || !Spicetify?.Platform) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    const injectStyles = () => {
      if (document.getElementById("tagify-onboarding-styles")) return;

      const style = document.createElement("style");
      style.id = "tagify-onboarding-styles";
      style.innerHTML = `
        /* Hide default modal styling */
        .GenericModal[aria-label="Welcome to Tagify"] .main-trackCreditsModal-container {
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
        }

        .GenericModal[aria-label="Welcome to Tagify"] .main-trackCreditsModal-header {
          display: none !important;
        }

        #tagify-welcome-modal {
          padding: 0;
          max-width: 440px;
          text-align: center;
          font-family: var(--font-family, 'Spotify Circular', sans-serif);
          background: var(--spice-card, #121212);
          color: var(--spice-text, #fff);
          border-radius: 12px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
          overflow: hidden;
        }

        #tagify-welcome-header {
          background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
          padding: 32px 32px;
          position: relative;
        }

        #tagify-welcome-icon {
          width: 72px;
          height: 72px;
          margin: 0 auto 24px;
          background: linear-gradient(135deg, #282a29 0%, #000000 100%);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: tagifyIconPulse 2s ease-in-out infinite;
        }

        @keyframes tagifyIconPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        #tagify-welcome-icon svg {
          width: 40px;
          height: 40px;
          color: #fff;
        }

        #tagify-welcome-modal h2 {
          font-size: 32px;
          font-weight: 700;
          margin: 0 0 16px 0;
          color: var(--spice-text, #fff);
        }

        #tagify-welcome-modal .version-badge {
          position: absolute;
          top: 24px;
          right: 24px;
          display: inline-block;
          font-size: 14px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.6);
          background: rgba(255, 255, 255, 0.08);
          padding: 4px 10px;
          border-radius: 12px;
          margin: 0;
          letter-spacing: 0.5px;
        }

        #tagify-welcome-modal .subtitle {
          font-size: 16px;
          color: var(--spice-subtext, #b3b3b3);
          margin: 0;
          line-height: 1.5;
        }

        #tagify-welcome-modal .subtitle strong {
          color: rgba(255, 255, 255, 0.9);
          font-weight: 600;
        }

        #tagify-welcome-modal .nav-hint {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.5);
          margin: 12px 0 0 0;
          line-height: 1.5;
        }

        #tagify-welcome-modal .nav-hint strong {
          color: rgba(255, 255, 255, 0.8);
          font-weight: 600;
        }

        #tagify-welcome-footer {
          padding: 32px;
          background: rgba(0, 0, 0, 0.3);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        #tagify-welcome-close {
          width: 80%;
          background: rgb(0 0 0 / 30%);
          color: #fff;
          font-weight: 700;
          font-size: 16px;
          border: 1px solid rgb(255 255 255 / 15%);
          border-radius: 500px;
          padding: 14px 32px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        #tagify-welcome-close:hover {
          background: rgb(255 255 255 / 10%);
          transform: translateY(-2px);
          border-color: rgb(255 255 255 / 30%);
          box-shadow: 0 4px 12px rgb(0 0 0 / 20%);
          // box-shadow: 0 8px 20px rgba(29, 185, 84, 0.4);
        }

        #tagify-welcome-close:active {
          transform: translateY(0);
        }
      `;
      document.head.appendChild(style);
    };

    const showModal = () => {
      injectStyles();

      const content = document.createElement("div");
      content.id = "tagify-welcome-modal";

      const TAGIFY_SVG = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.42L11.59,21.42C11.96,21.79 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.42L21.41,14.42C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z"/>
        </svg>
      `;

      content.innerHTML = `
        <div id="tagify-welcome-header">
          <p class="version-badge">v${packageJson.version}</p>
          <div id="tagify-welcome-icon">
            ${TAGIFY_SVG}
          </div>
          <h2>Welcome to Tagify!</h2>
          <p class="subtitle">Successfully installed and ready to go.</p>
          <p class="nav-hint">Click <strong>Tagify</strong> in your top bar to start.</p>
        </div>

        <div id="tagify-welcome-footer">
          <button id="tagify-welcome-close">Start Tagging</button>
        </div>
      `;

      Spicetify.PopupModal.display({
        title: "Welcome to Tagify",
        content,
        isLarge: false,
      });

      localStorage.setItem(LAST_SEEN_VERSION_KEY, packageJson.version);

      content
        .querySelector("#tagify-welcome-close")
        ?.addEventListener("click", () => {
          Spicetify.PopupModal.hide();

          // navigate to Tagify
          // Spicetify.Platform.History.push("/tagify");
        });
    };

    (async () => {
      await waitForSpicetify();

      const lastSeenVersion = localStorage.getItem(LAST_SEEN_VERSION_KEY);
      const currentVersion = packageJson.version;

      if (!lastSeenVersion || lastSeenVersion !== currentVersion) {
        // let UI fully render before showing popup
        setTimeout(showModal, 1000);
      }
    })();
  },
};
