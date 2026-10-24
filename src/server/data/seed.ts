import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Decision, Update } from '../../shared/types.js';
import { addDays } from '../clock.js';
import type { SeedBundle } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/server/data -> project root, and dist/server/data -> project root.
const PROJECT_ROOT = path.resolve(here, '..', '..', '..');
const SEED_DIR = path.join(PROJECT_ROOT, 'data', 'seed');

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), 'utf8')) as T;
}

/** A local timestamp string that sorts correctly and stays readable. */
function stamp(date: string, time: string): string {
  return `${date}T${time}:00`;
}

interface SeedUpdate extends Omit<Update, 'createdAt' | 'reviewDate' | 'plannedBlock' | 'revisions'> {
  createdDayOffset: number;
  createdTime: string;
  reviewDayOffset: number;
  plannedBlock: { dayOffset: number; start: string; end: string; label: string } | null;
  revisions: {
    revisedDayOffset: number;
    revisedTime: string;
    revisedBy: string;
    note: string;
    previousBody: string;
  }[];
}

interface SeedDecision
  extends Omit<Decision, 'createdAt' | 'dueDate' | 'reviewDate' | 'completedAt'> {
  createdDayOffset: number;
  dueDayOffset: number | null;
  reviewDayOffset: number | null;
  completedDayOffset: number | null;
}

/**
 * Builds the synthetic dataset relative to an anchor date so the demo always
 * reads as "this week" while tests pin the anchor and get identical output.
 */
export function loadSeed(anchorDate: string): SeedBundle {
  const rawUpdates = readJson<SeedUpdate[]>('updates.json');
  const rawDecisions = readJson<SeedDecision[]>('decisions.json');

  const updates: Update[] = rawUpdates.map((u) => {
    const createdDate = addDays(anchorDate, u.createdDayOffset);
    return {
      id: u.id,
      orgId: u.orgId,
      athleteId: u.athleteId,
      department: u.department,
      body: u.body,
      requestedAction: u.requestedAction,
      requestedActionOwnerId: u.requestedActionOwnerId,
      audienceId: u.audienceId,
      reviewDate: addDays(anchorDate, u.reviewDayOffset),
      authorId: u.authorId,
      createdAt: stamp(createdDate, u.createdTime),
      status: u.status,
      supersedesUpdateId: u.supersedesUpdateId,
      plannedBlock: u.plannedBlock
        ? {
            date: addDays(anchorDate, u.plannedBlock.dayOffset),
            start: u.plannedBlock.start,
            end: u.plannedBlock.end,
            label: u.plannedBlock.label,
          }
        : null,
      revisions: u.revisions.map((r) => ({
        revisedAt: stamp(addDays(anchorDate, r.revisedDayOffset), r.revisedTime),
        revisedBy: r.revisedBy,
        note: r.note,
        previousBody: r.previousBody,
      })),
    };
  });

  const decisions: Decision[] = rawDecisions.map((d) => ({
    id: d.id,
    orgId: d.orgId,
    audienceId: d.audienceId,
    athleteId: d.athleteId,
    action: d.action,
    ownerId: d.ownerId,
    rationale: d.rationale,
    dueDate: d.dueDayOffset === null ? null : addDays(anchorDate, d.dueDayOffset),
    reviewDate: d.reviewDayOffset === null ? null : addDays(anchorDate, d.reviewDayOffset),
    status: d.status,
    createdBy: d.createdBy,
    createdAt: stamp(addDays(anchorDate, d.createdDayOffset), '12:00'),
    completedAt:
      d.completedDayOffset === null ? null : stamp(addDays(anchorDate, d.completedDayOffset), '12:00'),
    supersedesDecisionId: d.supersedesDecisionId,
    supersededByDecisionId: d.supersededByDecisionId,
    sourceUpdateIds: d.sourceUpdateIds,
    briefId: d.briefId,
  }));

  return {
    organizations: readJson('organizations.json'),
    audiences: readJson('audiences.json'),
    users: readJson('users.json'),
    athletes: readJson('athletes.json'),
    updates,
    decisions,
  };
}
