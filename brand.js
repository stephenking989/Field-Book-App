// ═══════════════════════════════════════════════════════════════════════════
//  FIELD BOOK — BRAND
//  The ONE place to change the app's colours and fonts.
//
//  Change a value below, save, bump the version (sw.js CACHE_NAME + APP_VERSION),
//  and the whole app follows: Tailwind fb-* classes, the CSS in index.html,
//  inline styles, the sketch panels, PDF heading colour, and the browser
//  theme colour all read from here.
//
//  Rules:
//   • Values are hex (#RRGGBB). Keep names exactly as they are; code uses them.
//   • To change a font: edit the stack in FONTS and, if it's a new Google Font,
//     add it to GOOGLE_FONTS_URL.
//   • DESIGN.md explains what each colour is FOR. Keep its front matter in sync
//     (the drift check in DESIGN.md compares the two).
//   • Not covered (change by hand): manifest.json theme/background colour and
//     icon.svg, which can't read this file.
// ═══════════════════════════════════════════════════════════════════════════
(function () {

  // ── COLOURS ──────────────────────────────────────────────────────────────
  const COLORS = {
    // Cover — the green notebook cover (app chrome)
    cover:        '#3C5445',  // nav bar, project/home backdrop, selected chips, toasts
    coverDeep:    '#1A3526',  // project cover card
    coverEdge:    '#2D6A4F',  // cover card border
    heading:      '#3C5445',  // green printed labels/headings on paper
    accent:       '#4E7864',  // primary buttons, ON toggles, focus, progress
    accentLight:  '#7AAE94',  // secondary accent, eyebrow text on the cover
    accentPale:   '#D2E8DA',  // selected choice card, pressed menu item

    // Paper
    page:         '#F5F0E3',  // notebook paper — pages, sheets, menus
    pageAlt:      '#EBE5D5',  // cards, header strips, toolbars, secondary buttons
    pageDeep:     '#E0D9C8',  // pressed state
    field:        '#FDFAF4',  // input wells, active tab, DataPage body
    border:       '#CEC5B0',  // every border, rule and divider
    ruleTan:      '#B8A88A',  // ruled-paper lines
    gridBlue:     '#9BBCD0',  // grid-paper lines (used at low opacity)
    marginRed:    '#C84848',  // red margin rule (used at low opacity)

    // Ink
    ink:          '#1A1A1A',  // text and entered data
    inkMuted:     '#5A5248',  // secondary text, labels
    inkFaint:     '#9A908A',  // placeholders, disabled

    // Status
    warn:         '#9A5B00',
    warnPale:     '#FFF6E0',
    warnLine:     '#E0C070',
    error:        '#B83C3C',
    errorPale:    '#F5DDDD',
    errorLine:    '#E6B8AF',
    errorDeep:    '#7F1D1D',
    info:         '#1D6FA0',
  };

  // ── PAGE-TYPE BADGES ─────────────────────────────────────────────────────
  const PAGE_TYPES = {
    data:   { color: '#3C5445', bg: '#D2E8DA' },
    sketch: { color: '#3B82F6', bg: '#EFF6FF' },
    title:  { color: '#D97706', bg: '#FEF3C7' },
    photo:  { color: '#7C3AED', bg: '#EDE9FE' },
    points: { color: '#0E7490', bg: '#E0F2FE' },
    notes:  { color: '#B45309', bg: '#FEF3C7' },
    gnss:   { color: '#BE185D', bg: '#FCE7F3' },
    obstructions: { color: '#4D7C0F', bg: '#ECFCCB' },
    tracker: { color: '#4338CA', bg: '#E0E7FF' },
  };

  // ── SKETCH PANELS (brown drafting-kit palette for the sketch inspector) ──
  const SKETCH_PANEL = {
    bg:      '#F5F0E3',   // panel/toolbar background
    bgAlt:   '#EDE8D8',   // section headers, stripe rows
    bgHov:   '#E4DDD0',   // hover / active row
    border:  '#8B7355',   // dividers and borders
    accent:  '#4A3728',   // active layer bar, highlights
    text:    '#2C1F0E',   // primary text
    muted:   '#7A6550',   // secondary labels
    faint:   '#B8A898',   // inactive icons
    inputBg: '#FFF9F0',   // input backgrounds
  };

  // ── FONTS ────────────────────────────────────────────────────────────────
  const FONTS = {
    ui:     "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",  // app chrome
    print:  "'Oswald', 'Segoe UI', sans-serif",                          // printed labels on paper
    hand:   "'Caveat', 'Patrick Hand', cursive",                         // surveyor's entries
    mono:   "'Share Tech Mono', 'Courier New', monospace",               // numbers, coordinates
    sketch: "Courier New, monospace",                                    // sketch workspace chrome
    // ⚠ sketch text wrapping assumes a monospace font (~0.6 em per character) —
    //   keep `sketch` monospaced or text boxes on sketches will wrap wrong.
  };
  const GOOGLE_FONTS_URL =
    'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Oswald:wght@400;500;600&family=Share+Tech+Mono&display=swap';

  // ═════════════════════════════════════════════════════════════════════════
  //  Plumbing below — no need to edit.
  // ═════════════════════════════════════════════════════════════════════════
  const kebab = s => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  const rgb = hex => {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  };

  // CSS custom properties on <html>: --fb-page, --fb-page-rgb (for alpha), --fb-font-hand …
  const root = document.documentElement.style;
  Object.entries(COLORS).forEach(([k, v]) => {
    root.setProperty('--fb-' + kebab(k), v);
    root.setProperty('--fb-' + kebab(k) + '-rgb', rgb(v).join(' '));
  });
  Object.entries(FONTS).forEach(([k, v]) => root.setProperty('--fb-font-' + k, v));

  // Google Fonts stylesheet
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONTS_URL;
  document.head.appendChild(link);

  // Browser/PWA chrome colour
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS.cover);

  // Tailwind config — fb-* colour classes + font-data / font-heading / font-handwritten
  function tailwindConfig() {
    const fb = {};
    Object.entries(COLORS).forEach(([k, v]) => { fb[kebab(k)] = v; });
    Object.assign(fb, {                       // legacy aliases still used by older markup
      dark: COLORS.cover, mid: COLORS.accent, light: COLORS.accentLight, pale: COLORS.accentPale,
      cream: COLORS.page, cream2: COLORS.pageAlt, text: COLORS.ink, muted: COLORS.inkMuted,
    });
    return { theme: { extend: {
      colors: { fb },
      fontFamily: { data: [FONTS.mono], heading: [FONTS.print], handwritten: [FONTS.hand] },
    } } };
  }

  // rgba string of a brand colour — for JS that needs transparency: fbAlpha('accent', 0.08)
  function alpha(name, a) {
    const v = COLORS[name];
    if (!v) throw new Error('fbAlpha: unknown brand colour "' + name + '"');
    return 'rgba(' + rgb(v).join(',') + ',' + a + ')';
  }

  window.FB_BRAND = Object.freeze({ COLORS, PAGE_TYPES, SKETCH_PANEL, FONTS, GOOGLE_FONTS_URL, tailwindConfig, alpha });
  window.FBC = COLORS;     // short names used throughout index.html / sketch.js
  window.FBF = FONTS;
  window.fbAlpha = alpha;
})();
