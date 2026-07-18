export type SourceKind = "government_record" | "video_transcript" | "reporting";

export type DemoLocation = {
  id: string;
  label: string;
};

export type EvidenceLocator =
  | { kind: "page"; pageNumber: number }
  | { kind: "timestamp"; startSeconds: number; endSeconds?: number };

export type EvidenceRecord = {
  id: string;
  locationId: string;
  locationLabel: string;
  sourceKind: SourceKind;
  publisher: string;
  sourceTitle: string;
  title: string;
  publishedAt: string;
  canonicalUrl: string;
  exactQuote: string;
  locator: EvidenceLocator;
};

export type DemoSeed = {
  version: 1;
  locations: DemoLocation[];
  records: EvidenceRecord[];
};

// Kept until the Phase 1 inspector replaces the merged placeholder shell.
export type SignalLevel = "High" | "Medium" | "Low";

export type Signal = {
  id: string;
  title: string;
  body: string;
  relevance: string;
  date: string;
  board: string;
  stage: string;
  level: SignalLevel;
  tags: string[];
  citations: { label: string; page: string; excerpt: string; url: string }[];
};
