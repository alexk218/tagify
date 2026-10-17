export interface RymRelease {
  id: string;
  url: string;
  title: string;
  artists: string[];
  year: number | null;
  releaseType: string;
  tags: string[];
}
export interface RymExport {
  format: "tagify-rym-personal-tags";
  version: 1;
  account: string;
  status: "complete" | "incomplete";
  selectedTags: Array<{ name: string; url: string; expected: number; collected: number }>;
  pages: Array<{ tag: string; path: string; signature: string }>;
  releases: RymRelease[];
  error: string | null;
}
export function parseRymExport(value: unknown, options?: { requireComplete?: boolean; compact?: boolean }): RymExport;
