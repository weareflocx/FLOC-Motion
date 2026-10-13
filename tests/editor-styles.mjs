import { readFileSync } from 'node:fs';

// The editor stylesheet as Vite bundles it: src/styles/index.css @imports inlined in cascade order.
export function editorStyles() {
  const index = new URL('../src/styles/index.css', import.meta.url);
  return [...readFileSync(index, 'utf8').matchAll(/@import '([^']+)';/g)].map(([, file]) => readFileSync(new URL(file, index), 'utf8')).join('\n');
}
