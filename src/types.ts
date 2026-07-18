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
export type EvidenceKind = "civic_update" | "recent_public_position";

export type EvidenceLocator =
  | { kind: "page"; pageNumber: number }
  | { kind: "timestamp"; startSeconds: number; endSeconds?: number };

export type EvidenceRecord = {
  id: string;
  locationId: string;
  locationLabel: string;
  updateType: UpdateType;
  evidenceKind: EvidenceKind;
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

export type AnswerBlock = {
  text: string;
  evidenceIds: string[];
};

export type GroundedAnswer =
  | { status: "answered"; blocks: [AnswerBlock, ...AnswerBlock[]] }
  | { status: "insufficient"; blocks: [] };

export type ChatProviderStatus =
  | { kind: "bundled"; label: "Bundled demo answer" }
  | { kind: "live"; provider: "OpenAI" | "Anthropic" | "Gemini" }
  | { kind: "unavailable" }
  | { kind: "failed"; provider: "OpenAI" | "Anthropic" | "Gemini"; errorType: string };

export type ChatTurn = {
  question: string;
  coverageId: string;
  answer: GroundedAnswer;
  provider: ChatProviderStatus;
  packetCount: number;
  createdAt: string;
};

export type ChatThreads = Record<string, ChatTurn[]>;
