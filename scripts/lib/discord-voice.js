const axios = require('axios');
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    const fs = require('fs');
    if (!fs.existsSync(ffmpegPath)) {
      console.log('[Voice Engine] ffmpeg binary missing. Executing ffmpeg-static install...');
      try {
        require('ffmpeg-static/install');
      } catch (iErr) {
        console.warn('[Voice Engine] Auto-installing ffmpeg binary failed:', iErr?.message || iErr);
      }
    }
    process.env.FFMPEG_PATH = ffmpegPath;
  }
} catch (_) {}

const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  entersState,
  StreamType,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');

// Store active voice connections & audio players per guild
// Key: guildId -> Value: { connection, player, channelId }
const activeVoiceConnections = new Map();

/**
 * Automatically detects language code (e.g. 'en', 'es', 'fr', 'de', 'ru', 'ar', 'ja', 'zh') for TTS
 */
function detectLanguageCode(text) {
  if (!text) return 'en';

  // 1. Script-based detection for non-Latin scripts
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'; // Cyrillic (Russian)
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'; // Arabic
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'; // Japanese
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'; // Chinese
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'; // Korean
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th'; // Thai
  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Hindi

  // 2. Vocabulary-based detection for Latin-script languages
  const lower = text.toLowerCase();
  if (/\b(hola|gracias|por favor|amigo|buenas|cómo|estás|que|para|con|bien|todos)\b/i.test(lower)) return 'es';
  if (/\b(bonjour|merci|oui|comment|vous|avec|pour|salut|français|bien)\b/i.test(lower)) return 'fr';
  if (/\b(hallo|danke|bitte|wie|geht|und|mit|deutsch|nein|guten)\b/i.test(lower)) return 'de';
  if (/\b(obrigado|obrigada|olá|como|você|tudo|bom|português)\b/i.test(lower)) return 'pt';
  if (/\b(ciao|grazie|come|stai|per favore|buongiorno|italiano)\b/i.test(lower)) return 'it';
  if (/\b(merhaba|teşekkürler|evet|hayır|nasıl|türkçe)\b/i.test(lower)) return 'tr';
  if (/\b(czesc|dziękuję|dziekuje|jak|tak|nie|polski)\b/i.test(lower)) return 'pl';
  if (/\b(hallo|dank|alsjeblieft|hoe|nederlands)\b/i.test(lower)) return 'nl';

  // 3. Fallback diacritics for Vietnamese
  if (/[ảãạấẩẫậằắẳẵặẻẽẹếểễệỉĩịỏõọốổỗộớởỡợủũụứửữựỷỹỵđ]/i.test(text)) return 'vi';

  return 'en';
}

/**
 * Checks if text expresses an intent for Atis to join voice chat naturally
 */
function isJoinVoiceIntent(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  // Short direct phrases
  if (/^(join|join me|join us|join vc|join voice|come in|come join|join call)$/i.test(lower)) {
    return true;
  }

  // Keywords combination (action + target)
  const hasAction = /\b(join|come|hop|get|connect|enter|jump)\b/i.test(lower);
  const hasTarget = /\b(voice|vc|call|channel|talk|speak|here|me|us|room)\b/i.test(lower);

  return hasAction && hasTarget;
}

/**
 * Checks if text expresses an intent for Atis to leave voice chat naturally
 */
function isLeaveVoiceIntent(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  // Short direct phrases
  if (/^(leave|leave vc|leave voice|disconnect|bye|bye atis|exit)$/i.test(lower)) {
    return true;
  }

  const hasAction = /\b(leave|exit|disconnect|quit|get out|bye)\b/i.test(lower);
  const hasTarget = /\b(voice|vc|call|channel|room)\b/i.test(lower);

  return hasAction && (hasTarget || lower.includes('leave') || lower.includes('disconnect'));
}

/**
 * Calls LLM with a super chill, friendly, casual buddy persona for voice chit-chat
 * Supports multiple languages and returns { content, provider }
 */
async function callLlmForVoiceChat(userQuery, userName = 'Friend') {
  const systemPrompt = `You are Atis, the OpenSteam Personal Assistant!
You are hanging out with your friends in a Discord Voice Call as their personal assistant and buddy.

OPENSTEAM PERSONAL ASSISTANT RULES:
1. TALK LIKE A FRIEND: Be warm, friendly, helpful, and conversational—just like a personal assistant hanging out with good friends in a voice call.
2. CASUAL CHIT-CHAT & ASSISTANCE: You can chat casually about games, life, hobbies, or assist with any OpenSteam questions ${userName} mentions.
3. SPOKEN STYLE: Keep your answers short, concise, and easy to speak and listen to (1-3 natural sentences). NEVER use markdown symbols like bold (**), code blocks (\`\`\`), bulleted lists, or formal customer support language that sounds unnatural when spoken aloud.
4. MULTILINGUAL SUPPORT: You can understand and converse fluently in ANY language (English, Spanish, French, German, Russian, Arabic, Japanese, Chinese, Portuguese, Italian, Turkish, etc.). Always respond naturally in the exact same language that ${userName} speaks to you in!
`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${userName} says: "${userQuery}"` },
  ];

  // 1. Primary Local LLM (Ollama)
  const localBaseUrl = process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
  const nativeOllamaUrl = localBaseUrl.replace(/\/v1\/?$/, '');
  const candidateModels = [...new Set([
    process.env.LOCAL_LLM_MODEL,
    'qwen2.5:1.5b',
    'llama3:latest',
    'qwen',
    'llama3',
  ].filter(Boolean))];

  for (const localModel of candidateModels) {
    try {
      const res = await axios.post(
        `${localBaseUrl}/chat/completions`,
        { model: localModel, messages, temperature: 0.7, max_tokens: 300 },
        { timeout: 15000 }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return {
          content: res.data.choices[0].message.content.trim(),
          provider: `VPS Local LLM (${localModel})`,
        };
      }
    } catch (_) {
      try {
        const nativeRes = await axios.post(
          `${nativeOllamaUrl}/api/generate`,
          {
            model: localModel,
            system: systemPrompt,
            prompt: `${userName} says: "${userQuery}"`,
            stream: false,
          },
          { timeout: 15000 }
        );
        if (nativeRes.data?.response) {
          return {
            content: nativeRes.data.response.trim(),
            provider: `VPS Local LLM (${localModel})`,
          };
        }
      } catch (_) {}
    }
  }

  // 2. AgentRouter Fallback
  if (process.env.AGENTROUTER_API_KEY) {
    try {
      const agentRouterModel = process.env.AGENTROUTER_MODEL || 'auto';
      const providerLabel = process.env.AGENTROUTER_MODEL
        ? `AgentRouter (${process.env.AGENTROUTER_MODEL})`
        : 'AgentRouter';
      const res = await axios.post(
        `${process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1'}/chat/completions`,
        { model: agentRouterModel, messages, temperature: 0.7, max_tokens: 300 },
        { headers: { Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return {
          content: res.data.choices[0].message.content.trim(),
          provider: providerLabel,
        };
      }
    } catch (_) {}
  }

  // 3. Groq Fallback
  if (process.env.GROQ_API_KEY) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: 'llama-3.3-70b-versatile', messages, temperature: 0.7, max_tokens: 300 },
        { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      if (res.data?.choices?.[0]?.message?.content) {
        return {
          content: res.data.choices[0].message.content.trim(),
          provider: 'Groq Cloud',
        };
      }
    } catch (_) {}
  }

  // 4. Gemini Fallback
  if (process.env.GEMINI_API_KEY) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const res = await axios.post(
        geminiUrl,
        { contents: [{ parts: [{ text: `${systemPrompt}\n\nUSER QUESTION: ${userQuery}` }] }] },
        { timeout: 10000 }
      );
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return {
          content: text.trim(),
          provider: 'Google Gemini',
        };
      }
    } catch (_) {}
  }

  return {
    content: `Hey ${userName}! Always great hanging out in voice with you guys. What games are you playing today?`,
    provider: 'OpenSteam KB Engine',
  };
}

/**
 * Plays spoken TTS text audio into the guild's voice connection with automatic multi-language support
 */
async function playSpokenTextInVoice(guildId, text) {
  console.log(`[Voice Engine Debug] Attempting playSpokenTextInVoice for guild ${guildId}...`);
  const active = activeVoiceConnections.get(guildId);
  if (!active || !active.player) {
    console.warn(`[Voice Engine Debug] No active voice connection or player found for guild ${guildId}`);
    return false;
  }

  try {
    const cleanText = text.replace(/[*_~`#>-]/g, '').trim();
    if (!cleanText) {
      console.warn('[Voice Engine Debug] Cleaned text is empty. Skipping TTS.');
      return false;
    }

    const lang = detectLanguageCode(cleanText);
    console.log(`[Voice Engine Debug] Speaking text ("${cleanText.slice(0, 60)}...") in lang: ${lang}`);
    console.log(`[Voice Engine Debug] FFMPEG_PATH = ${process.env.FFMPEG_PATH}`);

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText.slice(0, 250))}&tl=${lang}&client=tw-ob`;
    console.log(`[Voice Engine Debug] Fetching TTS stream from: ${ttsUrl}`);

    const res = await axios.get(ttsUrl, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });
    console.log(`[Voice Engine Debug] TTS Stream received. HTTP Status: ${res.status}`);

    const resource = createAudioResource(res.data, { inputType: StreamType.Arbitrary });
    console.log(`[Voice Engine Debug] AudioResource created. Playing on audio player...`);

    active.player.play(resource);
    console.log(`[Voice Engine Debug] Player.play(resource) called successfully! Current Player Status: ${active.player.state.status}`);
    return true;
  } catch (err) {
    console.error('[Voice TTS Error]', err?.stack || err?.message || err);
    return false;
  }
}

/**
 * Handles natural join request when a user says "join my voice chat where I am so we can talk"
 */
async function handleNaturalVoiceJoin(message, client) {
  if (!message || !message.guild || message.author.bot) return false;

  const text = message.content || '';
  if (!isJoinVoiceIntent(text)) return false;

  const member = message.member;
  const voiceChannel = member?.voice?.channel;

  console.log(`[Voice Engine Debug] Natural join request detected from ${message.author.tag} in channel ${voiceChannel ? voiceChannel.name : 'NONE'}`);

  if (!voiceChannel) {
    await message.reply({
      content: "Hop into a voice channel first and ask me to join, and I'll jump right in with you! 🎙️",
    }).catch(() => {});
    return true;
  }

  try {
    const existingConn = getVoiceConnection(voiceChannel.guild.id);
    if (existingConn) {
      console.log(`[Voice Engine Debug] Cleaning existing voice connection in status ${existingConn.state.status}...`);
      try { existingConn.destroy(); } catch (_) {}
    }

    console.log(`[Voice Engine Debug] Connecting to voice channel ${voiceChannel.name} (${voiceChannel.id}) in guild ${voiceChannel.guild.name}...`);
    
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    connection.on('stateChange', (oldState, newState) => {
      console.log(`[Voice Connection State] Guild ${voiceChannel.guild.id}: ${oldState.status} ➔ ${newState.status}`);
    });

    connection.on('error', (err) => {
      console.error(`[Voice Connection Error] Guild ${voiceChannel.guild.id}:`, err?.stack || err?.message || err);
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    player.on('stateChange', (oldState, newState) => {
      console.log(`[Voice Player State] Guild ${voiceChannel.guild.id}: ${oldState.status} ➔ ${newState.status}`);
      if (newState.status === AudioPlayerStatus.AutoPaused || newState.status === AudioPlayerStatus.Paused) {
        console.log(`[Voice Player State] Player auto-paused/paused. Forcing unpause...`);
        try { player.unpause(); } catch (_) {}
      }
    });

    player.on('error', (err) => {
      console.error(`[Voice Player Error] Guild ${voiceChannel.guild.id}:`, err?.stack || err?.message || err);
    });

    connection.subscribe(player);

    activeVoiceConnections.set(voiceChannel.guild.id, {
      connection,
      player,
      channelId: voiceChannel.id,
      calledByUserId: message.author.id,
    });

    console.log(`[Voice Engine Debug] Awaiting VoiceConnectionStatus.Ready state...`);
    let voiceReady = false;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      voiceReady = true;
      console.log(`[Voice Engine Debug] VoiceConnectionStatus is now READY!`);
    } catch (stateErr) {
      console.warn(`[Voice Join State Warning] entersState Ready failed: ${stateErr?.message || stateErr}`);
      console.warn(`[Voice Engine Debug] Connection stuck in signalling — this usually means UDP ports 50000-65535 are BLOCKED on your VPS firewall!`);

      // Notify in Discord that there is a UDP firewall issue
      await message.channel.send({
        content: `⚠️ <@${message.author.id}> I joined the channel but my voice UDP connection is being blocked! **Discord Voice requires outbound UDP ports 50000–65535 to be open on the server firewall.** Ask your server admin to open those ports so I can speak! 🔊`,
      }).catch(() => {});
    }

    const greeting = `Hello everyone! I am Atis, your OpenSteam Personal Assistant. Great to join you in ${voiceChannel.name}! Feel free to talk to me!`;
    console.log(`[Voice Engine Debug] Triggering initial spoken greeting (voiceReady=${voiceReady})...`);
    await playSpokenTextInVoice(voiceChannel.guild.id, greeting);

    const embed = new EmbedBuilder()
      .setTitle('🎙️ OpenSteam Personal Assistant')
      .setDescription(`Hello <@${message.author.id}>! I am **Atis, your OpenSteam Personal Assistant**. I've joined **${voiceChannel.name}** to hang out and assist you in voice! 👋${!voiceReady ? '\n\n⚠️ **Voice UDP ports may be blocked on the server.** Voice playback may not work until UDP 50000–65535 is allowed.' : ''}`)
      .setColor(voiceReady ? 0x6366f1 : 0xf59e0b)
      .setFooter({ text: `OpenSteam Personal Assistant • Voice Engine${voiceReady ? '' : ' • UDP Firewall Issue Detected'}` });

    await message.reply({ embeds: [embed] }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[Natural Voice Join Error]', err?.stack || err?.message || err);
    await message.reply({ content: `❌ Could not join voice channel: ${err.message || 'Unknown error'}` }).catch(() => {});
    return true;
  }
}

/**
 * Handles natural leave request when a user says "leave voice" or "disconnect from voice"
 */
async function handleNaturalVoiceLeave(message, client) {
  if (!message || !message.guild || message.author.bot) return false;

  const text = message.content || '';
  if (!isLeaveVoiceIntent(text)) return false;

  const guildId = message.guild.id;
  const connection = getVoiceConnection(guildId);

  if (!connection) {
    await message.reply({ content: "I'm not in any voice channel right now!" }).catch(() => {});
    return true;
  }

  try {
    await playSpokenTextInVoice(guildId, 'Catch you guys later! Have a great time! Bye!');
    setTimeout(() => {
      try {
        connection.destroy();
        activeVoiceConnections.delete(guildId);
      } catch (_) {}
    }, 2000);

    const embed = new EmbedBuilder()
      .setDescription('👋 Left the voice channel! Catch you later!')
      .setColor(0x6366f1)
      .setFooter({ text: 'Source: Voice Engine' });

    await message.reply({ embeds: [embed] }).catch(() => {});
    return true;
  } catch (err) {
    try { connection.destroy(); } catch (_) {}
    activeVoiceConnections.delete(guildId);
    await message.reply({ content: '👋 Disconnected from voice channel.' }).catch(() => {});
    return true;
  }
}

/**
 * Automatically disconnects Atis when all human members disconnect/leave the voice channel
 */
function handleVoiceStateUpdate(oldState, newState) {
  try {
    const leftChannel = oldState.channel;
    if (!leftChannel) return;

    const guildId = leftChannel.guild.id;
    const active = activeVoiceConnections.get(guildId);
    if (!active || active.channelId !== leftChannel.id) return;

    const humanMembers = leftChannel.members.filter((m) => !m.user.bot);

    if (humanMembers.size === 0) {
      try {
        const connection = getVoiceConnection(guildId);
        if (connection) {
          connection.destroy();
        }
      } catch (_) {}
      activeVoiceConnections.delete(guildId);
      console.log(`[Voice AI] Auto-disconnected from ${leftChannel.name} in guild ${guildId} because all humans left.`);
    }
  } catch (err) {
    console.error('[VoiceStateUpdate Error]', err?.message || err);
  }
}

/**
 * Handles text messages sent in voice channel text chat when Atis is in voice
 */
async function handleVoiceChannelTextMessage(message, client) {
  if (!message || message.author.bot || !message.guild) return false;

  const handledJoin = await handleNaturalVoiceJoin(message, client);
  if (handledJoin) return true;

  const handledLeave = await handleNaturalVoiceLeave(message, client);
  if (handledLeave) return true;

  const active = activeVoiceConnections.get(message.guild.id);
  if (!active) return false;

  const isVoiceTextChannel = message.channel.id === active.channelId;
  const isMentioned = client?.user && message.mentions.has(client.user);

  if (!isVoiceTextChannel && !isMentioned) {
    return false;
  }

  let cleanText = message.content;
  if (client?.user) {
    cleanText = cleanText.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  }

  if (!cleanText) return false;

  try {
    await message.channel.sendTyping().catch(() => {});
  } catch (_) {}

  const llmResult = await callLlmForVoiceChat(cleanText, message.author.username);
  const replyText = llmResult.content;

  // Play audio in voice call in the detected language
  await playSpokenTextInVoice(message.guild.id, replyText);

  // Embed displaying the LLM source provider (VPS Local LLM, AgentRouter, Groq Cloud, Google Gemini)
  const embed = new EmbedBuilder()
    .setDescription(replyText)
    .setColor(0x6366f1)
    .setFooter({ text: `Source: ${llmResult.provider}` });

  await message.reply({ embeds: [embed], tts: true }).catch(() => {});

  return true;
}

module.exports = {
  activeVoiceConnections,
  detectLanguageCode,
  isJoinVoiceIntent,
  isLeaveVoiceIntent,
  callLlmForVoiceChat,
  playSpokenTextInVoice,
  handleNaturalVoiceJoin,
  handleNaturalVoiceLeave,
  handleVoiceStateUpdate,
  handleVoiceChannelTextMessage,
};
