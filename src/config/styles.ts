/**
 * Centralized UI style definitions
 * Combines Tailwind classes with CSS-in-JS patterns for consistency
 */

import { COLORS, TYPOGRAPHY } from './constants';

// =============================================================================
// TEXT STYLES (Tailwind class strings)
// =============================================================================

export const TEXT = {
  // Primary text - bright white, main content
  PRIMARY: 'text-white',
  
  // Secondary text - slightly muted, supporting info
  SECONDARY: 'text-[#888]',
  
  // Muted text - dimmed, less important
  MUTED: 'text-[#555]',
  
  // Dimmed text - very subtle, hints
  DIMMED: 'text-[#444]',
  
  // Dark text - almost invisible, decorative
  DARK: 'text-[#333]',
  
  // Accent colors
  ACCENT: 'text-[#00ff88]',
  ACCENT_ALT: 'text-[#00ddff]',
  ACCENT_BLUE: 'text-[#66aaff]',
  WARNING: 'text-[#ffaa00]',
  ERROR: 'text-[#ff4444]',
  
  // Font sizes
  XS: 'text-[8px]',
  SM: 'text-[9px]',
  BASE: 'text-[10px]',
  MD: 'text-[11px]',
  LG: 'text-[12px]',
  XL: 'text-[14px]',
  
  // Font styles
  MONO: 'font-mono',
  TRACKING: 'tracking-widest',
  TRACKING_WIDE: 'tracking-wider',
} as const;

// =============================================================================
// COMPOSITE TEXT STYLES (common combinations)
// =============================================================================

export const TEXT_STYLE = {
  // Main content text
  BODY: `${TEXT.PRIMARY} ${TEXT.BASE}`,
  BODY_MONO: `${TEXT.PRIMARY} ${TEXT.BASE} ${TEXT.MONO}`,
  
  // Labels and headers
  LABEL: `${TEXT.MUTED} ${TEXT.SM} ${TEXT.TRACKING}`,
  SECTION_LABEL: `${TEXT.DIMMED} ${TEXT.SM} ${TEXT.TRACKING}`,
  
  // Values and data
  VALUE: `${TEXT.PRIMARY} ${TEXT.MONO}`,
  VALUE_ACCENT: `${TEXT.ACCENT} ${TEXT.MONO}`,
  VALUE_SECONDARY: `${TEXT.SECONDARY} ${TEXT.MONO}`,
  
  // Interactive elements
  BUTTON: `${TEXT.PRIMARY} ${TEXT.BASE} ${TEXT.TRACKING}`,
  LINK: `${TEXT.ACCENT_BLUE} ${TEXT.BASE}`,
  
  // Hints and helper text
  HINT: `${TEXT.MUTED} ${TEXT.XS}`,
  FOOTER: `${TEXT.MUTED} ${TEXT.XS}`,
  
  // Status indicators
  STATUS_ACTIVE: `${TEXT.ACCENT} ${TEXT.SM}`,
  STATUS_INACTIVE: `${TEXT.SECONDARY} ${TEXT.SM}`,
  STATUS_ERROR: `${TEXT.ERROR} ${TEXT.SM}`,
} as const;

// =============================================================================
// BACKGROUND STYLES
// =============================================================================

export const BG = {
  DARK: 'bg-black/40 backdrop-blur-md',
  OVERLAY: 'bg-black/40 backdrop-blur-md',
  GLASS: 'bg-black/20 backdrop-blur-md',
  ELEVATED: 'bg-white/5 backdrop-blur-md',
  HOVER: 'bg-white/10 backdrop-blur-md',

  // With backdrop blur
  GLASS_BLUR: 'bg-black/20 backdrop-blur-md',
  OVERLAY_BLUR: 'bg-black/30 backdrop-blur-md',
  PANEL_BLUR: 'bg-black/30 backdrop-blur-md',
} as const;

// =============================================================================
// BORDER STYLES
// =============================================================================

export const BORDER = {
  DEFAULT: 'border-white/10',
  SUBTLE: 'border-white/5',
  FOCUS: 'border-[#00ff88]/30',
  ACCENT: 'border-[#00ff88]/40',
  ACCENT_BLUE: 'border-[#66aaff]/30',

  // Full border
  PANEL: 'border border-white/10',
  PANEL_SUBTLE: 'border border-white/5',

  // Dividers
  DIVIDER: 'border-t border-white/5',
  DIVIDER_B: 'border-b border-white/5',
} as const;

// =============================================================================
// COMPONENT STYLES (full component class strings)
// =============================================================================

export const COMPONENT = {
  // Panels and containers
  PANEL: `${BG.GLASS_BLUR} ${BORDER.PANEL}`,
  PANEL_SOLID: `${BG.PANEL_BLUR} ${BORDER.PANEL}`,
  
  // Info cards
  INFO_CARD: `${BG.GLASS_BLUR} ${BORDER.PANEL} px-4 py-3`,
  
  // Buttons
  BUTTON: `${TEXT.PRIMARY} ${TEXT.BASE} ${TEXT.TRACKING} ${BG.ELEVATED} ${BORDER.PANEL} px-3 py-1.5 transition-all duration-200`,
  BUTTON_HOVER: 'hover:bg-white/10 hover:border-white/20',

  // Input fields
  INPUT: `${BG.DARK} ${TEXT.PRIMARY} ${TEXT.MONO} ${BORDER.PANEL} px-3 py-2 outline-none placeholder:${TEXT.MUTED}`,
  INPUT_FOCUS: 'focus:border-[#00ff88]/30',
  
  // Toast notifications
  TOAST: `${BG.OVERLAY_BLUR} ${BORDER.PANEL} px-4 py-2 ${TEXT.XS} ${TEXT.PRIMARY} ${TEXT.TRACKING}`,
  
  // Status dots
  DOT_ACTIVE: 'w-1.5 h-1.5 rounded-full bg-[#00ff88]',
  DOT_INACTIVE: 'w-1.5 h-1.5 rounded-full bg-[#666]',
} as const;

// =============================================================================
// ANIMATION CLASSES
// =============================================================================

export const ANIMATION = {
  FADE_IN: 'animate-fadeIn',
  FADE_OUT: 'animate-fadeOut',
  SLIDE_UP: 'animate-slideUp',
  SLIDE_DOWN: 'animate-slideDown',
  
  // Transitions
  TRANSITION_FAST: 'transition-all duration-150 ease-out',
  TRANSITION_DEFAULT: 'transition-all duration-300 ease-out',
  TRANSITION_SLOW: 'transition-all duration-500 ease-out',
} as const;

// =============================================================================
// CSS-IN-JS VALUES (for inline styles)
// =============================================================================

export const CSS = {
  colors: COLORS,
  typography: TYPOGRAPHY,
  
  // Common inline style objects
  glowAccent: {
    textShadow: `0 0 8px ${COLORS.UI_ACCENT}`,
  },
  glowAccentStrong: {
    textShadow: `0 0 12px ${COLORS.UI_ACCENT}, 0 0 24px ${COLORS.UI_ACCENT}`,
  },
  glowBlue: {
    textShadow: `0 0 8px ${COLORS.UI_ACCENT_BLUE}`,
  },
  
  // Border radius presets
  borderRadius: {
    sm: '2px',
    md: '4px',
    lg: '8px',
  },
  
  // Spacing presets (in rem)
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  },
} as const;

