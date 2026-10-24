import { DEPARTMENT_LABELS } from '../../shared/types.js';
import { detectUntrustedContent } from '../domain/deterministic.js';
import type { AiNote, AiProvider, AiRequest } from './contract.js';

/**
 * Deterministic stand-in for a language model. It makes no network calls.
 *
 * It does real, if simple, work: it splits each note into sentences, tags each
 * sentence with a training-load topic and a direction, and reports where two
 * departments point in opposite directions on the same topic for the same
 * athlete. Same input, same output, every time. Output is labelled as mock
 * everywhere it is shown.
 */

const UP_TERMS = [
  'increase', 'increases', 'increasing', 'add', 'adds', 'adding', 'additional', 'extra',
  'more', 'raise', 'raises', 'raising', 'boost', 'ramp', 'heavier', 'higher', 'harder',
  'up', 'build',
];

const DOWN_TERMS = [
  'reduce', 'reduces', 'reducing', 'decrease', 'decreases', 'decreasing', 'less', 'fewer',
  'cut', 'cap', 'caps', 'capped', 'limit', 'limits', 'limited', 'lower', 'hold', 'holds',
  'pull', 'back off', 'scale back', 'ease',
];

type Topic = 'running_load' | 'throwing_load' | 'lifting_load' | 'hitting_work' | 'fueling' | 'sleep';

const TOPIC_TERMS: Record<Topic, string[]> = {
  running_load: ['running', 'run', 'runs', 'sprint', 'sprints', 'conditioning', 'cardio'],
  throwing_load: ['throwing', 'throw', 'throws', 'bullpen', 'pitch', 'pitches', 'pitching', 'mound'],
  lifting_load: ['lift', 'lifts', 'lifting', 'squat', 'squats', 'strength', 'weight'],
  hitting_work: ['hitting', 'swings', 'cage', 'reps', 'batting'],
  fueling: ['carbohydrate', 'carbohydrates', 'carbs', 'fuel', 'fueling', 'calories', 'shake', 'hydration', 'protein'],
  sleep: ['sleep', 'nap', 'bedtime', 'strap'],
};

const TOPIC_LABELS: Record<Topic, string> = {
  running_load: 'running load',
  throwing_load: 'throwing load',
  lifting_load: 'lifting load',
  hitting_work: 'hitting work',
  fueling: 'fueling',
  sleep: 'sleep',
};

interface Claim {
  note: AiNote;
  topic: Topic;
  direction: 'up' | 'down';
  quote: string;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function tokens(sentence: string): Set<string> {
  return new Set(sentence.toLowerCase().match(/[a-z]+/g) ?? []);
}

function countTerms(sentence: string, terms: string[], toks: Set<string>): number {
  const lower = sentence.toLowerCase();
  let n = 0;
  for (const term of terms) {
    if (term.includes(' ')) {
      if (lower.includes(term)) n += 1;
    } else if (toks.has(term)) {
      n += 1;
    }
  }
  return n;
}

function trimQuote(sentence: string): string {
  return sentence.length <= 140 ? sentence : `${sentence.slice(0, 137)}...`;
}

function claimsFrom(note: AiNote): Claim[] {
  const claims: Claim[] = [];
  for (const sentence of splitSentences(note.text)) {
    // A sentence that looks like an injected instruction is never turned into a claim.
    if (detectUntrustedContent(sentence)) continue;
    const toks = tokens(sentence);
    const up = countTerms(sentence, UP_TERMS, toks);
    const down = countTerms(sentence, DOWN_TERMS, toks);
    if (up === down) continue;
    const direction: 'up' | 'down' = up > down ? 'up' : 'down';
    for (const topic of Object.keys(TOPIC_TERMS) as Topic[]) {
      if (countTerms(sentence, TOPIC_TERMS[topic], toks) === 0) continue;
      claims.push({ note, topic, direction, quote: trimQuote(sentence) });
    }
  }
  return claims;
}

function summarize(note: AiNote): string {
  const sentences = splitSentences(note.text);
  const clean = sentences.find((s) => !detectUntrustedContent(s));
  const lead = clean
    ? trimQuote(clean)
    : 'Withheld. Every sentence in this note reads as an attempt to give the assistant orders. Open the source.';
  const action = note.requestedAction ? ` Requested action on file: ${note.requestedAction}.` : '';
  return `${DEPARTMENT_LABELS[note.department]}, ${note.date}: ${lead}${action}`;
}

export class MockAiProvider implements AiProvider {
  readonly kind = 'mock' as const;
  readonly label = 'Mock provider (deterministic, no external calls)';

  async analyze(request: AiRequest): Promise<unknown> {
    const summaries = request.notes.map((note) => ({
      sourceId: note.sourceId,
      summary: summarize(note),
    }));

    const byAthlete = new Map<string, Claim[]>();
    for (const note of request.notes) {
      for (const claim of claimsFrom(note)) {
        const list = byAthlete.get(note.athleteLabel) ?? [];
        list.push(claim);
        byAthlete.set(note.athleteLabel, list);
      }
    }

    const possibleDisagreements: {
      athleteLabel: string;
      sourceIds: string[];
      description: string;
      clarifyingQuestion: string;
    }[] = [];

    for (const [athleteLabel, claims] of [...byAthlete.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const seenTopics = new Set<Topic>();
      for (const a of claims) {
        for (const b of claims) {
          if (a.topic !== b.topic) continue;
          if (seenTopics.has(a.topic)) continue;
          if (a.direction === b.direction) continue;
          if (a.note.department === b.note.department) continue;
          if (a.note.sourceId === b.note.sourceId) continue;

          const upSide = a.direction === 'up' ? a : b;
          const downSide = a.direction === 'up' ? b : a;
          seenTopics.add(a.topic);
          possibleDisagreements.push({
            athleteLabel,
            sourceIds: [upSide.note.sourceId, downSide.note.sourceId],
            description:
              `${DEPARTMENT_LABELS[upSide.note.department]} and ${DEPARTMENT_LABELS[downSide.note.department]} ` +
              `point in opposite directions on ${TOPIC_LABELS[a.topic]}. ` +
              `${DEPARTMENT_LABELS[upSide.note.department]} wrote: "${upSide.quote}" ` +
              `${DEPARTMENT_LABELS[downSide.note.department]} wrote: "${downSide.quote}"`,
            clarifyingQuestion:
              `Which instruction stands for ${athleteLabel}'s ${TOPIC_LABELS[a.topic]} this week, ` +
              `and who confirms it with the athlete?`,
          });
        }
      }
    }

    return { summaries, possibleDisagreements };
  }
}
