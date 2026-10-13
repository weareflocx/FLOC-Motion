import { request as defaultRequest } from './request.js';
import { FORMAT_LABELS } from '../project.js';
import { NAME_LIMIT, batchSources, variantProject, workspaceAssets } from '../batch-variants.js';
import { textOverflowIssues } from './text-overflow.js';

// Batch variants talk to the same endpoints as single compositions and exports, one request per output.
const post = (request, url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function loadWorkspaceAssets(template, request = defaultRequest) {
  const { templates } = await request('/api/templates');
  return workspaceAssets([template, ...templates.map(entry => entry.project)]);
}

// Uploaded files the workspace no longer has (deleted or cleaned up); bundled assets always exist.
export async function missingAssets(sources, fetcher = globalThis.fetch) {
  const missing = new Set();
  await Promise.all(sources.filter(src => src.startsWith('/assets/')).map(async src => {
    const response = await fetcher(src, { method: 'HEAD' });
    if (response.status === 404) missing.add(src);
  }));
  return missing;
}

const outputName = (row, format, formats) => {
  const name = row.name.trim();
  if (formats.length < 2) return name;
  const suffix = ` · ${FORMAT_LABELS[format]}`;
  return `${name.slice(0, NAME_LIMIT - suffix.length)}${suffix}`;
};

// Every output a batch would produce: one per row and selected format.
export function batchOutputs(template, rows, formats) {
  return rows.flatMap(row => formats.map(format => ({ row, format, project: { ...variantProject(template, row, format), name: outputName(row, format, formats) } })));
}

// Text layout is checked in each selected format, since linked formats lay text out differently.
export async function overflowIssues(template, rows, formats, measure = textOverflowIssues) {
  const issues = new Map();
  for (const row of rows) {
    const found = [];
    for (const format of formats) {
      let project;
      try { project = variantProject(template, row, format); } catch { continue; }
      for (const issue of await measure(project)) found.push(formats.length > 1 ? { ...issue, message: `${issue.message} (${FORMAT_LABELS[format]})` } : issue);
    }
    if (found.length) issues.set(row.key, found);
  }
  return issues;
}

export const reviewSources = batchSources;

// Saves each row as its own composition; stops at the first failure and reports what was saved.
export async function createCompositions(template, rows, request = defaultRequest) {
  const created = [];
  for (const row of rows) {
    const project = variantProject(template, row);
    try { created.push(await post(request, '/api/templates', { name: project.name, tags: [], project })); }
    catch (error) { return { created, error: `${error.message} ${created.length} of ${rows.length} compositions were saved.` }; }
  }
  return { created };
}

// Queues one export per output with the current export settings, in row order.
export async function queueExports(outputs, settings, request = defaultRequest) {
  const jobs = [];
  for (const { project } of outputs) {
    try { jobs.push(await post(request, '/api/exports', { project, settings })); }
    catch (error) { return { jobs, error: `${error.message} ${jobs.length} of ${outputs.length} exports were queued.` }; }
  }
  return { jobs };
}
