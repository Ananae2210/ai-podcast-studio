import { CLAUDE_MODEL, GEMINI_MODEL } from "@/lib/writers";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    tts: Boolean(process.env.OPENAI_API_KEY),
    accessCode: Boolean(process.env.ACCESS_CODE),
    models: { claude: CLAUDE_MODEL, gemini: GEMINI_MODEL },
  });
}
