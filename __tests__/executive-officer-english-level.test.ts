import { describe, it, expect } from 'vitest'
import {
  finalizeTypingMetrics,
  sanitizePerQuestionTyping,
  type QuestionTyping,
} from '@/app/lib/typing-metrics'
import { buildExecTimerState, isExecExpired, parseExecTimerState } from '@/app/lib/exec-timer'
import { scoreToHandledLevel } from '@/app/lib/exec-categories'
import {
  adjustDifficultyForHandling,
  quickCategoryScorePct,
} from '@/app/lib/exec-adaptive'
import type { ModQuestionMcq } from '@/app/lib/mod-assessment-types'
import {
  scoreToCefr,
  cambridgeExamForLevel,
  typingFluencyScore,
} from '@/app/lib/english-level'
import type { PromoTier } from '@/app/lib/promo-tiers'

const execTier = { examMinutes: 240 } as unknown as PromoTier

describe('scoreToCefr', () => {
  it('maps blended scores to CEFR bands', () => {
    expect(scoreToCefr(95)).toBe('C2')
    expect(scoreToCefr(80)).toBe('C1')
    expect(scoreToCefr(65)).toBe('B2')
    expect(scoreToCefr(50)).toBe('B1')
    expect(scoreToCefr(30)).toBe('A2')
    expect(scoreToCefr(10)).toBe('A1')
  })

  it('clamps out-of-range scores', () => {
    expect(scoreToCefr(1000)).toBe('C2')
    expect(scoreToCefr(-50)).toBe('A1')
  })
})

describe('cambridgeExamForLevel', () => {
  it('maps CEFR levels to Cambridge qualifications', () => {
    expect(cambridgeExamForLevel('B2')).toContain('First')
    expect(cambridgeExamForLevel('C1')).toContain('Advanced')
    expect(cambridgeExamForLevel('C2')).toContain('Proficiency')
  })
})

describe('typingFluencyScore', () => {
  it('is 0 when nothing was typed', () => {
    expect(typingFluencyScore(null)).toBe(0)
    expect(
      typingFluencyScore(finalizeTypingMetrics({})),
    ).toBe(0)
  })

  it('rewards fast, low-edit typing over slow, heavy-edit typing', () => {
    const fast = finalizeTypingMetrics({
      q1: { chars: 500, keystrokes: 520, backspaces: 10, activeMs: 120_000, firstKeyLatencyMs: 800 },
    })
    const slow = finalizeTypingMetrics({
      q1: { chars: 120, keystrokes: 260, backspaces: 90, activeMs: 180_000, firstKeyLatencyMs: 9000 },
    })
    expect(typingFluencyScore(fast)).toBeGreaterThan(typingFluencyScore(slow))
  })
})

describe('finalizeTypingMetrics', () => {
  it('computes WPM from active typing time (5 chars per word)', () => {
    // 500 chars = 100 words over 2 minutes => 50 wpm
    const m = finalizeTypingMetrics({
      q1: { chars: 500, keystrokes: 500, backspaces: 0, activeMs: 120_000, firstKeyLatencyMs: 500 },
    })
    expect(m.overall.words).toBe(100)
    expect(m.overall.wpm).toBeCloseTo(50, 0)
    expect(m.overall.questionsTyped).toBe(1)
    expect(m.overall.backspaceRate).toBe(0)
  })

  it('aggregates across questions and computes edit rate', () => {
    const per: Record<string, QuestionTyping> = {
      q1: { chars: 100, keystrokes: 100, backspaces: 20, activeMs: 60_000, firstKeyLatencyMs: 1000 },
      q2: { chars: 100, keystrokes: 100, backspaces: 0, activeMs: 60_000, firstKeyLatencyMs: 3000 },
    }
    const m = finalizeTypingMetrics(per)
    expect(m.overall.questionsTyped).toBe(2)
    expect(m.overall.totalBackspaces).toBe(20)
    expect(m.overall.backspaceRate).toBeCloseTo(0.1, 5)
    expect(m.overall.avgFirstKeyLatencyMs).toBe(2000)
  })
})

describe('sanitizePerQuestionTyping', () => {
  it('coerces and clamps hostile client input', () => {
    const out = sanitizePerQuestionTyping({
      q1: { chars: -5, keystrokes: 10, backspaces: 999, activeMs: 'nope', firstKeyLatencyMs: null },
    })
    expect(out.q1.chars).toBe(0)
    expect(out.q1.backspaces).toBeLessThanOrEqual(out.q1.keystrokes)
    expect(out.q1.activeMs).toBe(0)
    expect(out.q1.firstKeyLatencyMs).toBeNull()
  })

  it('ignores non-object input', () => {
    expect(sanitizePerQuestionTyping(null)).toEqual({})
    expect(sanitizePerQuestionTyping([1, 2, 3])).toEqual({})
  })
})

describe('scoreToHandledLevel', () => {
  it('maps category performance to handled tiers', () => {
    expect(scoreToHandledLevel(92)).toBe('exceptional')
    expect(scoreToHandledLevel(70)).toBe('competent')
    expect(scoreToHandledLevel(30)).toBe('below_expectation')
  })
})

describe('exec timer', () => {
  it('builds a 4-hour deadline and detects expiry with grace', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const state = buildExecTimerState(execTier, now)
    expect(state.exam).toBeTruthy()

    // Just before the deadline: not expired.
    const nearEnd = new Date(now.getTime() + 240 * 60_000 - 1000)
    expect(isExecExpired(state, nearEnd)).toBe(false)

    // Well after the deadline: expired.
    const past = new Date(now.getTime() + 240 * 60_000 + 60_000)
    expect(isExecExpired(state, past)).toBe(true)
  })

  it('treats missing timer as not expired', () => {
    expect(isExecExpired(parseExecTimerState(null))).toBe(false)
  })
})

describe('adaptive category difficulty', () => {
  it('raises tier after strong handling and lowers after weak', () => {
    expect(adjustDifficultyForHandling('expert', 'strong')).toBe('executive')
    expect(adjustDifficultyForHandling('expert', 'below_expectation')).toBe('advanced')
    expect(adjustDifficultyForHandling('expert', 'competent')).toBe('expert')
  })

  it('scores MCQ-only for fast adaptation between categories', () => {
    const qs: ModQuestionMcq[] = [
      { id: 'a', type: 'mcq', prompt: 'p', points: 10, correct: 'A', choices: { A: '1', B: '2', C: '3', D: '4' } },
      { id: 'b', type: 'mcq', prompt: 'p2', points: 10, correct: 'B', choices: { A: '1', B: '2', C: '3', D: '4' } },
    ]
    expect(quickCategoryScorePct(qs, { a: 'A', b: 'B' })).toBe(100)
    expect(quickCategoryScorePct(qs, { a: 'A', b: 'A' })).toBe(50)
  })
})
