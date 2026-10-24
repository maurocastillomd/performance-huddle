/**
 * Types shared by the API server and the web client.
 * Kept free of runtime dependencies so both builds can import it.
 */

export type Department =
  | 'strength_conditioning'
  | 'sports_science'
  | 'medical'
  | 'nutrition'
  | 'coaching';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  strength_conditioning: 'Strength & Conditioning',
  sports_science: 'Sports Science',
  medical: 'Medical',
  nutrition: 'Nutrition',
  coaching: 'Coaching',
};

/** Capabilities are resolved server-side from the staff directory, never from the client. */
export type Permission = 'submit' | 'approve';

export interface Audience {
  id: string;
  orgId: string;
  name: string;
  /** Sensitive audiences carry approved participation guidance and are labelled in the UI. */
  sensitive: boolean;
  description: string;
}

export interface Organization {
  id: string;
  name: string;
  level: string;
}

export interface StaffUser {
  id: string;
  orgId: string;
  name: string;
  title: string;
  department: Department;
  permissions: Permission[];
  audienceIds: string[];
  /** A disabled account is denied on the next request, with no cache in between. */
  disabled: boolean;
  /**
   * Microsoft Entra ID object id, when the organization has provisioned one.
   * Empty in the demo: the demo never touches a real directory.
   */
  entraObjectId?: string | null;
}

export interface Athlete {
  id: string;
  orgId: string;
  name: string;
  position: string;
  jersey: number;
}

/** A time block a department has planned for an athlete. Used for deterministic overlap detection. */
export interface PlannedBlock {
  /** ISO date, YYYY-MM-DD, in the club's local time. */
  date: string;
  /** HH:MM 24h local. */
  start: string;
  end: string;
  label: string;
}

export type UpdateStatus = 'submitted' | 'approved' | 'withdrawn';

export interface UpdateRevision {
  revisedAt: string;
  revisedBy: string;
  note: string;
  previousBody: string;
}

export interface Update {
  id: string;
  orgId: string;
  athleteId: string;
  department: Department;
  /** The operational update itself. Treated as untrusted text everywhere downstream. */
  body: string;
  requestedAction: string | null;
  /** The owner of the requested action. Null is a real state the brief surfaces. */
  requestedActionOwnerId: string | null;
  audienceId: string;
  /** ISO date. Past this date the guidance is stale and the brief says so. */
  reviewDate: string;
  authorId: string;
  createdAt: string;
  status: UpdateStatus;
  /** Set when this update replaces an earlier one. */
  supersedesUpdateId: string | null;
  plannedBlock: PlannedBlock | null;
  revisions: UpdateRevision[];
}

export type BriefSectionKey =
  | 'whatChanged'
  | 'scheduleConflicts'
  | 'possibleDisagreements'
  | 'outdatedInformation'
  | 'actionsMissingOwner';

export const BRIEF_SECTION_ORDER: BriefSectionKey[] = [
  'whatChanged',
  'scheduleConflicts',
  'possibleDisagreements',
  'outdatedInformation',
  'actionsMissingOwner',
];

export const BRIEF_SECTION_LABELS: Record<BriefSectionKey, string> = {
  whatChanged: 'What changed',
  scheduleConflicts: 'Scheduling conflicts',
  possibleDisagreements: 'Possible disagreements',
  outdatedInformation: 'Outdated information',
  actionsMissingOwner: 'Actions missing an owner',
};

export const BRIEF_SECTION_HELP: Record<BriefSectionKey, string> = {
  whatChanged: 'New and revised updates since the last approved brief. Computed in code.',
  scheduleConflicts: 'Planned blocks for the same athlete that overlap in time. Computed in code.',
  possibleDisagreements:
    'Departments that may be asking for opposite things. Drafted by a model, not confirmed. A person decides.',
  outdatedInformation: 'Guidance whose review date has passed. Computed in code.',
  actionsMissingOwner: 'Requested actions and decisions with nobody assigned. Computed in code.',
};

export type ItemOrigin = 'deterministic' | 'ai';
export type ItemReviewState = 'needs_review' | 'confirmed' | 'edited' | 'dismissed';
/** Flags are advisory markers rendered next to an item; they never change workflow state. */
export type ItemFlag = 'untrusted_content' | 'sensitive_source' | 'ai_unverified';

export interface BriefItem {
  id: string;
  section: BriefSectionKey;
  origin: ItemOrigin;
  title: string;
  detail: string;
  /** Every item links back to the updates it came from. Never empty. */
  sourceUpdateIds: string[];
  athleteId: string | null;
  reviewState: ItemReviewState;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Only present on AI items: a question for a person to ask, never an instruction. */
  clarifyingQuestion: string | null;
  /** Set when the item was raised by an existing decision rather than an update alone. */
  relatedDecisionId: string | null;
  flags: ItemFlag[];
}

export type BriefStatus = 'draft' | 'approved' | 'invalidated';

export interface AiRunInfo {
  provider: 'mock' | 'azure';
  label: string;
  available: boolean;
  /** Set when the provider failed or was unreachable. The brief still ships. */
  unavailableReason: string | null;
  itemsProposed: number;
  itemsRejected: number;
  rejectionReasons: string[];
}

export interface AiSummary {
  sourceUpdateId: string;
  /** A model-written sentence about the note. An interpretation, not a fact. */
  summary: string;
}

export interface Brief {
  id: string;
  orgId: string;
  audienceId: string;
  /** The huddle date, ISO YYYY-MM-DD. */
  date: string;
  status: BriefStatus;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  invalidatedReason: string | null;
  items: BriefItem[];
  sourceUpdateIds: string[];
  aiSummaries: AiSummary[];
  ai: AiRunInfo;
}

export type DecisionStatus = 'open' | 'completed' | 'superseded';

export interface Decision {
  id: string;
  orgId: string;
  audienceId: string;
  athleteId: string | null;
  action: string;
  ownerId: string | null;
  rationale: string;
  dueDate: string | null;
  reviewDate: string | null;
  status: DecisionStatus;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  supersedesDecisionId: string | null;
  supersededByDecisionId: string | null;
  sourceUpdateIds: string[];
  briefId: string | null;
}

export interface SessionInfo {
  user: {
    id: string;
    name: string;
    title: string;
    department: Department;
    orgId: string;
    orgName: string;
    permissions: Permission[];
    audiences: Audience[];
  };
  demoMode: boolean;
  aiProviderLabel: string;
  aiProviderKind: 'mock' | 'azure';
}

export interface ApiError {
  error: string;
  message: string;
}
