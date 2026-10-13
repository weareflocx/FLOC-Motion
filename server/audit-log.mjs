import { database } from './database.mjs';

// Workspace activity for admins. Rows are append-only apart from retention, so ids stay
// contiguous and the newest AUDIT_RETENTION rows are exactly those above `last - AUDIT_RETENTION`.
export const AUDIT_RETENTION = 10000;
export const AUDIT_PAGE_LIMIT = 200;
const failure = message => Object.assign(new Error(message), { status: 400 });
const exportDetails = job => ({ name: job.name, format: job.format, resolution: job.resolution });

export function createAuditLog(data, { now = Date.now } = {}) {
  const db = database(data);
  function record({ actorId = null, action, target = null, details = {} }) {
    const { lastInsertRowid } = db.prepare('INSERT INTO audit_log (time, actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(now(), actorId, action, target?.type ?? null, target?.id ?? null, JSON.stringify(details));
    db.prepare('DELETE FROM audit_log WHERE id <= ?').run(Number(lastInsertRowid) - AUDIT_RETENTION);
  }
  return {
    record,
    // Newest first. Removed accounts keep their email through the removal entry while it is retained.
    page({ before, limit } = {}) {
      const cursor = before === undefined || before === null || before === '' ? Number.MAX_SAFE_INTEGER : Number(before);
      const size = limit === undefined || limit === null || limit === '' ? 50 : Number(limit);
      if (!Number.isSafeInteger(cursor) || cursor < 1) throw failure('Invalid activity cursor.');
      if (!Number.isSafeInteger(size) || size < 1 || size > AUDIT_PAGE_LIMIT) throw failure(`Request 1–${AUDIT_PAGE_LIMIT} activity entries.`);
      const rows = db.prepare(`SELECT a.id, a.time, a.actor_id, a.action, a.target_type, a.target_id, a.details,
          coalesce(u.email, (SELECT json_extract(r.details, '$.email') FROM audit_log r WHERE r.target_type = 'user' AND r.target_id = a.actor_id AND r.action = 'user.removed' ORDER BY r.id DESC LIMIT 1)) AS actor_email
        FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`).all(cursor, size + 1);
      const entries = rows.slice(0, size).map(row => ({
        id: row.id, time: new Date(row.time).toISOString(), action: row.action,
        actor: row.actor_id ? { id: row.actor_id, email: row.actor_email ?? null } : null,
        target: row.target_type ? { type: row.target_type, id: row.target_id } : null,
        details: JSON.parse(row.details)
      }));
      return { entries, next: rows.length > size ? entries.at(-1).id : null };
    },
    exportQueued: (actorId, job) => record({ actorId, action: 'export.queued', target: { type: 'export', id: job.id }, details: exportDetails(job) }),
    exportCancelled: (actorId, job) => record({ actorId, action: 'export.cancelled', target: { type: 'export', id: job.id }, details: exportDetails(job) }),
    // Outcomes arrive from the renderer, so they are attributed to whoever queued the export. Each export ends once.
    exportEnded(job) {
      if (job?.state !== 'done' && job?.state !== 'failed') return;
      const target = { type: 'export', id: job.id };
      if (db.prepare("SELECT 1 FROM audit_log WHERE target_type = 'export' AND target_id = ? AND action IN ('export.finished', 'export.failed')").get(job.id)) return;
      const queued = db.prepare("SELECT actor_id FROM audit_log WHERE target_type = 'export' AND target_id = ? AND action = 'export.queued'").get(job.id);
      const details = { ...exportDetails(job), ...(job.state === 'failed' && { message: String(job.message || '').slice(0, 300) }) };
      record({ actorId: queued?.actor_id ?? null, action: job.state === 'done' ? 'export.finished' : 'export.failed', target, details });
    }
  };
}
