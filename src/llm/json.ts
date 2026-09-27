// With search grounding on, Gemini's JSON isn't strictly decoded against the schema, and now
// and then it writes numbers the way people do: ".55" or "55." (both invalid JSON), or wraps
// the object in a ```json fence. Repair those before giving up, since the call is already paid for.
const repair = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const body = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return (
    body
      // .55 -> 0.55 (after a colon, comma or bracket, outside strings in practice)
      .replace(/([:,[]\s*)(-?)\.(\d)/g, "$1$20.$3")
      // 55. -> 55
      .replace(/(\d)\.(?=\s*[,}\]])/g, "$1")
  );
};

export const parseModelJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    try {
      return JSON.parse(repair(text));
    } catch {
      // keep the original message, plus enough of the reply to see what went wrong
      const snippet = text.length > 160 ? `${text.slice(0, 160)}…` : text;
      throw new Error(`${(error as Error).message} in model reply: ${snippet}`);
    }
  }
};
