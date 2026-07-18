import type { ChatProviderStatus, GroundedAnswer } from "./types";

export type DemoChatPreset = {
  coverageId: string;
  question: string;
  answer: GroundedAnswer;
  provider: ChatProviderStatus;
};

const bundled: ChatProviderStatus = { kind: "bundled", label: "Bundled demo answer" };

export const demoChatPresets: DemoChatPreset[] = [
  {
    coverageId: "indy",
    question: "What happened at the latest Indianapolis council meeting?",
    answer: { status: "answered", blocks: [{ text: "The Indianapolis City-County Council meeting was called to order.", evidenceIds: ["indy-video-2026-06-01"] }] },
    provider: bundled,
  },
  {
    coverageId: "indy",
    question: "What does reporting say Senate Bill 199 directs?",
    answer: { status: "answered", blocks: [{ text: "Reporting says Senate Bill 199 directs Indiana’s Commission for Higher Education to review degree programs at state colleges.", evidenceIds: ["in-report-2026-03-06"] }] },
    provider: bundled,
  },
  {
    coverageId: "indy",
    question: "What does Indianapolis Proposal No. 30 say about tax abatements?",
    answer: { status: "answered", blocks: [{ text: "The proposal discourages developers from pursuing local tax abatements.", evidenceIds: ["indy-prop-26-030"] }] },
    provider: bundled,
  },
  {
    coverageId: "indiana",
    question: "What does Executive Order 25-20 direct state agencies to do?",
    answer: { status: "answered", blocks: [{ text: "Executive Order 25-20 directs state agencies to ensure Indiana abortion laws are fully and faithfully executed.", evidenceIds: ["in-eo-25-20"] }] },
    provider: bundled,
  },
  {
    coverageId: "indiana",
    question: "What review does Executive Order 25-11 direct?",
    answer: { status: "answered", blocks: [{ text: "Executive Order 25-11 directs the Governor’s General Counsel to review previously issued executive orders.", evidenceIds: ["in-eo-25-11"] }] },
    provider: bundled,
  },
  {
    coverageId: "federal",
    question: "What law is titled the Save Our Seas 2.0 Amendments Act?",
    answer: { status: "answered", blocks: [{ text: "Public Law 119-65 is titled the Save Our Seas 2.0 Amendments Act.", evidenceIds: ["federal-plaw-119-65"] }] },
    provider: bundled,
  },
  {
    coverageId: "federal",
    question: "What law is titled the Homebuyers Privacy Protection Act?",
    answer: { status: "answered", blocks: [{ text: "Public Law 119-36 is titled the Homebuyers Privacy Protection Act.", evidenceIds: ["federal-plaw-119-36"] }] },
    provider: bundled,
  },
];

export const normalizeQuestion = (question: string) => question.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function findBundledAnswer(coverageId: string, question: string) {
  const normalized = normalizeQuestion(question);
  return demoChatPresets.find((preset) => preset.coverageId === coverageId && normalizeQuestion(preset.question) === normalized);
}
