import test from 'node:test';
import assert from 'node:assert/strict';
import { textTypography } from '../src/text-style.js';
import { stageMarkup } from '../src/scene.js';
import { demoProject } from '../src/project.js';

test('legacy text retains its original typography and authored spacing/alignment are applied', () => {
  assert.deepEqual(textTypography({}), { lineHeight: 0.98, letterSpacing: '-0.035em', textAlign: 'left' });
  assert.deepEqual(textTypography({ lineHeight: 1.3, letterSpacing: 0.12, textAlign: 'center' }), { lineHeight: 1.3, letterSpacing: '0.12em', textAlign: 'center' });
  assert.deepEqual(textTypography({ lineHeight: NaN, letterSpacing: Infinity, textAlign: 'invalid' }), textTypography({}));
});

test('text markup retains a plain text node for incremental content updates', () => {
  const project = demoProject();
  const text = project.layers.find(layer => layer.type === 'text');
  const markup = stageMarkup({ ...project, layers: [{ ...text, text: 'FIRST\nSECOND <tag>', lineHeight: 1.2, letterSpacing: 0.08, textAlign: 'right' }] });
  assert.match(markup, /line-height:1.2;letter-spacing:0.08em;text-align:right;/);
  assert.match(markup, />FIRST\nSECOND &lt;tag&gt;<\/div>$/);
  assert.doesNotMatch(markup, /<span/);
});
