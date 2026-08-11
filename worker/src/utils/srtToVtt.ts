// worker/src/utils/srtToVtt.ts
// Converts SRT subtitle format to WebVTT format.
// Ported directly from D.Verse — handles edge cases:
//   - Windows/Unix line endings
//   - Comma → period in timestamps
//   - HTML tag passthrough (VTT supports <b>, <i>, <u>)
//   - Empty cue blocks

export function srtToVtt(srt: string): string {
  // Normalise line endings
  const normalised = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  const lines  = normalised.split('\n');
  const output = ['WEBVTT', ''];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip blank lines between cues
    if (!line) { i++; continue; }

    // Cue index — must be a number
    if (/^\d+$/.test(line)) {
      i++; // advance past the index

      // Timestamp line
      if (i < lines.length) {
        const tsLine = lines[i].trim();

        // SRT timestamp: 00:00:00,000 --> 00:00:00,000
        // VTT timestamp: 00:00:00.000 --> 00:00:00.000
        const vttTs = tsLine.replace(/,/g, '.');

        if (vttTs.includes('-->')) {
          output.push(vttTs);
          i++;

          // Collect cue text lines until blank or next index
          const cueLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== '') {
            cueLines.push(lines[i]);
            i++;
          }

          if (cueLines.length > 0) {
            output.push(...cueLines);
            output.push(''); // blank line between cues
          }
        } else {
          // Not a valid timestamp — skip
          i++;
        }
      }
    } else {
      // Unexpected content — skip
      i++;
    }
  }

  return output.join('\n');
}
