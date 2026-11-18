import React from "react";
import { createRoot } from "react-dom/client";
import { CommunityConnectPrompt } from "@/features/community/CommunityConnectPrompt";
import { RewindPrompt } from "@/features/rewind/RewindPrompt";

const params = new URLSearchParams(location.search);
const width = params.get("sheet") === "narrow" ? 375 : 1280;
localStorage.clear();
Object.assign(window, { Spicetify: { Platform: { UserAPI: { getUser: async () => ({ username: "isolated-rewind-prompt" }) } } } });
window.fetch = async () => new Response("{}", { status: 503 });

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ width }}>
    <div style={{ background: "#fff", color: "#000", font: "800 30px/1.2 -apple-system, Helvetica, Arial, sans-serif", padding: "12px 16px" }}>{label}</div>
    <div style={{ background: "#121212", border: "1px solid #333", padding: "8px 0 28px" }}>{children}</div>
  </div>;
}

createRoot(document.getElementById("app")!).render(<div style={{ display: "grid", gap: 24 }}>
  <Frame label="Community invitation (same spot)">
    <CommunityConnectPrompt enabled connected={false} onConnect={() => {}} />
  </Frame>
  <Frame label="Rewind prompt">
    <RewindPrompt songs={Number(params.get("songs") || 312)} connected={params.has("connected")} onOpen={() => {}} onDismiss={() => {}} />
  </Frame>
</div>);
