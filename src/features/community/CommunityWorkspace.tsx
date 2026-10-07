import React, { useState } from "react";
import { Cloud, ExternalLink, Link2, ShieldAlert, Unplug, Users } from "lucide-react";
import type { SyncStatus } from "@/services/sync/SyncRuntime";
import {
  COMMUNITY_ORIGIN,
  getCommunityDisconnectUrl,
  openCommunityUrl,
} from "./communityLinks";
import styles from "./CommunityWorkspace.module.css";
import { communityErrorMessage } from "./communitySyncCopy";

export function CommunityWorkspace({
  onConnectCommunity,
  onOpenCloudSync,
  connected,
  status,
  connectedAccountId,
  connectedDeviceId,
  onDisconnect,
}: {
  onConnectCommunity: () => void;
  onOpenCloudSync: () => void;
  connected: boolean;
  status: SyncStatus;
  connectedAccountId: string | null;
  connectedDeviceId: string | null;
  onDisconnect: () => Promise<void>;
}) {
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const reconnectRequired = connected && status === "reauthorize";

  const disconnect = async () => {
    if (connectedAccountId && connectedDeviceId) {
      openCommunityUrl(
        getCommunityDisconnectUrl(connectedAccountId, connectedDeviceId),
      );
    }
    setDisconnecting(true);
    setDisconnectError("");
    try {
      await onDisconnect();
      setConfirmingDisconnect(false);
    } catch (error) {
      setDisconnectError(communityErrorMessage(error, "Couldn't disconnect safely. Your library is still on this device. Please try again."));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className={styles.workspace} aria-labelledby="community-title">
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">
          <Users size={32} />
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>Tagify Community</p>
          <h2
            id="community-title"
            aria-label="Discover tags. Share your own."
          >
            <span>Discover tags.</span>
            <span>Share your own.</span>
          </h2>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => openCommunityUrl(COMMUNITY_ORIGIN)}
          >
            <ExternalLink size={16} />
            Visit Community
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={connected ? onOpenCloudSync : onConnectCommunity}
          >
            {reconnectRequired ? <ShieldAlert size={16} /> : connected ? <Cloud size={16} /> : <Link2 size={16} />}
            {reconnectRequired ? "Reconnect device" : connected ? "Sync" : "Connect Community"}
          </button>
        </div>

        {connected ? (
          <div className={styles.connectionPanel}>
            {confirmingDisconnect ? (
              <div className={styles.disconnectConfirmation}>
                <div>
                  <strong>Stop cloud backup?</strong>
                  <span>
                    Your tags stay here. Cloud sync stops, and Community signs out in your browser.
                  </span>
                </div>
                <div className={styles.disconnectActions}>
                  <button
                    type="button"
                    onClick={() => setConfirmingDisconnect(false)}
                    disabled={disconnecting}
                  >
                    Keep connected
                  </button>
                  <button
                    type="button"
                    className={styles.disconnectConfirmButton}
                    onClick={() => void disconnect()}
                    disabled={disconnecting}
                  >
                    <Unplug size={14} />
                    {disconnecting ? "Disconnecting…" : "Disconnect now"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`${styles.connectionStatus} ${reconnectRequired ? styles.reconnectStatus : ""}`}>
                <span className={reconnectRequired ? styles.reconnectDot : styles.connectedDot} aria-hidden="true" />
                <span>{reconnectRequired ? "Device revoked · Reconnect required" : "Cloud backup is on"}</span>
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  Disconnect
                </button>
              </div>
            )}
            {disconnectError ? (
              <p className={styles.disconnectError} role="alert">
                {disconnectError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
