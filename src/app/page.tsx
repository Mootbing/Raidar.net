'use client';

import dynamic from 'next/dynamic';
import { Dashboard } from '@/components/Dashboard';
import { DataPoller } from '@/components/DataPoller';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRadarStore } from '@/store/gameStore';
import { useState, useEffect, useRef } from 'react';
import { useInputManagerInit } from '@/hooks/useInputManager';
import { INTRO } from '@/config/constants';
import { TEXT } from '@/config/styles';

const Scene = dynamic(() => import('@/components/Scene').then((mod) => mod.Scene), {
  ssr: false,
  loading: () => null,
});

function LoadingOverlay() {
  const setIntroPhase = useRadarStore((s) => s.setIntroPhase);
  const setLoadingProgress = useRadarStore((s) => s.setLoadingProgress);
  const setLocationReady = useRadarStore((s) => s.setLocationReady);
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  // Start borders animation immediately on mount (synced with loading progress 0-100%)
  useEffect(() => {
    setIntroPhase('borders');
  }, [setIntroPhase]);

  // Sync loading progress to global store for CountryBorders
  useEffect(() => {
    setLoadingProgress(progress);
  }, [progress, setLoadingProgress]);

  // Cycle through loading stages
  useEffect(() => {
    if (done) return;

    const stage = INTRO.STAGES[stageIndex];
    if (!stage) return;

    const timer = setTimeout(() => {
      if (stageIndex < INTRO.STAGES.length - 1) {
        setStageIndex(prev => prev + 1);
      }
    }, stage.duration);

    return () => clearTimeout(timer);
  }, [stageIndex, done]);

  // Animate progress
  useEffect(() => {
    if (done) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        const targetProgress = ((stageIndex + 1) / INTRO.STAGES.length) * 100;
        const jitter = Math.random() * INTRO.PROGRESS_JITTER - 1;
        const newProgress = prev + (targetProgress - prev) * INTRO.PROGRESS_SMOOTH_FACTOR + jitter;
        return Math.min(Math.max(newProgress, prev), 99);
      });
    }, INTRO.PROGRESS_INTERVAL);

    return () => clearInterval(interval);
  }, [stageIndex, done]);

  // Sequential sweep phases triggered at progress milestones (50-100%)
  const sweepPhaseRef = useRef(0);
  const SWEEP_DELAY = 500; // ms between each layer sweep

  useEffect(() => {
    // At ~50% progress (stage 4 of 8), borders are fully drawn — start sweeps
    const halfwayStage = Math.floor(INTRO.STAGES.length / 2);
    if (stageIndex >= halfwayStage && sweepPhaseRef.current === 0) {
      sweepPhaseRef.current = 1;
      setIntroPhase('airports');

      // Sequential sweep: airports → docks → maritime → aircraft → satellites
      setTimeout(() => {
        setIntroPhase('docks');
      }, SWEEP_DELAY);

      setTimeout(() => {
        setIntroPhase('maritime');
      }, SWEEP_DELAY * 2);

      setTimeout(() => {
        setIntroPhase('aircraft');
      }, SWEEP_DELAY * 3);

      setTimeout(() => {
        setIntroPhase('satellites');
      }, SWEEP_DELAY * 4);
    }
  }, [stageIndex, setIntroPhase]);

  // When last loading stage is reached, finalize
  useEffect(() => {
    if (stageIndex < INTRO.STAGES.length - 1) return;
    if (done) return;

    const finishTimer = setTimeout(() => {
      setDone(true);
      setProgress(100);
      setLoadingProgress(100);
      setIntroPhase('complete');
      setLocationReady(true);
    }, INTRO.STAGES[INTRO.STAGES.length - 1].duration);

    return () => clearTimeout(finishTimer);
  }, [stageIndex, done, setIntroPhase, setLoadingProgress, setLocationReady]);

  const displayProgress = done ? 100 : progress;

  const currentStage = INTRO.STAGES[stageIndex] || INTRO.STAGES[INTRO.STAGES.length - 1];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center font-mono transition-opacity pointer-events-none ${
        done ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        transitionDuration: `${INTRO.FADE_DURATION}ms`,
        transitionDelay: done ? `${INTRO.FADE_DELAY}ms` : '0ms'
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
