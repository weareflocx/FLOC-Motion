// Undo history keeps reversible structural diffs between consecutive validated
// projects instead of full snapshots. Projects are treated as immutable plain
// JSON (`undefined` means absent): ops share subtrees with the projects they
// came from, and applying one copies only the objects along its path.
//
// Op shapes, `p` being a path of object keys, array indexes or `{ id }` items:
// - set:    { p, a, b }                  old/new value at an existing key or index
// - splice: { t: 'splice', p, at, a, b } array items removed/inserted at `at`
// - order:  { t: 'order', p, a, b, items } id lists of an id-keyed array plus its
//                                        removed (old) and added (new) items
// - keys:   { t: 'keys', p, a, b, items } key lists of an object plus its removed
//                                        (old) and added (new) [key, value] pairs
// `order` and `keys` precede the ops for the items both sides share, so they
// run before those going forward and after them going back.

export const HISTORY_LIMITS = { entries: 200, bytes: 8 * 1024 * 1024, documents: 10 };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
const definedKeys = object => Object.keys(object).filter(key => object[key] !== undefined);
const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
const keyed = list => { const ids = new Set(); return list.every(item => isObject(item) && typeof item.id === 'string' && !ids.has(item.id) && ids.add(item.id)); };
const mismatch = () => { throw new Error('Undo history no longer matches this composition.'); };

// Key order counts so restored projects serialize exactly like their snapshots.
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (!isObject(a) || !isObject(b)) return false;
  const keys = definedKeys(a);
  return sameList(keys, definedKeys(b)) && keys.every(key => equal(a[key], b[key]));
}

// `path` is a shared stack; ops keep a copy of it.
function diffValue(a, b, path, ops) {
  if (a === b) return;
  if (isObject(a) && isObject(b)) {
    const before = definedKeys(a), after = definedKeys(b);
    if (!sameList(before, after)) {
      const items = [...before.filter(key => own(b, key) === undefined).map(key => [key, a[key]]), ...after.filter(key => own(a, key) === undefined).map(key => [key, b[key]])];
      ops.push({ t: 'keys', p: path.slice(), a: before, b: after, items });
    }
    for (const key of after) if (own(a, key) !== undefined) diffChild(a[key], b[key], key, path, ops);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if ((a.length || b.length) && keyed(a) && keyed(b)) diffKeyed(a, b, path, ops);
    else diffList(a, b, path, ops);
  } else ops.push({ p: path.slice(), a, b });
}

function diffChild(a, b, segment, path, ops) {
  path.push(segment);
  diffValue(a, b, path, ops);
  path.pop();
}

// Items with unique ids (layers, images) are matched by id so inserting,
// removing or reordering one never rewrites its neighbours.
function diffKeyed(a, b, path, ops) {
  if (a.length === b.length && a.every((item, i) => item.id === b[i].id)) {
    b.forEach((item, i) => diffChild(a[i], item, { id: item.id }, path, ops));
    return;
  }
  const before = new Map(a.map(item => [item.id, item])), after = new Map(b.map(item => [item.id, item]));
  ops.push({ t: 'order', p: path.slice(), a: [...before.keys()], b: [...after.keys()], items: [...a.filter(item => !after.has(item.id)), ...b.filter(item => !before.has(item.id))] });
  for (const item of b) if (before.has(item.id)) diffChild(before.get(item.id), item, { id: item.id }, path, ops);
}

function diffList(a, b, path, ops) {
  if (a.length === b.length) { for (let i = 0; i < a.length; i++) diffChild(a[i], b[i], i, path, ops); return; }
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && equal(a[start], b[start])) start++;
  while (endA > start && endB > start && equal(a[endA - 1], b[endB - 1])) { endA--; endB--; }
  ops.push({ t: 'splice', p: path.slice(), at: start, a: a.slice(start, endA), b: b.slice(start, endB) });
}

/** Ops turning `before` into `after`; an empty list means the projects are equal. */
export function diffProjects(before, after) {
  const ops = [];
  diffValue(before, after, [], ops);
  return ops;
}

function locate(node, segment) {
  if (Array.isArray(node)) {
    const index = isObject(segment) ? node.findIndex(item => item?.id === segment.id) : segment;
    if (Number.isInteger(index) && index >= 0 && index < node.length) return index;
  } else if (isObject(node) && typeof segment === 'string' && Object.hasOwn(node, segment)) return segment;
  return mismatch();
}

function update(node, path, depth, fn) {
  if (depth === path.length) return fn(node);
  const key = locate(node, path[depth]);
  const copy = Array.isArray(node) ? node.slice() : { ...node };
  copy[key] = update(node[key], path, depth + 1, fn);
  return copy;
}

function applyOp(project, op, back) {
  const from = back ? 'b' : 'a', to = back ? 'a' : 'b';
  return update(project, op.p, 0, node => {
    if (!op.t) return op[to];
    if (op.t === 'keys') {
      if (!isObject(node)) return mismatch();
      const values = new Map([...op.items, ...Object.entries(node).filter(([, value]) => value !== undefined)]);
      return Object.fromEntries(op[to].map(key => values.has(key) ? [key, values.get(key)] : mismatch()));
    }
    if (!Array.isArray(node)) return mismatch();
    if (op.t === 'order') {
      const items = new Map([...op.items, ...node].map(item => [item.id, item]));
      return op[to].map(id => items.get(id) ?? mismatch());
    }
    const copy = node.slice();
    copy.splice(op.at, op[from].length, ...op[to]);
    return copy;
  });
}

export const applyDiff = (project, ops) => ops.reduce((value, op) => applyOp(value, op, false), project);
export const revertDiff = (project, ops) => ops.reduceRight((value, op) => applyOp(value, op, true), project);

const stackBytes = ({ past, future }) => [...past, ...future].reduce((sum, entry) => sum + entry.bytes, 0);

/** Appends an entry, dropping the oldest ones beyond the entry or byte budget. */
export function pushHistory(past, ops, { entries, bytes } = HISTORY_LIMITS) {
  // Approximate retained size: serialized ops as UTF-16 code units.
  const next = [...past, { ops, bytes: JSON.stringify(ops).length * 2 }];
  let total = stackBytes({ past: next, future: [] }), drop = 0;
  while (next.length - drop > 1 && (next.length - drop > entries || total > bytes)) total -= next[drop++].bytes;
  return drop ? next.slice(drop) : next;
}

/** Keeps a document's stacks for this session; the oldest documents go first. */
export function stashHistory(stashes, key, head, past, future, { documents, bytes } = HISTORY_LIMITS) {
  stashes.delete(key);
  if (past.length || future.length) stashes.set(key, { head, past, future });
  let total = 0;
  for (const stash of stashes.values()) total += stackBytes(stash);
  for (const [old, stash] of stashes) {
    if (stashes.size <= documents && total <= bytes) break;
    stashes.delete(old);
    total -= stackBytes(stash);
  }
}

/** Returns a document's stacks only when it reopens exactly as it was left. */
export function restoreHistory(stashes, key, project) {
  const stash = stashes.get(key);
  stashes.delete(key);
  return stash && !diffProjects(stash.head, project).length ? stash : null;
}
