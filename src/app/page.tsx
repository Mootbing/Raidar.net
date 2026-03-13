'use client';

import dynamic from 'next/dynamic';
import { Dashboard } from '@/components/Dashboard';
import { DataPoller } from '@/components/DataPoller';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRadarStore } from '@/store/gameStore';
import { useState, useEffect } from 'react';
import { useInputManagerInit } from '@/hooks/useInputManager';
import { INTRO } from '@/config/constants';
import { TEXT } from '@/config/styles';

const Scene = dynamic(() => import('@/components/Scene').then((mod) => mod.Scene), {
  ssr: false,
  loading: () => null,
});

function LoadingOverlay() {
  const locationReady = useRadarStore((s) => s.locationReady);
  const setIntroPhase = useRadarStore((s) => s.setIntroPhase);
  const setLoadingProgress = useRadarStore((s) => s.setLoadingProgress);
  const introPhase = useRadarStore((s) => s.introPhase);
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  
  // Start borders animation immediately on mount (synced with loading progress 0-100%)
  useEffect(() => {
    setIntroPhase('borders');
  }, [setIntroPhase]);
  
  // Sync loading progress to global store for CountryBorders
  useEffect(() => {
    setLoadingProgress(progress);
  }, [progress, setLoadingProgress]);
  
  // Airports animation is triggered by CameraController when camera lerp is 90% complete
  
  // Trigger aircraft animation after airports have started
  useEffect(() => {
    if (introPhase !== 'airports') return;
    
    // Start aircraft animation after a delay
    const aircraftTimer = setTimeout(() => {
      setIntroPhase('aircraft');
    }, INTRO.AIRCRAFT_DELAY);
    
    // Complete animation
    const completeTimer = setTimeout(() => {
      setIntroPhase('complete');
    }, INTRO.AIRCRAFT_DELAY + INTRO.AIRCRAFT_DURATION);
    
    return () => {
      clearTimeout(aircraftTimer);
      clearTimeout(completeTimer);
    };
  }, [introPhase, setIntroPhase]);
  
  // Cycle through loading stages
  useEffect(() => {
    if (locationReady) return;
    
    const stage = INTRO.STAGES[stageIndex];
    if (!stage) return;
    
    const timer = setTimeout(() => {
      if (stageIndex < INTRO.STAGES.length - 1) {
        setStageIndex(prev => prev + 1);
      }
    }, stage.duration);
    
    return () => clearTimeout(timer);
  }, [stageIndex, locationReady]);
  
  // Animate progress
  useEffect(() => {
    if (locationReady) return;
    
    const interval = setInterval(() => {
      setProgress(prev => {
        const targetProgress = ((stageIndex + 1) / INTRO.STAGES.length) * 100;
        const jitter = Math.random() * INTRO.PROGRESS_JITTER - 1;
        const newProgress = prev + (targetProgress - prev) * INTRO.PROGRESS_SMOOTH_FACTOR + jitter;
        return Math.min(Math.max(newProgress, prev), 99);
      });
    }, INTRO.PROGRESS_INTERVAL);
    
    return () => clearInterval(interval);
  }, [stageIndex, locationReady]);
  
  const displayProgress = locationReady ? 100 : progress;
  
  const currentStage = INTRO.STAGES[stageIndex] || INTRO.STAGES[INTRO.STAGES.length - 1];
  
  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center font-mono transition-opacity pointer-events-none ${
        locationReady ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ 
        transitionDuration: `${INTRO.FADE_DURATION}ms`,
        transitionDelay: locationReady ? `${INTRO.FADE_DELAY}ms` : '0ms' 
      }}
    >
      <div className="relative" style={{ width: '320px', height: '70px' }}>
        {/* Commercial edition label - top */}
        <div className={`absolute top-0 left-0 right-0 text-center ${TEXT.BASE} ${TEXT.MUTED} tracking-[0.15em]`}>
          COMMERCIAL EDITION
        </div>
        
        {/* Main title with reveal effect - absolutely positioned */}
        <div className="absolute top-5 left-0 right-0 text-center">
          <div className="relative inline-block text-sm tracking-[0.25em] font-light">
            {/* Grey background text */}
            <span className={`${TEXT.DARK} whitespace-nowrap`}>
              RAIDAR OBSERVABILITY NETWORK
            </span>
            {/* White overlay that reveals left to right */}
            <div 
              className={`absolute top-0 left-0 ${TEXT.PRIMARY} overflow-hidden whitespace-nowrap`}
              style={{ width: `${displayProgress}%` }}
            >
              RAIDAR OBSERVABILITY NETWORK
            </div>
          </div>
        </div>
        
        {/* Status line: stage text - percentage - absolutely positioned */}
        <div className={`absolute bottom-0 left-0 right-0 text-center ${TEXT.BASE} ${TEXT.MUTED} tracking-[0.15em]`}>
          {currentStage.text} — {Math.floor(displayProgress)}%
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  // Initialize global input manager
  useInputManagerInit();
  
  return (
    <ErrorBoundary>
      <main className="w-full h-screen overflow-hidden bg-black">
        <Scene />
        <Dashboard />
        <DataPoller />
        <LoadingOverlay />
      </main>
    </ErrorBoundary>
  );
}
