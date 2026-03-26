// AudioWorklet processor for capturing microphone input
// Converts Float32 samples to Int16 PCM and posts to main thread
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; // ~128ms at 16kHz — good chunk size
    this.buffer = new Int16Array(this.bufferSize);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      // Clamp and convert float32 [-1, 1] to int16 [-32768, 32767]
      const s = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.writeIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

      if (this.writeIndex >= this.bufferSize) {
        // Copy and send buffer
        const chunk = this.buffer.slice(0);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.buffer = new Int16Array(this.bufferSize);
        this.writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
