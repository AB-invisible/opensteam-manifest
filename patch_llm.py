import sys

file_path = "b:/Backup/own-manifest/app/lib/llm-client.ts"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace local Ollama section
old_ollama = """          const res = await fetch(`${ollamaBase}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: options.signal,
          });"""

new_ollama = """          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(new Error('MODEL_TIMEOUT')), 6000);
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
          clearTimeout(timer);"""

if old_ollama in content:
    content = content.replace(old_ollama, new_ollama)
else:
    print("Could not find old_ollama")


# Replace Local LLM fallback catch
old_local_catch = """  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    console.error('[LLM Client] Local LLM fallback error:', err.message);
  }"""

new_local_catch = """  } catch (err: any) {
    if (options.signal?.aborted) throw err;
    if (err.name === 'AbortError' || err.message === 'MODEL_TIMEOUT') {
      console.warn('[LLM Client] Local Ollama timed out (6s).');
    } else {
      console.error('[LLM Client] Local LLM fallback error:', err.message);
    }
  }"""

if old_local_catch in content:
    content = content.replace(old_local_catch, new_local_catch)
else:
    print("Could not find old_local_catch")

# Replace Groq try catch
old_groq = """      try {
        const completion = await groq.chat.completions.create({
          messages: options.messages,
          model,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.max_tokens ?? 1024,
          tools: options.tools,
          tool_choice: options.tool_choice,
          response_format: options.response_format as any,
        }, { signal: options.signal });

        const msg = completion.choices?.[0]?.message;"""

new_groq = """      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error('MODEL_TIMEOUT')), 6000);
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

        const msg = completion.choices?.[0]?.message;"""

if old_groq in content:
    content = content.replace(old_groq, new_groq)
else:
    print("Could not find old_groq")

# Replace Groq catch
old_groq_catch = """      } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        const isRateLimit = e?.status === 429 || e?.message?.includes('rate_limit') || e?.message?.includes('Rate limit');
        if (isRateLimit) {
          console.warn(`[LLM Client] ${model} rate-limited, trying next model...`);
          continue; // Try next model in chain
        }
        console.warn(`[LLM Client] ${model} failed: ${e.message}`);
        break; // Non-rate-limit error — don't retry other models
      }"""

new_groq_catch = """      } catch (e: any) {
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
      }"""

if old_groq_catch in content:
    content = content.replace(old_groq_catch, new_groq_catch)
else:
    print("Could not find old_groq_catch")


with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("llm-client.ts patch complete")
