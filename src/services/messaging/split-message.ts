export function splitMessageForWhatsApp(text: string, maxParts = 5) {
  const cleaned = text.trim();

  if (!cleaned) {
    return [];
  }

  if (cleaned.length <= 180) {
    return [cleaned];
  }

  const paragraphs = cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const parts: string[] = [];

  for (const paragraph of paragraphs) {
    if (isListBlock(paragraph) || paragraph.length <= 220) {
      parts.push(paragraph);
    } else {
      parts.push(...splitParagraph(paragraph));
    }
  }

  return compactParts(parts, maxParts);
}

export function typingDelayMs(message: string, wordsPerMinute = 150) {
  const words = Math.max(1, Math.round(message.length / 4.5));
  const ms = (words / wordsPerMinute) * 60_000;
  return Math.min(12_000, Math.max(1200, Math.round(ms)));
}

function splitParagraph(paragraph: string) {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > 220 && current) {
      chunks.push(trimTerminalPunctuation(current));
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(trimTerminalPunctuation(current));
  }

  return chunks;
}

function compactParts(parts: string[], maxParts: number) {
  const cleanParts = parts.map(trimTerminalPunctuation).filter(Boolean);

  while (cleanParts.length > maxParts) {
    const last = cleanParts.pop();
    const previous = cleanParts.pop();
    cleanParts.push(`${previous}\n\n${last}`);
  }

  return cleanParts;
}

function trimTerminalPunctuation(value: string) {
  return value.trim().replace(/[,.]$/, "");
}

function isListBlock(value: string) {
  return /\n\s*(?:[-*]|\d+\.)\s+/.test(value);
}
