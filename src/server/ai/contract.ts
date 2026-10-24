import { z } from 'zod';
import type { Department } from '../../shared/types.js';

/**
 * The model sees only this. Athlete names are replaced with per-brief labels
 * before the request leaves the server, and only sources approved for the
 * brief's audience are included.
 */
export interface AiNote {
  sourceId: string;
  department: Department;
  athleteLabel: string;
  date: string;
  text: string;
  requestedAction: string | null;
}

export interface AiRequest {
  huddleDate: string;
  audienceLabel: string;
  notes: AiNote[];
}

export const aiSummarySchema = z.object({
  sourceId: z.string().min(1),
  summary: z.string().min(1).max(400),
});

export const aiDisagreementSchema = z.object({
  athleteLabel: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(2).max(6),
  description: z.string().min(1).max(600),
  clarifyingQuestion: z.string().min(1).max(300),
});

export const aiEnvelopeSchema = z.object({
  summaries: z.array(aiSummarySchema).max(60),
  possibleDisagreements: z.array(aiDisagreementSchema).max(20),
});

export type AiEnvelope = z.infer<typeof aiEnvelopeSchema>;
export type AiDisagreement = z.infer<typeof aiDisagreementSchema>;

export interface AiProvider {
  readonly kind: 'mock' | 'azure';
  readonly label: string;
  /** Returns whatever the provider produced. Validation happens in validateAiOutput. */
  analyze(request: AiRequest): Promise<unknown>;
}

/**
 * Language that would make the model the decision maker. The product rule is
 * that the model summarizes and asks questions; people decide. An item that
 * breaks the rule is dropped and counted, never quietly rewritten.
 */
const PRESCRIPTIVE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(i|we)\s+recommend\b/i, reason: 'model_recommendation' },
  { pattern: /\byou\s+(should|must|need to)\b/i, reason: 'model_instruction' },
  {
    pattern: /\b(should|must)\s+be\s+(reduced|increased|stopped|capped|limited|cleared)\b/i,
    reason: 'model_instruction',
  },
  { pattern: /\bthe\s+(plan|athlete|player)\s+should\b/i, reason: 'model_instruction' },
  {
    pattern: /\b(cleared|clearance)\s+to\s+(play|return|throw|participate|train)\b/i,
    reason: 'medical_determination',
  },
  {
    pattern: /\b(diagnos\w+|prescrib\w+|treatment\s+plan|medication|rehab\s+protocol)\b/i,
    reason: 'medical_determination',
  },
  { pattern: /\brecommended?\s+(dose|load|volume|protocol|progression)\b/i, reason: 'model_prescription' },
  { pattern: /\bapprove[sd]?\s+(the|this)\s+(brief|decision)\b/i, reason: 'model_approval' },
];

export function findGuardrailBreach(text: string): string | null {
  for (const { pattern, reason } of PRESCRIPTIVE_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

export interface ValidationResult {
  envelope: AiEnvelope;
  rejections: string[];
}

/**
 * Rejects anything the provider made up. A summary or disagreement that cites a
 * source ID that was not in the request is discarded, as is anything that
 * breaches the guardrails. Rejections are counted and shown in the brief.
 */
export function validateAiOutput(raw: unknown, allowedSourceIds: string[]): ValidationResult {
  const allowed = new Set(allowedSourceIds);
  const rejections: string[] = [];

  const parsed = aiEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      envelope: { summaries: [], possibleDisagreements: [] },
      rejections: ['schema_invalid: the provider response did not match the required shape'],
    };
  }

  const summaries = parsed.data.summaries.filter((s) => {
    if (!allowed.has(s.sourceId)) {
      rejections.push(`fabricated_source_id: summary cited unknown source "${s.sourceId}"`);
      return false;
    }
    const breach = findGuardrailBreach(s.summary);
    if (breach) {
      rejections.push(`${breach}: summary for ${s.sourceId} was dropped`);
      return false;
    }
    return true;
  });

  const possibleDisagreements = parsed.data.possibleDisagreements.filter((d) => {
    const unknown = d.sourceIds.filter((id) => !allowed.has(id));
    if (unknown.length > 0) {
      rejections.push(
        `fabricated_source_id: possible disagreement cited unknown source(s) ${unknown.join(', ')}`,
      );
      return false;
    }
    if (new Set(d.sourceIds).size < 2) {
      rejections.push('insufficient_sources: a possible disagreement needs two distinct sources');
      return false;
    }
    const breach = findGuardrailBreach(`${d.description} ${d.clarifyingQuestion}`);
    if (breach) {
      rejections.push(`${breach}: possible disagreement was dropped`);
      return false;
    }
    return true;
  });

  return { envelope: { summaries, possibleDisagreements }, rejections };
}
