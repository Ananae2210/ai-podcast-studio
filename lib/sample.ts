import type { Episode } from "./schema";

// Shown in demo mode so visitors can try the player without any API keys.
export const SAMPLE_EPISODE: Episode = {
  title: "Why Your Brain Loves Podcasts",
  summary:
    "Maya and Leo dig into why audio feels so personal, and what that means for anyone building a show. A quick, friendly tour of the science of listening.",
  hosts: [
    { name: "Maya", persona: "curious host" },
    { name: "Leo", persona: "nerdy co-host" },
  ],
  lines: [
    { speaker: "Maya", text: "Here's a weird one. Your brain treats a voice in your headphones a lot like a friend sitting right next to you." },
    { speaker: "Leo", text: "Which is why people say they feel like they actually know their favorite hosts. Welcome to the show, everyone!" },
    { speaker: "Maya", text: "Today we're asking a simple question. Why do podcasts feel so personal, when they're really just recordings?" },
    { speaker: "Leo", text: "Part of it is the format. You're usually alone, doing something with your hands, and the voice is literally inside your ears." },
    { speaker: "Maya", text: "Right, so there's no screen competing for your attention. It's just you and the conversation." },
    { speaker: "Leo", text: "And conversation is the key word. Two people reacting to each other feels way more natural than one person reading a script." },
    { speaker: "Maya", text: "Which, funnily enough, is exactly what this app tries to write. Short turns, real reactions, no lectures." },
    { speaker: "Leo", text: "So the quick recap. Audio feels intimate, conversation feels human, and keeping it short keeps people listening." },
    { speaker: "Maya", text: "That's it for today. Thanks for hanging out with us, and we'll catch you next time!" },
  ],
};
