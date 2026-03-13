'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { UI, COLORS } from '@/config/constants';
import { TEXT, BG, BORDER } from '@/config/styles';
import { SelectorMenu, MenuSection } from './SelectorMenu';

type AITool = 'agent' | 'plan' | 'ask';

interface ToolBarProps {
  animateIn: boolean;
}

const AI_COLORS = {
  agent: COLORS.MODE_AI_AGENT,
  plan: COLORS.MODE_AI_PLAN,
  ask: COLORS.MODE_AI_ASK,
};

// Icons for AI tools
const AgentIcon = ({ active, highlighted }: { active: boolean; highlighted?: boolean }) => {
  const colors = AI_COLORS.agent;
  const color = highlighted ? colors.highlighted : active ? colors.active : colors.inactive;
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <circle cx="9" cy="14" r="2" />
      <circle cx="15" cy="14" r="2" />
      <path d="M12 2v4" />
      <path d="M8 6h8" />
    </svg>
  );
};

const PlanIcon = ({ active, highlighted }: { active: boolean; highlighted?: boolean }) => {
  const colors = AI_COLORS.plan;
  const color = highlighted ? colors.highlighted : active ? colors.active : colors.inactive;
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
};

const AskIcon = ({ active, highlighted }: { active: boolean; highlighted?: boolean }) => {
  const colors = AI_COLORS.ask;
  const color = highlighted ? colors.highlighted : active ? colors.active : colors.inactive;
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 9a3 3 0 1 1 3.5 2.9c-.8.4-1.5 1.1-1.5 2.1" />
      <circle cx="12" cy="17" r="0.5" fill={color} />
    </svg>
  );
};

const createAIIcon = (tool: AITool) => (active: boolean, highlighted: boolean) => {
  switch (tool) {
    case 'agent': return <AgentIcon active={active} highlighted={highlighted} />;
    case 'plan': return <PlanIcon active={active} highlighted={highlighted} />;
    case 'ask': return <AskIcon active={active} highlighted={highlighted} />;
  }
};

const HOLD_THRESHOLD = UI.TAB_HOLD_THRESHOLD;

export function StackedModeBars({ animateIn }: ToolBarProps) {
  const [aiTool, setAiTool] = useState<AITool>('agent');

  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const tabPressTime = useRef<number | null>(null);
  const tabHoldTimeout = useRef<NodeJS.Timeout | null>(null);

  // Animated highlight
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [highlightStyle, setHighlightStyle] = useState({ left: 0, width: 0 });

  const aiTools: AITool[] = useMemo(() => ['agent', 'plan', 'ask'], []);

  // Build menu sections
  const menuSections: MenuSection[] = useMemo(() => [
    {
      id: 'ai',
      label: 'AI TOOLS',
      items: aiTools.map(tool => ({
        id: tool,
        label: tool === 'agent' ? 'AGENT' : tool === 'plan' ? 'PLAN' : 'ASK',
        icon: createAIIcon(tool),
        colors: AI_COLORS[tool],
      })),
    },
  ], [aiTools]);

  const handleMenuSelect = useCallback((itemId: string, _sectionId: string) => {
    setAiTool(itemId as AITool);
    setMenuOpen(false);
  }, []);

  // Update highlight position
  useEffect(() => {
    const activeIndex = aiTools.indexOf(aiTool);
    const button = buttonRefs.current[activeIndex];
    const container = containerRef.current;

    if (button && container) {
      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setHighlightStyle({
        left: buttonRect.left - containerRect.left,
        width: buttonRect.width,
      });
    }
  }, [aiTool, aiTools]);

  // Tab handling — tap cycles, hold opens menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        if (!menuOpen) {
          tabPressTime.current = Date.now();

          tabHoldTimeout.current = setTimeout(() => {
            setHighlightedIndex(aiTools.indexOf(aiTool));
            setMenuOpen(true);
          }, HOLD_THRESHOLD);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (tabHoldTimeout.current) {
          clearTimeout(tabHoldTimeout.current);
          tabHoldTimeout.current = null;
        }

        if (!menuOpen && tabPressTime.current) {
          const duration = Date.now() - tabPressTime.current;
          if (duration < HOLD_THRESHOLD) {
            // Quick press — cycle through AI tools
            const currentIdx = aiTools.indexOf(aiTool);
            const nextIdx = (currentIdx + 1) % aiTools.length;
            setAiTool(aiTools[nextIdx]);
          }
        }

        if (menuOpen) {
          setAiTool(aiTools[highlightedIndex]);
          setMenuOpen(false);
        }

        tabPressTime.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (tabHoldTimeout.current) {
        clearTimeout(tabHoldTimeout.current);
      }
    };
  }, [aiTool, aiTools, menuOpen, highlightedIndex]);

  const getAIIcon = (tool: AITool, active: boolean, highlighted?: boolean) => {
    switch (tool) {
      case 'agent': return <AgentIcon active={active} highlighted={highlighted} />;
      case 'plan': return <PlanIcon active={active} highlighted={highlighted} />;
      case 'ask': return <AskIcon active={active} highlighted={highlighted} />;
    }
  };

  const getAILabel = (tool: AITool) => {
    switch (tool) {
      case 'agent': return 'AGENT';
      case 'plan': return 'PLAN';
      case 'ask': return 'ASK';
    }
  };

  return (
    <div
      className={`relative shrink-0 flex flex-col ${animateIn ? 'bottom-bar-item animate-in' : 'bottom-bar-item'}`}
      style={{ '--item-index': 0 } as React.CSSProperties}
    >
      {/* AI Menu — shown when Tab is held */}
      <SelectorMenu
        sections={menuSections}
        activeId={aiTool}
        highlightedIndex={highlightedIndex}
        setHighlightedIndex={setHighlightedIndex}
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSelect={handleMenuSelect}
        footer="release TAB to select"
      />

      {/* AI Tools Bar */}
      <div
        ref={containerRef}
        className={`relative flex items-center gap-1 flex-1 ${BG.GLASS_BLUR} border px-2 py-2 transition-all duration-200 cursor-pointer select-none ${TEXT.BASE} ${
          menuOpen ? BORDER.ACCENT_BLUE : BORDER.DEFAULT
        }`}
      >
        {/* Animated highlight background */}
        <div
          className={`absolute top-1 bottom-1 ${BG.ELEVATED} rounded-sm transition-all duration-300 ease-out pointer-events-none`}
          style={{
            left: highlightStyle.left,
            width: highlightStyle.width,
            opacity: highlightStyle.width > 0 ? 1 : 0,
          }}
        />

        {/* Tab hint */}
        <span className={`${TEXT.DIMMED} ${TEXT.BASE} mr-1 relative z-10`}>[TAB]</span>

        {aiTools.map((tool, index) => {
          const isActive = aiTool === tool;
          const colors = AI_COLORS[tool];

          return (
            <button
              key={tool}
              ref={(el) => { buttonRefs.current[index] = el; }}
              onClick={() => setAiTool(tool)}
              className="relative z-10 flex items-center gap-1.5 px-1.5 py-0.5 transition-colors"
            >
              {getAIIcon(tool, isActive)}
              {isActive && (
                <span style={{ color: colors.active }}>{getAILabel(tool)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
