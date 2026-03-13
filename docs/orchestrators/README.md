# Orchestrator Docs

Implementation guides for each data layer in the Bullhorn Aerosystems defense platform.

## Architecture

- [00-architecture.md](./00-architecture.md) — How the data layer system works end to end

## Layer guides

| # | Layer | Status | Doc |
|---|-------|--------|-----|
| 01 | Air Traffic | DONE | [01-air-traffic.md](./01-air-traffic.md) |
| 02 | Maritime Traffic | SCAFFOLDED | [02-maritime-traffic.md](./02-maritime-traffic.md) |
| 03 | Satellites | SCAFFOLDED | [03-satellites.md](./03-satellites.md) |
| 04 | Shipping Docks | SCAFFOLDED | [04-shipping-docks.md](./04-shipping-docks.md) |
| 05 | Border Highlighting | SCAFFOLDED | [05-border-highlighting.md](./05-border-highlighting.md) |
| 06 | Real-Time News | SCAFFOLDED | [06-realtime-news.md](./06-realtime-news.md) |
| 07 | Airports | DONE | [07-airports.md](./07-airports.md) |

## Implementation priority

Suggested order based on data availability and impact:

1. **Shipping Docks** — easiest, static dataset, no API key needed
2. **Border Highlighting** — no external data, purely client-side
3. **Maritime Traffic** — needs API key but straightforward AIS integration
4. **Real-Time News** — GDELT is free, high-impact feature
5. **Satellites** — needs satellite.js for SGP4, more complex rendering

## How to implement a layer

Each doc follows the same structure:

1. What already exists (scaffolding in place)
2. Step-by-step implementation with code samples
3. API route implementation
4. Rendering enhancements
5. EntityInfoPanel additions
6. Cross-layer integration points
7. Data flow diagram
