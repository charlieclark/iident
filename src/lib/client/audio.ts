"use client";

/** Microphone recording with a live level meter. */
export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data = new Float32Array(1024);
  startedAt = 0;

  constructor(private quality: "speech" | "voice-sample" = "speech") {}

  async start() {
    // Call-style processing (noise suppression, echo cancellation) dulls the
    // highs, and a voice clone inherits that. Voice samples are captured raw
    // (levels are normalized in toWav); push-to-talk keeps the processing.
    const raw = this.quality === "voice-sample";
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: !raw, noiseSuppression: !raw, autoGainControl: !raw, channelCount: 1 },
    });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.startedAt = performance.now();
  }

  /** 0..1 loudness for a meter. */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.data.length) * 4);
  }

  elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return resolve(new Blob(this.chunks));
      rec.onstop = () => {
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
        this.cleanup();
      };
      rec.stop();
    });
  }

  cancel() {
    try {
      this.recorder?.stop();
    } catch {}
    this.cleanup();
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.startedAt = 0;
  }
}

/**
 * Converts any browser-decodable recording (webm/opus, mp4/aac, ...) into a
 * mono 16-bit WAV, the most widely accepted format for voice cloning.
 */
export async function toWav(blob: Blob, sampleRate = 24000): Promise<{ wav: Blob; seconds: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const write = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    write(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1;
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i] * gain));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return { wav: new Blob([buffer], { type: "audio/wav" }), seconds: decoded.duration };
  } finally {
    ctx.close().catch(() => {});
  }
}
