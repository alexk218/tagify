import React from "react";
import { createRoot } from "react-dom/client";
import MainSettingsModal from "@/features/tag-data/components/MainSettingsModal";
import "@/styles/globals.css";

const params = new URLSearchParams(location.search);
if (params.has("handoff")) Object.assign(window, { __tagifyInstallerAnalyticsV1: { schemaVersion: 2, enabled: true, installationId: "ad824ac0-c441-4f56-85a7-ff1434d865bc", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() } });
Object.assign(window, { Spicetify: { showNotification: () => {}, Platform: { UserAPI: { getUser: async () => params.has("unavailable") ? {} : { username: "isolated-analytics-settings" } } } } });
// This UI fixture never transmits account activity or accesses the real Spotify account.
window.fetch = async () => new Response("{}", { status: 503 });
if (params.has("saveFailure")) {
  const save = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (key.startsWith("tagify:product-analytics:")) throw new Error("Isolated save failure");
    save.call(this, key, value);
  };
}
createRoot(document.getElementById("app")!).render(<MainSettingsModal onClose={() => {}} showSupportButtons onToggleSupportButtons={() => {}} showUpdateProtectionButton onToggleUpdateProtectionButton={() => {}} />);
