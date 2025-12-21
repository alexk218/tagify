export const SORT_OPTIONS = {
  DATE_MODIFIED: "dateModified",
  DATE_CREATED: "dateCreated",
  ALPHABETICAL: "alphabetical",
  RATING: "rating",
  ENERGY: "energy",
  BPM: "bpm",
} as const;

export const SORT_ORDERS = {
  ASC: "asc",
  DESC: "desc",
} as const;

export type SortOption = (typeof SORT_OPTIONS)[keyof typeof SORT_OPTIONS];

export type SortOrder = (typeof SORT_ORDERS)[keyof typeof SORT_ORDERS];

export const PAGINATION_BATCH_SIZE = 30;
