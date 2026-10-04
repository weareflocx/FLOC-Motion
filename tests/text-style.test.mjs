import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEXT_STYLE, TEXT_REVEALS, textTypography, textRevealClip } from '../src/text-style.js';
import { stageMarkup } from '../src/scene.js';
import { demoProject } from '../src/project.js';

test('legacy text retains its original typography and authored spacing/alignment are applied', () => {
  assert.deepEqual(textTypography({}), { lineHeight: 0.98, letterSpacing: '-0.035em', textAlign: 'left' });
  assert.deepEqual(textTypography({ lineHeight: 1.3, letterSpacing: 0.12, textAlign: 'center' }), { lineHeight: 1.3, letterSpacing: '0.12em', textAlign: 'center' });
  assert.deepEqual(textTypography({ lineHeight: NaN, letterSpacing: Infinity, textAlign: 'invalid' }), textTypography({}));
  assert.equal(DEFAULT_TEXT_STYLE.reveal, 'none');
  assert.equal(textRevealClip({}, 0), 'none');
});

test('wipe masks reveal from the chosen edge using layer-local time', () => {
  assert.deepEqual(TEXT_REVEALS.map(reveal => reveal.id), ['none', 'up', 'down', 'right', 'left']);
  const expected = { up: 'inset(75% 0% 0% 0%)', down: 'inset(0% 0% 75% 0%)', right: 'inset(0% 75% 0% 0%)', left: 'inset(0% 0% 0% 75%)' };
  for (const [reveal, clip] of Object.entries(expected)) {
    const layer = { reveal, start: 3, revealDuration: 2 };
    assert.equal(textRevealClip(layer, 3.5), clip);
    assert.match(textRevealClip(layer, 2), /100%/);
    assert.equal(textRevealClip(layer, 5), 'none');
    assert.equal(textRevealClip(layer, 8), 'none');
    assert.equal(textRevealClip(layer, 3.5), clip);
  }
  assert.equal(textRevealClip({ reveal: 'right', start: 2, revealDuration: 0 }, 2), 'none');
  assert.equal(textRevealClip({ reveal: 'right', start: 2, revealDuration: 0 }, 1), 'inset(0% 100% 0% 0%)');
  assert.equal(textRevealClip({ reveal: 'unsupported' }, 1), 'none');
});

test('text markup retains a plain text node for incremental content updates', () => {
  const project = demoProject();
  const text = project.layers.find(layer => layer.type === 'text');
  const markup = stageMarkup({ ...project, layers: [{ ...text, text: 'FIRST\nSECOND <tag>', lineHeight: 1.2, letterSpacing: 0.08, textAlign: 'right', reveal: 'up', revealDuration: 1 }] });
  assert.match(markup, /line-height:1.2;letter-spacing:0.08em;text-align:right;clip-path:inset\(100% 0% 0% 0%\)/);
  assert.match(markup, />FIRST\nSECOND &lt;tag&gt;<\/div>$/);
  assert.doesNotMatch(markup, /<span/);
});
