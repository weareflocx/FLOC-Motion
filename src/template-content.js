export const CONTENT_PROPERTIES = Object.freeze({ text: 'text', carousel: 'images', logo: 'src', media: 'src', music: 'src' });

export function contentFields(project) {
  return project.layers.filter(layer => Object.hasOwn(CONTENT_PROPERTIES, layer.type) && typeof layer.contentField === 'string' && layer.contentField.trim());
}
