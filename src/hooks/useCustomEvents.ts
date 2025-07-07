import { useEffect } from "react";

interface UseCustomEventsProps {
  eventName: string;
  handler: (event: Event) => void;
  dependencies: any[];
}

export function useCustomEvents({ eventName, handler, dependencies = [] }: UseCustomEventsProps) {
  useEffect(() => {
    window.addEventListener(eventName, handler);

    // Cleanup
    return () => {
      window.removeEventListener(eventName, handler);
    };
  }, dependencies);
}
