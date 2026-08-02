const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getKnowledgeBaseContext } = require('./kb-service');
const { processStaffMessageForLearning } = require('./kb-learning');

const DEFAULT_AI_CHANNEL_ID = '1475890665924591856';

// Cache AI channel config for 60s to avoid DB round-trip on every message
let _aiChannelIdsCache = null;
let _aiChannelIdsCacheAt = 0;

/**
 * Checks if a channel is configured as an AI Chat channel
 */
async function isAiChatChannel(channel, prisma) {
  if (!channel) return false;

  // Cache the channel IDs for 60s to avoid a DB hit on every single message
  const now = Date.now();
  if (!_aiChannelIdsCache || now - _aiChannelIdsCacheAt > 60_000) {
    let configuredIdString = process.env.DISCORD_AI_CHAT_CHANNEL_ID || process.env.AI_CHAT_CHANNEL_IDS || '';
    if (prisma) {
      try {
        const dbCfg = await prisma.systemConfig.findFirst({
          where: { key: { in: ['DISCORD_AI_CHAT_CHANNEL_ID', 'AI_CHAT_CHANNEL_IDS'] } },
        });
        if (dbCfg?.value) configuredIdString = dbCfg.value;
      } catch (_) {}
    }
    _aiChannelIdsCache = configuredIdString
      ? configuredIdString.split(',').map((id) => id.trim()).filter(Boolean)
      : [DEFAULT_AI_CHANNEL_ID];
    _aiChannelIdsCacheAt = now;
  }

  if (_aiChannelIdsCache.includes(channel.id)) return true;

  if (process.env.ALLOW_FUZZY_AI_CHANNEL_NAMES === 'true') {
    const name = (channel.name || '').toLowerCase();
    if (name.includes('ai-chat') || name.includes('ask-ai') || name.includes('ai-support') || name.includes('atis-ai')) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if human members are already talking to each other / helping each other in the channel.
 * Returns true if Atis should stay quiet ("dont mind it").
 */
function shouldIgnoreHumanConversation(message, client) {
  // If the user explicitly pinged/mentioned Atis, ALWAYS respond
  if (client?.user && message.mentions.has(client.user)) return false;

  // If message is a reply to another human, ignore it (uses cached message object — no fetch needed)
  if (message.reference?.messageId) {
    const cached = message.channel.messages?.cache?.get(message.reference.messageId);
    if (cached && !cached.author.bot && cached.author.id !== client?.user?.id) return true;
  }

  // If message explicitly mentions another human (not a bot and not Atis), ignore it
  const mentionedHumans = message.mentions.users.filter((u) => !u.bot && u.id !== client?.user?.id);
  if (mentionedHumans.size > 0) return true;

  return false;
}

/**
 * Calls local VPS LLM (Ollama) or external fallbacks with a human-like persona
 */
async function callLlmForDiscord(userQuery, kbContext) {
  const systemPrompt = `You are Atis, the official OpenSteam Personal Assistant (opensteam.lol).
Your job is to assist users in Discord with accurate platform knowledge, helpful answers, and friendly conversation.

OPENSTEAM PERSONAL ASSISTANT RULES:
1. EXPLAIN LIKE A HUMAN: Speak naturally, warmly, and conversationally as a personal assistant. Avoid sounding like a bot, a customer support agent, or reading from a manual.
2. USE GUIDES NATURALLY: Use the Knowledge Base context to ensure factual accuracy, but explain concepts in your own words. NEVER copy-paste raw guide text, blocky headers, or verbatim documentation pages ("do not spill it like from a guide").
3. NO UNRELATED TIPS: Answer ONLY what the user asked. Do NOT dump unsolicited "pro tips", manifest rules, or unrelated platform advice if it was not asked for.
4. OFF-TOPIC OR GENERAL CHAT: If the user asks something off-topic, casual, or general, answer naturally like a human personal assistant without forcing OpenSteam platform tips into the response.
5. CONCISE DISCORD STYLE: Keep your response clean, conversational, and direct (usually a few friendly sentences or short paragraphs). Avoid giant walls of text, unnecessary bulleted lists, or stiff bot templates.
6. MULTILINGUAL SUPPORT: You can understand and respond fluently in ANY language (English, Spanish, French, German, Russian, Arabic, Japanese, Chinese, Portuguese, Italian, Turkish, Polish, Dutch, etc.). Always reply naturally in the exact same language that the user spoke to you in!

KNOWLEDGE BASE CONTEXT (Use for facts, but rephrase naturally in your own human voice):
${kbContext}
`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userQuery },
  ];

  // 1. Primary VPS Local LLM (Ollama)
  const localBaseUrl = process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
  const nativeOllamaUrl = localBaseUrl.replace(/\/v1\/?$/, '');
  const candidateModels = [...new Set([
    process.env.LOCAL_LLM_MODEL,
    'qwen2.5:1.5b',
    'llama3:latest',
    'qwen',
    'llama3',
  ].filter(Boolean))];

  // Quick liveness check — if Ollama isn't up, skip straight to cloud (saves up to 60s)
  let ollamaAlive = false;
  try {
    await axios.get(`${nativeOllamaUrl}/api/tags`, { timeout: 2000 });
    ollamaAlive = true;
  } catch (_) {}

  if (ollamaAlive) {
    for (const localModel of candidateModels) {
      try {
        const res = await axios.post(
          `${localBaseUrl}/chat/completions`,
          { model: localModel, messages, temperature: 0.5, max_tokens: 600 },
          { timeout: 8000 }
        );
        if (res.data?.choices?.[0]?.message?.content) {
          return { content: res.data.choices[0].message.content, provider: `VPS Local LLM (${localModel})` };
        }
      } catch (_) {
        try {
          const nativeRes = await axios.post(
            `${nativeOllamaUrl}/api/generate`,
            { model: localModel, system: systemPrompt, prompt: userQuery, stream: false },
            { timeout: 8000 }
          );
          if (nativeRes.data?.response) {
            return { content: nativeRes.data.response, provider: `VPS Local LLM (${localModel})` };
          }
        } catch (_) {}
      }
      // Stop after first successful-looking model to avoid waiting on slow models
      break;
    }
  }


  // 2. AgentRouter Fallback (https://agentrouter.org — OpenAI-compatible gateway)
  if (process.env.AGENTROUTER_API_KEY) {
    try {
      const agentRouterBase = process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1';
      const agentRouterModel = process.env.AGENTROUTER_MODEL || 'auto';
      const providerLabel = process.env.AGENTROUTER_MODEL
        ? `AgentRouter (${process.env.AGENTROUTER_MODEL})`
        : 'AgentRouter';
      const res = await axios.post(
        `${agentRouterBase}/chat/completions`,
        {
          model: agentRouterModel,
          messages,
          temperature: 0.5,
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return { content: res.data.choices[0].message.content, provider: providerLabel };
      }
    } catch (_) {}
  }

  // 3. Groq Cloud Fallback
  if (process.env.GROQ_API_KEY) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages,
          temperature: 0.5,
          max_tokens: 1000,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return { content: res.data.choices[0].message.content, provider: 'Groq Cloud' };
      }
    } catch (_) {}
  }

  // 4. Google Gemini API Fallback
  if (process.env.GEMINI_API_KEY) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const res = await axios.post(
        geminiUrl,
        {
          contents: [
            {
              parts: [{ text: `${systemPrompt}\n\nUSER QUESTION: ${userQuery}` }],
            },
          ],
        },
        { timeout: 15000 }
      );
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return { content: text, provider: 'Google Gemini' };
      }
    } catch (_) {}
  }

  return {
    content: `Hey! On OpenSteam, main manifest scripts use **.lua** files (like \`main.lua\`). Depot **.manifest** files are optional metadata files and aren't always required. Check out [opensteam.lol/docs](http://opensteam.lol/docs) or ask me if you have any specific questions!`,
    provider: 'OpenSteam KB Engine',
  };
}

/**
 * Handles incoming Discord message in an AI channel, ticket channel, or bot mention
 */
async function handleDiscordAiMessage(message, client, prisma) {
  if (!message || message.author.bot) return false;

  // 1. Process Staff Learning from Tickets (Category ID 1444925897949053040)
  try {
    const learned = await processStaffMessageForLearning(message, prisma);
    if (learned) {
      // Message was logged for staff learning, proceed with normal processing
    }
  } catch (err) {
    console.error('[AI Chat] Staff learning check error:', err?.message || err);
  }

  // 2. Only respond inside the configured AI channel — mentions in other channels are ignored
  const isChannelMatch = await isAiChatChannel(message.channel, prisma);
  if (!isChannelMatch) {
    return false;
  }

  // 3. If humans are already talking to each other / helping each other, don't mind it!
  // BUT if they ping Atis directly in the channel, always respond.
  const ignoreHumanTalk = await shouldIgnoreHumanConversation(message, client);
  if (ignoreHumanTalk) {
    return false;
  }

  let queryText = message.content;
  if (client?.user) {
    const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
    queryText = queryText.replace(mentionRegex, '').trim();
  }

  if (!queryText) {
    await message.reply({
      content: "Hey! I'm Atis, your OpenSteam Personal Assistant. Feel free to ask me anything about manifests (`.lua`), API keys, verification, or ask me to join your voice chat!",
    }).catch(() => {});
    return true;
  }

  try {
    await message.channel.sendTyping().catch(() => {});
  } catch (_) {}

  const kbContext = getKnowledgeBaseContext(queryText);
  const llmResult = await callLlmForDiscord(queryText, kbContext);
  const responseContent = (llmResult.content || '').trim();

  if (!responseContent) return false;

  // Send conversational embed displaying the LLM source provider (VPS Local LLM, AgentRouter, Groq Cloud, or Google Gemini)
  const embed = new EmbedBuilder()
    .setDescription(responseContent.slice(0, 4000))
    .setColor(0x6366f1)
    .setFooter({ text: `Source: ${llmResult.provider}` });

  await message.reply({ embeds: [embed] }).catch(() => {
    message.channel.send({ content: `<@${message.author.id}>\n${responseContent}\n\n*Source: ${llmResult.provider}*` }).catch(() => {});
  });

  return true;
}

module.exports = {
  DEFAULT_AI_CHANNEL_ID,
  isAiChatChannel,
  shouldIgnoreHumanConversation,
  callLlmForDiscord,
  handleDiscordAiMessage,
};
