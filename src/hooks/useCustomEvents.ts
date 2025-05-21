import { useEffect } from "react";

interface UseCustomEventsProps {
  eventName: string;
  handler: (event: Event) => void;
  dependencies: any[];
}

export function useCustomEvents({ eventName, handler, dependencies = [] }: UseCustomEventsProps) {
  useEffect(() => {
    window.addEventListener(eventName, handler);

    // Check if we should show missing tracks panel on load
    if (eventName === "tagify:toggleMissingTracks") {
      const activePanel = localStorage.getItem("tagify:activePanel");
      if (activePanel === "missingTracks") {
        const event = new CustomEvent("tagify:toggleMissingTracks", {
          detail: { show: true },
        });
        window.dispatchEvent(event);
      }
    }

    // Cleanup
    return () => {
      window.removeEventListener(eventName, handler);
    };
  }, dependencies);
}
