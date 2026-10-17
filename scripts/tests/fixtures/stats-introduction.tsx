import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DataManager from "@/features/tag-data/components/DataManager";
import { welcomeModal } from "@/extensions/WelcomeModal";

const params = new URLSearchParams(location.search);
if (params.has("previous") || params.has("fresh")) {
  localStorage.clear();
  if (params.has("previous")) localStorage.setItem("tagify:lastSeenVersion", params.get("previous")!);
  history.replaceState(null, "", location.pathname);
}
Object.assign(window, { Spicetify: {
  showNotification: () => {},
  PopupModal: { display: () => {}, hide: () => {} },
  Platform: { UserAPI: { getUser: async () => ({ username: "isolated-stats-introduction" }) }, History: { push: () => {} } },
} });
window.fetch = async () => new Response("{}", { status: 503 });
welcomeModal.initialize();
function Fixture() {
  const [open, setOpen] = useState(false);
  return <><DataManager onExportTagData={async () => {}} onImportTagData={async () => {}}
    onOpenStats={() => setOpen(!open)} statsOpen={open} onResetTagifyData={async () => {}}
    onRetryMigration={async () => { throw new Error("Not used in this fixture"); }} />
    {open && <p role="status">Stats opened</p>}</>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
