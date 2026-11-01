export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    tts: Boolean(process.env.OPENAI_API_KEY),
    accessCode: Boolean(process.env.ACCESS_CODE),
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  });
}
