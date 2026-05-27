/**
 * Aurora design tokens — Personal OS aesthetic.
 *
 * Direction: deep graphite base with a slight cool cast, hairline strokes,
 * minimal surface tints, restrained amber for user/action and a calm sky
 * for system intelligence. Inspired by Arc, Linear, Raycast, Apple Journal,
 * and visionOS spatial chrome.
 */
export const theme = {
  // ---- Surfaces (graphite with a hint of cool blue) ----
  bg: "#08090C",
  bgElevated: "#0E0F13",
  bgSunken: "#06070A",
  // Glass tints — barely-there panels that feel like floating layers, not boxes
  surface: "rgba(255,255,255,0.028)",
  surfaceStrong: "rgba(255,255,255,0.055)",
  surfaceSoft: "rgba(255,255,255,0.014)",
  // Hairline strokes — Linear-style precision
  border: "rgba(255,255,255,0.055)",
  borderStrong: "rgba(255,255,255,0.09)",
  borderFaint: "rgba(255,255,255,0.03)",

  // ---- Text (Apple Journal hierarchy) ----
  text: "#F4F4F6",
  textMuted: "rgba(244,244,246,0.60)",
  textDim: "rgba(244,244,246,0.36)",
  textFaint: "rgba(244,244,246,0.20)",
  textGhost: "rgba(244,244,246,0.10)",

  // ---- Accents (use sparingly — no more than two per view) ----
  // User / action — warm graphite-amber, never saturated
  amber: "#E5A560",
  amberSoft: "rgba(229,165,96,0.13)",
  amberStroke: "rgba(229,165,96,0.28)",
  peach: "#D08966",
  // AI / system intelligence — quiet sky, Apple Intelligence feel
  ai: "#86B5E2",
  aiSoft: "rgba(134,181,226,0.12)",
  aiStroke: "rgba(134,181,226,0.26)",
  aiGhost: "rgba(134,181,226,0.05)",

  // Legacy secondary accents (compat — used very sparingly)
  lavender: "#9F8AD9",
  rose: "#D27292",
  mint: "#83C6A8",
  sky: "#86B5E2",
  danger: "#D86A6A",

  // ---- Aurora ambient (quiet, spatial — not decorative) ----
  auroraTop: "#0B0C10",
  auroraMid: "#08090C",
  auroraBottom: "#050609",
  auroraGlow: "#15131A",

  // ---- Spatial glow (focus / AI presence — used as low-opacity shadows) ----
  glowAmber: "rgba(229,165,96,0.22)",
  glowAi: "rgba(134,181,226,0.20)",
  glowFocus: "rgba(229,165,96,0.14)",
} as const;

/** Spacing scale — 4pt grid, generous for breathing room */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
  huge: 56,
} as const;

/** Radius scale — soft, Apple Journal */
export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

/**
 * Typography scale — strong hierarchy, Apple Display feel.
 * Use sparingly: one display per screen, headlines lead sections, body for
 * everything else, footnote/caption for metadata. Avoid stacking bold on bold.
 */
export const typography = {
  display: { fontSize: 34, fontWeight: "700" as const, letterSpacing: -0.7, lineHeight: 40 },
  largeTitle: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.5, lineHeight: 34 },
  title: { fontSize: 22, fontWeight: "600" as const, letterSpacing: -0.3, lineHeight: 28 },
  headline: { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.1, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
  callout: { fontSize: 14, fontWeight: "500" as const, lineHeight: 19 },
  footnote: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.1, lineHeight: 16 },
  caption: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6, lineHeight: 14 },
  micro: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 1.2, lineHeight: 13 },
} as const;

/** Motion presets — calm, iOS-native */
export const motion = {
  fast: 180,
  base: 240,
  slow: 380,
  // Ambient timings — used for breathing background / focus glow / AI pulse
  breath: 4200,
  drift: 22000,
  driftSlow: 34000,
} as const;

export type ThemeColor = keyof typeof theme;
