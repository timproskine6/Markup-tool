// Fire Sprinkler symbol library. Each symbol is a clean, self-contained SVG
// plus metadata used to build the palette, the legend, and the on-page markup.
//
// This library was expanded from just "Addressable Duct Detector" to a full
// NFPA-170-style starter set, transcribed table-by-table from photos of the
// user's own printed copy of NFPA 170 (Tables 8.2, 8.3 [including its Abort
// Switch / Addressable Module / Automatic, Flame, Gas & Heat Detection /
// Interface & Supervisory / Manual Fire Alarm Box / Smoke Detection
// subsections], 8.4.1-8.4.3, 8.5, 8.6, 9.2, 9.3). Table 8.4.1 is a subscript
// *glossary* (what "C", "H", "RI", etc. mean when appended to a notification
// appliance symbol), not itself a table of symbols, so it wasn't turned into
// palette entries. Tables 9.4 (Water Flow Control Valves & Water Sources) and
// 9.5 (Equipment Rooms) were referenced in the photographed pages but not
// themselves photographed, so they're not in here yet. The CATEGORIES below
// are the *default* grouping (matching the
// standard's own table sections) used the first time the app runs — from
// there, symbolPrefs.js layers user-editable categories, custom category
// assignment per symbol, and favorites/pinning on top, all persisted in
// localStorage. This file only ever describes the base/default library; it
// is never mutated at runtime.
//
// NOTE: every glyph here is a deliberately simplified stand-in (basic
// geometric shape + short text label, colored per category) — NOT a
// pixel-exact reproduction of NFPA's own copyrighted artwork. NFPA 170 is a
// commercial standard; reproducing its exact pictograms wholesale isn't
// something this project does. These are original, simplified glyphs built
// from the textual descriptions and basic shape families (box/hexagon/
// diamond/triangle/etc.) that the standard itself documents as the shape
// convention, sized to be readable at ~28px on an iPad palette button.

const COLORS = {
  initiating: '#d97706', // amber — legacy/custom (pre-existing) symbols
  'control-panels': '#2563eb', // blue
  'suppression-control-units': '#7c3aed', // violet
  'abort-switches': '#b91c1c', // dark red
  'addressable-modules': '#0d9488', // teal
  'automatic-detection': '#b45309', // amber-700
  'flame-detection': '#ea580c', // orange
  'gas-detection': '#111827', // near-black (filled)
  'heat-detection': '#dc2626', // red
  'interface-supervisory': '#475569', // slate
  'manual-fire-alarm-box': '#92400e', // amber-800
  'smoke-detection': '#059669', // emerald
  'notification-appliances': '#c026d3', // fuchsia
  'emergency-communications': '#9333ea', // purple
  'related-equipment': '#0891b2', // cyan
  'access-assessment': '#16a34a', // green
  'detection-extinguishing': '#e11d48', // rose
  'smoke-pressurization-controls': '#0284c7', // sky
};

export const CATEGORIES = [
  { id: 'initiating', label: 'Initiating Devices' },
  { id: 'control-panels', label: 'Control Panels' },
  { id: 'suppression-control-units', label: 'Suppression / Releasing Control Units' },
  { id: 'abort-switches', label: 'Abort Switches' },
  { id: 'addressable-modules', label: 'Addressable Modules' },
  { id: 'automatic-detection', label: 'Automatic Detection' },
  { id: 'flame-detection', label: 'Flame Detectors' },
  { id: 'gas-detection', label: 'Gas Detectors' },
  { id: 'heat-detection', label: 'Heat Detectors' },
  { id: 'interface-supervisory', label: 'Interface & Supervisory Devices' },
  { id: 'manual-fire-alarm-box', label: 'Manual Fire Alarm Box Types' },
  { id: 'smoke-detection', label: 'Smoke Detection / Sensor Types' },
  { id: 'notification-appliances', label: 'Notification Appliances' },
  { id: 'emergency-communications', label: 'Emergency Communications' },
  { id: 'related-equipment', label: 'Related Equipment' },
  { id: 'access-assessment', label: 'Access / Assessment / Ventilation / Utility Shutoffs' },
  { id: 'detection-extinguishing', label: 'Detection / Extinguishing Equipment' },
  { id: 'smoke-pressurization-controls', label: 'Smoke / Pressurization Controls' },
];

function svgWrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${inner}</svg>`;
}

function fitSize(s, cap) {
  const n = (s || '').length;
  let size;
  if (n <= 2) size = 10.5;
  else if (n === 3) size = 9;
  else if (n === 4) size = 7.8;
  else if (n === 5) size = 6.8;
  else size = 5.6;
  return cap ? Math.min(size, cap) : size;
}

function txt(x, y, size, s, color, weight) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" font-weight="${weight || 700}" text-anchor="middle" fill="${color}">${s}</text>`;
}

function twoLine(x, y1, y2, base, mod, color) {
  let out = '';
  if (base) out += txt(x, y1, fitSize(base, 8), base, color);
  if (mod) out += txt(x, y2, Math.min(fitSize(mod, 6.5), 6.5), mod, color, 600);
  return out;
}

// ---- shape builders -----------------------------------------------------
// Every builder returns 32x32-viewBox inner markup: an outline/fill shape,
// plus a `base` label (and optional smaller `mod` sub-label) centered in it.
// No <defs>/id/url() anywhere — palette.js and legend.js inline this SVG
// markup directly into the live DOM (not via <img>), and the same symbol can
// appear more than once on screen at once, so ids would collide.

function boxIcon(color, base, mod) {
  const rect = `<rect x="3.5" y="10" width="25" height="12" rx="1.5" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  if (!base) return rect;
  if (mod) return rect + twoLine(16, 15.3, 20.8, base, mod, color);
  return rect + txt(16, 17.5, fitSize(base), base, color);
}

function hatchBoxIcon(color) {
  return (
    `<rect x="3.5" y="10" width="25" height="12" rx="1.5" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<g stroke="${color}" stroke-width="1">` +
    `<line x1="4" y1="18" x2="12" y2="10"/>` +
    `<line x1="4" y1="22" x2="17" y2="10"/>` +
    `<line x1="9.5" y1="22" x2="22" y2="10"/>` +
    `<line x1="15" y1="22" x2="27" y2="11"/>` +
    `<line x1="20.5" y1="22" x2="28.5" y2="14.5"/>` +
    `</g>`
  );
}

function hexVIcon(color, base, mod) {
  const hex = `<polygon points="16,6 24,11 24,21 16,26 8,21 8,11" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (!base) return hex;
  if (mod) return hex + twoLine(16, 15.3, 20.8, base, mod, color);
  return hex + txt(16, 17.5, fitSize(base), base, color);
}

function hexArrowIcon(color) {
  return (
    `<polygon points="14,6 22,11 22,21 14,26 6,21 6,11" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<line x1="22" y1="16" x2="29" y2="16" stroke="${color}" stroke-width="1.6"/>` +
    `<polygon points="29,16 25.5,14 25.5,18" fill="${color}"/>` +
    txt(14, 19, 8, 'H', color)
  );
}

function hexHIcon(color, base, mod) {
  const hex = `<polygon points="3,16 8,8 24,8 29,16 24,24 8,24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (!base) return hex;
  if (mod) return hex + twoLine(16, 15.3, 20.8, base, mod, color);
  return hex + txt(16, 17.5, fitSize(base), base, color);
}

function hexPeakIcon(color, base) {
  const hex = `<polygon points="16,3 19,8 24,11 24,21 16,26 8,21 8,11 13,8" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (!base) return hex;
  return hex + txt(16, 19, fitSize(base, 7.5), base, color);
}

function pentagonIcon(color, base) {
  const pent = `<polygon points="16,3 27,11 23,27 9,27 5,11" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (!base) return pent;
  return pent + txt(16, 19, fitSize(base, 7), base, '#fff');
}

function triUpIcon(color, base) {
  const tri = `<polygon points="16,5 28,27 4,27" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (!base) return tri;
  return tri + txt(16, 23, fitSize(base, 7.5), base, color);
}

function diamondIcon(color, base) {
  const dia = `<polygon points="16,3 29,16 16,29 3,16" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  if (!base) return dia;
  return dia + txt(16, 19, fitSize(base, 8), base, color);
}

function abortIcon(color, base) {
  const shape =
    `<path d="M12 8h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<path d="M12 8q-3-5-8-4" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`;
  if (!base) return shape;
  return shape + txt(16, 20.5, fitSize(base, 7.5), base, color);
}

// ---- notification-appliance / emergency-communications family ----------

function bellIcon(color, base, mod) {
  return (
    `<circle cx="16" cy="8.5" r="2.4" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<rect x="10" y="12" width="12" height="10" rx="1" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    (base ? txt(16, 19.3, 8, base, color) : '') +
    (mod ? txt(16, 28, 6.2, mod, color, 600) : '')
  );
}

function hornIcon(color, base, mod) {
  return (
    `<polygon points="12,5 20,5 16,10" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<rect x="10" y="12" width="12" height="10" rx="1" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    (base ? txt(16, 19.3, 8, base, color) : '') +
    (mod ? txt(16, 28, 6.2, mod, color, 600) : '')
  );
}

function burstIcon(color, letter, mod) {
  const ticks =
    `<g stroke="${color}" stroke-width="1.3">` +
    `<line x1="16" y1="5.5" x2="16" y2="7.5"/>` +
    `<line x1="16" y1="18.5" x2="16" y2="20.5"/>` +
    `<line x1="8.5" y1="13" x2="10.5" y2="13"/>` +
    `<line x1="21.5" y1="13" x2="23.5" y2="13"/>` +
    `<line x1="10.7" y1="7.7" x2="12.1" y2="9.1"/>` +
    `<line x1="19.9" y1="16.9" x2="21.3" y2="18.3"/>` +
    `<line x1="21.3" y1="7.7" x2="19.9" y2="9.1"/>` +
    `<line x1="12.1" y1="16.9" x2="10.7" y2="18.3"/>` +
    `</g>`;
  return (
    `<circle cx="16" cy="13" r="5.5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    ticks +
    (letter ? txt(16, 15.5, 7, letter, color) : '') +
    (mod ? txt(16, 29, 6.2, mod, color, 600) : '')
  );
}

function comboIcon(color, letter, mod) {
  const ticks =
    `<g stroke="${color}" stroke-width="1.2">` +
    `<line x1="16" y1="11.2" x2="16" y2="12.7"/>` +
    `<line x1="16" y1="23.3" x2="16" y2="24.8"/>` +
    `<line x1="9.7" y1="18" x2="11.2" y2="18"/>` +
    `<line x1="20.8" y1="18" x2="22.3" y2="18"/>` +
    `<line x1="11.4" y1="13.4" x2="12.4" y2="14.4"/>` +
    `<line x1="19.6" y1="21.6" x2="20.6" y2="22.6"/>` +
    `<line x1="20.6" y1="13.4" x2="19.6" y2="14.4"/>` +
    `<line x1="12.4" y1="21.6" x2="11.4" y2="22.6"/>` +
    `</g>`;
  return (
    `<polygon points="12,3 20,3 16,7.5" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="16" cy="18" r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    ticks +
    (letter ? txt(16, 20, 6.5, letter, color) : '') +
    (mod ? txt(16, 30.5, 6, mod, color, 600) : '')
  );
}

function switchXIcon(color, mod) {
  return (
    `<rect x="6" y="6" width="20" height="20" rx="1.5" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<line x1="8" y1="8" x2="24" y2="24" stroke="${color}" stroke-width="1.4"/>` +
    `<line x1="24" y1="8" x2="8" y2="24" stroke="${color}" stroke-width="1.4"/>` +
    (mod ? txt(16, 30.5, 6.5, mod, color) : '')
  );
}

function beaconIcon(color) {
  return (
    `<circle cx="16" cy="16" r="7" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<path d="M9 10 Q4 16 9 22" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<path d="M23 10 Q28 16 23 22" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`
  );
}

function textualVisibleIcon(color) {
  return (
    `<rect x="4" y="12" width="14" height="9" rx="1" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<polygon points="20,10 29,16 20,22" fill="${color}"/>` +
    txt(11, 19, 7, 'ET', color)
  );
}

function pipingDotIcon(color) {
  return (
    `<line x1="4" y1="16" x2="28" y2="16" stroke="${color}" stroke-width="1.8"/>` +
    `<circle cx="16" cy="16" r="2.6" fill="${color}"/>`
  );
}

function resistorZigzagIcon(color) {
  return `<polyline points="3,16 8,16 11,9 15,23 19,9 23,23 26,16 29,16" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function valveIcon(color, supervised) {
  return (
    `<circle cx="16" cy="13" r="7" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<polygon points="11,10 11,16 16,13" fill="${color}"/>` +
    `<polygon points="21,10 21,16 16,13" fill="${color}"/>` +
    (supervised
      ? `<line x1="9" y1="21" x2="23" y2="21" stroke="${color}" stroke-width="1.4"/><line x1="9" y1="24" x2="23" y2="24" stroke="${color}" stroke-width="1.4"/>`
      : '') +
    txt(16, 30.5, 6.5, 'SOV', color)
  );
}

function transferAutoIcon(color) {
  return (
    `<polygon points="16,6 24,11 24,21 16,26 8,21 8,11" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<line x1="16" y1="11" x2="20" y2="8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` +
    txt(16, 30.5, 6.5, 'ATS', color)
  );
}

function transferManualIcon(color) {
  return (
    `<rect x="8" y="8" width="16" height="14" rx="1.5" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<line x1="16" y1="8" x2="20" y2="4" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    txt(16, 30.5, 6.5, 'MTS', color)
  );
}

function valveSupervisoryIntegralIcon(color) {
  return (
    `<rect x="9" y="4" width="14" height="8" rx="1" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    txt(16, 10, 6.5, 'VS', color) +
    `<rect x="6" y="14" width="20" height="14" rx="1.5" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<line x1="8" y1="16" x2="24" y2="26" stroke="${color}" stroke-width="1.3"/>` +
    `<line x1="24" y1="16" x2="8" y2="26" stroke="${color}" stroke-width="1.3"/>`
  );
}

// ---- smoke detection family (extra bespoke pictograms) -----------------

function smokeHeatCoIcon(color) {
  return (
    hexVIcon(color, 'S/H') +
    `<polygon points="24,20 30,26 18,26" fill="#111827"/>` +
    txt(24, 25, 5, 'CO', '#fff', 700)
  );
}

function smokeDuctIcon(color) {
  return hexVIcon(color, 'S') + `<line x1="16" y1="6" x2="16" y2="2" stroke="${color}" stroke-width="1.4" stroke-dasharray="1.5,1.5"/>`;
}

function smokeDclComboIcon(color) {
  return (
    `<polygon points="11,8 16,11 16,19 11,22 6,19 6,11" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>` +
    txt(11, 17, 7, 'S', color) +
    `<rect x="17" y="11" width="12" height="10" rx="1" fill="none" stroke="${color}" stroke-width="1.4"/>` +
    txt(23, 17.5, 6, 'DCL', color)
  );
}

// ---- Table 8.6 — Smoke/Pressurization Controls (schematic-style) -------
// These read closer to HVAC line-diagram symbols than the badge-style
// shapes elsewhere in this file, so they get bespoke line-art instead of
// the shared shape+label template -- still a simplified stand-in, not a
// reproduction of NFPA's own artwork.

function ductLines(color) {
  return `<line x1="4" y1="8" x2="28" y2="8" stroke="${color}" stroke-width="1.6"/><line x1="4" y1="12" x2="28" y2="12" stroke="${color}" stroke-width="1.6"/>`;
}

function damperBarometricIcon(color) {
  return (
    `<line x1="4" y1="10" x2="28" y2="10" stroke="${color}" stroke-width="1.6"/>` +
    `<line x1="9" y1="6" x2="18" y2="26" stroke="${color}" stroke-width="1.6"/>` +
    `<line x1="14" y1="6" x2="23" y2="26" stroke="${color}" stroke-width="1.6"/>`
  );
}

function damperFireIcon(color) {
  return ductLines(color) + `<circle cx="16" cy="19" r="2.4" fill="${color}"/>`;
}

function damperFireSmokeIcon(color) {
  return (
    ductLines(color) +
    `<circle cx="16" cy="17" r="2" fill="${color}"/>` +
    `<circle cx="16" cy="24" r="3.6" fill="none" stroke="${color}" stroke-width="1.3"/>` +
    txt(16, 26.3, 6, 'S', color)
  );
}

function damperMotorizedIcon(color) {
  return (
    ductLines(color) +
    `<circle cx="13" cy="17" r="1.8" fill="${color}"/>` +
    `<circle cx="13" cy="24" r="3.2" fill="none" stroke="${color}" stroke-width="1.3"/>` +
    txt(13, 26.1, 5.5, 'S', color) +
    txt(23, 25, 7, 'M', color, 700)
  );
}

function damperSmokeIcon(color) {
  return ductLines(color) + `<circle cx="16" cy="21" r="3.8" fill="none" stroke="${color}" stroke-width="1.4"/>` + txt(16, 23.5, 6.5, 'S', color);
}

function pinwheelIcon(color, cx, cy, r) {
  const blade = (deg) => {
    const rad = (deg * Math.PI) / 180;
    const tipX = (cx + r * Math.cos(rad)).toFixed(1);
    const tipY = (cy + r * Math.sin(rad)).toFixed(1);
    const rad2 = rad + 2.1;
    const bx = (cx + r * 0.4 * Math.cos(rad2)).toFixed(1);
    const by = (cy + r * 0.4 * Math.sin(rad2)).toFixed(1);
    return `<polygon points="${cx},${cy} ${bx},${by} ${tipX},${tipY}" fill="${color}"/>`;
  };
  return `<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="${color}" stroke-width="1.4"/>` + blade(270) + blade(30) + blade(150);
}

function fanGeneralIcon(color) {
  return pinwheelIcon(color, 16, 17, 6);
}

function fanDuctIcon(color) {
  return ductLines(color) + pinwheelIcon(color, 16, 20, 5);
}

function fanRoofIcon(color) {
  return pinwheelIcon(color, 16, 18, 5.5) + `<path d="M9 10 Q16 4 23 10" fill="none" stroke="${color}" stroke-width="1.4"/>`;
}

function fanWallIcon(color) {
  return `<line x1="2" y1="17" x2="9" y2="17" stroke="${color}" stroke-width="1.6"/>` + pinwheelIcon(color, 17, 17, 6);
}

function toggleBoxIcon(color, label) {
  return (
    `<rect x="5" y="9" width="22" height="14" rx="1.5" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<circle cx="11" cy="16" r="1.8" fill="${color}"/>` +
    `<line x1="11" y1="16" x2="17" y2="11" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
    txt(21, 18.5, 6.5, label, color, 700)
  );
}

function stairwellIcon(color) {
  return (
    `<rect x="8" y="6" width="16" height="20" rx="1" fill="none" stroke="${color}" stroke-width="1.6"/>` +
    `<line x1="11" y1="6" x2="11" y2="26" stroke="${color}" stroke-width="1"/>` +
    `<line x1="14.5" y1="6" x2="14.5" y2="26" stroke="${color}" stroke-width="1"/>` +
    `<line x1="18" y1="6" x2="18" y2="26" stroke="${color}" stroke-width="1"/>` +
    `<line x1="21.5" y1="6" x2="21.5" y2="26" stroke="${color}" stroke-width="1"/>`
  );
}

function ventOpeningIcon(color) {
  return (
    `<line x1="4" y1="16" x2="28" y2="16" stroke="${color}" stroke-width="1.6"/>` +
    `<line x1="16" y1="26" x2="16" y2="8" stroke="${color}" stroke-width="1.6"/>` +
    `<polygon points="16,4 12.5,10 19.5,10" fill="${color}"/>`
  );
}

function E(id, name, category, abbr, inner) {
  return { id, name, category, abbr, svg: svgWrap(inner) };
}

const cpColor = COLORS['control-panels'];
const suColor = COLORS['suppression-control-units'];
const asColor = COLORS['abort-switches'];
const amColor = COLORS['addressable-modules'];
const adColor = COLORS['automatic-detection'];
const fdColor = COLORS['flame-detection'];
const gdColor = COLORS['gas-detection'];
const hdColor = COLORS['heat-detection'];
const isColor = COLORS['interface-supervisory'];
const mbColor = COLORS['manual-fire-alarm-box'];
const sdColor = COLORS['smoke-detection'];
const naColor = COLORS['notification-appliances'];
const ecColor = COLORS['emergency-communications'];
const reColor = COLORS['related-equipment'];
const aaColor = COLORS['access-assessment'];
const deColor = COLORS['detection-extinguishing'];
const spcColor = COLORS['smoke-pressurization-controls'];

export const SYMBOLS = [
  // ---- legacy / pre-existing ---------------------------------------------
  {
    id: 'addressable-duct-detector',
    name: 'Addressable Duct Detector',
    category: 'initiating',
    abbr: 'A.D.D',
    svg: svgWrap(`
      <polygon points="16,10 23,14 23,22 16,26 9,22 9,14" fill="none" stroke="${COLORS.initiating}" stroke-width="2" stroke-linejoin="round"/>
      <text x="16" y="21.5" font-size="9" font-family="sans-serif" font-weight="600" text-anchor="middle" fill="${COLORS.initiating}">S</text>
      <line x1="16" y1="10" x2="12" y2="4" stroke="${COLORS.initiating}" stroke-width="1.5"/>
      <line x1="12" y1="4" x2="16" y2="4" stroke="${COLORS.initiating}" stroke-width="1.5"/>
      <text x="29" y="20" font-size="8" font-family="sans-serif" font-weight="600" text-anchor="middle" fill="${COLORS.initiating}">R</text>
    `),
  },

  // ---- Table 8.2 — Control Panels ---------------------------------------
  E('cp-basic', 'Basic shape', 'control-panels', '', boxIcon(cpColor, '')),
  E('cp-amp', 'Amplifier rack', 'control-panels', 'AMP', boxIcon(cpColor, 'AMP')),
  E('cp-arcm', 'Area of refuge emergency communication system — master unit', 'control-panels', 'ARCM', boxIcon(cpColor, 'ARCM')),
  E('cp-arcr', 'Area of refuge emergency communication system — remote unit', 'control-panels', 'ARCR', boxIcon(cpColor, 'ARCR')),
  E('cp-acu', 'Autonomous control unit', 'control-panels', 'ACU', boxIcon(cpColor, 'ACU')),
  E('cp-batt', 'Battery cabinet', 'control-panels', 'BATT', boxIcon(cpColor, 'BATT')),
  E('cp-crt', 'Cathode ray tube', 'control-panels', 'CRT', boxIcon(cpColor, 'CRT')),
  E('cp-hvac', 'Control panel for heating (H), ventilation (V), air conditioning (AC), exhaust (E), stairwell pressurization (P)', 'control-panels', 'HVAC', boxIcon(cpColor, 'HVAC')),
  E('cp-dacr', 'Digital alarm communicator receiver', 'control-panels', 'DACR', boxIcon(cpColor, 'DACR')),
  E('cp-dact', 'Digital alarm communicator transmitter', 'control-panels', 'DACT', boxIcon(cpColor, 'DACT')),
  E('cp-esr', 'Elevator status/recall', 'control-panels', 'ESR', boxIcon(cpColor, 'ESR')),
  E('cp-eccu', 'Emergency communications control unit', 'control-panels', 'ECCU', boxIcon(cpColor, 'ECCU')),
  E('cp-faa', 'Fire alarm annunciator', 'control-panels', 'FAA', boxIcon(cpColor, 'FAA')),
  E('cp-fac', 'Fire alarm communicator', 'control-panels', 'FAC', boxIcon(cpColor, 'FAC')),
  E('cp-facp', 'Fire alarm control panel (legacy symbol for FACU)', 'control-panels', 'FACP', boxIcon(cpColor, 'FACP')),
  E('cp-facu', "Fire alarm control unit; include a 'D' subscript if it is a dedicated unit", 'control-panels', 'FACU', boxIcon(cpColor, 'FACU')),
  E('cp-fatc', 'Fire alarm terminal cabinet', 'control-panels', 'FATC', boxIcon(cpColor, 'FATC')),
  E('cp-tpr', 'Fire alarm transponder (n = transponder number)', 'control-panels', 'TPR/n', boxIcon(cpColor, 'TPR', 'n')),
  E('cp-ffi', 'Fire fighter interface', 'control-panels', 'FFI', boxIcon(cpColor, 'FFI')),
  E('cp-fscp', 'Fire suppression control panel (legacy symbol for FSCU); xx denotes suppression type', 'control-panels', 'FSCP/xx', boxIcon(cpColor, 'FSCP', 'xx')),
  E('cp-fscu', 'Fire suppression control unit; xx denotes suppression type', 'control-panels', 'FSCU/xx', boxIcon(cpColor, 'FSCU', 'xx')),
  E('cp-gap', 'Graphic annunciator panel', 'control-panels', 'GAP', boxIcon(cpColor, 'GAP')),
  E('cp-lcd', 'LCD annunciator/display', 'control-panels', 'LCD', boxIcon(cpColor, 'LCD')),
  E('cp-mfacu', 'Master fire alarm control unit', 'control-panels', 'MFACU', boxIcon(cpColor, 'MFACU')),
  E('cp-nac', 'Notification circuit power booster, extender panel (n = unit number)', 'control-panels', 'NAC/n', boxIcon(cpColor, 'NAC', 'n')),
  E('cp-power-panel', 'Power panel', 'control-panels', '', hatchBoxIcon(cpColor)),
  E('cp-pre', 'Pre-action system/control unit', 'control-panels', 'PRE', boxIcon(cpColor, 'PRE')),
  E('cp-prn', 'Printer', 'control-panels', 'PRN', boxIcon(cpColor, 'PRN')),
  E('cp-ppcu', 'Protected premises control unit (local)', 'control-panels', 'PPCU', boxIcon(cpColor, 'PPCU')),
  E('cp-pp', 'Purge panel', 'control-panels', 'PP', boxIcon(cpColor, 'PP')),
  E('cp-rp', 'Relay panel', 'control-panels', 'RP', boxIcon(cpColor, 'RP')),
  E('cp-rsfacu', 'Releasing service fire alarm control unit', 'control-panels', 'RSFACU', boxIcon(cpColor, 'RSFACU')),
  E('cp-evac', 'Voice evacuation control unit', 'control-panels', 'EVAC', boxIcon(cpColor, 'EVAC')),
  E('cp-wcu', 'Wireless control unit', 'control-panels', 'WCU', boxIcon(cpColor, 'WCU')),
  E('cp-mic', 'Remote voice evacuation microphone', 'control-panels', 'MIC', boxIcon(cpColor, 'MIC')),
  E('cp-evacn', 'Remotely located evacuation amplifier cabinet (n = unit number)', 'control-panels', 'EVAC/n', boxIcon(cpColor, 'EVAC', 'n')),
  E('cp-sap', 'Sprinkler alarm panel', 'control-panels', 'SAP', boxIcon(cpColor, 'SAP')),
  E('cp-ups', 'Uninterruptible power supply', 'control-panels', 'UPS', boxIcon(cpColor, 'UPS')),

  // ---- Table 8.2 — Fire Suppression/Releasing Service Control Unit Types --
  E('su-aerosol', 'Aerosol', 'suppression-control-units', 'RSFACU/A', boxIcon(suColor, 'RSFACU', 'A')),
  E('su-co2', 'Carbon dioxide', 'suppression-control-units', 'RSFACU/CO2', boxIcon(suColor, 'RSFACU', 'CO2')),
  E('su-ca', 'Clean agent', 'suppression-control-units', 'RSFACU/CA', boxIcon(suColor, 'RSFACU', 'CA')),
  E('su-deluge', 'Deluge fire sprinkler', 'suppression-control-units', 'RSFACU/DL', boxIcon(suColor, 'RSFACU', 'DL')),
  E('su-dc', 'Dry chemical', 'suppression-control-units', 'RSFACU/DC', boxIcon(suColor, 'RSFACU', 'DC')),
  E('su-faci', 'Fire alarm control interface', 'suppression-control-units', 'FACI', boxIcon(suColor, 'FACI')),
  E('su-fpc', 'Fire pump controller', 'suppression-control-units', 'FPC', boxIcon(suColor, 'FPC')),
  E('su-fo', 'Foam', 'suppression-control-units', 'RSFACU/FO', boxIcon(suColor, 'RSFACU', 'FO')),
  E('su-hl', 'Halon', 'suppression-control-units', 'RSFACU/HL', boxIcon(suColor, 'RSFACU', 'HL')),
  E('su-mns', 'Mass notification system interface', 'suppression-control-units', 'MNS', boxIcon(suColor, 'MNS')),
  E('su-ocu', 'Operating control unit', 'suppression-control-units', 'OCU', boxIcon(suColor, 'OCU')),
  E('su-wm', 'Water mist', 'suppression-control-units', 'RSFACU/WM', boxIcon(suColor, 'RSFACU', 'WM')),
  E('su-wc', 'Wet chemical', 'suppression-control-units', 'RSFACU/WC', boxIcon(suColor, 'RSFACU', 'WC')),

  // ---- Table 8.3 — Abort Switch Types -------------------------------------
  E('as-basic', 'Abort switch — basic shape', 'abort-switches', '', abortIcon(asColor, '')),
  E('as-a', 'Abort switch', 'abort-switches', 'A', abortIcon(asColor, 'A')),
  E('as-ar', 'Aerosol release abort station', 'abort-switches', 'AR', abortIcon(asColor, 'AR')),
  E('as-ca', 'Clean agent', 'abort-switches', 'CA', abortIcon(asColor, 'CA')),
  E('as-dl', 'Deluge fire sprinkler', 'abort-switches', 'DL', abortIcon(asColor, 'DL')),
  E('as-dc', 'Dry chemical', 'abort-switches', 'DC', abortIcon(asColor, 'DC')),
  E('as-fo', 'Foam', 'abort-switches', 'FO', abortIcon(asColor, 'FO')),
  E('as-hl', 'Halon', 'abort-switches', 'HL', abortIcon(asColor, 'HL')),
  E('as-m', 'Manual releasing station', 'abort-switches', 'M', abortIcon(asColor, 'M')),
  E('as-pre', 'Preaction', 'abort-switches', 'PRE', abortIcon(asColor, 'PRE')),
  E('as-wm', 'Water mist', 'abort-switches', 'WM', abortIcon(asColor, 'WM')),
  E('as-wc', 'Wet chemical', 'abort-switches', 'WC', abortIcon(asColor, 'WC')),

  // ---- Table 8.3 — Manual Fire Alarm Box Types ----------------------------
  E('mb-basic', 'Manual station — basic shape', 'manual-fire-alarm-box', '', boxIcon(mbColor, '')),
  E('mb-aerosol', 'Aerosol', 'manual-fire-alarm-box', 'A', boxIcon(mbColor, 'A')),
  E('mb-co2', 'Carbon dioxide', 'manual-fire-alarm-box', 'CO2', boxIcon(mbColor, 'CO2')),
  E('mb-ca', 'Clean agent', 'manual-fire-alarm-box', 'CA', boxIcon(mbColor, 'CA')),
  E('mb-deluge', 'Deluge fire sprinkler', 'manual-fire-alarm-box', 'DL', boxIcon(mbColor, 'DL')),
  E('mb-dk', 'Drill key', 'manual-fire-alarm-box', 'DK', boxIcon(mbColor, 'DK')),
  E('mb-dc', 'Dry chemical', 'manual-fire-alarm-box', 'DC', boxIcon(mbColor, 'DC')),
  E('mb-master', 'Fire alarm master box', 'manual-fire-alarm-box', 'MB', boxIcon(mbColor, 'MB')),
  E('mb-fo', 'Foam', 'manual-fire-alarm-box', 'FO', boxIcon(mbColor, 'FO')),
  E('mb-hl', 'Halon', 'manual-fire-alarm-box', 'HL', boxIcon(mbColor, 'HL')),
  E('mb-pre', 'Preaction', 'manual-fire-alarm-box', 'PRE', boxIcon(mbColor, 'PRE')),
  E('mb-pull', 'Pull station/fire alarm box', 'manual-fire-alarm-box', 'F', boxIcon(mbColor, 'F')),
  E('mb-wm', 'Water mist', 'manual-fire-alarm-box', 'WM', boxIcon(mbColor, 'WM')),
  E('mb-wc', 'Wet chemical', 'manual-fire-alarm-box', 'WC', boxIcon(mbColor, 'WC')),

  // ---- Table 8.3 — Addressable Modules ------------------------------------
  E('am-aim', 'Addressable input monitor module', 'addressable-modules', 'AIM', hexHIcon(amColor, 'AIM')),
  E('am-aio', 'Addressable input/output module (# denotes number of inputs and outputs)', 'addressable-modules', 'AIO/#', hexHIcon(amColor, 'AIO', '#')),
  E('am-aom', 'Addressable output control module', 'addressable-modules', 'AOM', hexHIcon(amColor, 'AOM')),
  E('am-im', 'Isolation module', 'addressable-modules', 'IM', hexHIcon(amColor, 'IM')),

  // ---- Table 8.3 — Automatic Detection Type -------------------------------
  E('ad-basic', 'Automatic detection and supervisory devices — basic shape', 'automatic-detection', '', hexVIcon(adColor, '')),
  E('ad-water', 'Water detector', 'automatic-detection', 'W', hexVIcon(adColor, 'W')),

  // ---- Table 8.3 — Flame Detection Types ----------------------------------
  E('fd-basic', 'Flame detector basic shape (XX = detection type)', 'flame-detection', 'XX', hexPeakIcon(fdColor, 'XX')),
  E('fd-uvir', 'Combination ultraviolet/infrared', 'flame-detection', 'UV/IR', hexPeakIcon(fdColor, 'UV/IR')),
  E('fd-ir', 'Infrared detector', 'flame-detection', 'IR', hexPeakIcon(fdColor, 'IR')),
  E('fd-uv', 'Ultraviolet detector', 'flame-detection', 'UV', hexPeakIcon(fdColor, 'UV')),
  E('fd-vr', 'Visible radiation detector', 'flame-detection', 'VR', hexPeakIcon(fdColor, 'VR')),

  // ---- Table 8.3 — Gas Detection Types ------------------------------------
  E('gd-basic', 'Gas detector/sensor basic shape (XX = gas type)', 'gas-detection', 'XX', pentagonIcon(gdColor, 'XX')),
  E('gd-co2', 'Carbon dioxide detector', 'gas-detection', 'CO2', pentagonIcon(gdColor, 'CO2')),
  E('gd-co', 'Carbon monoxide detector', 'gas-detection', 'CO', pentagonIcon(gdColor, 'CO')),
  E('gd-hcl', 'Hydrogen chloride detector', 'gas-detection', 'HCL', pentagonIcon(gdColor, 'HCL')),
  E('gd-ch4', 'Methane detector', 'gas-detection', 'CH4', pentagonIcon(gdColor, 'CH4')),

  // ---- Table 8.3 — Heat Detection Types -----------------------------------
  E('hd-basic', 'Heat detector/sensor — XX = type basic shape', 'heat-detection', 'XX', hexVIcon(hdColor, 'XX')),
  E('hd-rf', 'Combination rate of rise/fixed temperature', 'heat-detection', 'R/F', hexVIcon(hdColor, 'R/F')),
  E('hd-f', 'Fixed temperature', 'heat-detection', 'F', hexVIcon(hdColor, 'F')),
  E('hd-line', 'Heat detector — line type', 'heat-detection', 'H', hexArrowIcon(hdColor)),
  E('hd-thermal', 'Heat detector/sensor (thermal detection)', 'heat-detection', 'H', hexVIcon(hdColor, 'H')),
  E('hd-rc', 'Rate compensation', 'heat-detection', 'R/C', hexVIcon(hdColor, 'R/C')),
  E('hd-r', 'Rate of rise only', 'heat-detection', 'R', hexVIcon(hdColor, 'R')),

  // ---- Table 8.3 — Smoke Detection/Sensor Types ---------------------------
  E('sd-basic', 'Smoke detector/sensor — basic shape (orientation not to be changed)', 'smoke-detection', 'S', hexVIcon(sdColor, 'S')),
  E('sd-as', 'Air sampling', 'smoke-detection', 'S/AS', hexVIcon(sdColor, 'S', 'AS')),
  E('sd-id', 'In duct', 'smoke-detection', 'S/ID', hexVIcon(sdColor, 'S', 'ID')),
  E('sd-ion', 'Ionization', 'smoke-detection', 'S/I', hexVIcon(sdColor, 'S', 'I')),
  E('sd-photo', 'Photoelectric', 'smoke-detection', 'S/P', hexVIcon(sdColor, 'S', 'P')),
  E('sd-relay', 'Relay base', 'smoke-detection', 'S/R', hexVIcon(sdColor, 'S', 'R')),
  E('sd-combo-co', 'Smoke/heat detector/carbon monoxide detector', 'smoke-detection', 'S/H/CO', smokeHeatCoIcon(sdColor)),
  E('sd-combo-sh', 'Smoke/heat detector/sensor combination', 'smoke-detection', 'S/H/R', hexVIcon(sdColor, 'S/H', 'R')),
  E('sd-single-station', 'Smoke alarm (single station)', 'smoke-detection', 'SS', hexVIcon(sdColor, 'SS')),
  E('sd-beam-r', 'Smoke detector/sensor — beam receiver', 'smoke-detection', 'S/BR', hexVIcon(sdColor, 'S', 'BR')),
  E('sd-beam-t', 'Smoke detector/sensor — beam transmitter', 'smoke-detection', 'S/BT', hexVIcon(sdColor, 'S', 'BT')),
  E('sd-type', 'Smoke detector/sensor — XX = type', 'smoke-detection', 'S/XX', hexVIcon(sdColor, 'S', 'XX')),
  E('sd-duct', 'Smoke detector/sensor for duct', 'smoke-detection', 'S', smokeDuctIcon(sdColor)),
  E('sd-sounder-base', 'Sounder base', 'smoke-detection', 'S/SB', hexVIcon(sdColor, 'S', 'SB')),

  // ---- Table 8.3 — Interface and Supervisory Devices ----------------------
  E('is-eol-c', 'End of line device — capacitor', 'interface-supervisory', 'EOL/C', boxIcon(isColor, 'EOL', 'C')),
  E('is-eol-d', 'End of line device — diode', 'interface-supervisory', 'EOL/D', boxIcon(isColor, 'EOL', 'D')),
  E('is-eol-ri', 'End of line device — relay', 'interface-supervisory', 'EOL/RI', boxIcon(isColor, 'EOL', 'RI')),
  E('is-eol-re', 'End of line device — resistor', 'interface-supervisory', 'EOL/Re', boxIcon(isColor, 'EOL', 'Re')),
  E('is-wf', 'Flow detector/switch', 'interface-supervisory', 'WF', boxIcon(isColor, 'WF')),
  E('is-ht', 'High temperature switch', 'interface-supervisory', 'HT', boxIcon(isColor, 'HT')),
  E('is-ls', 'Level detector/switch', 'interface-supervisory', 'LS', boxIcon(isColor, 'LS')),
  E('is-lt', 'Low temperature switch', 'interface-supervisory', 'LT', boxIcon(isColor, 'LT')),
  E('is-mr', 'Main/reserve', 'interface-supervisory', 'MR', boxIcon(isColor, 'MR')),
  E('is-md', 'Maintenance/disconnect switch', 'interface-supervisory', 'MD', boxIcon(isColor, 'MD')),
  E('is-rl', 'Non-addressable output relay', 'interface-supervisory', 'RL', boxIcon(isColor, 'RL')),
  E('is-ps', 'Pressure detector/switch', 'interface-supervisory', 'PS', boxIcon(isColor, 'PS')),
  E('is-sov', 'Solenoid valve', 'interface-supervisory', 'SOV', valveIcon(isColor, false)),
  E('is-sov-sup', 'Supervised solenoid valve', 'interface-supervisory', 'SOV', valveIcon(isColor, true)),
  E('is-ss', 'Surge suppressor', 'interface-supervisory', 'SS', boxIcon(isColor, 'SS')),
  E('is-tss', 'Temperature supervisory switch', 'interface-supervisory', 'TSS', boxIcon(isColor, 'TSS')),
  E('is-ats', 'Transfer switch — automatic with handle', 'interface-supervisory', 'ATS', transferAutoIcon(isColor)),
  E('is-mts', 'Transfer switch — manual with handle', 'interface-supervisory', 'MTS', transferManualIcon(isColor)),
  E('is-vs', 'Valve supervisory switch', 'interface-supervisory', 'VS', boxIcon(isColor, 'VS')),
  E('is-vs-integral', 'Valve with integral supervisory switch', 'interface-supervisory', 'VS', valveSupervisoryIntegralIcon(isColor)),

  // ---- Table 8.4.2 — Notification Appliances ------------------------------
  E('na-basic', 'Audible appliance — basic shape', 'notification-appliances', '', hornIcon(naColor, '')),
  E('na-bell-ss', 'Bell — single stroke', 'notification-appliances', 'F/SS', bellIcon(naColor, 'F', 'SS')),
  E('na-bell-t', 'Bell — trouble', 'notification-appliances', 'F/T', bellIcon(naColor, 'F', 'T')),
  E('na-bell-v', 'Bell — vibrating', 'notification-appliances', 'F/V', bellIcon(naColor, 'F', 'V')),
  E('na-ceiling-indicator', 'Ceiling mount indicator', 'notification-appliances', 'RI', burstIcon(naColor, null, 'RI')),
  E('na-chime', 'Chime', 'notification-appliances', 'F/C', bellIcon(naColor, 'F', 'C')),
  E('na-chime-electronic', 'Chime — electronic', 'notification-appliances', 'F/C', hornIcon(naColor, 'F', 'C')),
  E('na-combo-horn-visible', 'Combination horn/visible (CD = candela rating/setting)', 'notification-appliances', 'CD', comboIcon(naColor, null, 'CD')),
  E('na-combo-speaker-visible', 'Combination speaker/visible (W = wattage, CD = candela rating/setting)', 'notification-appliances', 'CD/1W', comboIcon(naColor, null, 'CD/1W')),
  E('na-gong', 'Gong', 'notification-appliances', 'F/G', bellIcon(naColor, 'F', 'G')),
  E('na-horn-only', 'Horn only', 'notification-appliances', 'F/H', hornIcon(naColor, 'F', 'H')),
  E('na-mini-horn', 'Mini-horn', 'notification-appliances', 'F/M', hornIcon(naColor, 'F', 'M')),
  E('na-rts', 'Remote alarm indicating and test switch', 'notification-appliances', 'RTS', switchXIcon(naColor, 'RTS')),
  E('na-remote-indicator', 'Remote indicator', 'notification-appliances', 'RI', burstIcon(naColor, null, 'RI')),
  E('na-rotating-beacon', 'Rotating beacon', 'notification-appliances', '', beaconIcon(naColor)),
  E('na-speaker-ceiling', 'Speaker only, ceiling mount (denotes wattage tap)', 'notification-appliances', 'S/.5W/C', hornIcon(naColor, 'S', '.5W/C')),
  E('na-speaker-wall', 'Speaker only, wall mount (denotes wattage tap)', 'notification-appliances', 'S/.5W', hornIcon(naColor, 'S', '.5W')),
  E('na-strobe-ceiling', 'Visible only (strobe) — ceiling mount (CD = candela rating/setting)', 'notification-appliances', 'CD/C', burstIcon(naColor, null, 'CD/C')),
  E('na-strobe-wall', 'Visible only (strobe) — wall mount', 'notification-appliances', 'CD', burstIcon(naColor, null, 'CD')),

  // ---- Table 8.4.3 — Emergency Communications Notification Appliances ----
  E('ec-combo-ceiling', 'Combination speaker/visible — ceiling mount (CD = candela rating/setting, W = wattage)', 'emergency-communications', 'M/CD/W/C', comboIcon(ecColor, 'M', 'CD/W/C')),
  E('ec-combo-wall', 'Combination speaker/visible — wall mount', 'emergency-communications', 'M/CD/W', comboIcon(ecColor, 'M', 'CD/W')),
  E('ec-textual', 'Emergency textual visible appliance', 'emergency-communications', 'ET', textualVisibleIcon(ecColor)),
  E('ec-visible-ceiling', 'Visible only (strobe) — ceiling mount (CD = candela rating/setting)', 'emergency-communications', 'M/CD/C', burstIcon(ecColor, 'M', 'CD/C')),
  E('ec-visible-wall', 'Visible only (strobe) — wall mount', 'emergency-communications', 'M/CD', burstIcon(ecColor, 'M', 'CD')),

  // ---- Table 8.5 — Related Equipment ---------------------------------------
  E('re-piping', 'Air sampling detector piping', 'related-equipment', '', pipingDotIcon(reColor)),
  E('re-dcl', 'Door closer', 'related-equipment', 'DCL', boxIcon(reColor, 'DCL')),
  E('re-dh', 'Door holder', 'related-equipment', 'DH', boxIcon(reColor, 'DH')),
  E('re-eol-resistor', 'End of line resistor', 'related-equipment', '', resistorZigzagIcon(reColor)),
  E('re-phone-basic', 'Fire service or emergency phone station — basic shape', 'related-equipment', 'C', boxIcon(reColor, 'C')),
  E('re-phone-a', 'Fire service or emergency phone station — accessible', 'related-equipment', 'C/A', boxIcon(reColor, 'C', 'A')),
  E('re-phone-h', 'Fire service or emergency phone station — handset', 'related-equipment', 'C/H', boxIcon(reColor, 'C', 'H')),
  E('re-phone-j', 'Fire service or emergency phone station — jack', 'related-equipment', 'C/J', boxIcon(reColor, 'C', 'J')),
  E('re-phone-fws', 'Floor Warden Station', 'related-equipment', 'C/FWS', boxIcon(reColor, 'C', 'FWS')),
  E('re-smoke-dcl', 'Integrated smoke sensor and door closer', 'related-equipment', 'S/DCL', smokeDclComboIcon(reColor)),
  E('re-jb', 'Junction box', 'related-equipment', 'JB', boxIcon(reColor, 'JB')),
  E('re-sa', 'Sync adapter module (strobe synchronization)', 'related-equipment', 'SA', boxIcon(reColor, 'SA')),
  E('re-wt', "Watchman's tour station", 'related-equipment', 'WT', boxIcon(reColor, 'WT')),

  // ---- Table 9.2 — Access/Assessment/Ventilation Features & Utility Shutoffs
  E('aa-basic', 'Access features, assessment features, ventilation features, and utility shutoffs — basic shape', 'access-assessment', '', triUpIcon(aaColor, '')),
  E('aa-fd', 'Access feature — fire department access point', 'access-assessment', 'FD', triUpIcon(aaColor, 'FD')),
  E('aa-k', 'Access feature — fire department key box', 'access-assessment', 'K', triUpIcon(aaColor, 'K')),
  E('aa-ra', 'Access feature — roof access', 'access-assessment', 'RA', triUpIcon(aaColor, 'RA')),
  E('aa-ap', 'Assessment feature — fire alarm annunciator panel', 'access-assessment', 'AP', triUpIcon(aaColor, 'AP')),
  E('aa-rp', 'Assessment feature — fire alarm reset panel', 'access-assessment', 'RP', triUpIcon(aaColor, 'RP')),
  E('aa-cp', 'Assessment feature — fire alarm voice communication panel', 'access-assessment', 'CP', triUpIcon(aaColor, 'CP')),
  E('aa-sp', 'Assessment feature — smoke control and pressurization panel', 'access-assessment', 'SP', triUpIcon(aaColor, 'SP')),
  E('aa-wb', 'Assessment feature — sprinkler system water flow bell', 'access-assessment', 'WB', triUpIcon(aaColor, 'WB')),
  E('aa-sl', 'Ventilation feature — skylight', 'access-assessment', 'SL', triUpIcon(aaColor, 'SL')),
  E('aa-sv', 'Ventilation feature — smoke vent', 'access-assessment', 'SV', triUpIcon(aaColor, 'SV')),
  E('aa-e', 'Utility shutoff — electric', 'access-assessment', 'E', triUpIcon(aaColor, 'E')),
  E('aa-w', 'Utility shutoff — domestic water', 'access-assessment', 'W', triUpIcon(aaColor, 'W')),
  E('aa-g', 'Utility shutoff — gas', 'access-assessment', 'G', triUpIcon(aaColor, 'G')),
  E('aa-lpg', 'Specific variations — LP-Gas shutoff', 'access-assessment', 'LPG', triUpIcon(aaColor, 'LPG')),
  E('aa-ng', 'Specific variations — natural gas shutoff', 'access-assessment', 'NG', triUpIcon(aaColor, 'NG')),
  E('aa-cng', 'Specific variations — compressed natural gas shutoff', 'access-assessment', 'CNG', triUpIcon(aaColor, 'CNG')),

  // ---- Table 9.3 — Detection/Extinguishing Equipment ----------------------
  E('de-basic', 'Detection/extinguishing equipment — basic shape', 'detection-extinguishing', '', diamondIcon(deColor, '')),
  E('de-dd', 'Duct detector', 'detection-extinguishing', 'DD', diamondIcon(deColor, 'DD')),
  E('de-hd', 'Heat detector', 'detection-extinguishing', 'HD', diamondIcon(deColor, 'HD')),
  E('de-sd', 'Smoke detector', 'detection-extinguishing', 'SD', diamondIcon(deColor, 'SD')),
  E('de-fs', 'Flow switch (water)', 'detection-extinguishing', 'FS', diamondIcon(deColor, 'FS')),
  E('de-ps', 'Manual station — pull station/fire alarm box', 'detection-extinguishing', 'PS', diamondIcon(deColor, 'PS')),
  E('de-ts', 'Tamper switch', 'detection-extinguishing', 'TS', diamondIcon(deColor, 'TS')),
  E('de-hl', 'Halon system', 'detection-extinguishing', 'HL', diamondIcon(deColor, 'HL')),
  E('de-dc', 'Dry chemical system', 'detection-extinguishing', 'DC', diamondIcon(deColor, 'DC')),
  E('de-co2', 'Carbon dioxide system', 'detection-extinguishing', 'CO2', diamondIcon(deColor, 'CO2')),
  E('de-wc', 'Wet chemical system', 'detection-extinguishing', 'WC', diamondIcon(deColor, 'WC')),
  E('de-fo', 'Foam system', 'detection-extinguishing', 'FO', diamondIcon(deColor, 'FO')),
  E('de-ca', 'Clean agent system', 'detection-extinguishing', 'CA', diamondIcon(deColor, 'CA')),
  E('de-bsd', 'Beam smoke detector', 'detection-extinguishing', 'BSD', diamondIcon(deColor, 'BSD')),

  // ---- Table 8.6 — Symbols for Smoke/Pressurization Controls -------------
  E('spc-damper-barometric', 'Dampers — barometric', 'smoke-pressurization-controls', '', damperBarometricIcon(spcColor)),
  E('spc-damper-fire', 'Dampers — fire', 'smoke-pressurization-controls', '', damperFireIcon(spcColor)),
  E('spc-damper-fire-smoke', 'Dampers — fire/smoke', 'smoke-pressurization-controls', 'S', damperFireSmokeIcon(spcColor)),
  E('spc-damper-motorized', 'Dampers — motorized fire/smoke (orient as required for base or head injection)', 'smoke-pressurization-controls', 'S/M', damperMotorizedIcon(spcColor)),
  E('spc-damper-smoke', 'Dampers — smoke', 'smoke-pressurization-controls', 'S', damperSmokeIcon(spcColor)),
  E('spc-fan-duct', 'Fans — duct (arrow indicates direction of flow)', 'smoke-pressurization-controls', '', fanDuctIcon(spcColor)),
  E('spc-fan-general', 'Fans — general (arrow indicates direction of flow)', 'smoke-pressurization-controls', '', fanGeneralIcon(spcColor)),
  E('spc-fan-roof', 'Fans — roof (arrow indicates direction of flow)', 'smoke-pressurization-controls', '', fanRoofIcon(spcColor)),
  E('spc-fan-wall', 'Fans — wall (arrow indicates direction of flow)', 'smoke-pressurization-controls', '', fanWallIcon(spcColor)),
  E('spc-hoa', 'Hand (manual)/off-automatic', 'smoke-pressurization-controls', 'HOA', toggleBoxIcon(spcColor, 'HOA')),
  E('spc-stairwell', 'Pressurized stairwell (orient as required for base or head injection)', 'smoke-pressurization-controls', '', stairwellIcon(spcColor)),
  E('spc-purge', 'Purge controls — manual control', 'smoke-pressurization-controls', 'PC', toggleBoxIcon(spcColor, 'PC')),
  E('spc-vent-opening', 'Ventilation openings (orient as required for intake or exhaust)', 'smoke-pressurization-controls', '', ventOpeningIcon(spcColor)),
];

export const SYMBOLS_BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

// Cache of pre-rendered Image objects (SVG rasterized) for fast canvas drawImage() calls.
const imageCache = new Map();

export function getSymbolImage(defId) {
  if (imageCache.has(defId)) return imageCache.get(defId);
  const def = SYMBOLS_BY_ID[defId];
  const img = new Image();
  const promise = new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
  img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(def.svg);
  imageCache.set(defId, { img, promise });
  return imageCache.get(defId);
}

export function preloadAllSymbolImages() {
  return Promise.all(SYMBOLS.map((s) => getSymbolImage(s.id).promise));
}
