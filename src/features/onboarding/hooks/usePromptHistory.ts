import { useEffect, useSyncExternalStore } from "react";
import packageJson from "../../../../package.json";
import { promptHistoryStore } from "../services/promptHistory";

export function usePromptHistory() {
  const snapshot = useSyncExternalStore(promptHistoryStore.subscribe, promptHistoryStore.getSnapshot);
  useEffect(() => promptHistoryStore.start(packageJson.version), []);
  return { ...snapshot, markSeen: (prompt: "mobileTaggingIntroSeen" | "discoverySurveyDismissed") => promptHistoryStore.markSeen(prompt) };
}
