// Gemini Live API (WebSocket) 음성 세션 — 브라우저 단독, 서버 불필요
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// 마이크 → 16kHz 16bit PCM 변환 워크릿 (기기 샘플레이트와 무관하게 동작)
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) this.buf.push(ch[Math.floor(this.pos)]);
    this.pos -= ch.length;
    if (this.buf.length >= 1600) { // 100ms
      const out = new Int16Array(this.buf.length);
      let peak = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        peak = Math.max(peak, Math.abs(s));
      }
      this.port.postMessage({ pcm: out.buffer, peak }, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);`;

function b64FromBuf(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bufFromB64(b64) {
  const s = atob(b64); const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export async function testKey(key, model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(key)}`);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const msg = data?.error?.message || `HTTP ${res.status}`;
  if (res.status === 400 || res.status === 403) throw new Error("API 키가 올바르지 않거나 권한이 없어요. (" + msg + ")");
  if (res.status === 404) throw new Error(`모델 "${model}"을 찾을 수 없어요. 설정에서 모델 이름을 확인해 주세요.`);
  if (res.status === 429) throw new Error("무료 사용량 한도에 걸렸어요. 잠시 후 다시 해주세요.");
  throw new Error(msg);
}

/**
 * cb: { onState(kind), onAiText(text), onMeText(text), onTool(name,args), onTurnDone(), onClose(info), onReady() }
 */
export class LiveSession {
  constructor({ key, model, voice, instructions, tools }, cb) {
    Object.assign(this, { key, model, voice, instructions, tools, cb });
    this.handle = null; this.ws = null; this.closedByUser = false;
    this.aiBuf = ""; this.meBuf = ""; this.playing = new Set(); this.nextTime = 0; this.lastAudioEnd = 0;
  }

  // 반드시 사용자 탭 안에서 호출 (iOS 오디오/마이크 잠금 해제)
  async initAudio() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const src = this.ctx.createMediaStreamSource(this.mic);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e) => this.onMicChunk(e.data);
    src.connect(this.node);
    // 워크릿이 돌도록 무음으로 출력에 연결
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  // 스피커(특히 차량 블루투스)는 실제 소리가 늦게 나오므로 그만큼 더 기다렸다가 마이크를 연다
  get echoTail() { return 0.5 + Math.min(this.ctx?.outputLatency || 0, 0.6); }
  get aiSpeaking() { return this.ctx && this.ctx.currentTime < this.lastAudioEnd + this.echoTail; }

  onMicChunk({ pcm }) {
    if (!this.ready || this.ws?.readyState !== 1) return;
    // 선생님이 말하는 중엔 마이크를 보내지 않음 → 차 스피커 소리를 자기 말로 착각하는 것 방지
    if (this.aiSpeaking) return;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64FromBuf(pcm), mimeType: "audio/pcm;rate=16000" } } }));
  }

  // 서버가 새 도구 옵션(behavior/scheduling)을 거부하면 옵션 없이 한 번 더 시도
  async connect(isResume = false) {
    try { return await this._connect(isResume); }
    catch (err) {
      if (this.plainTools || !/behavior|scheduling|non_blocking|unknown name|invalid json|invalid argument/i.test(err.message || "")) throw err;
      this.plainTools = true;
      return this._connect(isResume);
    }
  }

  _connect(isResume = false) {
    this.ready = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(this.key)}`);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        const setup = {
          model: `models/${this.model}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
          },
          systemInstruction: { parts: [{ text: this.instructions }] },
          tools: [{ functionDeclarations: this.plainTools ? this.tools.map(({ behavior, ...t }) => t) : this.tools }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              endOfSpeechSensitivity: "END_SENSITIVITY_LOW", // 초급자: 말 사이 머뭇거림 허용
              silenceDurationMs: 1200,
            },
          },
          sessionResumption: this.handle ? { handle: this.handle } : {},
          contextWindowCompression: { slidingWindow: {} },
        };
        ws.send(JSON.stringify({ setup }));
      };
      ws.onmessage = async (ev) => {
        const text = typeof ev.data === "string" ? ev.data : await ev.data.text();
        let msg; try { msg = JSON.parse(text); } catch { return; }
        if (msg.setupComplete) {
          this.ready = true;
          if (!settled) { settled = true; resolve(); }
          if (!isResume) this.sendText("(The learner is ready and listening. Start the lesson now.)");
          this.cb.onReady?.(isResume);
        }
        this.handleMessage(msg);
      };
      ws.onerror = () => {};
      ws.onclose = (e) => {
        this.ready = false;
        if (!settled) { settled = true; reject(new Error(closeReason(e))); return; }
        if (ws !== this.ws) return;
        this.cb.onClose?.({ byUser: this.closedByUser, reason: closeReason(e), resumable: !!this.handle, goAway: this.goAway });
      };
    });
  }

  handleMessage(msg) {
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.handle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) this.goAway = true;
    if (msg.toolCall?.functionCalls) {
      const responses = [];
      for (const fc of msg.toolCall.functionCalls) {
        this.cb.onTool?.(fc.name, fc.args || {});
        // SILENT: 결과만 기록하고 선생님이 이어서 말하지 않게 함.
        // (기본값 WHEN_IDLE은 도구 응답이 올 때마다 새 발화를 유도 → 학습자 대답을 안 기다리고 혼자 진행)
        responses.push({ id: fc.id, name: fc.name, response: { result: "ok" }, ...(this.plainTools ? {} : { scheduling: "SILENT" }) });
      }
      this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) this.stopPlayback();
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        const rate = Number((part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1]) || 24000;
        this.play(part.inlineData.data, rate);
      }
    }
    if (sc.inputTranscription?.text) { this.meBuf += sc.inputTranscription.text; this.cb.onState?.("listening"); }
    if (sc.outputTranscription?.text) this.aiBuf += sc.outputTranscription.text;
    if (sc.turnComplete || sc.generationComplete) this.flushTranscripts();
    if (sc.turnComplete) this.cb.onTurnDone?.();
  }

  flushTranscripts() {
    if (this.meBuf.trim()) { this.cb.onMeText?.(this.meBuf.trim()); this.meBuf = ""; }
    if (this.aiBuf.trim()) { this.cb.onAiText?.(this.aiBuf.trim()); this.aiBuf = ""; }
  }

  play(b64, rate) {
    const pcm = new Int16Array(bufFromB64(b64));
    if (!pcm.length) return;
    const buf = this.ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.ctx.destination);
    const start = Math.max(this.ctx.currentTime + 0.05, this.nextTime);
    src.start(start);
    this.nextTime = start + buf.duration;
    this.lastAudioEnd = this.nextTime;
    this.playing.add(src);
    if (this.meBuf.trim()) { this.cb.onMeText?.(this.meBuf.trim()); this.meBuf = ""; } // 내 말 확정
    this.cb.onState?.("speaking");
    src.onended = () => {
      this.playing.delete(src);
      if (!this.playing.size) this.cb.onState?.("idle");
    };
  }

  stopPlayback() {
    for (const s of this.playing) { try { s.stop(); } catch {} }
    this.playing.clear(); this.nextTime = 0; this.lastAudioEnd = 0;
  }

  // 남은 음성이 다 재생될 때까지 기다림
  waitPlaybackDone(maxMs = 15000) {
    return new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (!this.playing.size || Date.now() - t0 > maxMs) { clearInterval(iv); res(); }
      }, 200);
    });
  }

  sendText(text) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { text } }));
  }

  closeSocket() { try { this.ws?.close(); } catch {} }

  close() {
    this.closedByUser = true;
    this.flushTranscripts();
    this.closeSocket();
    this.stopPlayback();
    this.mic?.getTracks().forEach((t) => t.stop());
    try { this.node?.disconnect(); } catch {}
    try { this.ctx?.close(); } catch {}
  }
}

function closeReason(e) {
  const r = e?.reason || "";
  if (/api key/i.test(r)) return "API 키가 올바르지 않아요. (" + r + ")";
  if (/quota|rate|exhaust/i.test(r)) return "무료 사용량 한도에 걸렸어요. 잠시 후 다시 해주세요. (" + r + ")";
  if (/not found|not supported/i.test(r)) return "모델 이름을 확인해 주세요. (" + r + ")";
  return r ? `연결 종료: ${r}` : `연결이 끊겼어요 (code ${e?.code ?? "?"})`;
}
