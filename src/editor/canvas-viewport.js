export function canvasViewport([width, height], box, zoom = 'fit', offset = { x: 0, y: 0 }) {
  const availableWidth = Math.max(1, box.width - 24);
  const availableHeight = Math.max(1, box.height - 24);
  const fitScale = Math.max(0.05, Math.min(availableWidth / width, availableHeight / height));
  const scale = zoom === 'fit' ? fitScale : Math.max(0.05, Math.min(2, zoom));
  const maxX = Math.max(0, (width * scale - availableWidth) / 2);
  const maxY = Math.max(0, (height * scale - availableHeight) / 2);
  return {
    scale, fitScale, canPan: maxX > 0 || maxY > 0,
    x: Math.max(-maxX, Math.min(maxX, offset.x)) || 0,
    y: Math.max(-maxY, Math.min(maxY, offset.y)) || 0
  };
}
