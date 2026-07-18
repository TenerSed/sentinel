export type SourceKind = "government_record" | "video_transcript" | "reporting";

export type DemoLocation = {
  id: string;
  label: string;
};

export type DemoCoverage = {
  locationId: string;
  coveredLocationId: string;
};

export type UpdateType = "legislation" | "office_holder" | "policy";

export type EvidenceLocator =
  | { kind: "page"; pageNumber: number }
  | { kind: "timestamp"; startSeconds: number; endSeconds?: number };

export type EvidenceRecord = {
  id: string;
  locationId: string;
  locationLabel: string;
  updateType: UpdateType;
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
  coverage: DemoCoverage[];
  records: EvidenceRecord[];
};
