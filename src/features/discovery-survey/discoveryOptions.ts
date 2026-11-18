import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faDiscord, faGithub, faReddit, faYoutube } from "@fortawesome/free-brands-svg-icons";
import { faCartShopping, faCircleQuestion, faSearch, faUsers } from "@fortawesome/free-solid-svg-icons";

/** The answers to "How did you find Tagify?"; the values are what the daily report counts. */
export const DISCOVERY_OPTIONS: ReadonlyArray<{ value: string; label: string; icon: IconDefinition }> = [
  { value: "marketplace", label: "Spicetify Marketplace", icon: faCartShopping },
  { value: "reddit", label: "Reddit", icon: faReddit },
  { value: "youtube", label: "YouTube", icon: faYoutube },
  { value: "discord", label: "Discord", icon: faDiscord },
  { value: "friend", label: "Friend/Word of Mouth", icon: faUsers },
  { value: "github", label: "GitHub", icon: faGithub },
  { value: "search", label: "Search Engine", icon: faSearch },
  { value: "other", label: "Other", icon: faCircleQuestion },
];
