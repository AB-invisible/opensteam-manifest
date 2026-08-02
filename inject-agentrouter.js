/**
 * inject-agentrouter.js
 *
 * Patches scripts/lib/discord-ai-chat.js to add AgentRouter
 * (https://agentrouter.org) as the 2nd fallback in the LLM chain:
 *
 *   Ollama (local) → AgentRouter → Groq → Gemini → static fallback
 *
 * Usage:  node inject-agentrouter.js
 *
 * Requires env var:  AGENTROUTER_API_KEY
 * Optional env var:  AGENTROUTER_MODEL  (default: gpt-4o-mini)
 *                    AGENTROUTER_BASE_URL (default: https://agentrouter.org/v1)
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'scripts/lib/discord-ai-chat.js');

// Guard — don't double-inject
const content = fs.readFileSync(TARGET, 'utf8');
if (content.includes('agentrouter.org') || content.includes('AGENTROUTER')) {
  console.log('✅ AgentRouter already injected — nothing to do.');
  process.exit(0);
}

// The code block to inject — drops in right before the Groq fallback comment
const injection = `
  // 2. AgentRouter Fallback (https://agentrouter.org — OpenAI-compatible gateway)
  if (process.env.AGENTROUTER_API_KEY) {
    try {
      const agentRouterBase = process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1';
      const agentRouterModel = process.env.AGENTROUTER_MODEL || 'gpt-4o-mini';
      const res = await axios.post(
        \`\${agentRouterBase}/chat/completions\`,
        {
          model: agentRouterModel,
          messages,
          temperature: 0.3,
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: \`Bearer \${process.env.AGENTROUTER_API_KEY}\`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return { content: res.data.choices[0].message.content, provider: \`AgentRouter (\${agentRouterModel})\` };
      }
    } catch (_) {}
  }

`;

// Find the Groq block marker and inject before it
const GROQ_MARKER = '  // 2. Groq Cloud Fallback';
if (!content.includes(GROQ_MARKER)) {
  console.error('❌ Could not find Groq fallback marker in discord-ai-chat.js.');
  console.error('   The file may have been modified. Check the marker text and update this script.');
  process.exit(1);
}

// Renumber the existing fallbacks (2→3, 3→4) so the numbering stays clean
const patched = content
  .replace(injection, '') // safety: strip any partial injection
  .replace('  // 2. Groq Cloud Fallback', injection + '  // 3. Groq Cloud Fallback')
  .replace('  // 3. Google Gemini API Fallback', '  // 4. Google Gemini API Fallback');

fs.writeFileSync(TARGET, patched, 'utf8');
console.log('✅ AgentRouter injected into scripts/lib/discord-ai-chat.js');
console.log('   Chain is now: Ollama → AgentRouter → Groq → Gemini → static fallback');
console.log('');
console.log('   Add to your .env:');
console.log('   AGENTROUTER_API_KEY=your_key_here');
console.log('   AGENTROUTER_MODEL=gpt-4o-mini   # optional, default: gpt-4o-mini');
