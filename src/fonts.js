export const FONTS = [
  { id: 'geist', name: 'Geist', family: 'Geist', weights: [400, 600, 700, 800] },
  { id: 'druk-wide', name: 'Druk Wide', family: 'Druk Wide', weights: [900] },
  { id: 'geist-mono', name: 'Geist Mono', family: 'Geist Mono', weights: [500, 700] }
];
export const FONT_WEIGHTS = { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Heavy' };
export const fontDefinition = id => FONTS.find(font => font.id === (id ?? 'geist'));
export const FONT_FILES = FONTS.flatMap(font => font.weights.map(weight => ({ family: font.family, weight, file: font.id === 'druk-wide' ? 'druk-wide-heavy.woff2' : `${font.id}-${weight}.woff2` })));
export const fontFaceCss = prefix => FONT_FILES.map(font => `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};src:url("${prefix}${font.file}") format("woff2");font-display:block}`).join('');
