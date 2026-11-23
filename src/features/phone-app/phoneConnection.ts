import { useEffect, useState } from "react";
import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";

/** Asks Tagify to open Community setup. The phone apps only work with a Tagify account. */
export const CONNECT_FOR_PHONE_EVENT = "tagify:connectForPhone";

export function requestConnectForPhone(): void {
  window.dispatchEvent(new CustomEvent(CONNECT_FOR_PHONE_EVENT));
}

export interface PhoneConnection {
  connected: boolean;
  /** The name people know their Tagify account by, while connected. */
  accountLabel: string | null;
}

function accountLabel(configuration: DesktopSyncConfiguration): string {
  return configuration.profile?.displayName
    || (configuration.profile?.handle ? `@${configuration.profile.handle}` : "your Tagify account");
}

function read(): PhoneConnection {
  const configuration = getDesktopSyncConfiguration();
  return configuration ? { connected: true, accountLabel: accountLabel(configuration) } : { connected: false, accountLabel: null };
}

/** Whether this computer is connected to a Tagify account, kept current as it connects or disconnects. */
export function usePhoneConnection(): PhoneConnection {
  const [connection, setConnection] = useState(read);
  useEffect(() => {
    const update = () => setConnection((current) => {
      const next = read();
      return next.connected === current.connected && next.accountLabel === current.accountLabel ? current : next;
    });
    window.addEventListener("tagify:syncStatus", update);
    update();
    return () => window.removeEventListener("tagify:syncStatus", update);
  }, []);
  return connection;
}
