// Telegram rejects messages over 4,096 characters (a Kalshi scan report was, on 2026-09-30, and
// it was lost). Split at blank lines, which is where our messages separate their items, so no
// HTML tag is ever cut in half; a single oversized block is split by lines. The limit counts the
// text after HTML is parsed, so measuring the raw HTML leaves a safe margin.
const LIMIT = 3800;

export const splitMessage = (html: string, limit = LIMIT) => {
  const parts: string[] = [];
  let current = "";
  const push = (block: string, separator: string) => {
    if (current && current.length + separator.length + block.length > limit) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current}${separator}${block}` : block;
  };
  for (const block of html.split("\n\n")) {
    if (block.length <= limit) push(block, "\n\n");
    else for (const line of block.split("\n")) push(line.slice(0, limit), "\n");
  }
  if (current) parts.push(current);
  return parts;
};
