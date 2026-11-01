/**
 * Best-effort parser for a JSON document that is still streaming in.
 * It cuts the text back to the last fully completed value and closes any
 * open objects/arrays, so the UI can render finished script lines live.
 */
export function parsePartialJson<T = unknown>(text: string): T | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cut = -1;
  let cutStack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      cut = i + 1;
      cutStack = [...stack];
    } else if (ch === ",") {
      cut = i;
      cutStack = [...stack];
    }
  }

  if (cut === -1) return null;
  const candidate = text.slice(0, cut) + cutStack.reverse().join("");
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
