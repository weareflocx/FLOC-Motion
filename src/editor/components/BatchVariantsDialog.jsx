import React, { useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { FORMAT_LABELS, PROJECT_LIMITS } from '../../project.js';
import { EXPORT_QUALITIES, exportFormat } from '../../export-settings.js';
import { BATCH_ROW_LIMIT, acceptsAsset, batchColumns, batchFormats, batchRow, batchSources, reviewRows, rowsFromTable, workspaceAssets } from '../../batch-variants.js';
import { batchOutputs, createCompositions, loadWorkspaceAssets, missingAssets, overflowIssues, queueExports } from '../batch-actions.js';
import { IconButton, Modal } from '../controls.jsx';
import { uploadAssets } from '../upload-assets.js';
import '../template-content.css';

const acceptedFiles = { carousel: 'image/*,video/mp4,video/webm', logo: 'image/*', media: 'image/*,video/mp4,video/webm', music: '.mp3,.wav,.m4a,.ogg,audio/*' };
const fileName = src => src.split('/').pop();

// One row per output and one column per content field. Review flags each row; only a clean
// review enables creating compositions or queueing exports, and both need this person's click.
export function BatchVariantsDialog({ project: template, exportSettings, onClose }) {
  const title = useId();
  const columns = batchColumns(template);
  const formats = batchFormats(template);
  const counter = useRef(0);
  const nextKey = () => `row-${++counter.current}`;
  const [rows, setRows] = useState(() => [batchRow(template, nextKey(), `${template.name.slice(0, 96)} 1`)]);
  const [selectedFormats, setSelectedFormats] = useState(() => [template.format]);
  const [assets, setAssets] = useState(() => workspaceAssets([template]));
  const [pasted, setPasted] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const pending = useRef(false);
  const fileInput = useRef();
  const fileTarget = useRef(null);
  const output = exportFormat(exportSettings.format);

  useEffect(() => {
    let current = true;
    loadWorkspaceAssets(template).then(list => { if (current) setAssets(list); }).catch(failure => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [template]);

  // Any edit makes the previous review stale.
  function edit(next) { setRows(next); setReview(null); setResult(''); setError(''); }
  const setRow = (key, change) => edit(rows.map(row => row.key === key ? change(row) : row));
  const setValue = (key, id, value) => setRow(key, row => ({ ...row, values: { ...row.values, [id]: value } }));
  function addRow() {
    if (rows.length >= BATCH_ROW_LIMIT) return setError(`Use up to ${BATCH_ROW_LIMIT} rows.`);
    edit([...rows, batchRow(template, nextKey(), `${template.name.slice(0, 96)} ${rows.length + 1}`)]);
  }
  function addPasted() {
    try {
      const added = rowsFromTable(template, pasted, { assets, key: nextKey });
      // A single untouched starter row is replaced by the pasted rows.
      const keep = rows.length === 1 && !review && JSON.stringify(rows[0]) === JSON.stringify(batchRow(template, rows[0].key, `${template.name.slice(0, 96)} 1`)) ? [] : rows;
      if (keep.length + added.length > BATCH_ROW_LIMIT) throw new Error(`Use up to ${BATCH_ROW_LIMIT} rows.`);
      edit([...keep, ...added]);
      setPasted('');
    } catch (failure) { setError(failure.message); }
  }
  function pick(row, column) {
    if (pending.current) return;
    fileTarget.current = { key: row.key, column };
    fileInput.current.accept = acceptedFiles[column.type];
    fileInput.current.multiple = column.type === 'carousel';
    fileInput.current.click();
  }
  async function upload(event) {
    const files = [...event.target.files];
    event.target.value = '';
    const target = fileTarget.current;
    if (!files.length || !target || pending.current) return;
    if (target.column.type === 'carousel' && files.length > PROJECT_LIMITS.maxImages) return setError(`Use up to ${PROJECT_LIMITS.maxImages} carousel assets.`);
    pending.current = true; setBusy('upload'); setError('');
    try {
      const uploaded = await uploadAssets(files);
      setAssets(list => [...list, ...uploaded.filter(asset => !list.some(item => item.src === asset.src)).map(({ src, name }) => ({ src, name }))]);
      setValue(target.key, target.column.id, target.column.type === 'carousel' ? uploaded.map(({ id, src, name }) => ({ id, src, name })) : uploaded[0].src);
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(''); }
  }
  async function runReview() {
    if (pending.current) return;
    if (!rows.length) return setError('Add at least one row.');
    if (!selectedFormats.length) return setError('Choose at least one format.');
    pending.current = true; setBusy('review'); setError(''); setResult('');
    try {
      const missing = await missingAssets(batchSources(template, rows));
      const overflow = await overflowIssues(template, rows, selectedFormats);
      setReview({ rows, formats: selectedFormats, results: reviewRows(template, rows, { missingAssets: missing, overflow }) });
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(''); }
  }
  const flagged = review?.results.filter(item => item.issues.length) ?? [];
  const ready = review && review.rows === rows && review.formats === selectedFormats && !flagged.length;
  async function create() {
    if (pending.current || !ready) return;
    pending.current = true; setBusy('create'); setError('');
    try {
      const { created, error: failure } = await createCompositions(template, rows);
      if (failure) setError(failure);
      else setResult(`${created.length} ${created.length === 1 ? 'composition' : 'compositions'} saved.`);
    } finally { pending.current = false; setBusy(''); }
  }
  async function exportAll() {
    if (pending.current || !ready) return;
    const outputs = batchOutputs(template, rows, selectedFormats);
    if (outputs.length > BATCH_ROW_LIMIT) return setError(`Up to ${BATCH_ROW_LIMIT} exports can wait in the queue. Remove rows or formats.`);
    pending.current = true; setBusy('export'); setError('');
    try {
      const { jobs, error: failure } = await queueExports(outputs, exportSettings);
      if (failure) setError(failure);
      else setResult(`${jobs.length} ${jobs.length === 1 ? 'export' : 'exports'} queued. Follow them in Export → Recent exports.`);
    } finally { pending.current = false; setBusy(''); }
  }
  function close() { if (!pending.current) onClose(); }
  const issuesFor = key => review?.rows === rows ? review.results.find(item => item.key === key)?.issues ?? [] : [];

  function cell(row, column, index) {
    const value = row.values[column.id];
    const label = `Row ${index + 1} ${column.label}`;
    if (column.type === 'text') return <><textarea aria-label={label} rows={2} maxLength={500} value={value} onChange={event => setValue(row.key, column.id, event.target.value)}/>{column.maxLength !== undefined && <small className={value.length > column.maxLength ? 'over' : ''}>{value.length} / {column.maxLength}</small>}</>;
    const options = assets.filter(asset => acceptsAsset(column.type, asset.src));
    if (column.type === 'carousel') return <div className="batch-asset"><span>{value.length} {value.length === 1 ? 'card' : 'cards'}</span><IconButton label={`Upload cards for ${label}`} onClick={() => pick(row, column)}><UploadSimple size={14}/></IconButton></div>;
    return <div className="batch-asset"><select aria-label={label} value={value} onChange={event => setValue(row.key, column.id, event.target.value)}>
      <option value="">None</option>
      {value && !options.some(asset => asset.src === value) && <option value={value}>{fileName(value)}</option>}
      {options.map(asset => <option key={asset.src} value={asset.src}>{asset.name}</option>)}
    </select><IconButton label={`Upload file for ${label}`} onClick={() => pick(row, column)}><UploadSimple size={14}/></IconButton></div>;
  }

  return <Modal labelledBy={title} onClose={close}><div className="template-content-window batch-window">
    <header className="template-content-header"><h2 id={title}>Batch variants</h2><IconButton label="Close batch variants" disabled={Boolean(busy)} onClick={close}><X size={20}/></IconButton></header>
    <div className="batch-body">
      <fieldset disabled={Boolean(busy)}>
        <div className="batch-table-wrap"><table className="batch-table">
          <thead><tr><th scope="col">#</th><th scope="col">Output name</th>{columns.map(column => <th scope="col" key={column.id}>{column.label}{column.required && <abbr title="Required" aria-label="required">*</abbr>}<small>{column.id}</small></th>)}<th scope="col" aria-label="Row actions"/></tr></thead>
          <tbody>{rows.map((row, index) => {
            const issues = issuesFor(row.key);
            return <React.Fragment key={row.key}>
              <tr className={issues.length ? 'flagged' : ''}>
                <th scope="row">{index + 1}</th>
                <td><input aria-label={`Row ${index + 1} output name`} maxLength={100} value={row.name} onChange={event => setRow(row.key, item => ({ ...item, name: event.target.value }))}/></td>
                {columns.map(column => <td key={column.id}>{cell(row, column, index)}</td>)}
                <td><IconButton label={`Remove row ${index + 1}`} onClick={() => edit(rows.filter(item => item.key !== row.key))}><Trash size={14}/></IconButton></td>
              </tr>
              {issues.length > 0 && <tr className="batch-issues"><td/><td colSpan={columns.length + 2}><ul>{issues.map((issue, item) => <li key={item}>{issue.message}</li>)}</ul></td></tr>}
            </React.Fragment>;
          })}</tbody>
        </table></div>
        <div className="batch-actions"><button type="button" className="outline-button" disabled={rows.length >= BATCH_ROW_LIMIT} onClick={addRow}><Plus size={16}/>Add row</button></div>
        <label className="template-content-field batch-paste">Paste rows (CSV or TSV)<textarea rows={4} value={pasted} placeholder={['Name', ...columns.filter(column => column.type === 'text').map(column => column.label)].join(',')} onChange={event => setPasted(event.target.value)}/><small>A header row may name columns by “Name”, field label or field ID. Media columns take an uploaded file name; separate carousel cards with “|”.</small></label>
        <div className="batch-actions"><button type="button" className="outline-button" disabled={!pasted.trim()} onClick={addPasted}>Add pasted rows</button></div>
        {formats.length > 1 && <div className="batch-formats" role="group" aria-label="Formats to export">{formats.map(format => <label className="check-field" key={format}><input type="checkbox" checked={selectedFormats.includes(format)} onChange={event => { setSelectedFormats(event.target.checked ? formats.filter(item => item === format || selectedFormats.includes(item)) : selectedFormats.filter(item => item !== format)); setReview(null); }}/>{FORMAT_LABELS[format]}</label>)}</div>}
        <p className="helper">Exports use the settings chosen in Export: {output.name} · {EXPORT_QUALITIES.find(item => item.id === exportSettings.quality)?.label} · {exportSettings.resolution}{exportSettings.transparent && output.alpha ? ' · Transparent' : ''}.</p>
      </fieldset>
    </div>
    <input hidden ref={fileInput} type="file" onChange={upload}/>
    <footer className="template-content-footer">
      <div className="template-content-feedback">{error && <p role="alert">{error}</p>}{busy === 'upload' && <p role="status">Uploading…</p>}{busy === 'review' && <p role="status">Reviewing…</p>}{review && !busy && !error && !result && <p role="status">{flagged.length ? `${flagged.length} of ${review.results.length} rows need changes.` : review.rows === rows ? `${rows.length} ${rows.length === 1 ? 'row is' : 'rows are'} ready.` : ''}</p>}{result && <p role="status">{result}</p>}</div>
      <button type="button" className="outline-button" disabled={Boolean(busy) || !rows.length} onClick={runReview}>{busy === 'review' ? 'Reviewing…' : 'Review'}</button>
      <button type="button" className="outline-button" disabled={Boolean(busy) || !ready} onClick={create}>{busy === 'create' ? 'Creating…' : 'Create compositions'}</button>
      <button type="button" className="export-button" disabled={Boolean(busy) || !ready} onClick={exportAll}>{busy === 'export' ? 'Queueing…' : 'Export all'}</button>
    </footer>
  </div></Modal>;
}

