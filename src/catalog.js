import sourceCatalog from './catalog/preset-catalog.json' with { type: 'json' };
import { BRAND } from './brand.js';
import { DEFAULT_MOTION, MOTION_CURVES, motionBaseline } from './motion-timing.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numberValue = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

const familyTemplate = {
  Orbit: 'circular', Spinner: 'spinner', Showcase: 'showcase', Sliders: 'horizontal',
  Sphere: 'sphere', Stack: 'stack', Stickers: 'stickers', Twist: 'twist', Wheel: 'wheel'
};
const modelVariant = {
  circular_orbit_wrapped_faces: 'wrapped', circular_orbit_billboards: 'billboard', inward_facing_orbit: 'inward', splayed_orbit: 'bloom',
  perspective_linear_queue: 'queue', linear_slider: 'strip', linear_slider_with_scale_field: 'focus',
  spherical_point_cloud_billboards: 'billboard', spherical_tangential_panels: 'tangent', multi_axis_spherical_cloud: 'cloud',
  axis_rotor: 'rotor', hinged_axis_rotor: 'hinge', fan_axis_rotor: 'fan',
  cycling_deck: 'deck', stair_deck: 'stairs', arc_deck: 'spread', radial_deck: 'radial', recycled_depth_queue: 'infinite',
  layered_peeling_posters: 'peel', curling_stickers: 'scatter', single_torsion_panel: 'single', torsion_panel_carousel: 'ribbon',
  large_radius_radial_arc: 'rock', planar_circle_or_ellipse: 'ring'
};
const aspectValue = entry => {
  const ratio = entry.composition?.cardAspectRatio;
  if (typeof ratio !== 'string') return 1 / 1.14;
  const [w, h] = ratio.split(':').map(Number);
  return w > 0 && h > 0 ? clamp(w / h, 0.25, 4) : 1 / 1.14;
};

const familyCurve = {
  Orbit: 0.8,
  Spinner: 0.72,
  Showcase: 0.25,
  Sliders: 0.2,
  Sphere: 0.45,
  Stack: 0.18,
  Stickers: 0.12,
  Twist: 0.5,
  Wheel: 0.55
};

const settingsFor = entry => [
  ...(entry?.composition?.settings || []),
  ...(entry?.animation?.settings || [])
];

export function readCatalogSetting(entry, key, fallback = null) {
  const setting = settingsFor(entry).find(item => item.key === key);
  return setting && setting.value !== undefined ? setting.value : fallback;
}

const numberSetting = (entry, key, fallback = 0) => {
  const value = numberValue(readCatalogSetting(entry, key));
  return value === null ? fallback : value;
};

const sourceThumbnail = entry => {
  const contactSheet = entry?.evidence?.contactSheet;
  return typeof contactSheet === 'string' && contactSheet.startsWith('visuals/')
    ? `/catalog/${contactSheet}`
    : '';
};

function deriveCurve(entry) {
  const diameter = numberValue(readCatalogSetting(entry, 'composition.Distribution.Diameter'));
  if (diameter !== null && diameter > 0) return clamp(diameter / 240, 0, 1);
  return familyCurve[entry.family] ?? 0.4;
}

function derivePatch(entry) {
  const duration = Math.max(1, numberValue(entry.animation?.observedLoopDurationSeconds) || 12);
  const direction = String(readCatalogSetting(entry, 'animation.Motion.Direction', 'Forward')).toLowerCase();
  const sign = direction === 'reverse' ? -1 : 1;
  const cameraZoom = numberSetting(entry, 'composition.Camera.Zoom', 100);
  const cameraOffsetX = numberSetting(entry, 'composition.Camera.Offset X', 0);
  const cameraOffsetY = numberSetting(entry, 'composition.Camera.Offset Y', 0);
  const distributionX = numberSetting(entry, 'composition.Distribution.X', 0);
  const distributionY = numberSetting(entry, 'composition.Distribution.Y', 0);
  const distributionZ = numberSetting(entry, 'composition.Distribution.Z', 0);
  const gap = clamp(numberSetting(entry, 'composition.Distribution.Gap', 0) / 100, 0, 1);
  const patch = {
    template: familyTemplate[entry.family] ?? 'horizontal',
    motionVariant: modelVariant[entry.recreation?.model] || 'default',
    cardCount: clamp(Math.round(numberValue(entry.composition?.cardCount) || 0), 0, 48),
    cardAspect: aspectValue(entry),
    loopDuration: clamp(duration, 1, 60),
    radius: 0,
    cornerRadius: clamp(numberSetting(entry, 'composition.Cards.Corner', 0), 0, 100),
    cardShape: String(readCatalogSetting(entry, 'composition.Cards.Shape', '')).toLowerCase() === 'squircle' ? 'squircle' : 'rounded',
    frontface: String(readCatalogSetting(entry, 'composition.Distribution.Frontface', 'Show')).toLowerCase() === 'hide' ? 'hide' : 'show',
    backface: String(readCatalogSetting(entry, 'composition.Distribution.Backface', 'Show')).toLowerCase() === 'hide' ? 'hide' : 'show',
    yaw: clamp(distributionY, -180, 180),
    fade: clamp(numberSetting(entry, 'composition.Distribution.Fade', 0) / 100, 0, 1),
    speed: clamp(sign * (360 / duration), -90, 90),
    tilt: clamp(distributionX, -65, 65),
    roll: clamp(distributionZ, -180, 180),
    size: clamp(0.85 + cameraZoom / 220, 0.5, 2.5),
    gap,
    curve: deriveCurve(entry),
    x: clamp(50 + cameraOffsetX, 10, 90),
    y: clamp(54 + cameraOffsetY, 10, 90),
    shader: 'none',
    intensity: 0.35,
    tint: BRAND.colors.blue
  };
  const action = settingsFor(entry).find(setting => setting.key === 'animation.Motion.Action' && setting.disabled !== true);
  const curve = String(readCatalogSetting(entry, 'animation.Curves.Default', 'Original')).toLowerCase();
  patch.motion = {
    ...DEFAULT_MOTION,
    mode: numberValue(action?.value) > 0 ? 'steps' : 'continuous',
    action: clamp(numberValue(action?.value) || 1, 0.05, 30),
    pause: clamp(numberSetting(entry, 'animation.Motion.Pause', 0), 0, 30),
    curve: MOTION_CURVES.some(([id]) => id === curve) ? curve : 'native',
    intensity: clamp(numberSetting(entry, 'animation.Easing.Intensity', 50) / 100, 0, 1)
  };
  patch.motionBaseline = motionBaseline(patch, (entry.name || entry.id).slice(0, 100));
  return patch;
}

const supportedMappings = [
  'family + group model → original motion family / variant',
  'Cards.Corner + Shape → rounded or squircle mask',
  'Distribution.Frontface + Backface → mesh face visibility',
  'card count + aspect ratio → card geometry (media cycles deterministically)',
  'Motion.Duration + Direction → exact full loop / direction',
  'Motion.Action + Pause → FLOC per-card action / hold rhythm',
  'Curves.Default + Easing.Intensity → FLOC progress curves / blend',
  'Distribution.X + Y + Z → orientation',
  'Distribution.Fade → rear fade for orbit',
  'Camera.Zoom → card size',
  'Distribution.Gap → gap',
  'Distribution.Diameter → curvature when present',
  'Camera.Offset X + Y → position'
];

const unsupportedMappings = [
  'card counts above 48 (capped for bounded GPU work)',
  'imported camera perspective and precise zoom calibration',
  'surface selection and imported card alignment',
  'material deformation',
  'non-orbit fade, shadow and depth-of-field controls',
  'exact source-system curve formulas, cycle modes and stagger choreography'
];

export function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.family !== 'string') throw new Error('Invalid catalog entry.');
  return {
    id: entry.id,
    name: entry.name || entry.id,
    family: entry.family,
    group: entry.group || entry.family,
    description: typeof entry.definition === 'string' ? entry.definition : entry.composition?.description || '',
    status: entry.status || 'reconstructed',
    thumbnail: sourceThumbnail(entry),
    cardCount: numberValue(entry.composition?.cardCount),
    cardAspectRatio: entry.composition?.cardAspectRatio || null,
    carouselPatch: derivePatch(entry),
    support: {
      kind: 'reconstructed_recipe',
      applied: supportedMappings,
      notApplied: unsupportedMappings
    },
    raw: entry
  };
}

export const CATALOG_SOURCE = {
  schemaVersion: sourceCatalog.schemaVersion,
  title: sourceCatalog.title,
  source: sourceCatalog.source,
  coverage: sourceCatalog.coverage,
  limitations: sourceCatalog.limitations
};

export const CATALOG = sourceCatalog.templates.map(normalizeCatalogEntry);

export function getCatalogEntry(id) {
  const entry = CATALOG.find(item => item.id === id);
  if (!entry) throw new Error(`Unknown catalog preset: ${id}.`);
  return entry;
}

export function listCatalog({ query = '', family = '', limit = 108 } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const normalizedFamily = String(family).trim().toLowerCase();
  const matches = CATALOG.filter(entry => {
    const searchable = `${entry.id} ${entry.name} ${entry.family} ${entry.group} ${entry.description}`.toLowerCase();
    return (!normalizedQuery || searchable.includes(normalizedQuery)) && (!normalizedFamily || entry.family.toLowerCase() === normalizedFamily);
  });
  return matches.slice(0, clamp(Number(limit) || 108, 1, 108));
}

export function catalogSummary() {
  return {
    ...CATALOG_SOURCE,
    templates: CATALOG.map(({ raw, ...entry }) => entry)
  };
}
