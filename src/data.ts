import type { Signal } from "./types";

export const signals: Signal[] = [
  {
    id: "data-center-zoning",
    title: "Data center zoning framework advances to public hearing",
    body: "The Metropolitan Development Commission is considering a special-use framework for new data center development. The proposal would require rezoning and a public hearing for qualifying projects.",
    relevance: "Raises entitlement timelines and site-selection risk for new facilities in Marion County.",
    date: "July 1, 2026",
    board: "Metropolitan Development Commission",
    stage: "Under review",
    level: "High",
    tags: ["Data centers", "Zoning", "Public hearing"],
    citations: [
      {
        label: "MDC meeting agenda packet",
        page: "Agenda item 6",
        excerpt: "Proposed amendments establish a special-use zoning district for data center development.",
        url: "https://indianapolis-in.municodemeetings.com/",
      },
    ],
  },
  {
    id: "utility-capacity",
    title: "Utility capacity becomes a review criterion",
    body: "Staff materials identify electricity and water infrastructure as factors for evaluating large-scale computing facilities during the land-use review process.",
    relevance: "Creates a new diligence requirement before property acquisition or interconnection commitments.",
    date: "June 18, 2026",
    board: "Department of Metropolitan Development",
    stage: "Upcoming",
    level: "High",
    tags: ["Utilities", "Water", "Due diligence"],
    citations: [
      {
        label: "Planning staff report",
        page: "p. 4",
        excerpt: "Infrastructure capacity and community impacts will be evaluated as part of the proposal.",
        url: "https://indianapolis-in.municodemeetings.com/",
      },
    ],
  },
  {
    id: "historic-review",
    title: "Historic-area project receives conditional approval",
    body: "A proposed development near a protected district was approved with additional design and neighborhood-engagement conditions.",
    relevance: "Signals heightened scrutiny for projects near historic assets and potential community opposition.",
    date: "June 4, 2026",
    board: "Historic Preservation Commission",
    stage: "Decision",
    level: "Medium",
    tags: ["Historic district", "Community impact"],
    citations: [
      {
        label: "IHPC meeting minutes",
        page: "p. 8",
        excerpt: "Approval is subject to the conditions stated by the Commission.",
        url: "https://indianapolis-in.municodemeetings.com/",
      },
    ],
  },
  {
    id: "tax-abatement",
    title: "Council committee schedules incentive review",
    body: "The City-County Council committee calendar adds a discussion of economic-development incentives and reporting requirements.",
    relevance: "May affect project economics and disclosure requirements for incentive applicants.",
    date: "May 21, 2026",
    board: "City-County Council",
    stage: "Upcoming",
    level: "Medium",
    tags: ["Tax abatement", "Economic development"],
    citations: [
      {
        label: "Council committee agenda",
        page: "Item 3",
        excerpt: "Discussion of economic development incentive reporting requirements.",
        url: "https://indianapolis.granicus.com/",
      },
    ],
  },
];
