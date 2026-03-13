'use client';

import { useState, useCallback } from 'react';
import { useRadarStore } from '@/store/gameStore';
import { LayerId, LAYER_CONFIGS, LAYER_CATEGORIES, LayerCategory } from '@/types/layers';
import { TEXT, BG, BORDER } from '@/config/styles';

/**
 * Layer toggle panel - lets users enable/disable data layers.
 * Accessed via a button in the Dashboard UI.
 */
export function LayerPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const layers = useRadarStore((s) => s.layers);
  const toggleLayer = useRadarStore((s) => s.toggleLayer);

  if (!isOpen) return null;

  const categories = Object.entries(LAYER_CATEGORIES)
    .sort(([, a], [, b]) => a.order - b.order) as [LayerCategory, typeof LAYER_CATEGORIES[LayerCategory]][];

  return (
    <div className={`${BG.GLASS_BLUR} ${BORDER.PANEL} p-3 min-w-[200px]`}>
      <div className={`${TEXT.SM} ${TEXT.MUTED} tracking-widest mb-2`}>LAYERS</div>

      {categories.map(([catId, catInfo]) => {
        const catLayers = Object.values(LAYER_CONFIGS).filter(l => l.category === catId);
        if (catLayers.length === 0) return null;

        return (
          <div key={catId} className="mb-2">
            <div className={`${TEXT.XS} ${TEXT.DIMMED} tracking-wider mb-1`}>{catInfo.label}</div>
            {catLayers.map((config) => {
              const state = layers[config.id];
              return (
                <button
                  key={config.id}
                  onClick={() => toggleLayer(config.id)}
                  className={`flex items-center gap-2 w-full px-2 py-1 transition-colors hover:bg-white/5 ${TEXT.BASE}`}
                >
                  <span
                    className="w-2 h-2 rounded-full transition-opacity"
                    style={{
                      backgroundColor: config.color,
                      opacity: state.enabled ? 1 : 0.2,
                    }}
                  />
                  <span
                    className="transition-colors"
                    style={{ color: state.enabled ? config.color : '#555' }}
                  >
                    {config.shortLabel}
                  </span>
                  {state.loading && (
                    <span className={`${TEXT.XS} ${TEXT.MUTED} ml-auto`}>...</span>
                  )}
                  {state.entityCount > 0 && state.enabled && (
                    <span className={`${TEXT.XS} ${TEXT.MUTED} ml-auto`}>{state.entityCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}

      <button
        onClick={onClose}
        className={`${TEXT.XS} ${TEXT.DIMMED} mt-1 hover:text-white/50 transition-colors`}
      >
        [/] CLOSE
      </button>
    </div>
  );
}
