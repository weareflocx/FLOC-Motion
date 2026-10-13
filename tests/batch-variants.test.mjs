import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, fileLayer, linkFormats, patchLayer, validateProject } from '../src/project.js';
import { BATCH_ROW_LIMIT, batchColumns, batchFormats, batchRow, parseDelimited, reviewRows, rowsFromTable, variantProject, workspaceAssets } from '../src/batch-variants.js';
import { batchOutputs, createCompositions, overflowIssues, queueExports } from '../src/editor/batch-actions.js';

const upload = (id, extension) => `/assets/${String(id).padStart(8, '0')}-1234-1234-1234-123456789012.${extension}`;
// Headline and subline text fields (the headline required, 24 characters max), a logo and a carousel.
function template() {
  let p = validateProject({ ...demoProject(), name: 'Promo' });
  p = validateProject({ ...p, layers: [...p.layers, { ...p.layers.find(l => l.id === 'headline'), id: 'subline', name: 'Subline', text: 'Template subline', y: 60 }, fileLayer({ src: upload(9, 'png'), name: 'Product shot' }, p.duration, 'photo')] });
  p = patchLayer(p, 'headline', { contentField: { id: 'headline', label: 'Headline', required: true, maxLength: 24 } });
  p = patchLayer(p, 'subline', { contentField: { id: 'subline', label: 'Subline', required: false } });
  p = patchLayer(p, 'logo', { contentField: { id: 'logo', label: 'Logo', required: true } });
  p = patchLayer(p, 'photo', { contentField: { id: 'photo', label: 'Photo', required: false } });
  return patchLayer(p, 'headline', { locked: true });
}
const assets = [{ src: upload(1, 'png'), name: 'Logo A.png' }, { src: upload(2, 'svg'), name: 'logo-b.svg' }, { src: upload(3, 'mp3'), name: 'Theme.mp3' }];

test('pasted CSV and TSV keep quoted delimiters, quotes and line breaks', () => {
  assert.deepEqual(parseDelimited('\uFEFFName,Headline\r\n"Spring, 2027","Say ""hi""\nthere"\n\n,\n'), [['Name', 'Headline'], ['Spring, 2027', 'Say "hi"\nthere']]);
  assert.deepEqual(parseDelimited('Name\tHeadline\nA, B\tC "quoted"'), [['Name', 'Headline'], ['A, B', 'C "quoted"']]);
  assert.throws(() => parseDelimited('Name\n"open'), /not closed/);
});

test('a header maps columns by name, label or ID; without one, columns are the name and text fields', () => {
  const p = template();
  assert.deepEqual(batchColumns(p).map(column => [column.id, column.type, column.required]), [['headline', 'text', true], ['logo', 'logo', true], ['subline', 'text', false], ['photo', 'media', false]]);
  const rows = rowsFromTable(p, 'subline,Output name,HEADLINE,Logo\nSecond line,Variant A,Big news,logo-b.svg\nOther,Variant B,More news,Missing.png', { assets });
  assert.deepEqual(rows.map(row => [row.key, row.name, row.values.headline, row.values.subline, row.values.logo]), [
    ['row-1', 'Variant A', 'Big news', 'Second line', upload(2, 'svg')],
    ['row-2', 'Variant B', 'More news', 'Other', 'Missing.png']
  ], 'media cells resolve uploaded file names; unknown names stay visible for review');
  assert.equal(rows[0].values.photo, upload(9, 'png'), 'unlisted columns keep the template value');
  const positional = rowsFromTable(p, 'Plain,Head\nSecond,Next,Sub');
  assert.deepEqual(positional.map(row => [row.name, row.values.headline, row.values.subline]), [['Plain', 'Head', 'Template subline'], ['Second', 'Next', 'Sub']]);
  assert.throws(() => rowsFromTable(p, 'A,B,C,D'), /more columns than the template has text fields/);
  assert.throws(() => rowsFromTable(p, 'Name,Headline,Tagline\nA,B,C'), /Unknown column “Tagline”/);
  assert.throws(() => rowsFromTable(p, 'Name,headline,Headline\nA,B,C'), /appears twice/);
  assert.throws(() => rowsFromTable(p, 'Name,Headline'), /below the header/);
  assert.throws(() => rowsFromTable(p, ['Name', ...Array.from({ length: BATCH_ROW_LIMIT + 1 }, (_, i) => `Row ${i}`)].join('\n')), /Use up to 50 rows/);
  // Repeated labels need IDs; an exact ID always wins.
  const twin = patchLayer(patchLayer(p, 'subline', { contentField: { id: 'subline', label: 'Copy', required: false } }), 'photo', { contentField: { id: 'photo', label: 'Copy', required: false } });
  assert.throws(() => rowsFromTable(twin, 'Name,Copy\nA,B'), /matches several fields/);
  assert.equal(rowsFromTable(twin, 'Name,subline\nA,B')[0].values.subline, 'B');
});

test('a variant applies only declared content, keeps locks, and follows linked formats', () => {
  const p = linkFormats(template());
  const row = { ...batchRow(p, 'r1', ' Variant A '), values: { ...batchRow(p, 'r1').values, headline: 'Big news', logo: upload(1, 'png') } };
  const variant = variantProject(p, row);
  assert.equal(variant.name, 'Variant A');
  const layer = id => variant.layers.find(l => l.id === id);
  assert.equal(layer('headline').text, 'Big news'); assert.equal(layer('headline').locked, true);
  assert.equal(layer('logo').src, upload(1, 'png'));
  assert.deepEqual(layer('headline').contentField, p.layers.find(l => l.id === 'headline').contentField);
  assert.deepEqual(batchFormats(p), ['square', 'portrait', 'landscape']);
  const portrait = variantProject(p, row, 'portrait');
  assert.equal(portrait.format, 'portrait');
  assert.equal(portrait.layers.find(l => l.id === 'headline').text, 'Big news', 'content is shared across formats');
  assert.deepEqual(batchFormats(template()), ['square']);
  const outputs = batchOutputs(p, [row], ['square', 'portrait']);
  assert.deepEqual(outputs.map(output => [output.project.name, output.project.format]), [['Variant A · 1 : 1', 'square'], ['Variant A · 9 : 16', 'portrait']]);
});

test('review flags required values, maximum length, duplicate names and missing or unsupported assets per row', () => {
  const p = template();
  const row = (key, name, values = {}) => ({ ...batchRow(p, key, name), values: { ...batchRow(p, key).values, logo: upload(1, 'png'), ...values } });
  const rows = [
    row('ok', 'Clean'),
    row('empty', 'Empty', { headline: '   ', logo: '' }),
    row('long', 'Too long', { headline: 'x'.repeat(25) }),
    row('dup-a', 'Same'), row('dup-b', ' same '),
    row('asset', 'Assets', { logo: upload(3, 'mp3'), photo: 'Unknown.png' }),
    row('gone', 'Gone', { logo: upload(2, 'svg') }),
    row('unnamed', '  ')
  ];
  const review = reviewRows(p, rows, { missingAssets: new Set([upload(2, 'svg')]), overflow: new Map([['ok', [{ kind: 'overflow', message: 'Headline runs past the frame.' }]]]) });
  const flags = Object.fromEntries(review.map(item => [item.key, item.issues.map(issue => issue.message)]));
  assert.deepEqual(flags, {
    ok: ['Headline runs past the frame.'],
    empty: ['Headline is required.', 'Logo is required.'],
    long: ['Headline is longer than 24 characters.'],
    'dup-a': ['Another row is also named “Same”.'],
    'dup-b': ['Another row is also named “same”.'],
    asset: ['Logo: “00000003-1234-1234-1234-123456789012.mp3” is not a supported image file.', 'Photo: “Unknown.png” is not an uploaded asset.'],
    gone: ['Logo: “00000002-1234-1234-1234-123456789012.svg” is missing from the workspace.'],
    unnamed: ['Output name is required.']
  });
  assert.deepEqual(reviewRows(p, [row('fine', 'Fine')]), [{ key: 'fine', issues: [] }]);
});

test('workspace assets come from every saved composition with their given names', () => {
  const p = template();
  const other = validateProject({ ...demoProject(), images: [{ id: 'a', src: upload(4, 'webm'), name: 'Clip.webm' }] });
  const listed = workspaceAssets([p, other]);
  assert.ok(listed.some(asset => asset.src === upload(9, 'png') && asset.name === 'Product shot'));
  assert.ok(listed.some(asset => asset.src === upload(4, 'webm') && asset.name === 'Clip.webm'));
  assert.equal(new Set(listed.map(asset => asset.src)).size, listed.length, 'each asset once');
});

test('overflow is measured per row and selected format, and actions run one request per output in order', async () => {
  const p = linkFormats(template());
  const rows = [{ ...batchRow(p, 'a', 'A'), values: { ...batchRow(p, 'a').values, headline: 'Short', logo: upload(1, 'png') } }, { ...batchRow(p, 'b', 'B'), values: { ...batchRow(p, 'b').values, headline: 'A very long headline', logo: upload(1, 'png') } }];
  const measured = [];
  const issues = await overflowIssues(p, rows, ['square', 'portrait'], async project => {
    measured.push([project.name, project.format]);
    return project.layers.find(l => l.id === 'headline').text.length > 10 && project.format === 'portrait' ? [{ kind: 'overflow', message: 'Headline does not fit the safe area.' }] : [];
  });
  assert.deepEqual(measured, [['A', 'square'], ['A', 'portrait'], ['B', 'square'], ['B', 'portrait']]);
  assert.deepEqual([...issues], [['b', [{ kind: 'overflow', message: 'Headline does not fit the safe area. (9 : 16)' }]]]);

  const calls = [];
  const request = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push([url, body.name ?? body.project.name]);
    if (body.project?.name === 'B · 9 : 16') throw new Error('Up to 50 exports can wait in the queue.');
    return { id: `${calls.length}` };
  };
  assert.deepEqual(await createCompositions(p, rows, request), { created: [{ id: '1' }, { id: '2' }] });
  const queued = await queueExports(batchOutputs(p, rows, ['square', 'portrait']), { quality: 'high', resolution: '1080p', format: 'mp4', transparent: false }, request);
  assert.deepEqual(calls, [['/api/templates', 'A'], ['/api/templates', 'B'], ['/api/exports', 'A · 1 : 1'], ['/api/exports', 'A · 9 : 16'], ['/api/exports', 'B · 1 : 1'], ['/api/exports', 'B · 9 : 16']]);
  assert.equal(queued.jobs.length, 3);
  assert.equal(queued.error, 'Up to 50 exports can wait in the queue. 3 of 4 exports were queued.');
});
