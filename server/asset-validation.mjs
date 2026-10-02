// Imported SVG is only rendered as an image; reject executable/external content
// also when someone opens the local asset URL directly.
export function validateSvg(bytes) {
  const source = bytes.toString('utf8');
  if (!/<svg(?:\s|>)/i.test(source) || /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|style|animate\w*|set)\b|\bon\w+\s*=|\b(?:href|src)\s*=\s*["']\s*(?!#)|url\s*\(\s*["']?\s*(?!#)|@import/i.test(source)) {
    throw new Error('SVG must be self-contained without scripts, external resources or embedded HTML.');
  }
}
export function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Use a valid GLB 2.0 model.');
  const length = bytes.readUInt32LE(12);
  if (20 + length > bytes.length) throw new Error('Invalid GLB JSON chunk.');
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').trim());
  if ([...(json.buffers || []), ...(json.images || [])].some(item => item.uri && !/^data:/i.test(item.uri))) throw new Error('GLB textures and buffers must be embedded in the file.');
  if (json.extensionsRequired?.some(name => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name))) throw new Error('Use an uncompressed GLB with standard embedded textures.');
}
