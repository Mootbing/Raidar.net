'use client';

import { useRadarStore } from '@/store/gameStore';
import { useEffect, useCallback, useState } from 'react';
import { EntityInfoPanel } from './entities/EntityInfoPanel';
import { SearchBar } from './SearchBar';
import { StackedModeBars } from './StackedModeBars';
import { LayerPanel } from './LayerPanel';
import { useGlobalInput } from '@/hooks/useInputManager';
import { InputAction } from '@/lib/inputManager';
import { UI, COLORS } from '@/config/constants';
import { TEXT, BG, BORDER } from '@/config/styles';

export function Dashboard() {
  const gameState = useRadarStore((state) => state.gameState);
  const selectEntity = useRadarStore((state) => state.selectEntity);
  const locationReady = useRadarStore((state) => state.locationReady);
  const toasts = useRadarStore((state) => state.toasts);
  
  // Delay animation start until after loading screen fades
  const [animateIn, setAnimateIn] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  
  useEffect(() => {
    if (locationReady && !animateIn) {
      const timer = setTimeout(() => {
        setAnimateIn(true);
      }, UI.BOTTOM_BAR_ANIM_DELAY);
      return () => clearTimeout(timer);
    }
  }, [locationReady, animateIn]);

  const handleClosePanel = useCallback(() => {
    selectEntity(null);
  }, [selectEntity]);

  // Handle input actions from centralized input manager
  const handleGlobalAction = useCallback((action: InputAction) => {
    switch (action) {
      case 'deselect':
        if (layerPanelOpen) {
          setLayerPanelOpen(false);
        } else {
          handleClosePanel();
        }
        break;
      case 'select_hovered':
        if (gameState.hoveredEntity) {
          selectEntity(gameState.hoveredEntity);
        }
        break;
    }
  }, [handleClosePanel, gameState.hoveredEntity, selectEntity, layerPanelOpen]);
  
  useGlobalInput(handleGlobalAction);

  return (
    <div className="absolute inset-0 pointer-events-none font-mono">
      {/* Layer Panel - Top Right */}
      <div className="absolute top-4 right-4 pointer-events-auto">
        <LayerPanel isOpen={layerPanelOpen} onClose={() => setLayerPanelOpen(false)} />
        {!layerPanelOpen && locationReady && (
          <button
            onClick={() => setLayerPanelOpen(true)}
            className={`${BG.GLASS_BLUR} ${BORDER.PANEL} px-3 py-1.5 ${TEXT.BASE} ${TEXT.MUTED} hover:text-white/80 transition-colors tracking-wider ${animateIn ? 'bottom-bar-item animate-in' : 'bottom-bar-item'}`}
            style={{ '--item-index': 0 } as React.CSSProperties}
          >
            LAYERS
          </button>
        )}
      </div>

      {/* Entity Info Panel - Bottom Left */}
      <div className="absolute bottom-14 left-4 pointer-events-auto">
        <EntityInfoPanel onClose={handleClosePanel} />
      </div>
      
      {/* Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-auto">
        <div className="flex gap-3 items-end">
          {/* Left: Stacked Mode Bars (Filter + AI Tools) */}
          <StackedModeBars isSearchFocused={isSearchFocused} animateIn={animateIn} />
          
          {/* Center: Search Bar - spans all available space */}
          <div 
            className={`flex-1 min-w-0 ${animateIn ? 'bottom-bar-item animate-in' : 'bottom-bar-item'}`}
            style={{ '--item-index': 1 } as React.CSSProperties}
          >
            <SearchBar onFocusChange={setIsSearchFocused} />
          </div>
      
          {/* Right: Hints & Branding */}
          <div 
            className={`shrink-0 flex flex-col justify-center text-right ${BG.GLASS_BLUR} ${BORDER.PANEL} px-3 py-2 gap-0.5 ${animateIn ? 'bottom-bar-item animate-in' : 'bottom-bar-item'}`}
            style={{ '--item-index': 2 } as React.CSSProperties}
          >
            <div className={`${TEXT.XS} ${TEXT.MUTED}`}>WASD: move | ⇧+W/S: zoom | TAB: modes</div>
            <div className={`${TEXT.XS} ${TEXT.MUTED} group cursor-default flex items-center justify-end gap-1.5`}>
              <img src="/@bullhorn.png" alt="" className="w-3 h-3 opacity-50" />
              <span className="transition-opacity duration-200 group-hover:opacity-0">BULLHORN AEROSYSTEMS</span>
              <span className="transition-opacity duration-200 opacity-0 group-hover:opacity-100 absolute right-3">COMMERCIAL — V1.0.2</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Toast notifications - Bottom Right, stacked from bottom */}
      {/* New toasts appear at bottom, old ones rise up and fade out at top */}
      <div className="absolute bottom-20 right-4 pointer-events-none flex flex-col gap-2">
        {toasts.map((toast, index) => {
          // Distance from bottom: 0 = at bottom (newest), higher = further up (older)
          const distanceFromBottom = toasts.length - 1 - index;
          const baseOpacity = Math.max(UI.TOAST.MIN_OPACITY, 1 - distanceFromBottom * UI.TOAST.OPACITY_DECAY);
          
          return (
          <div 
            key={toast.id}
            className={`transition-all duration-300 ${
              toast.exiting 
                  ? 'opacity-0 -translate-y-2 scale-95' 
                  : 'translate-y-0 scale-100'
            }`}
            style={{
                opacity: toast.exiting ? 0 : baseOpacity,
                transitionDelay: toast.exiting ? '0ms' : `${index * UI.TOAST.STAGGER_DELAY}ms`,
            }}
          >
              <div 
                className={`backdrop-blur-sm border px-4 py-2 ${TEXT.LG} tracking-widest whitespace-nowrap`}
                style={{
                  backgroundColor: `rgba(0, 0, 0, ${UI.TOAST.BG_OPACITY_BASE + distanceFromBottom * UI.TOAST.BG_OPACITY_STEP})`,
                  borderColor: COLORS.BORDER_DEFAULT,
                  color: `rgba(255, 255, 255, ${baseOpacity})`,
                }}
              >
              {toast.message}
            </div>
          </div>
          );
        })}
      </div>
      
    </div>
  );
}
