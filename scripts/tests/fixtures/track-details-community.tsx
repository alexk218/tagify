// Track details "From Community" previews: ?variant=current|new|empty&narrow=1
import React from "react";
import { createRoot } from "react-dom/client";
import { sameTagNameKey, type PublicEntityViewV1 } from "@tagify/community-contracts";
import { CommunityEntityLens } from "@/features/community";
import { TrackDetailsCommunity } from "@/features/track-session/components/TrackDetailsCommunity";
import "@/styles/globals.css";

const params = new URLSearchParams(location.search);
const variant = params.get("variant") ?? "new";
const narrow = params.get("narrow") === "1";
const teaser = params.get("teaser") === "1";
const providerId = "a".repeat(22);
const uri = `spotify:track:${providerId}`;

if (!params.get("teaser")) localStorage.setItem("tagify:sync:configuration", JSON.stringify({ profile: { handle: "alex" } }));
Object.assign(window, { Spicetify: { showNotification: () => {}, Player: { data: null }, Platform: { History: { push: () => {} } } } });

const tag = (label: string, path: string) => ({ label, path });
const contributors = variant === "empty" ? [] : [
  { handle: "nightdrive", displayName: "Night Drive", ratingHalfStars: 9, isFollowing: true, tags: [tag("Deep House", "Genre / House / Deep House"), tag("Warm", "Mood / Feel / Warm"), tag("Opener", "Set / Role / Opener"), tag("Late Night", "Mood / Time / Late Night")] },
  { handle: "maya.f", displayName: "Maya", ratingHalfStars: 8, isFollowing: false, tags: [tag("Deep House", "Genre / House / Deep House"), tag("Warm", "Mood / Feel / Warm"), tag("Vocal", "Elements / Vocal")] },
  { handle: "selector_k", displayName: "K", ratingHalfStars: 10, isFollowing: false, tags: [tag("Deep House", "Genre / House / Deep House"), tag("Sunset", "Mood / Time / Sunset"), tag("Rolling Bass", "Elements / Rolling Bass")] },
  { handle: "alex", displayName: "Alex", ratingHalfStars: 8, isFollowing: false, isOwn: true, tags: [tag("House", "Genre / House")] },
];
const entity = {
  entity: { provider: "spotify", kind: "track", providerId },
  title: "Glass Horizons", subtitle: "Maya Fields", spotifyUrl: `https://open.spotify.com/track/${providerId}`, thumbnailUrl: null,
  artists: [{ name: "Maya Fields" }],
  rating: { average: 4.5, count: 3, distribution: [] },
  contributors,
} as unknown as PublicEntityViewV1;

window.fetch = async () => new Response(JSON.stringify({ entity }), { headers: { "content-type": "application/json" } });

const songTags = ["House", "Warm"];
const libraryTags = [...songTags, "Deep House", "Late Night", "Vocal"];
const keys = (names: string[]) => new Set(names.map(sameTagNameKey));

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "var(--spice-main-elevated, #242424)", borderRadius: 12, padding: 16 }}>
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
      <div style={{ width: 48, height: 48, borderRadius: 6, background: "linear-gradient(135deg,#3a6,#246)" }} />
      <div><div style={{ fontWeight: 700, fontSize: 16 }}>Glass Horizons</div><div style={{ color: "#b3b3b3", fontSize: 13 }}>Maya Fields</div></div>
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {songTags.map((name) => <span key={name} style={{ background: "#1db95433", color: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 12 }}>{name}</span>)}
    </div>
    {children}
  </div>;
}

function Fixture() {
  const section = variant === "current"
    ? <CommunityEntityLens entityUri={uri} />
    : <TrackDetailsCommunity uri={uri} songName="Glass Horizons" songTagKeys={keys(songTags)} libraryTagKeys={keys(libraryTags)}
      destinationOf={() => "Mood / Feel"} ownHandle="alex" onAdd={async () => {}}
      lookup={async () => ({ found: true, entity })}
      onConnect={teaser ? () => {} : undefined} />;
  return <main id="shot" style={{ maxWidth: narrow ? 350 : 1000, margin: "0 auto" }}><Card>{section}</Card></main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
