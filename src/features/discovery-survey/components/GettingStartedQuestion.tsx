import React, { useEffect, useRef, useState } from "react";
import { recordProductEvent } from "@/features/product-analytics/productAnalytics";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getUsageAccountDigest } from "../services/tagifyUsage";
import { finishQuestion, noteOpeningAndCheckDue, START_REASONS, type StartReason } from "../services/gettingStartedQuestion";
import styles from "./GettingStartedQuestion.module.css";

/**
 * One tap, shown in the empty song list from the second day someone opens Tagify
 * without tagging anything. It goes away after an answer or Not now.
 */
export function GettingStartedQuestion() {
  const [account, setAccount] = useState<string | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const digest = await getUsageAccountDigest();
      if (!active || !digest || !noteOpeningAndCheckDue(digest)) return;
      // The list can be empty while a library loads; ask only when the saved library really is empty.
      const count = await indexedDBStorage.getTrackCount().catch(() => null);
      if (active && count === 0) setAccount(digest);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!account || shown.current) return;
    shown.current = true;
    recordProductEvent(account, "start_reason_shown");
  }, [account]);

  if (!account) return null;

  const finish = (reason?: StartReason) => {
    recordProductEvent(account, reason ? "start_reason_answered" : "start_reason_dismissed", reason ? { start_reason: reason } : {});
    finishQuestion(account);
    setAccount(null);
  };

  return (
    <section className={styles.question} aria-labelledby="getting-started-question">
      <div className={styles.header}>
        <h3 id="getting-started-question" className={styles.title}>What's stopping you from tagging?</h3>
        <button type="button" className={styles.dismiss} onClick={() => finish()}>Not now</button>
      </div>
      <div className={styles.options}>
        {START_REASONS.map(({ value, label }) => (
          <button key={value} type="button" className={styles.option} onClick={() => finish(value)}>{label}</button>
        ))}
      </div>
    </section>
  );
}
