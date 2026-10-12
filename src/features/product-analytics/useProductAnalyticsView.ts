import { useEffect } from "react";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { recordProductEvent, type ProductEventName } from "./productAnalytics";

/** Fixed feature names only; never record routes, entity IDs or user-entered content. */
export function useProductAnalyticsView(event: ProductEventName | null): void {
  useEffect(() => {
    let active = true;
    if (event) void getUsageAccountDigest().then(account => {
      if (active && account) recordProductEvent(account, event);
    });
    return () => { active = false; };
  }, [event]);
}
