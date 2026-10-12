// Saved projects keep the schema version they were written with. Each step
// upgrades plain JSON from vN to vN+1; validation only describes the current shape.
export const CURRENT_PROJECT_VERSION = 2;

const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Legacy text entrance: fixed 0.45 s in / 0.25 s out ramps, optionally rising.
const TEXT_ENTRANCES = { none: [0, 0, false], fade: [0.45, 0.25, false], rise: [0.45, 0.25, true] };

// Image IDs are only list keys (nothing references a card by ID), so empty or
// repeated IDs are renamed by position; the first use of an ID keeps it.
function repairImageIds(images) {
  if (!Array.isArray(images)) return;
  const used = new Set(), broken = [];
  images.forEach((image, index) => {
    if (!record(image) || typeof image.id !== 'string') return;
    if (image.id.trim() && !used.has(image.id)) used.add(image.id);
    else broken.push(index);
  });
  for (const index of broken) {
    let id = `image-${index + 1}`;
    for (let suffix = 2; used.has(id); suffix++) id = `image-${index + 1}-${suffix}`;
    used.add(id);
    images[index].id = id;
  }
}
// Frozen here so later default changes never alter what a v1 file migrates to.
const V1_LAYOUT = { enabled: false, marginX: 5, marginY: 5, guides: true };

function v1ToV2(project) {
  if (project.layout === undefined) project.layout = { ...V1_LAYOUT };
  repairImageIds(project.images);
  for (const layer of Array.isArray(project.layers) ? project.layers : []) {
    if (!record(layer)) continue;
    if (layer.type === 'carousel') repairImageIds(layer.images);
    if (layer.type === 'text' && layer.animation !== undefined) {
      if (!Object.hasOwn(TEXT_ENTRANCES, layer.animation)) fail('Unknown text style.');
      const [fadeIn, fadeOut, rise] = TEXT_ENTRANCES[layer.animation];
      layer.fadeIn ??= fadeIn; layer.fadeOut ??= fadeOut; layer.rise ??= rise;
      delete layer.animation;
    }
  }
  return project;
}

// MIGRATIONS[n - 1] upgrades version n to n + 1. Steps receive a private copy.
const MIGRATIONS = [v1ToV2];

export function migrateProject(input) {
  if (!record(input)) fail('Invalid project.');
  if (!Object.hasOwn(input, 'version')) fail('Project version is missing.');
  const { version } = input;
  if (!Number.isInteger(version) || version < 1) fail('Invalid project version.');
  if (version > CURRENT_PROJECT_VERSION) fail('This project was created by a newer version of FLOC Motion.');
  let project = structuredClone(input);
  for (let from = version; from < CURRENT_PROJECT_VERSION; from++) project = { ...MIGRATIONS[from - 1](project), version: from + 1 };
  return project;
}
