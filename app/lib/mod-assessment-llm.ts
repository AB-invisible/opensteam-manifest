import { callLlmWithFallback } from './llm-client';

export type ModAssessmentChatBody = {
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
  skipLocalLlm?: boolean;
};

/**
 * POST /chat/completions using the centralized LLM client.
 * Prioritizes Groq and automatically falls back to local LLM if rate limited or overloaded.
 */
export async function modAssessmentChatCompletion(
  body: ModAssessmentChatBody
): Promise<{ content: string; label: string }> {
  try {
    const result = await callLlmWithFallback({
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      response_format: body.response_format,
      skipLocalLlm: body.skipLocalLlm,
    });
    
    if (!result || !result.message || typeof result.message.content !== 'string' || !result.message.content.trim()) {
      throw new Error("Received empty or invalid completion from all configured LLM models.");
    }
    
    return {
      content: result.message.content,
      label: `${result.provider}:${result.model}`
    };
  } catch (err: any) {
    throw new Error(`Moderator assessment LLM error: ${err.message}`);
  }
}
