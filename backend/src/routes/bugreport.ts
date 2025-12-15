import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import type { BugPriority, BugStatus } from '../db/bugtracker';
import { insertBug, listBugs, updateBug } from '../db/bugtracker';

const router = Router();

const allowedStatus: BugStatus[] = ['open', 'in_progress', 'closed'];
const allowedPriority: BugPriority[] = ['low', 'normal', 'high', 'urgent'];

// Checks if a value is a non-empty string.
const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

// Normalizes incoming status fields against the allow list.
const normalizeStatus = (value: unknown): BugStatus | undefined => (
  allowedStatus.includes(value as BugStatus) ? value as BugStatus : undefined
);

// Normalizes incoming priority fields against the allow list.
const normalizePriority = (value: unknown): BugPriority | undefined => (
  allowedPriority.includes(value as BugPriority) ? value as BugPriority : undefined
);

// Handles POST /api/bugreport to create a new bug entry.
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    if (!isNonEmptyString(body.url)) {
      return res.status(400).json({ error: 'bugReport.invalidPayload.url' });
    }
    if (!isNonEmptyString(body.userAgent)) {
      return res.status(400).json({ error: 'bugReport.invalidPayload.userAgent' });
    }
    if (!isNonEmptyString(body.language)) {
      return res.status(400).json({ error: 'bugReport.invalidPayload.language' });
    }
    const title = isNonEmptyString(body.title)
      ? body.title.trim()
      : (isNonEmptyString(body.subject) ? body.subject.trim() : '');
    if (!title) {
      return res.status(400).json({ error: 'bugReport.invalidPayload.title' });
    }
    const ts = isNonEmptyString(body.ts) ? body.ts.trim() : new Date().toISOString();
    const description = typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null;
    const appVersion = typeof body.appVersion === 'string' && body.appVersion.trim().length > 0
      ? body.appVersion.trim()
      : null;
    const status = normalizeStatus(body.status) ?? 'open';
    const priority = normalizePriority(body.priority) ?? 'normal';
    const id = insertBug({
      ts,
      url: body.url.trim(),
      userAgent: body.userAgent.trim(),
      language: body.language.trim(),
      title,
      description,
      status,
      priority,
      appVersion
    });
    res.status(201).json({ id });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    next(new Error('bugReport.send.failed:' + detail));
  }
});

// Handles GET /api/bugreport to list bug entries.
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = normalizeStatus(req.query.status);
    const priority = normalizePriority(req.query.priority);
    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const offsetRaw = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const limitParsed = Number(limitRaw ?? 50);
    const offsetParsed = Number(offsetRaw ?? 0);
    const limit = Number.isFinite(limitParsed) ? Math.min(200, Math.max(1, limitParsed)) : 50;
    const offset = Number.isFinite(offsetParsed) ? Math.max(0, offsetParsed) : 0;
    const result = listBugs({ status, priority, limit, offset });
    res.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    next(new Error('bugReport.send.failed:' + detail));
  }
});

// Handles PATCH /api/bugreport/:id to update status/priority.
router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminSecret = process.env.BUGTRACKER_ADMIN_SECRET;
    if (!adminSecret || req.header('x-admin-secret') !== adminSecret) {
      return res.status(401).json({ error: 'bugReport.unauthorized' });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'bugReport.invalidId' });
    }
    const updates: { status?: BugStatus; priority?: BugPriority } = {};
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'status')) {
      const status = normalizeStatus(req.body.status);
      if (!status) {
        throw new Error('invalidStatus');
      }
      updates.status = status;
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'priority')) {
      const priority = normalizePriority(req.body.priority);
      if (!priority) {
        throw new Error('invalidPriority');
      }
      updates.priority = priority;
    }
    updateBug(id, updates);
    res.status(204).end();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    next(new Error('bugReport.send.failed:' + detail));
  }
});

export default router;
