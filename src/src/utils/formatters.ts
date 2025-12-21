export const formatTimestamp = (
  timestamp: number | undefined,
  includeSeconds: boolean = false
): string => {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp);

  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds && { second: "2-digit" }),
  });
};

/**
 * Format timestamp into a condensed, readable format
 * Examples: "Dec 15", "Jan 3, 2023" (if different year), "12/15/24"
 */
export const formatCondensedDate = (
  timestamp: number | undefined,
  style: "short" | "numeric" | "relative" = "short"
): string => {
  if (!timestamp) return "Unknown";

  const date = new Date(timestamp);
  const now = new Date();
  const currentYear = now.getFullYear();
  const dateYear = date.getFullYear();

  switch (style) {
    case "short":
      // "Dec 15" or "Dec 15, 2023" if different year
      { const options: Intl.DateTimeFormatOptions = {
        month: "short",
        day: "numeric",
        ...(dateYear !== currentYear && { year: "numeric" }),
      };
      return date.toLocaleDateString([], options); }

    case "numeric":
      // "12/15" or "12/15/23" if different year
      if (dateYear === currentYear) {
        return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
      } else {
        return date.toLocaleDateString([], {
          month: "numeric",
          day: "numeric",
          year: "2-digit",
        });
      }

    case "relative":
      // "2 days ago", "3 weeks ago", "Dec 15" (if > 30 days)
      { const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
      }

      // Fall back to short format for older dates
      return formatCondensedDate(timestamp, "short"); }

    default:
      return formatCondensedDate(timestamp, "short");
  }
};
