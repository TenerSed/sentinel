import type { DemoSeed } from "./types";

export const demoSeed: DemoSeed = {
  "version": 1,
  "locations": [
    {
      "id": "indy",
      "label": "Indianapolis"
    },
    {
      "id": "indiana",
      "label": "Indiana"
    },
    {
      "id": "federal",
      "label": "U.S. federal"
    }
  ],
  "coverage": [
    {
      "locationId": "indy",
      "coveredLocationId": "indy"
    },
    {
      "locationId": "indy",
      "coveredLocationId": "indiana"
    },
    {
      "locationId": "indy",
      "coveredLocationId": "federal"
    },
    {
      "locationId": "indiana",
      "coveredLocationId": "indiana"
    },
    {
      "locationId": "federal",
      "coveredLocationId": "federal"
    }
  ],
  "records": [
    {
      "id": "indy-video-2026-06-01",
      "locationId": "indy",
      "locationLabel": "Indianapolis",
      "updateType": "office_holder",
      "sourceKind": "video_transcript",
      "publisher": "Open Publica",
      "sourceTitle": "Indianapolis City-County Council Meeting — June 1, 2026",
      "title": "City-County Council meeting opened",
      "publishedAt": "2026-06-01T00:00:00Z",
      "canonicalUrl": "https://www.openpublica.com/meetings/indianapolis-indiana-city-county-council-2026-06-01-6a46ab01b8ebd3518b4bfaf6",
      "exactQuote": "I will now call to order the Indianapolis City County Council to order",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "timestamp",
        "startSeconds": 14,
        "endSeconds": 20
      },
      "topics": [
        "government-operations"
      ],
      "embedding": [
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0
      ]
    },
    {
      "id": "in-report-2026-03-06",
      "locationId": "indiana",
      "locationLabel": "Indiana",
      "updateType": "legislation",
      "sourceKind": "reporting",
      "publisher": "Indiana Newsdesk / WTIU PBS",
      "sourceTitle": "Indiana Newsdesk, Episode 1334, 03/06/2026",
      "title": "Reporting: Indiana Newsdesk describes Senate Bill 199 review requirement",
      "publishedAt": "2026-03-06T00:00:00Z",
      "canonicalUrl": "https://www.pbs.org/video/indiana-newsdesk-episode-1334-03062026-2h6adw/",
      "exactQuote": "SENATE BILL 199 DIRECTS THE INDIANA COMMISSION FOR HIGHER EDUCATION TO REVIEW DEGREE PROGRAMS AT STATE COLLEGES",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "timestamp",
        "startSeconds": 404,
        "endSeconds": 411
      },
      "topics": [
        "education",
        "legislation"
      ],
      "embedding": [
        0,
        0,
        0,
        0.70710678,
        0,
        0,
        0,
        0.70710678
      ]
    },
    {
      "id": "indy-prop-26-030",
      "locationId": "indy",
      "locationLabel": "Indianapolis",
      "updateType": "policy",
      "sourceKind": "government_record",
      "publisher": "Indianapolis City-County Council",
      "sourceTitle": "City-County Council Proposal No. 30, 2026",
      "title": "Council proposal urges transparent data-center engagement",
      "publishedAt": "2026-01-05T00:00:00Z",
      "canonicalUrl": "https://www.indy.gov/api/v1/indy_proposal_document?content_type=application%2Fpdf&id=19373&name=PROP26-030&type=1",
      "exactQuote": "Developers are discouraged from pursuing local tax abatements for their projects.",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "technology",
        "government-operations"
      ],
      "embedding": [
        0,
        0,
        0,
        0,
        0.70710678,
        0.70710678,
        0,
        0
      ]
    },
    {
      "id": "federal-plaw-119-65",
      "locationId": "federal",
      "locationLabel": "U.S. federal",
      "updateType": "legislation",
      "sourceKind": "government_record",
      "publisher": "U.S. Government Publishing Office",
      "sourceTitle": "Public Law 119-65 — Save Our Seas 2.0 Amendments Act",
      "title": "Save Our Seas 2.0 Amendments Act approved",
      "publishedAt": "2025-12-26T00:00:00Z",
      "canonicalUrl": "https://www.govinfo.gov/content/pkg/PLAW-119publ65/pdf/PLAW-119publ65.pdf",
      "exactQuote": "SAVE OUR SEAS 2.0 AMENDMENTS ACT",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "environment",
        "legislation"
      ],
      "embedding": [
        0,
        0,
        0.70710678,
        0,
        0,
        0,
        0,
        0.70710678
      ]
    },
    {
      "id": "federal-plaw-119-40",
      "locationId": "federal",
      "locationLabel": "U.S. federal",
      "updateType": "legislation",
      "sourceKind": "government_record",
      "publisher": "U.S. Government Publishing Office",
      "sourceTitle": "Public Law 119-40 — Wetlands Conservation and Access Improvement Act of 2025",
      "title": "Wetlands Conservation and Access Improvement Act approved",
      "publishedAt": "2025-11-25T00:00:00Z",
      "canonicalUrl": "https://www.govinfo.gov/content/pkg/PLAW-119publ40/pdf/PLAW-119publ40.pdf",
      "exactQuote": "Wetlands Conservation and Access Improvement Act of 2025",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "environment",
        "legislation"
      ],
      "embedding": [
        0,
        0,
        0.70710678,
        0,
        0,
        0,
        0,
        0.70710678
      ]
    },
    {
      "id": "federal-plaw-119-36",
      "locationId": "federal",
      "locationLabel": "U.S. federal",
      "updateType": "legislation",
      "sourceKind": "government_record",
      "publisher": "U.S. Government Publishing Office",
      "sourceTitle": "Public Law 119-36 — Homebuyers Privacy Protection Act",
      "title": "Homebuyers Privacy Protection Act approved",
      "publishedAt": "2025-09-05T00:00:00Z",
      "canonicalUrl": "https://www.govinfo.gov/content/pkg/PLAW-119publ36/pdf/PLAW-119publ36.pdf",
      "exactQuote": "Homebuyers Privacy Protection Act",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "housing",
        "legislation"
      ],
      "embedding": [
        0.70710678,
        0,
        0,
        0,
        0,
        0,
        0,
        0.70710678
      ]
    },
    {
      "id": "federal-plaw-119-28",
      "locationId": "federal",
      "locationLabel": "U.S. federal",
      "updateType": "legislation",
      "sourceKind": "government_record",
      "publisher": "U.S. Government Publishing Office",
      "sourceTitle": "Public Law 119-28 — Rescissions Act of 2025",
      "title": "Rescissions Act of 2025 approved",
      "publishedAt": "2025-07-24T00:00:00Z",
      "canonicalUrl": "https://www.govinfo.gov/content/pkg/PLAW-119publ28/pdf/PLAW-119publ28.pdf",
      "exactQuote": "Rescissions Act of 2025",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "budget",
        "legislation"
      ],
      "embedding": [
        0,
        0.70710678,
        0,
        0,
        0,
        0,
        0,
        0.70710678
      ]
    },
    {
      "id": "in-eo-25-20",
      "locationId": "indiana",
      "locationLabel": "Indiana",
      "updateType": "policy",
      "sourceKind": "government_record",
      "publisher": "State of Indiana",
      "sourceTitle": "Executive Order 25-20",
      "title": "Indiana executive order addresses abortion-law execution",
      "publishedAt": "2025-03-01T00:00:00Z",
      "canonicalUrl": "https://www.in.gov/gov/files/EO-25-20.pdf",
      "exactQuote": "All state agencies are directed to ensure that the State of Indiana’s abortion laws are fully and faithfully executed,",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "health",
        "government-operations"
      ],
      "embedding": [
        0,
        0,
        0,
        0,
        0,
        0.70710678,
        0.70710678,
        0
      ]
    },
    {
      "id": "in-eo-25-11",
      "locationId": "indiana",
      "locationLabel": "Indiana",
      "updateType": "office_holder",
      "sourceKind": "government_record",
      "publisher": "State of Indiana",
      "sourceTitle": "Executive Order 25-11",
      "title": "Indiana orders review of prior executive orders",
      "publishedAt": "2025-02-01T00:00:00Z",
      "canonicalUrl": "https://www.in.gov/gov/files/EO-25-11.pdf",
      "exactQuote": "The Governor’s General Counsel is directed to conduct a review of the previously issued Executive Orders.",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "government-operations"
      ],
      "embedding": [
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0
      ]
    },
    {
      "id": "in-eo-25-10",
      "locationId": "indiana",
      "locationLabel": "Indiana",
      "updateType": "policy",
      "sourceKind": "government_record",
      "publisher": "State of Indiana",
      "sourceTitle": "Executive Order 25-10",
      "title": "Indiana continues the Executive Council on Cybersecurity",
      "publishedAt": "2025-01-13T00:00:00Z",
      "canonicalUrl": "https://www.in.gov/gov/files/EO-25-10.pdf",
      "exactQuote": "shall continue until July 1, 2026.",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "technology",
        "government-operations"
      ],
      "embedding": [
        0,
        0,
        0,
        0,
        0.70710678,
        0.70710678,
        0,
        0
      ]
    },
    {
      "id": "indy-prop-24-205",
      "locationId": "indy",
      "locationLabel": "Indianapolis",
      "updateType": "policy",
      "sourceKind": "government_record",
      "publisher": "Indianapolis City-County Council",
      "sourceTitle": "City-County General Ordinance No. 25, 2024",
      "title": "City-County General Ordinance No. 25, 2024",
      "publishedAt": "2025-01-01T00:00:00Z",
      "canonicalUrl": "https://www.indy.gov/api/v1/indy_proposal_document?content_type=application%2Fpdf&id=18732&name=PROP24-205&type=1",
      "exactQuote": "The Indianapolis Short-Term Rental Permitting is hereby established.",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "housing",
        "government-operations"
      ],
      "embedding": [
        0.70710678,
        0,
        0,
        0,
        0,
        0.70710678,
        0,
        0
      ]
    },
    {
      "id": "indy-prop-25-050",
      "locationId": "indy",
      "locationLabel": "Indianapolis",
      "updateType": "policy",
      "sourceKind": "government_record",
      "publisher": "Indianapolis City-County Council",
      "sourceTitle": "City-County Fiscal Ordinance No. 1, 2025",
      "title": "City-County Fiscal Ordinance No. 1, 2025",
      "publishedAt": "2025-01-01T00:00:00Z",
      "canonicalUrl": "https://www.indy.gov/api/v1/indy_proposal_document?content_type=application%2Fpdf&id=18995&name=PROP25-050&type=1",
      "exactQuote": "CITY-COUNTY FISCAL ORDINANCE NO. 1, 2025",
      "evidenceKind": "civic_update",
      "locator": {
        "kind": "page",
        "pageNumber": 1
      },
      "topics": [
        "budget",
        "government-operations"
      ],
      "embedding": [
        0,
        0.70710678,
        0,
        0,
        0,
        0.70710678,
        0,
        0
      ]
    }
  ]
};
