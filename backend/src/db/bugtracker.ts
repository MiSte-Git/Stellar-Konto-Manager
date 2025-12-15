import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type BugStatus = 'open' | 'in_progress' | 'closed';
export type BugPriority = 'low' | 'normal' | 'high' | 'urgent';

interface InsertBugInput {
  ts: string;
  url: string;
  userAgent: string;
  language: string;
  title: string;
  description: string | null;
  status: BugStatus;
  priority: BugPriority;
  appVersion: string | null;
}

export interface BugReportRecord extends InsertBugInput {
  id: number;
}

interface ListFilters {
  status?: BugStatus;
  priority?: BugPriority;
  limit?: number;
  offset?: number;
}

interface UpdatePayload {
  status?: BugStatus;
  priority?: BugPriority;
}

const allowedStatus: BugStatus[] = ['open', 'in_progress', 'closed'];
const allowedPriority: BugPriority[] = ['low', 'normal', 'high', 'urgent'];

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'bugtracker.sqlite');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    url TEXT,
    userAgent TEXT,
    language TEXT,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    appVersion TEXT
  )
`);

// Lightweight migration for existing installations.
try {
  const columns = db.prepare(`PRAGMA table_info(bug_reports)`).all() as Array<{ name: string }>;
  const hasTitle = columns.some((c) => c.name === 'title');
  if (!hasTitle) {
    db.exec(`ALTER TABLE bug_reports ADD COLUMN title TEXT`);
  }
} catch {
  // Ignore migration failures; the app can still run without the column.
}

// Inserts a bug report row and returns its generated identifier.
export const insertBug = (input: InsertBugInput): number => {
  const stmt = db.prepare(`
    INSERT INTO bug_reports (ts, url, userAgent, language, title, description, status, priority, appVersion)
    VALUES (@ts, @url, @userAgent, @language, @title, @description, @status, @priority, @appVersion)
  `);
  const info = stmt.run(input);
  return Number(info.lastInsertRowid);
};

// Lists bug report rows using optional filters and pagination.
export const listBugs = (filters: ListFilters = {}): { items: BugReportRecord[]; total: number } => {
  const limit = Number.isFinite(filters.limit) ? Number(filters.limit) : 50;
  const offset = Number.isFinite(filters.offset) ? Number(filters.offset) : 0;
  const conditions: string[] = [];
  const baseParams: Record<string, unknown> = {};
  if (filters.status) {
    conditions.push('status = @status');
    baseParams.status = filters.status;
  }
  if (filters.priority) {
    conditions.push('priority = @priority');
    baseParams.priority = filters.priority;
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const queryParams = { ...baseParams, limit, offset };
  const rows = db.prepare(`
    SELECT id, ts, url, userAgent, language, title, description, status, priority, appVersion
    FROM bug_reports
    ${whereClause}
    ORDER BY id DESC
    LIMIT @limit OFFSET @offset
  `).all(queryParams) as BugReportRecord[];
  const totalRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM bug_reports
    ${whereClause}
  `).get(baseParams) as { count: number };
  return { items: rows, total: totalRow?.count ?? 0 };
};

// Updates a bug report row with whitelisted fields.
export const updateBug = (id: number, payload: UpdatePayload): void => {
  const updates: string[] = [];
  const params: Record<string, unknown> = { id };
  if (payload.status) {
    if (!allowedStatus.includes(payload.status)) {
      throw new Error('bugReport.send.failed:invalidStatus');
    }
    updates.push('status = @status');
    params.status = payload.status;
  }
  if (payload.priority) {
    if (!allowedPriority.includes(payload.priority)) {
      throw new Error('bugReport.send.failed:invalidPriority');
    }
    updates.push('priority = @priority');
    params.priority = payload.priority;
  }
  if (updates.length === 0) {
    return;
  }
  const stmt = db.prepare(`UPDATE bug_reports SET ${updates.join(', ')} WHERE id = @id`);
  const result = stmt.run(params);
  if (result.changes === 0) {
    throw new Error('bugReport.send.failed:notFound');
  }
};

export default db;
