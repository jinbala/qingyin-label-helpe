// Character-by-character wrapping. Label fonts (Arial, Microsoft YaHei) break
// Latin and CJK text at different places, so width is measured with the real
// font metrics instead of being estimated from a character count.
export function fitLines(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
