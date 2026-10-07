import React, { useEffect, useMemo, useState } from "react";
import {
  parseSpotifyEntity,
  type PublicEntityViewV1,
} from "@tagify/community-contracts";
import { Users } from "lucide-react";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { COMMUNITY_ORIGIN } from "./communityLinks";
import { communityDeviceFetch, readCommunityDeviceCredential } from "./communityDevice";
import styles from "./CommunityEntityLens.module.css";

type EntityResponse = { entity: PublicEntityViewV1 };

export function CommunityEntityLens({ entityUri, onAvailabilityChange }: {
  entityUri: string;
  onAvailabilityChange?: (entityUri: string, hasPerspectives: boolean) => void;
}) {
  const entityRef = useMemo(() => parseSpotifyEntity(entityUri), [entityUri]);
  const [loadedEntity, setLoadedEntity] = useState<{
    entityUri: string;
    view: PublicEntityViewV1;
  } | null>(null);
  const view = loadedEntity?.entityUri === entityUri ? loadedEntity.view : null;

  useEffect(() => {
    let isCurrent = true;
    setLoadedEntity(null);
    onAvailabilityChange?.(entityUri, false);
    if (!entityRef) return;

    const load = async () => {
      try {
        const path = `/api/v2/entities/${entityRef.kind}/${entityRef.providerId}`;
        const syncConfiguration = getDesktopSyncConfiguration();
        const response = syncConfiguration?.accessToken
            ? await fetch(`${COMMUNITY_ORIGIN}${path}`, {
                headers: { authorization: `Bearer ${syncConfiguration.accessToken}` },
              })
          : readCommunityDeviceCredential()?.accessToken
            ? await communityDeviceFetch(path)
            : await fetch(`${COMMUNITY_ORIGIN}${path}`);
        if (!response.ok) return;

        const body = (await response.json()) as EntityResponse;
        if (!isCurrent || !Array.isArray(body.entity?.contributors) || body.entity.contributors.length === 0) return;
        setLoadedEntity({ entityUri, view: body.entity });
        onAvailabilityChange?.(entityUri, true);
      } catch {
        // Keep both the perspectives panel and its Community link hidden.
      }
    };

    void load();
    return () => { isCurrent = false; };
  }, [entityRef, entityUri, onAvailabilityChange]);

  if (!entityRef || !view || view.contributors.length === 0) {
    return null;
  }

  return (
    <details className={styles.lens}>
      <summary>
        <span>
          <Users size={15} /> Community perspectives
        </span>
        <small>
          {view.contributors.length} contributor
          {view.contributors.length === 1 ? "" : "s"}
        </small>
      </summary>
      <div className={styles.body}>
        <div className={styles.contributors}>
          {view.contributors.map((contributor) => (
            <article
              key={contributor.handle}
              className={contributor.isOwn ? styles.ownContributor : undefined}
            >
              <span>
                <strong>{contributor.isOwn ? "You" : contributor.displayName}</strong>
                {contributor.isOwn ? <small>Your public tags</small> : null}
              </span>
              {contributor.tags.length > 0 ? (
                <p>{contributor.tags.map((tag) => tag.label).join(" · ")}</p>
              ) : (
                <p className={styles.message}>No public tags for this track.</p>
              )}
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}
