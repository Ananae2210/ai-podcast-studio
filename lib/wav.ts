/** Gemini TTS returns raw 16-bit mono PCM at 24 kHz; these helpers wrap it in a WAV container. */
export const SAMPLE_RATE = 24000;
export const WAV_HEADER_BYTES = 44;

export function wavHeader(dataBytes: number, sampleRate = SAMPLE_RATE): Uint8Array {
  const buf = new ArrayBuffer(WAV_HEADER_BYTES);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM format
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}

/** Joins WAV clips produced by wavHeader() into one WAV, with a short silence between lines. */
export async function joinWavs(clips: Blob[], gapMs = 180): Promise<Blob> {
  const gap = new Uint8Array(Math.round((SAMPLE_RATE * gapMs) / 1000) * 2);
  const parts: BlobPart[] = [];
  let total = 0;
  for (const clip of clips) {
    const pcm = new Uint8Array(await clip.arrayBuffer()).slice(WAV_HEADER_BYTES);
    parts.push(pcm, gap);
    total += pcm.byteLength + gap.byteLength;
  }
  return new Blob([wavHeader(total) as BlobPart, ...parts], { type: "audio/wav" });
}
