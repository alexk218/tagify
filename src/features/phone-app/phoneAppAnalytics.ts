import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";

export const recordPhoneAppPanelOpened = (quietMenu: boolean) =>
  recordProductInteraction("phone_app_panel_opened", { optional_buttons: quietMenu ? "off" : "on" });
export const recordPhoneAppStoreClicked = (store: "app_store" | "google_play", surface: "panel" | "notice") =>
  recordProductInteraction("phone_app_store_clicked", { store, phone_surface: surface });
export const recordPhoneAppButtonHidden = () => recordProductInteraction("phone_app_button_hidden");
export const recordAndroidNotifyRequested = () => recordProductInteraction("android_notify_requested");
export const recordAndroidReleaseNoticeShown = () => recordProductInteraction("android_release_notice_shown");
