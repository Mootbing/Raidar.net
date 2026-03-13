'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRadarStore } from '@/store/gameStore';
import { EntityType } from '@/types/entities';
import { getEntityConfig } from '@/lib/entityRegistry';
import { LayerId } from '@/types/layers';
import { UI } from '@/config/constants';
import { TEXT, BG, BORDER } from '@/config/styles';
import { useUIInput } from '@/hooks/useInputManager';
import { InputAction } from '@/lib/inputManager';

interface ParsedSearch {
  entityType: 'all' | EntityType;
  filters: {
    field: string;
    operator: 'equals' | 'contains' | 'gt' | 'lt' | 'between';
    value: string | number | [number, number];
  }[];
  freeText: string[];
}

interface SearchResult {
  type: EntityType;
  id: string;
  displayName: string;
  subtitle: string;
  lat: number;
  lon: number;
  alt?: number;
}

// Maps entity types to the layer ID that controls their visibility
const ENTITY_TYPE_TO_LAYER: Partial<Record<EntityType, LayerId>> = {
  aircraft: 'aircraft',
  airport: 'airports',
  ship: 'maritime',
  satellite: 'satellites',
  dock: 'docks',
  news_event: 'news',
};

// Maps entity types to their store location
const ENTITY_TYPE_TO_LAYER_KEY: Partial<Record<EntityType, string>> = {
  ship: 'maritime',
  satellite: 'satellites',
  dock: 'docks',
  news_event: 'news',
};

// All entity types that can be searched
const SEARCHABLE_TYPES: EntityType[] = ['aircraft', 'airport', 'ship', 'satellite', 'dock', 'news_event'];

function getEntityPosition(type: EntityType, entity: any): { lat: number; lon: number; alt?: number } {
  if (type === 'aircraft') {
    return { lat: entity.position.latitude, lon: entity.position.longitude, alt: entity.position.altitude };
  }
  if (type === 'airport') {
    return { lat: entity.lat, lon: entity.lon };
  }
  // Generic entities use MapEntity position
  return { lat: entity.position?.lat ?? entity.lat, lon: entity.position?.lon ?? entity.lon, alt: entity.position?.alt };
}

function getEntityId(type: EntityType, entity: any): string {
  if (type === 'airport') return entity.icao;
  return entity.id;
}

interface SearchBarProps {
  onFocusChange?: (focused: boolean) => void;
}

export function SearchBar({ onFocusChange }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const aircraft = useRadarStore((s) => s.aircraft);
  const airports = useRadarStore((s) => s.airports);
  const layerEntities = useRadarStore((s) => s.layerEntities);
  const layers = useRadarStore((s) => s.layers);
  const selectEntity = useRadarStore((s) => s.selectEntity);
  const hoverEntity = useRadarStore((s) => s.hoverEntity);
  const setFocusLocation = useRadarStore((s) => s.setFocusLocation);
  const restoreCamera = useRadarStore((s) => s.restoreCamera);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get all entities of a given type from the store
  const getEntitiesForType = useCallback((type: EntityType): any[] => {
    if (type === 'aircraft') return aircraft;
    if (type === 'airport') return airports;
    const layerKey = ENTITY_TYPE_TO_LAYER_KEY[type];
    if (layerKey) return layerEntities[layerKey] ?? [];
    return [];
  }, [aircraft, airports, layerEntities]);

  // Check if a layer is enabled for a given entity type
  const isTypeEnabled = useCallback((type: EntityType): boolean => {
    const layerId = ENTITY_TYPE_TO_LAYER[type];
    if (!layerId) return false;
    return layers[layerId]?.enabled ?? false;
  }, [layers]);

  // Build search results for a given entity type using the entity registry
  const searchType = useCallback((
    type: EntityType,
    entities: any[],
    parsed: ParsedSearch,
  ): SearchResult[] => {
    const config = getEntityConfig(type);
    const results: SearchResult[] = [];

    for (const entity of entities) {
      // Use the registry's matchEntity for structured filter matching
      if (parsed.filters.length > 0 || parsed.freeText.length > 0) {
        if (!config.matchEntity(entity, parsed.filters as any, parsed.freeText)) continue;
      }

      const pos = getEntityPosition(type, entity);
      results.push({
        type,
        id: getEntityId(type, entity),
        displayName: config.getDisplayName(entity),
        subtitle: config.getSubtitle(entity),
        lat: pos.lat,
        lon: pos.lon,
        alt: pos.alt,
      });
    }

    return results;
  }, []);

  // Fallback client-side free-text search
  const searchTypeFreeText = useCallback((
    type: EntityType,
    entities: any[],
    terms: string[],
  ): SearchResult[] => {
    const config = getEntityConfig(type);
    const results: SearchResult[] = [];

    for (const entity of entities) {
      const searchable = config.getSearchableText(entity).toLowerCase();
      if (terms.some(t => searchable.includes(t))) {
        const pos = getEntityPosition(type, entity);
        results.push({
          type,
          id: getEntityId(type, entity),
          displayName: config.getDisplayName(entity),
          subtitle: config.getSubtitle(entity),
          lat: pos.lat,
          lon: pos.lon,
          alt: pos.alt,
        });
      }
    }

    return results;
  }, []);

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);

    // Determine which types to search based on enabled layers
    const enabledTypes = SEARCHABLE_TYPES.filter(t => isTypeEnabled(t));

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const parsed: ParsedSearch = await res.json();
      const searchResults: SearchResult[] = [];

      for (const type of enabledTypes) {
        // Skip if NLP narrowed to a specific type and this isn't it
        if (parsed.entityType !== 'all' && parsed.entityType !== type) continue;

        const entities = getEntitiesForType(type);
        searchResults.push(...searchType(type, entities, parsed));
      }

      setResults(searchResults.slice(0, UI.SEARCH_MAX_RESULTS));
      setShowResults(true);
      setSelectedIndex(0);
    } catch {
      // Fallback - client-side free text
      const terms = q.toLowerCase().split(/\s+/);
      const searchResults: SearchResult[] = [];

      for (const type of enabledTypes) {
        const entities = getEntitiesForType(type);
        searchResults.push(...searchTypeFreeText(type, entities, terms));
      }

      setResults(searchResults.slice(0, UI.SEARCH_MAX_RESULTS));
      setShowResults(true);
      setSelectedIndex(0);
    } finally {
      setIsSearching(false);
    }
  }, [isTypeEnabled, getEntitiesForType, searchType, searchTypeFreeText]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(e.target.value), UI.SEARCH_DEBOUNCE);
  }, [performSearch]);

  // Re-search when layers change
  useEffect(() => {
    if (query.trim()) {
      performSearch(query);
    }
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = useCallback((r: SearchResult) => {
    // Focus camera on entity location, then select it
    if (r.type !== 'aircraft') {
      setFocusLocation({ lat: r.lat, lon: r.lon, alt: r.alt });
    }
    selectEntity({ type: r.type, id: r.id });
    setShowResults(false);
    setQuery('');
  }, [selectEntity, setFocusLocation]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Handle input actions from centralized input manager
  const handleUIAction = useCallback((action: InputAction) => {
    switch (action) {
      case 'search_focus':
        inputRef.current?.focus();
        break;
      case 'search_blur':
        inputRef.current?.blur();
        setShowResults(false);
        setQuery('');
        break;
    }
  }, []);

  useUIInput(handleUIAction);

  useEffect(() => {
    if (results.length > 0 && showResults) {
      const r = results[selectedIndex];
      if (r) {
        hoverEntity({ type: r.type, id: r.id });
        setFocusLocation({ lat: r.lat, lon: r.lon, alt: r.alt });
      }
    }
  }, [selectedIndex, results, showResults, hoverEntity, setFocusLocation]);

  useEffect(() => {
    if (!showResults) {
      hoverEntity(null);
      restoreCamera();
    }
  }, [showResults, hoverEntity, restoreCamera]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && showResults) {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' && showResults) {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowResults(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }, [results, selectedIndex, showResults, handleSelect]);

  return (
    <div ref={containerRef} className="relative w-full flex-1 flex flex-col">
      {/* Results dropdown - expands upward */}
      {showResults && results.length > 0 && (
        <div className={`absolute bottom-full left-0 right-0 mb-1 ${BG.PANEL_BLUR} ${BORDER.PANEL_SUBTLE} max-h-[300px] overflow-y-auto custom-scrollbar`}>
          {results.map((r, i) => (
            <div
              key={`${r.type}-${r.id}`}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`px-3 py-2 cursor-pointer ${TEXT.BASE} border-b border-white/5 last:border-0 ${
                i === selectedIndex ? 'bg-[#00ff88]/10' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: getEntityConfig(r.type).color }}>{getEntityConfig(r.type).icon}</span>
                <span className={TEXT.PRIMARY}>{r.displayName}</span>
                <span className={`${TEXT.MUTED} ${TEXT.MONO}`}>{r.id.toUpperCase()}</span>
              </div>
              <div className={`${TEXT.DIMMED} mt-0.5 pl-5`}>{r.subtitle}</div>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query) setShowResults(true);
          onFocusChange?.(true);
        }}
        onBlur={() => onFocusChange?.(false)}
        placeholder="[Space] Search in natural language"
        className={`w-full flex-1 ${BG.GLASS_BLUR} ${BORDER.PANEL} px-3 py-2 ${TEXT.BASE} ${TEXT.PRIMARY} placeholder-[#555] ${BORDER.FOCUS} focus:outline-none`}
      />

      {isSearching && (
        <div className={`absolute right-2 top-1/2 -translate-y-1/2 ${TEXT.XS} ${TEXT.ACCENT}`}>...</div>
      )}
    </div>
  );
}
