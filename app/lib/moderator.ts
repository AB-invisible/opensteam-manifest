/**
 * Forge AI Moderation Utility
 * High-performance heuristics and pattern matching for script safety.
 */

import { callLlmWithFallback } from './llm-client'

export interface ModerationResult {
  status: 'APPROVED' | 'REJECTED' | 'PENDING';
  reason: string;
}

// Blocked patterns that indicate malicious intent or TOS violations
const MALICIOUS_PATTERNS = [
  { 
    regex: /fetch|XMLHttpRequest|axios|http\.request/i, 
    reason: 'External network requests are strictly forbidden in extraction scripts. Use manifest hooks instead.'
  },
  {
    regex: /localStorage|sessionStorage|indexedDB|cookie/i,
    reason: 'Browser storage access is forbidden to prevent cross-site data leaking.'
  },
  {
    regex: /eval|new Function|setTimeout\(.*['"].*['"]\)|setInterval\(.*['"].*['"]\)/i,
    reason: 'Dynamic code execution (eval) is disallowed for security reasons.'
  },
  {
    regex: /navigator\.userAgent|navigator\.platform|screen\.|fingerprint/i,
    reason: 'User fingerprinting or HWID tracking is against OpenSteam Forge TOS.'
  },
  {
    regex: /process\.|require\(|import\s+['"].*['"]/i,
    reason: 'Node.js environment escape detected. Standard extraction scripts must stay within the manifest sandbox.'
  },
  {
    regex: /location\.href|location\.assign|location\.replace/i,
    reason: 'URL redirection is forbidden.'
  }
];

const FORGE_TOS = `
### OpenSteam Forge Community Rules (TOS)
1. **No External Network Calls**: All manifest logic must be pure and use local context only.
2. **No Data Collection**: Scripts must not track user IP, HWID, or browser fingerprints.
3. **No Malicious Payloads**: Intentional damage to the extraction pipeline or user environment is a permanent ban.
4. **No Obfuscated Code**: All public scripts must be human-readable for review.
5. **No Token Grabbing**: Accessing user session or API keys results in legal action.
`;

async function llmModerationPass(content: string): Promise<ModerationResult | null> {
  try {
    const result = await callLlmWithFallback({
      messages: [
        {
          role: 'system',
          content:
            `You are a security reviewer for OpenSteam Forge extraction scripts. ${FORGE_TOS}\n` +
            'Reply with exactly one word: APPROVED, REJECTED, or PENDING. ' +
            'Use PENDING only when the script is ambiguous and needs human review. ' +
            'Then a pipe and a short reason, e.g. APPROVED|Looks safe.',
        },
        {
          role: 'user',
          content: `Review this script:\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``,
        },
      ],
      temperature: 0.1,
      max_tokens: 120,
      skipLocalLlm: true,
    })

    const raw = result?.message?.content?.trim() || ''
    const [verdict, ...reasonParts] = raw.split('|')
    const normalized = verdict?.toUpperCase().replace(/[^A-Z]/g, '')
    const reason = reasonParts.join('|').trim() || raw

    if (normalized === 'REJECTED') {
      return { status: 'REJECTED', reason: reason || 'Rejected by AI moderation.' }
    }
    if (normalized === 'PENDING') {
      return { status: 'PENDING', reason: reason || 'Queued for staff review.' }
    }
    if (normalized === 'APPROVED') {
      return { status: 'APPROVED', reason: reason || 'Approved by AI moderation.' }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Perform a multi-stage moderation check on a script content.
 */
export async function moderateScript(content: string): Promise<ModerationResult> {
  // Pass 1: Pattern Matching
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.regex.test(content)) {
      return {
        status: 'REJECTED',
        reason: `Violates Forge TOS: ${pattern.reason}`
      };
    }
  }

  // Pass 2: Heuristic Analysis (Length, Complexity)
  if (content.length < 3) {
    return { status: 'REJECTED', reason: 'Script is too short to be functional.' };
  }

  // Pass 3: Character analysis (Detecting obfuscation)
  const nonAscii = content.replace(/[\x00-\x7F]/g, '').length;
  if (nonAscii > content.length * 0.1) {
    return { status: 'REJECTED', reason: 'High density of non-ASCII characters detected. Obfuscated scripts are forbidden.' };
  }

  // Pass 4: LLM context-aware moderation
  const llmResult = await llmModerationPass(content)
  if (llmResult) return llmResult

  return {
    status: 'APPROVED',
    reason: 'Script passed automated security heuristics.'
  };
}

export function getForgeTOS() {
  return FORGE_TOS;
}
