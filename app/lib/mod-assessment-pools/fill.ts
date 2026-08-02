/**
 * Written-response pool — Discord moderation & ticket/support scenarios.
 * 10 prompts are drawn per exam next to MCQs (see mod-assessment-exam-realtime.ts).
 */
import type { ModQuestionFill } from "@/app/lib/mod-assessment-types";

const RUBRIC_BASE =
  "Grade on: stays on the actual situation (not a generic essay); choices that are safe and match normal mod practice; specific steps when they matter—who to ping, what to log, what to do first; calm grown-up tone. Give partial credit if it's thin but still sensible. Almost no credit for empty rambling, careless shortcuts, or skipping escalate when that's clearly needed.";

export const MASTER_FILL_BANK: ModQuestionFill[] = [
  {
    id: "ticket-w-01",
    type: "fill",
    prompt:
      "Someone opens a harassment ticket but only says people are being mean—no examples. What do you write back to get message links, rough times, and which channel—without blowing it up too fast?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-02",
    type: "fill",
    prompt:
      "Two people are arguing in support; one is a bit rude and both @ staff. How do you calm it down without acting like you're picking a winner?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-03",
    type: "fill",
    prompt:
      "You spot grooming or CSAM-related stuff in a thread. You're not the police. What do you do right away—save proof, who to tell, and keep gross detail out of public chat?",
    rubricForAi:
      `${RUBRIC_BASE} Should not ask for explicit detail in public; must stress escalate and preserve evidence.`,
    maxPoints: 10,
  },
  {
    id: "ticket-w-04",
    type: "fill",
    prompt:
      "A raid or bot wave floods the server. What do you do first, second, and so on—roles, slowmode, verification, telling members what's up?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-05",
    type: "fill",
    prompt:
      "You can't fix their billing, API key, or account lock inside the promised time. Write a short reply that's honest about what's possible and says what happens next—no fake guarantees.",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-06",
    type: "fill",
    prompt:
      "A mod DMs you that another mod used tools to help a friend. How do you note it down, avoid office gossip, and get it to the right leads?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-07",
    type: "fill",
    prompt:
      "Someone posts a real photo of another member without their OK in public. Take it down, how do you talk to the person affected, and do you pull in staff before a big public debate?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-08",
    type: "fill",
    prompt:
      "Both people in a ticket tell different stories and only show part of the screenshots. How do you look at what you have fairly, and when do you stop turning the ticket into a courtroom?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-09",
    type: "fill",
    prompt:
      "Someone posts about wanting to hurt themselves in a ticket. What's a caring first reply that isn't playing doctor, and what do you escalate?",
    rubricForAi:
      `${RUBRIC_BASE} No medical instructions; point to resources and proper escalation.`,
    maxPoints: 10,
  },
  {
    id: "ticket-w-10",
    type: "fill",
    prompt:
      "Your shift ends but the ticket isn't done. Write a short handoff another mod can run with: what happened, what's still open, how serious it is, anything sensitive.",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-11",
    type: "fill",
    prompt:
      "Bots spam phishing links faster than you can delete. Besides clicking delete forever, how do you lock things down—perms, bots, pinging the team?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-12",
    type: "fill",
    prompt:
      "Someone appeals a mute they think was unfair. How do you check logs, hear them out, and explain yes/no or next step without endless back-and-forth?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-13",
    type: "fill",
    prompt:
      "NSFW slips into a family-friendly channel by accident. Remove it, talk to the user—should follow-up be in public or DMs?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
  {
    id: "ticket-w-14",
    type: "fill",
    prompt:
      "Someone reports harassment that mostly happened in another server; they have screenshots. What can you actually do in your server, and where are the limits?",
    rubricForAi: RUBRIC_BASE,
    maxPoints: 10,
  },
];
