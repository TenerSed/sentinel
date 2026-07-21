# Sentinel: three-minute demo

Before presenting, start the app with `npm run dev` and open [http://localhost:5173](http://localhost:5173).

## 0:00–0:40 — The resident view

Open [`/`](http://localhost:5173/). Deliver the pitch: **“The intelligence developers pay lobbyists for — free, for the residents they're building next to.”**

Show the hero, proof statistics, and **What the record revealed**. Explain the asymmetry: a resident may get a 200-page packet only days before an evening meeting, while repeat participants already know the process and history.

## 0:40–1:05 — Start with an address

Type a Fishers address into the typeahead and choose a suggestion. Show that Sentinel translates a place a resident understands into nearby parcels, zoning, and land-use cases.

## 1:05–2:10 — Follow the Story Cottage case

Open [`/case?case=RZ-26-1`](http://localhost:5173/case?case=RZ-26-1).

Walk through:

1. What the Story Cottage memory-care proposal is and why it may matter nearby.
2. Who is behind it, including their track records in the local graph.
3. The named opposition found in the public record.
4. The timestamped meeting-video receipt—open it to prove the claim is inspectable.
5. The drafted public comment, turning research into something a resident can use.

Emphasize that the LLM phrases supplied facts; case numbers, counts, outcomes, and relationships come from Cypher or SQL, and claims retain document or video receipts.

## 2:10–2:35 — See the city

Open [`/map`](http://localhost:5173/map). Show the status-colored land-use cases and explain that the map includes the 35 cases whose parcels resolve to geometry.

## 2:35–3:00 — Under the hood

Open [`/terminal`](http://localhost:5173/terminal). Reveal the power map, entity dossier, and computed win rates. Close on the idea that this is not a chatbot wrapper: the ingestion pipeline, grounded knowledge graph, and fast precomputed snapshots are the product.

