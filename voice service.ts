export class VoiceService {
  private synth: SpeechSynthesis;
  private audioCtx: AudioContext | null = null;
  private lastSpoken: string = "";
  private lastSpokenTime: number = 0;

  constructor() {
    this.synth = window.speechSynthesis;
  }

  private initAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  /**
   * Unlocks audio on mobile devices. Must be called from a user gesture (e.g., button click).
   */
  async unlock() {
    this.initAudio();
    if (this.audioCtx?.state === 'suspended') {
      await this.audioCtx.resume();
    }
    
    // Prime SpeechSynthesis with a silent utterance
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    this.synth.speak(silent);
    
    // Play a very short silent beep to unlock AudioContext
    this.beep(440, 0.01);
  }

  beep(frequency: number = 440, duration: number = 0.2) {
    this.initAudio();
    if (!this.audioCtx) return;

    const oscillator = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);

    oscillator.start();
    oscillator.stop(this.audioCtx.currentTime + duration);
  }

  async speak(text: string, priority: boolean = false) {
    const now = Date.now();
    // Avoid repeating the same message too frequently unless it's a priority alert
    if (!priority && text === this.lastSpoken && now - this.lastSpokenTime < 5000) {
      return;
    }

    if (priority) {
      this.synth.cancel(); // Interrupt current speech for high priority
      this.beep(880, 0.3); // High pitch beep for priority
    }

    // Ensure voices are loaded (some mobile browsers need this)
    if (this.synth.getVoices().length === 0) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          this.synth.removeEventListener('voiceschanged', handler);
          resolve();
        };
        this.synth.addEventListener('voiceschanged', handler);
        // Timeout in case it never fires
        setTimeout(resolve, 100);
      });
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.2;
    utterance.pitch = 1.0;
    
    // On some mobile browsers, we need to resume audio context
    if (this.audioCtx?.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.synth.speak(utterance);
    this.lastSpoken = text;
    this.lastSpokenTime = now;
  }

  cancel() {
    this.synth.cancel();
  }
}
