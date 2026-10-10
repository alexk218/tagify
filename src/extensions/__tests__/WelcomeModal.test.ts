import { afterEach, expect, it, vi } from "vitest";
import { welcomeModal } from "../WelcomeModal";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.getElementById("tagify-welcome-modal")?.remove();
  document.getElementById("tagify-onboarding-styles")?.remove();
});

it("opens Tagify when a new user chooses Start Tagging", async () => {
  vi.useFakeTimers();
  const push = vi.fn();
  const hide = vi.fn();
  vi.stubGlobal("Spicetify", {
    Platform: { History: { push } },
    PopupModal: {
      display: ({ content }: { content: HTMLElement }) => document.body.appendChild(content),
      hide,
    },
  });

  welcomeModal.initialize();
  await vi.advanceTimersByTimeAsync(1000);
  document.getElementById("tagify-welcome-close")!.click();

  expect(hide).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledWith("/tagify");
});
