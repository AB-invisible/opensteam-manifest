import Groq from 'groq-sdk';

// Primary model, then fallbacks (each has its own independent rate limit on Groq)
const GROQ_MODEL_CHAIN = (process.env.GROQ_MODEL_CHAIN || [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
  'mixtral-8x7b-32768',
].join(',')).split(',').map(m => m.trim()).filter(Boolean);

// Gemini fallback (genuinely free tier — no credit card needed)
// https://ai.google.dev/gemini-api/docs/openai
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_MODEL_CHAIN || [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-1.5-flash',
].join(',')).split(',').map(m => m.trim()).filter(Boolean);

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_FALLBACK_MODELS = (process.env.ANTHROPIC_MODEL_CHAIN || [
  'claude-3-5-opus-latest',
  'claude-3-8-opus-latest',
  'claude-3-opus-20240229',
  'claude-3-5-sonnet-20241022',
].join(',')).split(',').map(m => m.trim()).filter(Boolean);

const LOCAL_LLM_BASE = process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen'

export interface LlmOptions {
  messages: any[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  tools?: any[];
  tool_choice?: any;
  response_format?: { type: string };
  signal?: AbortSignal;
  skipLocalLlm?: boolean;
}

export interface LlmMessage {
  role: string;
  content: string | null;
  tool_calls?: any[];
}

export interface LlmResult {
  message: LlmMessage;
  provider: 'groq' | 'gemini' | 'local' | 'openai' | 'anthropic';
  model: string;
}

/**
 * Universal LLM client.
 * Tries each Groq model in GROQ_MODEL_CHAIN (independent rate limits per model),
 * then falls back to Google Gemini free-tier if all Groq models are exhausted.
 * Finally falls back to Local Ollama if Gemini is exhausted or not configured.
 */
export async function callLlmWithFallback(options: LlmOptions): Promise<LlmResult | null> {
  // 1. Try Local Ollama first
  if (!options.skipLocalLlm) {
    try {
    const ollamaBase = LOCAL_LLM_BASE.replace(/\/v1\/?$/, '');

    // Check if Ollama is running
    let ollamaRunning = false;
    try {
      const ping = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (ping.ok) {
        ollamaRunning = true;
        // Find first available model if default not found
        const tags = await ping.json();
        const available: string[] = (tags.models || []).map((m: any) => m.name as string);
        if (available.length > 0) {
          // Use configured model if available, else first available
          const localModel = available.find(m => m.startsWith(LOCAL_LLM_MODEL)) || available[0];
          console.log(`[LLM Client] Using Ollama model: ${localModel}`);

          const body: any = {
            model: localModel,
            messages: options.messages,
            temperature: options.temperature ?? 0.3,
            max_tokens: options.max_tokens ?? 1024,
            stream: false,
          };
          if (options.tools) body.tools = options.tools;
          if (options.tool_choice) body.tool_choice = options.tool_choice;
          if (options.response_format) body.response_format = options.response_format;

          const localKey = process.env.LOCAL_LLM_API_KEY?.trim() || 'ollama';
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(new Error('MODEL_TIMEOUT')), 30000);
          if (options.signal) {
            options.signal.addEventListener('abort', () => ctrl.abort());
            if (options.signal.aborted) ctrl.abort();
          }

          const res = await fetch(`${ollamaBase}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          clearTimeout(timer);

          if (res.ok) {
            const json = await res.json();
            const msg = json.choices?.[0]?.message;
            if (msg) return { message: msg, provider: 'local', model: localModel };
          } else {
            const errText = await res.text().catch(() => '');
            console.warn(`[LLM Client] Ollama returned ${res.status}: ${errText}`);
          }
        } else {
          console.warn('[LLM Client] Ollama is running but no models are pulled yet.');
        }
      }
    } catch { /* not running */ }

    if (!ollamaRunning) {
      console.log('[LLM Client] Ollama not responding. Skipping background start (handled by setup script).');
    }
  } catch (err: any) {
    if (options.signal?.aborted) throw err;
    if (err.name === 'AbortError' || err.message === 'MODEL_TIMEOUT') {
      console.warn('[LLM Client] Local Ollama timed out (15s).');
    } else {
      console.error('[LLM Client] Local LLM fallback error:', err.message);
    }
  }
  }

  console.warn('[LLM Client] Local Ollama skipped, failed or unavailable. Falling back to Groq...');

  // 2. Fallback to Groq
  const groqKey = process.env.GROQ_API_KEY?.trim();

  // Build the model chain — if caller specifies a model, try it first
  const modelChain = options.model
    ? [options.model, ...GROQ_MODEL_CHAIN.filter(m => m !== options.model)]
    : GROQ_MODEL_CHAIN;

  if (groqKey) {
    const groq = new Groq({ apiKey: groqKey });
    for (const model of modelChain) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error('MODEL_TIMEOUT')), 15000);
        if (options.signal) {
          options.signal.addEventListener('abort', () => ctrl.abort());
          if (options.signal.aborted) ctrl.abort();
        }

        const completion = await groq.chat.completions.create({
          messages: options.messages,
          model,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.max_tokens ?? 1024,
          tools: options.tools,
          tool_choice: options.tool_choice,
          response_format: options.response_format as any,
        }, { signal: ctrl.signal });
        clearTimeout(timer);

        const msg = completion.choices?.[0]?.message;
        if (msg) {
          if (model !== modelChain[0]) {
            console.log(`[LLM Client] Used fallback Groq model: ${model}`);
          }
          return { message: msg as unknown as LlmMessage, provider: 'groq', model };
        }
      } catch (e: any) {
        if (options.signal?.aborted) throw e;
        if (e.name === 'AbortError' || e.message === 'MODEL_TIMEOUT') {
          console.warn(`[LLM Client] ${model} timed out, trying next model...`);
          continue;
        }
        const isRateLimit = e?.status === 429 || e?.message?.includes('rate_limit') || e?.message?.includes('Rate limit');
        if (isRateLimit) {
          console.warn(`[LLM Client] ${model} rate-limited, trying next model...`);
          continue; // Try next model in chain
        }
        console.warn(`[LLM Client] ${model} failed: ${e.message}`);
        break; // Non-rate-limit error — don't retry other models
      }
    }
    console.warn('[LLM Client] All Groq models exhausted or failed. Falling back to Gemini...');
  } else {
    console.warn('[LLM Client] No GROQ_API_KEY set, skipping Groq fallback.');
  }

  // 3. Fallback to Google Gemini (free tier, works on any PaaS)
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    for (const model of GEMINI_FALLBACK_MODELS) {
      try {
        console.log(`[LLM Client] Trying Gemini model: ${model}`);
        const body: any = {
          model,
          messages: options.messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.max_tokens ?? 1024,
          stream: false,
        };
        if (options.tools) body.tools = options.tools;
        if (options.tool_choice) body.tool_choice = options.tool_choice;
        if (options.response_format) body.response_format = options.response_format;

        const res = await fetch(`${GEMINI_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${geminiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const isRateLimit = res.status === 429 || errText.includes('RATE_LIMIT') || errText.includes('RESOURCE_EXHAUSTED');
          if (isRateLimit) {
            console.warn(`[LLM Client] Gemini ${model} rate-limited, trying next...`);
            continue;
          }
          console.warn(`[LLM Client] Gemini ${model} failed (${res.status}): ${errText}`);
          continue;
        }

        const json = await res.json();
        const msg = json.choices?.[0]?.message;
        if (msg) {
          return { message: msg, provider: 'gemini' as const, model };
        }
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        console.warn(`[LLM Client] Gemini ${model} error: ${err.message}`);
        continue;
      }
    }
    console.warn('[LLM Client] All Gemini models also failed.');
  } else {
    console.warn('[LLM Client] No GEMINI_API_KEY set, skipping Gemini fallback.');
  }

  // 4. Fallback to Anthropic (Claude)
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    for (const model of ANTHROPIC_FALLBACK_MODELS) {
      try {
        console.log(`[LLM Client] Trying Anthropic model: ${model}`);
        
        // Convert OpenAI messages to Anthropic
        let systemPrompt = '';
        const anthropicMessages = [];
        for (const m of options.messages) {
          if (m.role === 'system') {
            systemPrompt += m.content + '\n';
          } else {
            anthropicMessages.push({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.content || (m.tool_calls ? 'Tool response omitted' : '')
            });
          }
        }

        const body: any = {
          model,
          messages: anthropicMessages,
          max_tokens: options.max_tokens ?? 1024,
          temperature: options.temperature ?? 0.3,
        };
        
        if (systemPrompt) body.system = systemPrompt.trim();

        if (options.tools) {
          body.tools = options.tools.map((t: any) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
          }));
          if (options.tool_choice && typeof options.tool_choice === 'object' && options.tool_choice.function) {
            body.tool_choice = { type: 'tool', name: options.tool_choice.function.name };
          } else if (options.tool_choice === 'auto' || options.tool_choice === 'any') {
            body.tool_choice = { type: 'auto' };
          }
        }

        const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const isRateLimit = res.status === 429 || errText.includes('rate_limit');
          if (isRateLimit) {
            console.warn(`[LLM Client] Anthropic ${model} rate-limited, trying next...`);
            continue;
          }
          console.warn(`[LLM Client] Anthropic ${model} failed (${res.status}): ${errText}`);
          continue;
        }

        const json = await res.json();
        const msg: LlmMessage = { role: 'assistant', content: '', tool_calls: [] };
        
        if (json.content && Array.isArray(json.content)) {
          for (const block of json.content) {
            if (block.type === 'text') {
              msg.content += block.text;
            } else if (block.type === 'tool_use') {
              if (!msg.tool_calls) msg.tool_calls = [];
              msg.tool_calls.push({
                type: 'function',
                function: { name: block.name, arguments: JSON.stringify(block.input) }
              });
            }
          }
        }
        
        if (!msg.content) msg.content = null;
        if (msg.tool_calls?.length === 0) delete msg.tool_calls;

        return { message: msg, provider: 'anthropic', model };

      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        console.warn(`[LLM Client] Anthropic ${model} error: ${err.message}`);
        continue;
      }
    }
    console.warn('[LLM Client] All Anthropic models failed.');
  } else {
    console.warn('[LLM Client] No ANTHROPIC_API_KEY set, skipping Anthropic fallback.');
  }

  return null;
}
