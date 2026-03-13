'use client';

import { useRef, useState, useEffect } from 'react';
import { useRadarStore, Aircraft, Airport, ViewMode } from '@/store/gameStore';
import { EntityRef, getEntityTypeName } from '@/types/entities';
import { ScrollingText } from '../ScrollingText';
import { UI, COLORS } from '@/config/constants';
import { TEXT, BORDER, COMPONENT } from '@/config/styles';
import { predictPosition, predictAltitude } from '@/utils/geo';

// View mode display names
const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  focus: 'FOCUS',
  chase: 'CHASE',
  cockpit: 'COCKPIT',
  orbit: 'ORBIT',
  top: 'TOP',
};

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

export function DataRow({ 
  label, 
  value, 
  glowColor = 'green' 
}: { 
  label: string; 
  value: string; 
  glowColor?: 'blue' | 'yellow' | 'green';
}) {
  return (
    <div className="flex justify-between items-start gap-2 py-0.5">
      <span className={`${TEXT.MUTED} shrink-0`}>{label}</span>
      <ScrollingText 
        text={value} 
        className={`${TEXT.PRIMARY} text-right break-words`}
        glowColor={glowColor}
      />
    </div>
  );
}

// ============================================================================
// AIRCRAFT INFO CONTENT
// ============================================================================

function formatAltitude(ft: number | undefined): string {
  if (ft === undefined || ft === null) return 'N/A';
  return Math.round(ft).toLocaleString() + ' ft';
}

function formatSpeed(kts: number | undefined): string {
  if (kts === undefined || kts === null) return 'N/A';
  return Math.round(kts) + ' kts';
}

function formatVerticalRate(ftMin: number | undefined): string {
  if (ftMin === undefined || ftMin === null) return 'N/A';
  const val = Math.round(ftMin);
  if (val > 0) return '+' + val + ' ft/min';
  return val + ' ft/min';
}

function formatHeading(deg: number | undefined): string {
  if (deg === undefined || deg === null) return 'N/A';
  return Math.round(deg) + '°';
}

function formatCoord(val: number | undefined, isLat: boolean): string {
  if (val === undefined || val === null) return 'N/A';
  const abs = Math.abs(val).toFixed(5);
  if (isLat) return abs + (val >= 0 ? '° N' : '° S');
  return abs + (val >= 0 ? '° E' : '° W');
}

function formatLastContact(unix: number | undefined): string {
  if (!unix) return 'N/A';
  const diff = Math.floor(Date.now() / 1000 - unix);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
}

function getPositionSource(src: number | undefined): string {
  if (src === 0) return 'ADS-B';
  if (src === 1) return 'ASTERIX';
  if (src === 2) return 'MLAT';
  return 'UNKNOWN';
}

function AircraftInfoContent({ 
  aircraft, 
  glowColor 
}: { 
  aircraft: Aircraft; 
  glowColor: 'green' | 'yellow';
}) {
  const viewMode = useRadarStore((s) => s.gameState.viewMode);
  const cycleViewMode = useRadarStore((s) => s.cycleViewMode);
  
  // Track last server data for prediction
  const lastServerData = useRef({
    lat: aircraft.position.latitude,
    lon: aircraft.position.longitude,
    alt: aircraft.position.altitude,
    geoAlt: aircraft.position.geoAltitude,
    heading: aircraft.position.heading,
    speed: aircraft.position.speed,
    verticalRate: aircraft.position.verticalRate,
    time: Date.now(),
  });
  
  // State for predicted values (updates frequently)
  const [predicted, setPredicted] = useState({
    lat: aircraft.position.latitude,
    lon: aircraft.position.longitude,
    alt: aircraft.position.altitude,
    geoAlt: aircraft.position.geoAltitude,
  });
  
  // Hover state to show last synced values instead of predicted (unified for all categories)
  const [showLastSynced, setShowLastSynced] = useState(false);
  
  // Update server data when aircraft position changes
  useEffect(() => {
    const { latitude, longitude, altitude, geoAltitude, heading, speed, verticalRate } = aircraft.position;
    if (lastServerData.current.lat !== latitude || lastServerData.current.lon !== longitude) {
      lastServerData.current = {
        lat: latitude,
        lon: longitude,
        alt: altitude,
        geoAlt: geoAltitude,
        heading,
        speed,
        verticalRate,
        time: Date.now(),
      };
    }
  }, [aircraft.position.latitude, aircraft.position.longitude, aircraft.position.altitude, aircraft.position.geoAltitude, aircraft.position.heading, aircraft.position.speed, aircraft.position.verticalRate]);
  
  // Update predicted values every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      const { lat, lon, alt, geoAlt, heading, speed, verticalRate, time } = lastServerData.current;
      const elapsedSeconds = (Date.now() - time) / 1000;
      
      if (speed > 10 && elapsedSeconds < 120) {
        const predictedPos = predictPosition(lat, lon, heading, speed, elapsedSeconds);
        const predictedAlt = predictAltitude(alt, verticalRate, elapsedSeconds);
        const predictedGeoAlt = geoAlt ? predictAltitude(geoAlt, verticalRate, elapsedSeconds) : undefined;
        
        setPredicted({
          lat: predictedPos.lat,
          lon: predictedPos.lon,
          alt: predictedAlt,
          geoAlt: predictedGeoAlt,
        });
      } else {
        setPredicted({ lat, lon, alt, geoAlt });
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="space-y-3 select-none">
      {/* Header - Callsign & ICAO */}
      <div className={`flex items-start justify-between gap-3 ${BORDER.DIVIDER_B} pb-2`}>
        <div className="flex-1 min-w-0">
          <div className={`${TEXT.PRIMARY} font-medium text-sm truncate`}>
            <ScrollingText text={aircraft.callsign} glowColor={glowColor} />
          </div>
          <div className={`${TEXT.SECONDARY} ${TEXT.SM} truncate`}>
            {aircraft.originCountry || 'Unknown Origin'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`${TEXT.ACCENT} ${TEXT.MONO}`}>
            <ScrollingText text={aircraft.id.toUpperCase()} glowColor="green" />
          </div>
          <div className={`${TEXT.DIMMED} ${TEXT.SM}`}>ICAO24</div>
        </div>
      </div>
      
      {/* Status Row */}
      <div className="flex items-center gap-2">
        <div className={aircraft.onGround ? COMPONENT.DOT_INACTIVE : COMPONENT.DOT_ACTIVE} />
        <ScrollingText 
          text={aircraft.onGround ? 'ON_GROUND' : 'AIRBORNE'} 
          className={TEXT.SECONDARY}
          glowColor={glowColor}
        />
        {aircraft.squawk && (
          <>
            <span className={TEXT.DARK}>|</span>
            <span className={TEXT.SECONDARY}>SQK: <ScrollingText text={aircraft.squawk} className={TEXT.WARNING} glowColor={glowColor} /></span>
          </>
        )}
        {aircraft.spi && <span className={`${TEXT.ERROR} animate-pulse`}>SPI</span>}
        {aircraft.isMilitary && (
          <>
            <span className={TEXT.DARK}>|</span>
            <span className={`${TEXT.ERROR} font-medium`}>MIL</span>
          </>
        )}
      </div>

      {/* Aircraft Identification (from metadata enrichment) */}
      {(aircraft.type !== 'UNKNOWN' || aircraft.operator || aircraft.registration) && (
        <div className={`${BORDER.DIVIDER} pt-2`}>
          <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>IDENTIFICATION</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {aircraft.type !== 'UNKNOWN' && (
              <DataRow label="TYPE" value={aircraft.type} glowColor={glowColor} />
            )}
            {aircraft.aircraftModel && (
              <DataRow label="MODEL" value={aircraft.aircraftModel} glowColor={glowColor} />
            )}
            {aircraft.operator && (
              <DataRow label="OPR" value={aircraft.operator} glowColor={glowColor} />
            )}
            {aircraft.registration && (
              <DataRow label="REG" value={aircraft.registration} glowColor={glowColor} />
            )}
          </div>
        </div>
      )}

      {/* Position Section - Hover to show last synced for all */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div 
          className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1 cursor-pointer select-none`}
          onMouseEnter={() => setShowLastSynced(true)}
          onMouseLeave={() => setShowLastSynced(false)}
        >
          POSITION {showLastSynced 
            ? <span className={TEXT.ACCENT_BLUE}>(LAST SYNCED)</span>
            : <span className={TEXT.ACCENT}>(PREDICTED)</span>
          }
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <DataRow 
            label="LAT" 
            value={formatCoord(showLastSynced ? lastServerData.current.lat : predicted.lat, true)} 
            glowColor={showLastSynced ? 'blue' : glowColor} 
          />
          <DataRow 
            label="LON" 
            value={formatCoord(showLastSynced ? lastServerData.current.lon : predicted.lon, false)} 
            glowColor={showLastSynced ? 'blue' : glowColor} 
          />
        </div>
      </div>
      
      {/* Altitude Section - Hover to show last synced for all */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div 
          className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1 cursor-pointer select-none`}
          onMouseEnter={() => setShowLastSynced(true)}
          onMouseLeave={() => setShowLastSynced(false)}
        >
          ALTITUDE {showLastSynced 
            ? <span className={TEXT.ACCENT_BLUE}>(LAST SYNCED)</span>
            : <span className={TEXT.ACCENT}>(PREDICTED)</span>
          }
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <DataRow 
            label="BARO" 
            value={formatAltitude(showLastSynced ? lastServerData.current.alt : predicted.alt)} 
            glowColor={showLastSynced ? 'blue' : glowColor} 
          />
          <DataRow 
            label="GPS" 
            value={formatAltitude(showLastSynced ? lastServerData.current.geoAlt : predicted.geoAlt)} 
            glowColor={showLastSynced ? 'blue' : glowColor} 
          />
          <DataRow label="V/S" value={formatVerticalRate(aircraft.position.verticalRate)} glowColor={showLastSynced ? 'blue' : glowColor} />
        </div>
      </div>
      
      {/* Speed & Heading Section */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>VELOCITY</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <DataRow label="GND SPD" value={formatSpeed(aircraft.position.speed)} glowColor={glowColor} />
          <DataRow label="TRACK" value={formatHeading(aircraft.position.heading)} glowColor={glowColor} />
        </div>
      </div>
      
      {/* Data Source */}
      <div className={`${BORDER.DIVIDER} pt-2 flex justify-between ${TEXT.SM} select-none`}>
        <span className={TEXT.DIMMED}>SRC: <ScrollingText text={getPositionSource(aircraft.positionSource)} className={TEXT.SECONDARY} glowColor={glowColor} /></span>
        <span className={TEXT.DIMMED}>LAST: <ScrollingText text={formatLastContact(aircraft.lastContact)} className={TEXT.SECONDARY} glowColor={glowColor} /></span>
      </div>
      
      {/* View Mode Selector */}
      <div className={`${BORDER.DIVIDER} pt-2 select-none`}>
        <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>VIEW MODE</div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => cycleViewMode('prev')}
            className={`${TEXT.MUTED} hover:${TEXT.ACCENT} text-sm px-1 transition-colors`}
          >
            ◀
          </button>
          <div className="flex-1 text-center">
            <span className={`${TEXT.ACCENT} ${TEXT.BASE} tracking-wider`}>{VIEW_MODE_LABELS[viewMode]}</span>
          </div>
          <button 
            onClick={() => cycleViewMode('next')}
            className={`${TEXT.MUTED} hover:${TEXT.ACCENT} text-sm px-1 transition-colors`}
          >
            ▶
          </button>
        </div>
        <div className={`${TEXT.DARK} ${TEXT.XS} text-center mt-1`}>Q / E to cycle</div>
      </div>
    </div>
  );
}

// ============================================================================
// AIRPORT INFO CONTENT
// ============================================================================

function AirportInfoContent({ 
  airport, 
  glowColor 
}: { 
  airport: Airport; 
  glowColor: 'green' | 'yellow';
}) {
  return (
    <div className="space-y-2 select-none">
      {/* Header - ICAO & IATA */}
      <div className={`flex items-start justify-between gap-3 ${BORDER.DIVIDER_B} pb-2`}>
        <div className="flex-1 min-w-0">
          <div className={`${TEXT.PRIMARY} font-medium text-sm`}>
            <ScrollingText text={airport.iata || airport.icao} glowColor={glowColor} />
          </div>
          <div className={`${TEXT.SECONDARY} ${TEXT.SM} break-words`}>
            {airport.name}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`${TEXT.ACCENT} ${TEXT.MONO}`}>
            <ScrollingText text={airport.icao} glowColor="green" />
          </div>
          <div className={`${TEXT.DIMMED} ${TEXT.SM}`}>ICAO</div>
        </div>
      </div>
      
      {/* Location */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <DataRow label="CITY" value={airport.city || 'N/A'} glowColor={glowColor} />
        <DataRow label="COUNTRY" value={airport.country || 'N/A'} glowColor={glowColor} />
        <DataRow label="ELEV" value={airport.elevation ? `${Math.round(airport.elevation)} ft` : 'N/A'} glowColor={glowColor} />
        <DataRow label="TYPE" value={airport.type.replace('_', ' ').toUpperCase()} glowColor={glowColor} />
      </div>
    </div>
  );
}

// ============================================================================
// SHIP INFO CONTENT
// ============================================================================

const SHIP_TYPE_LABELS: Record<string, string> = {
  cargo: 'CARGO',
  tanker: 'TANKER',
  passenger: 'PASSENGER',
  military: 'MILITARY',
  fishing: 'FISHING',
  high_speed: 'HIGH SPEED',
  special: 'SPECIAL',
  other: 'OTHER',
};

function ShipInfoContent({
  ship,
  glowColor,
}: {
  ship: any;
  glowColor: 'green' | 'yellow';
}) {
  return (
    <div className="space-y-2 select-none">
      {/* Header - Name & MMSI */}
      <div className={`flex items-start justify-between gap-3 ${BORDER.DIVIDER_B} pb-2`}>
        <div className="flex-1 min-w-0">
          <div className={`${TEXT.PRIMARY} font-medium text-sm truncate`}>
            <ScrollingText text={ship.name || 'Unknown Vessel'} glowColor={glowColor} />
          </div>
          <div className={`${TEXT.SECONDARY} ${TEXT.SM} truncate`}>
            {SHIP_TYPE_LABELS[ship.shipType] || ship.shipType?.toUpperCase() || 'UNKNOWN'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`${TEXT.ACCENT} ${TEXT.MONO}`}>
            <ScrollingText text={ship.id} glowColor="green" />
          </div>
          <div className={`${TEXT.DIMMED} ${TEXT.SM}`}>MMSI</div>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <div className={ship.speed > 0.5 ? COMPONENT.DOT_ACTIVE : COMPONENT.DOT_INACTIVE} />
        <ScrollingText
          text={ship.speed > 0.5 ? 'UNDERWAY' : 'AT_ANCHOR'}
          className={TEXT.SECONDARY}
          glowColor={glowColor}
        />
        {ship.flag && (
          <>
            <span className={TEXT.DARK}>|</span>
            <span className={TEXT.SECONDARY}>FLAG: <ScrollingText text={ship.flag} className={TEXT.WARNING} glowColor={glowColor} /></span>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>NAVIGATION</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <DataRow label="SPEED" value={`${ship.speed ?? 0} kn`} glowColor={glowColor} />
          <DataRow label="HEADING" value={`${Math.round(ship.heading ?? 0)}°`} glowColor={glowColor} />
          <DataRow label="LAT" value={formatCoord(ship.lat, true)} glowColor={glowColor} />
          <DataRow label="LON" value={formatCoord(ship.lon, false)} glowColor={glowColor} />
        </div>
      </div>

      {/* Voyage Info */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>VOYAGE</div>
        <div className="space-y-0.5">
          <DataRow label="DEST" value={ship.destination || 'N/A'} glowColor={glowColor} />
          {ship.draught != null && (
            <DataRow label="DRAUGHT" value={`${ship.draught} m`} glowColor={glowColor} />
          )}
          {ship.imo != null && (
            <DataRow label="IMO" value={String(ship.imo)} glowColor={glowColor} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SATELLITE INFO CONTENT
// ============================================================================

function SatelliteInfoContent({
  sat,
  glowColor,
}: {
  sat: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  glowColor: 'green' | 'yellow';
}) {
  return (
    <div className="space-y-2 select-none">
      {/* Header - Name & NORAD ID */}
      <div className={`flex items-start justify-between gap-3 ${BORDER.DIVIDER_B} pb-2`}>
        <div className="flex-1 min-w-0">
          <div className={`${TEXT.PRIMARY} font-medium text-sm truncate`}>
            <ScrollingText text={sat.name || 'UNKNOWN'} glowColor={glowColor} />
          </div>
          <div className={`${TEXT.SECONDARY} ${TEXT.SM} truncate`}>
            {sat.group ? sat.group.toUpperCase() : 'SATELLITE'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`${TEXT.ACCENT} ${TEXT.MONO}`}>
            <ScrollingText text={sat.noradId || 'N/A'} glowColor="green" />
          </div>
          <div className={`${TEXT.DIMMED} ${TEXT.SM}`}>NORAD</div>
        </div>
      </div>

      {/* Orbit Classification */}
      <div className="flex items-center gap-2">
        <div className={COMPONENT.DOT_ACTIVE} />
        <ScrollingText
          text={sat.orbitType || 'UNKNOWN'}
          className={TEXT.SECONDARY}
          glowColor={glowColor}
        />
        {sat.intlDesignator && (
          <>
            <span className={TEXT.DARK}>|</span>
            <span className={TEXT.SECONDARY}>
              COSPAR: <ScrollingText text={sat.intlDesignator} className={TEXT.WARNING} glowColor={glowColor} />
            </span>
          </>
        )}
      </div>

      {/* Position */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>POSITION</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <DataRow
            label="LAT"
            value={sat.lat != null ? `${Math.abs(sat.lat).toFixed(4)}${sat.lat >= 0 ? '° N' : '° S'}` : 'N/A'}
            glowColor={glowColor}
          />
          <DataRow
            label="LON"
            value={sat.lon != null ? `${Math.abs(sat.lon).toFixed(4)}${sat.lon >= 0 ? '° E' : '° W'}` : 'N/A'}
            glowColor={glowColor}
          />
          <DataRow
            label="ALT"
            value={sat.alt != null ? `${Math.round(sat.alt).toLocaleString()} km` : 'N/A'}
            glowColor={glowColor}
          />
          <DataRow
            label="SPEED"
            value={sat.velocity != null ? `${sat.velocity.toFixed(2)} km/s` : 'N/A'}
            glowColor={glowColor}
          />
        </div>
      </div>

      {/* Orbital Parameters */}
      <div className={`${BORDER.DIVIDER} pt-2`}>
        <div className={`${TEXT.DIMMED} ${TEXT.SM} tracking-wider mb-1`}>ORBITAL ELEMENTS</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <DataRow
            label="INCL"
            value={sat.inclination != null ? `${sat.inclination.toFixed(2)}°` : 'N/A'}
            glowColor={glowColor}
          />
          <DataRow
            label="PERIOD"
            value={sat.period != null ? `${sat.period.toFixed(1)} min` : 'N/A'}
            glowColor={glowColor}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ENTITY INFO PANEL (Simplified animation - no state machine)
// ============================================================================

interface EntityInfoPanelProps {
  onClose?: () => void;
}

export function EntityInfoPanel({ onClose: _onClose }: EntityInfoPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Store displayed entity for exit animation (using state instead of refs)
  const [displayedRef, setDisplayedRef] = useState<EntityRef | null>(null);
  const [displayedEntity, setDisplayedEntity] = useState<Aircraft | Airport | null>(null);
  
  // Get interaction state from store
  const hoveredEntity = useRadarStore((s) => s.gameState.hoveredEntity);
  const selectedEntity = useRadarStore((s) => s.gameState.selectedEntity);
  const selectEntity = useRadarStore((s) => s.selectEntity);
  const getEntityByRef = useRadarStore((s) => s.getEntityByRef);
  
  // The "target" entity we want to display
  const targetRef = hoveredEntity || selectedEntity;
  const targetEntity = getEntityByRef(targetRef);
  
  // Handle visibility changes
  useEffect(() => {
    const hasTarget = targetRef !== null && targetEntity !== undefined;
    
    if (hasTarget) {
      // Immediately show with new entity
      setDisplayedRef(targetRef);
      setDisplayedEntity(targetEntity as Aircraft | Airport);
      setIsVisible(true);
      setIsAnimating(false);
    } else if (displayedRef !== null && !isAnimating) {
      // Start exit animation
      setIsAnimating(true);
      setIsVisible(false);
      
      // Clear after animation
      const timeout = setTimeout(() => {
        setDisplayedRef(null);
        setDisplayedEntity(null);
        setIsAnimating(false);
      }, 300);
      
      return () => clearTimeout(timeout);
    }
  }, [targetRef, targetEntity, isAnimating, displayedRef]);
  
  // Measure content for height animation
  useEffect(() => {
    if (contentRef.current && displayedEntity) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [displayedRef?.type, displayedRef?.id, isVisible, displayedEntity]);
  
  const isHovering = hoveredEntity !== null;
  const isSelected = selectedEntity !== null;
  const isHoveringDifferent = isSelected && isHovering && 
    (hoveredEntity?.type !== selectedEntity?.type || hoveredEntity?.id !== selectedEntity?.id);
  
  const glowColor = isHoveringDifferent ? 'yellow' as const : 'green' as const;
  
  const handleAction = () => {
    if (isHoveringDifferent && hoveredEntity) {
      selectEntity(hoveredEntity);
    } else if (isSelected) {
      selectEntity(null);
    }
  };
  
  const typeLabel = displayedRef ? getEntityTypeName(displayedRef.type).toUpperCase() : 'ENTITY';
  const showContent = displayedRef !== null && displayedEntity !== null;
  
  return (
    <div 
      className={`bg-black/90 transition-all duration-300 ease-out ${BORDER.SUBTLE} ` + 
        (showContent ? 'border ' : 'border-0 ') +
        (isHovering && !isSelected ? 'border-dashed' : 'border-solid')}
      style={{ 
        width: `${UI.INFO_PANEL_WIDTH}px`,
        maxHeight: showContent ? `${UI.INFO_PANEL_MAX_HEIGHT}px` : '0px',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        overflow: 'hidden',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      {showContent && (
        <>
          {/* Header */}
          <div 
            className={`${BORDER.DIVIDER_B} px-3 py-2 ${TEXT.BASE} ${TEXT.SECONDARY} transition-colors duration-300 flex justify-between items-center ` + 
              (isHovering && !isSelected ? 'border-dashed' : 'border-solid')}
          >
            <span>{typeLabel}_INFO</span>
            <div className="flex items-center gap-2">
              {isHovering && !isSelected && (
                <span className={TEXT.WARNING}>[↵ SELECT]</span>
              )}
              {isSelected && isHoveringDifferent && (
                <button 
                  onClick={handleAction}
                  className={`${TEXT.WARNING} hover:text-[#ffcc00] hover:bg-[${COLORS.UI_WARNING}]/10 px-1.5 transition-colors`}
                >
                  [↵ SELECT]
                </button>
              )}
              {isSelected && !isHoveringDifferent && (
                <button 
                  onClick={handleAction}
                  className={`${TEXT.ERROR} hover:text-[#ff6666] hover:bg-[${COLORS.UI_ERROR}]/10 px-1.5 transition-colors`}
                >
                  [ESC]
                </button>
              )}
            </div>
          </div>
          
          {/* Content */}
          <div 
            className="transition-[height] duration-300 ease-out"
            style={{ height: height || 'auto' }}
          >
            <div ref={contentRef} className={`p-3 ${TEXT.BASE}`}>
              {displayedRef?.type === 'aircraft' && displayedEntity && (
                <AircraftInfoContent aircraft={displayedEntity as Aircraft} glowColor={glowColor} />
              )}
              {displayedRef?.type === 'airport' && displayedEntity && (
                <AirportInfoContent airport={displayedEntity as Airport} glowColor={glowColor} />
              )}
              {displayedRef?.type === 'ship' && displayedEntity && (
                <ShipInfoContent ship={displayedEntity} glowColor={glowColor} />
              )}
              {displayedRef?.type === 'satellite' && displayedEntity && (
                <SatelliteInfoContent sat={displayedEntity} glowColor={glowColor} />
              )}
              {displayedRef && !['aircraft', 'airport', 'ship', 'satellite'].includes(displayedRef.type) && (
                <div className={TEXT.SECONDARY}>
                  <ScrollingText text={`${typeLabel} info not yet implemented`} glowColor={glowColor} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
