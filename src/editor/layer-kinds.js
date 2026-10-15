// Display names for layer types, shared by the layer list, inspector header and timeline.
export const LAYER_KINDS = { background: 'Background', carousel: 'Carousel', text: 'Text', logo: 'Logo', music: 'Audio', media: 'Media', model: '3D model', effect: 'Effect' };

export const layerKind = layer => layer.type === 'effect' && layer.effectScope === 'below' ? 'Adjustment' : LAYER_KINDS[layer.type];
