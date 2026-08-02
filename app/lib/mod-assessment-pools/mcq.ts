/**
 * Reference MCQs — topic coverage for docs, tests, or future tooling.
 * Live exams no longer draw from this file; MCQs are model-generated per attempt (see mod-assessment-mcq-generate.ts).
 */
import type { ModQuestionMcq } from "@/app/lib/mod-assessment-types";

const P = 3;

const C = (a: string, b: string, c: string, d: string) => ({ A: a, B: b, C: c, D: d });

export const MASTER_MCQ_BANK: ModQuestionMcq[] = [
  {
    id: "discord-mcq-01",
    type: "mcq",
    points: P,
    prompt:
      "A user opens a support ticket reporting harassment in a public channel. Your first moderation step should be?",
    choices: C(
      "Ignore until three separate users report",
      "Triage urgency, stabilize the conversation (slowmode/thread), gather message links and IDs",
      "Announce your personal opinion in chat before reading the ticket",
      "Delete every message before anyone can review logs"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-02",
    type: "mcq",
    points: P,
    prompt:
      "You are unsure whether a message crosses the ban threshold in the handbook. What should you do?",
    choices: C(
      "Run a straw poll with regular members",
      "Escalate with a clear evidence packet to the authorised senior moderator or admin chain",
      "Ban quietly so nobody questions you",
      "Ask the offending user how hard they think you should punish them"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-03",
    type: "mcq",
    points: P,
    prompt: "Screenshots or sensitive moderation evidence belong in?",
    choices: C(
      "A public meme channel",
      "Random DMs unless someone asks nicely",
      "Staff-confidential channels / your ticket tool — not public chats",
      "Pinned messages in #general for transparency"
    ),
    correct: "C",
  },
  {
    id: "discord-mcq-04",
    type: "mcq",
    points: P,
    prompt:
      "A member keeps @mentioning moderators outside the designated support ticket flow. Appropriate response?",
    choices: C(
      "Mute them indefinitely",
      "Remind them to use the ticket / help channel per server rules and continue in-thread",
      "Turn off pings for mods globally",
      "Promote them to bypass future tickets"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-05",
    type: "mcq",
    points: P,
    prompt: "When replying to an angry but non-abusive user in a ticket, you should generally?",
    choices: C(
      "Match their caps lock and insults",
      "Stay professional, restate the issue, set next steps or timeline",
      "Close the ticket so they cool off",
      "Tell them other users have it worse"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-06",
    type: "mcq",
    points: P,
    prompt: "Two users derail a public ticket thread into a personal fight. Best practice?",
    choices: C(
      "Let them argue — engagement helps",
      "Move follow-up into a moderated thread / separate channel and enforce rules",
      "Pick a winner",
      "Delete the whole channel"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-07",
    type: "mcq",
    points: P,
    prompt:
      "Someone shares a vague self-harm reference in a ticket. You are not a clinician; you should?",
    choices: C(
      "Give medical advice and dosage tips",
      "Escalate per crisis / trust-and-safety policy; provide resources the handbook allows; do not dismiss",
      "Ignore because it might be a joke",
      "Post the conversation in public for community support"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-08",
    type: "mcq",
    points: P,
    prompt: "A sudden wave of bot accounts spams invite links. First-line actions include?",
    choices: C(
      "Slowmode, lockdown or permission toggles as policy allows, delete spam, alert staff",
      "Do nothing — bots are random",
      "Give everyone admin to fight back",
      "DM every user the same warning template 30 times"
    ),
    correct: "A",
  },
  {
    id: "discord-mcq-09",
    type: "mcq",
    points: P,
    prompt: "A user asks you to delete audit or moderation logs to “clean up.” You should?",
    choices: C(
      "Delete them if they are friends with an admin",
      "Refuse and escalate if this is pressure or policy violation; logs support accountability",
      "Post logs in public to prove you did not",
      "Replace logs with placeholder text"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-10",
    type: "mcq",
    points: P,
    prompt: "You suspect ban evasion via an alt account. Best first step?",
    choices: C(
      "Accuse them publicly in #announcements",
      "Use internal correlation review (IDs, patterns) and escalate if policy thresholds are met",
      "Ban every new account that joins that day",
      "Ask them in public to admit they are an alt"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-11",
    type: "mcq",
    points: P,
    prompt: "NSFW content is posted in a SFW channel. Per typical moderation ladders you should?",
    choices: C(
      "Award the user a funny role",
      "Remove or relocate content, warn/mute/route per the handbook ladder for that channel",
      "Wait for a report next week",
      "Only act if the image is illegal in your country"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-12",
    type: "mcq",
    points: P,
    prompt: "You need to judge a dispute involving your close friend. According to moderation ethics you should?",
    choices: C(
      "Recuse yourself and ask another moderator to handle it",
      "Rule harder in their favor so nobody suspects bias",
      "Ignore the friendship — no one will notice",
      "Let the community vote"
    ),
    correct: "A",
  },
  {
    id: "discord-mcq-13",
    type: "mcq",
    points: P,
    prompt: "Forwarding a screenshot that includes another user’s real name or IP to a public channel is?",
    choices: C(
      "Good for transparency",
      "A serious privacy breach — redact or use restricted staff channels only",
      "Required before any ban",
      "Allowed if the ticket is urgent"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-14",
    type: "mcq",
    points: P,
    prompt: "A support ticket cites “urgent abuse” but evidence is thin. You should?",
    choices: C(
      "Ignore it as spam",
      "Ask specific follow-up questions, request links/IDs within policy, escalate if credible risk signals appear",
      "Ban the accused user pre-emptively",
      "Tell them to solve it offline only"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-15",
    type: "mcq",
    points: P,
    prompt: "After a major moderation action (ban, raid recovery), documentation should?",
    choices: C(
      "Only exist in your head",
      "Follow the handbook: internal note with timeline, IDs, rationale, escalation if required",
      "Be posted verbatim in general chat",
      "Be skipped if everyone already saw it"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-16",
    type: "mcq",
    points: P,
    prompt: "A user duplicates the same ticket in three channels to get faster attention. You should?",
    choices: C(
      "Merge or close duplicates, point them to one thread, prioritize by severity — not noise",
      "Answer three times with different answers",
      "Ban for spamming",
      "Ignore all copies"
    ),
    correct: "A",
  },
  {
    id: "discord-mcq-17",
    type: "mcq",
    points: P,
    prompt: "Using moderator powers to win an in-server game or argument is generally?",
    choices: C(
      "Encouraged for efficiency",
      "Acceptable once per week",
      "Abuse of position — escalate to staff leadership",
      "Fine if nobody recorded it"
    ),
    correct: "C",
  },
  {
    id: "discord-mcq-18",
    type: "mcq",
    points: P,
    prompt: "Phishing links or malware are posted. Priority response?",
    choices: C(
      "React with emoji only",
      "Remove/quarantine posts, alert security or admins per playbook, preserve evidence privately",
      "Ask users to vote on whether links are malicious",
      "Wait until someone clicks first"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-19",
    type: "mcq",
    points: P,
    prompt:
      "You cannot solve a payout, API-access, or account issue inside the SLA. What does good ticket posture look like?",
    choices: C(
      "Ghost the ticket",
      "Clearly state status, owner, and escalation path — no false promises",
      "Promise compensation you cannot authorize",
      "Close with “handled” with no explanation"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-20",
    type: "mcq",
    points: P,
    prompt: "A member leaks private staff-chat decisions into public. Appropriate stance?",
    choices: C(
      "Congratulate them for transparency",
      "Sanction per policy on confidentiality; review what was leaked and whether policy update is needed",
      "Ignore — free speech covers everything",
      "Promote them for engagement"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-21",
    type: "mcq",
    points: P,
    prompt: "When queueing moderation work, typical priority order favors?",
    choices: C(
      "Whatever ticket has the funniest meme",
      "Safety / credible harm → repeated abuse → spam → cosmetic requests",
      "Users who donated last",
      "Oldest ticket only, always"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-22",
    type: "mcq",
    points: P,
    prompt: "Raids or mass-DM harassment coordinated off-platform but discussed in your server should be?",
    choices: C(
      "Ignored as off-topic",
      "Investigated with preserved evidence; coordinate with staff per incident policy",
      "Handled only with memes",
      "Publicly naming suspects before any review"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-23",
    type: "mcq",
    points: P,
    prompt: "A bot integration has more permissions than your security guidelines allow. You should?",
    choices: C(
      "Disable or restrict the integration, document, involve security sponsor or admin",
      "Ignore — bots are trusted",
      "Grant more permissions so it breaks less",
      "Delete the server"
    ),
    correct: "A",
  },
  {
    id: "discord-mcq-24",
    type: "mcq",
    points: P,
    prompt: "Handing off an open ticket to the next shift should include?",
    choices: C(
      "Nothing — each mod starts fresh",
      "What was tried, pending questions, risk level, and next step or owner",
      "A copy-paste of the entire chat into DMs",
      "Closing the ticket so stats look good"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-25",
    type: "mcq",
    points: P,
    prompt: "A user demands an instant unban with threats. You should?",
    choices: C(
      "Comply to de-escalate",
      "Stay calm, cite appeal or review process, escalate threats of violence or doxxing",
      "Argue with them in public",
      "Share their threat in every channel"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-26",
    type: "mcq",
    points: P,
    prompt: "Voice channel disruption (screaming, slurs) — first actions often include?",
    choices: C(
      "Mute/kick per ladder, document, escalate if repeat or targeted harassment",
      "Record and post publicly",
      "Join in",
      "Disable voice for the whole server forever"
    ),
    correct: "A",
  },
  {
    id: "discord-mcq-27",
    type: "mcq",
    points: P,
    prompt: "Appeals after a written sanction should follow?",
    choices: C(
      "Whatever the user prefers",
      "The handbook’s appeal window and channel — stay consistent and documented",
      "Only if they buy nitro",
      "Infinite retries until they win"
    ),
    correct: "B",
  },
  {
    id: "discord-mcq-28",
    type: "mcq",
    points: P,
    prompt:
      "For long back-and-forth troubleshooting, using a thread or dedicated channel instead of spamming the main chat is mainly to?",
    choices: C(
      "Hide problems from staff",
      "Keep context readable, reduce noise, and protect user privacy",
      "Reduce your workload to zero",
      "Avoid answering difficult questions"
    ),
    correct: "B",
  },
];
