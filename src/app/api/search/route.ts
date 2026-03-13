import { NextRequest, NextResponse } from 'next/server';

interface SearchQuery {
  query: string;
  entityTypes?: string[]; // Optional filter by entity types
}

interface ParsedSearch {
  entityType: 'all' | 'aircraft' | 'airport' | 'missile' | 'radar' | 'sam_site' | 'ship' | 'satellite' | 'dock' | 'news_event';
  filters: {
    field: string;
    operator: 'equals' | 'contains' | 'gt' | 'lt' | 'between';
    value: string | number | [number, number];
  }[];
  freeText: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { query, entityTypes }: SearchQuery = await request.json();

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ entityType: 'all', filters: [], freeText: [] });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // Fallback to simple text matching if no API key
      return NextResponse.json({
        entityType: 'all',
        filters: [],
        freeText: query.split(/\s+/).filter(Boolean),
        fallback: true,
      });
    }

    const systemPrompt = `You are a search query parser for a global observability platform. Parse natural language queries about entities into structured filters.

ENTITY TYPE DETECTION:
Determine the entity type the user is searching for:
- "aircraft" - planes, flights, jets, helicopters, air traffic
- "airport" - airports, airfields, terminals, hubs, runways
- "ship" - ships, vessels, boats, tankers, cargo ships, maritime traffic
- "satellite" - satellites, orbital objects, space objects
- "dock" - ports, docks, harbors, terminals, shipping terminals
- "news_event" - news, events, incidents, reports, alerts
- "all" - when no specific type is mentioned or multiple types

AIRCRAFT FIELDS:
- callsign: Flight callsign (e.g., "UAL123")
- id: ICAO24 hex identifier
- originCountry: Country of origin
- altitude: Altitude in feet
- speed: Ground speed in knots
- heading: Track heading in degrees (0-360)
- squawk: Transponder code

AIRPORT FIELDS:
- icao: ICAO code (e.g., "KJFK")
- iata: IATA code (e.g., "JFK")
- name: Airport name
- city: City name
- country: Country name
- elevation: Elevation in feet
- airportType: large_airport, medium_airport, small_airport

SHIP FIELDS:
- name: Ship name
- shipType: Type of vessel (cargo, tanker, passenger, etc.)
- flag: Country flag
- destination: Destination port
- speed: Speed in knots
- heading: Heading in degrees

SATELLITE FIELDS:
- name: Satellite name
- noradId: NORAD catalog ID
- orbitType: LEO, MEO, GEO, HEO, SSO
- operator: Operating organization
- purpose: Mission purpose (communications, weather, navigation, etc.)

DOCK/PORT FIELDS:
- name: Port name
- portCode: Port code
- country: Country
- portType: container, bulk, naval, mixed, oil_terminal

NEWS EVENT FIELDS:
- headline: Event headline/title
- source: News source
- category: military, security, maritime, aviation, geopolitics, natural_disaster
- severity: low, medium, high, critical

ALTITUDE PATTERNS:
- "20k ft" or "20K feet" = 20000 feet
- "FL350" = 35000 feet (FL × 100)
- "above/over 20000 feet" -> altitude gt 20000
- "cruising altitude" -> altitude between [30000, 42000]

HEADING/DIRECTION PATTERNS:
- "heading north" or "northbound" -> heading between [315, 45]
- "heading south" or "southbound" -> heading between [135, 225]
- "heading east" or "eastbound" -> heading between [45, 135]
- "heading west" or "westbound" -> heading between [225, 315]

Return JSON with this structure:
{
  "entityType": "aircraft" | "airport" | "ship" | "satellite" | "dock" | "news_event" | "all",
  "filters": [
    { "field": "fieldName", "operator": "equals|contains|gt|lt|between", "value": "value or number or [min,max]" }
  ],
  "freeText": ["words", "to", "match", "anywhere"]
}

Examples:
- "flights above 20k ft" -> { "entityType": "aircraft", "filters": [{ "field": "altitude", "operator": "gt", "value": 20000 }], "freeText": [] }
- "airports in Germany" -> { "entityType": "airport", "filters": [{ "field": "country", "operator": "contains", "value": "Germany" }], "freeText": [] }
- "JFK airport" -> { "entityType": "airport", "filters": [], "freeText": ["JFK"] }
- "cargo ships" -> { "entityType": "ship", "filters": [{ "field": "shipType", "operator": "contains", "value": "cargo" }], "freeText": [] }
- "ships flagged Panama" -> { "entityType": "ship", "filters": [{ "field": "flag", "operator": "contains", "value": "Panama" }], "freeText": [] }
- "LEO satellites" -> { "entityType": "satellite", "filters": [{ "field": "orbitType", "operator": "equals", "value": "LEO" }], "freeText": [] }
- "SpaceX satellites" -> { "entityType": "satellite", "filters": [], "freeText": ["SpaceX"] }
- "container ports" -> { "entityType": "dock", "filters": [{ "field": "portType", "operator": "equals", "value": "container" }], "freeText": [] }
- "ports in China" -> { "entityType": "dock", "filters": [{ "field": "country", "operator": "contains", "value": "China" }], "freeText": [] }
- "critical news" -> { "entityType": "news_event", "filters": [{ "field": "severity", "operator": "equals", "value": "critical" }], "freeText": [] }
- "military news" -> { "entityType": "news_event", "filters": [{ "field": "category", "operator": "equals", "value": "military" }], "freeText": [] }
- "United flights heading west" -> { "entityType": "aircraft", "filters": [{ "field": "callsign", "operator": "contains", "value": "UAL" }, { "field": "heading", "operator": "between", "value": [225, 315] }], "freeText": [] }
- "large airports" -> { "entityType": "airport", "filters": [{ "field": "airportType", "operator": "equals", "value": "large_airport" }], "freeText": [] }`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Parse this search query: "${query}"` },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        entityType: 'all',
        filters: [],
        freeText: query.split(/\s+/).filter(Boolean),
      });
    }

    const parsed: ParsedSearch = JSON.parse(jsonMatch[0]);

    // If entityTypes filter is specified, override if needed
    if (entityTypes && entityTypes.length > 0 && !entityTypes.includes(parsed.entityType) && parsed.entityType !== 'all') {
      parsed.entityType = 'all';
    }

    return NextResponse.json(parsed);

  } catch (error) {
    console.error('Search API error:', error);
    // Fallback to simple text search
    const { query } = await request.json().catch(() => ({ query: '' }));
    return NextResponse.json({
      entityType: 'all',
      filters: [],
      freeText: query?.split(/\s+/).filter(Boolean) || [],
      error: true,
    });
  }
}
