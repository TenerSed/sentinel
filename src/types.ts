export type SignalStage = "Upcoming" | "Under review" | "Decision" | "Adopted";
export type SignalLevel = "High" | "Medium" | "Low";

export type Citation = {
  label: string;
  page: string;
  excerpt: string;
  url: string;
};

export type Signal = {
  id: string;
  title: string;
  body: string;
  relevance: string;
  date: string;
  board: string;
  stage: SignalStage;
  level: SignalLevel;
  tags: string[];
  citations: Citation[];
};
