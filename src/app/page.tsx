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

// Cosmetic stages for the first 0-50% of loading (borders drawing)
const COSMETIC_STAGES = [
  { text: 'INITIALIZING_RENDERER', duration: 500 },
  { text: 'DRAWING_BORDERS', duration: 500 },
  { text: 'RENDERING_COASTLINES', duration: 500 },
];

// Data sources to track, in sweep order
const SWEEP_SOURCES = ['airports', 'docks', 'maritime', 'aircraft', 'news', 'satellites'] as const;
const SWEEP_PHASES = ['airports', 'docks', 'maritime', 'aircraft', 'news', 'satellites'] as const;
const SWEEP_TEXTS = [
  'LOADING_AIRPORT_DATA',
  'FETCHING_DOCK_POSITIONS',
  'FETCHING_MARITIME_DATA',
  'FETCHING_AIRCRAFT_DATA',
  'SCANNING_NEWS_FEEDS',
  'TRACKING_SATELLITES',
];
const SWEEP_DELAY = 150; // ms minimum between sweep animations
const MAX_LOADING_TIMEOUT = 15000; // Force completion after 15s

function LoadingOverlay() {
  const setIntroPhase = useRadarStore((s) => s.setIntroPhase);
  const setLoadingProgress = useRadarStore((s) => s.setLoadingProgress);
  const setLocationReady = useRadarStore((s) => s.setLocationReady);
  const setDataFetchReady = useRadarStore((s) => s.setDataFetchReady);
  const fetchAirports = useRadarStore((s) => s.fetchAirports);
  const dataLoadState = useRadarStore((s) => s.dataLoadState);

  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [stageText, setStageText] = useState(COSMETIC_STAGES[0].text);

  // Phase 1: Cosmetic stage cycling (0-50%)
  const [cosmeticIdx, setCosmeticIdx] = useState(0);

  // Phase 2: Sequential sweep tracking
  const [nextSweepIdx, setNextSweepIdx] = useState(0);
  const lastSweepTime = useRef(0);

  // ---- On mount: start borders drawing and trigger data fetches ----
  useEffect(() => {
    setIntroPhase('borders');
    // Fetch airports immediately (no viewport needed)
    fetchAirports();
    // Allow viewport-dependent fetches after viewport tracker initializes
    const timer = setTimeout(() => {
      setDataFetchReady(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [setIntroPhase, fetchAirports, setDataFetchReady]);

  // ---- Phase 1: Cosmetic stages (progress 0→50%) ----
  useEffect(() => {
    if (done || cosmeticIdx >= COSMETIC_STAGES.length) return;

    setStageText(COSMETIC_STAGES[cosmeticIdx].text);

    const timer = setTimeout(() => {
      setCosmeticIdx(prev => prev + 1);
    }, COSMETIC_STAGES[cosmeticIdx].duration);

    return () => clearTimeout(timer);
  }, [cosmeticIdx, done]);

  // ---- Phase 2: Trigger sweeps in order as data arrives ----
  useEffect(() => {
    if (done || nextSweepIdx >= SWEEP_SOURCES.length) return;

    const source = SWEEP_SOURCES[nextSweepIdx];
    if (!dataLoadState[source]) return; // Wait for this source

    const now = Date.now();
    const minDelay = Math.max(0, SWEEP_DELAY - (now - lastSweepTime.current));

    const timer = setTimeout(() => {
      setIntroPhase(SWEEP_PHASES[nextSweepIdx]);
      setStageText(SWEEP_TEXTS[nextSweepIdx]);
      lastSweepTime.current = Date.now();
      setNextSweepIdx(prev => prev + 1);
    }, minDelay);

    return () => clearTimeout(timer);
  }, [nextSweepIdx, dataLoadState, done, setIntroPhase]);

  // ---- Smooth progress animation ----
  useEffect(() => {
    if (done) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        // Phase 1 target: cosmetic stages → 0-50%
        const cosmeticTarget = Math.min(50, ((cosmeticIdx + 1) / COSMETIC_STAGES.length) * 50);

        // Phase 2 target: data sources → 50-100%
        const loadedCount = SWEEP_SOURCES.filter(s => dataLoadState[s]).length;
        const dataTarget = 50 + (loadedCount / SWEEP_SOURCES.length) * 50;

        const targetProgress = Math.max(cosmeticTarget, dataTarget);
        const jitter = Math.random() * INTRO.PROGRESS_JITTER - 1;
        const newProgress = prev + (targetProgress - prev) * INTRO.PROGRESS_SMOOTH_FACTOR + jitter;
        return Math.min(Math.max(newProgress, prev), 99);
      });
    }, INTRO.PROGRESS_INTERVAL);

    return () => clearInterval(interval);
  }, [cosmeticIdx, dataLoadState, done]);

  // ---- Sync progress to store (for CountryBorders) ----
  useEffect(() => {
    setLoadingProgress(progress);
  }, [progress, setLoadingProgress]);

  // ---- Finalize when all data sources have loaded ----
  useEffect(() => {
    const allLoaded = SWEEP_SOURCES.every(s => dataLoadState[s]);
    if (!allLoaded || done) return;

    // Wait for last sweep to trigger before finalizing
    const timer = setTimeout(() => {
      setDone(true);
      setProgress(100);
      setLoadingProgress(100);
      setStageText('SYSTEM_READY');

      setTimeout(() => {
        setIntroPhase('complete');
        setLocationReady(true);
      }, 200);
    }, 300);

    return () => clearTimeout(timer);
  }, [dataLoadState, done, setIntroPhase, setLoadingProgress, setLocationReady]);

  // ---- Safety timeout: force completion if loading hangs ----
  useEffect(() => {
    const timer = setTimeout(() => {
      if (done) return;
      console.warn('[LoadingOverlay] Loading timeout — forcing completion');
      setDone(true);
      setProgress(100);
      setLoadingProgress(100);
      setIntroPhase('complete');
      setLocationReady(true);
      setDataFetchReady(true);
    }, MAX_LOADING_TIMEOUT);
    return () => clearTimeout(timer);
  }, [done, setIntroPhase, setLoadingProgress, setLocationReady, setDataFetchReady]);

  const displayProgress = done ? 100 : progress;

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
              RAIDAR NETWORKS
            </span>
            {/* White overlay that reveals left to right */}
            <div
              className={`absolute top-0 left-0 ${TEXT.PRIMARY} overflow-hidden whitespace-nowrap`}
              style={{ width: `${displayProgress}%` }}
            >
              RAIDAR NETWORKS
            </div>
          </div>
        </div>

        {/* Status line: stage text - percentage - absolutely positioned */}
        <div className={`absolute bottom-0 left-0 right-0 text-center ${TEXT.BASE} ${TEXT.MUTED} tracking-[0.15em]`}>
          {stageText} — {Math.floor(displayProgress)}%
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
