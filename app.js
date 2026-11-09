import { SCENARIOS, todayScenario } from "./scenarios.js";
import { buildInstructions, TOOLS } from "./prompt.js";
import { LiveSession, testKey } from "./gemini.js";
const $ = (id) => document.getElementById(id);

// ---------- 저장소 ----------
const DEFAULTS = { key: "", minutes: 10, pace: "slow", help: "high", voice: "Kore", model: "gemini-3.8-live" };
const store = {
  get(k, d) { try { const v = localStorage.getItem("de_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem("de_" + k, JSON.stringify(v)); },
};
const settings = () => ({ ...DEFAULTS, ...store.get("settings", {}) });
const phrases = () => store.get("phrases", []);
const sessions = () => store.get("sessions", []);

function addPhrase(en, ko) {
  en = (en || "").trim(); ko = (ko || "").trim();
  if (!en) return;
  const list = phrases();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (list.some((p) => norm(p.en) === norm(en))) return;
  list.unshift({ en, ko, at: Date.now() });
  store.set("phrases", list.slice(0, 500));
}

// ---------- 화면 전환 ----------
function go(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + view).classList.add("active");
  window.scrollTo(0, 0);
  if (view === "home") renderHome();
  if (view === "review") renderReview();
  if (view === "settings") renderSettings();
  if (view === "setup") renderSetup();
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go]");
  if (t) { e.preventDefault(); go(t.dataset.go); }
});

// ---------- 홈 ----------
function calcStreak() {
  const days = new Set(sessions().filter((s) => s.durationSec >= 60).map((s) => new Date(s.at).toDateString()));
  let streak = 0; const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // 오늘 아직 안 했으면 어제부터
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function renderHome() {
  const today = todayScenario();
  $("today-title").textContent = `${today.ko} · ${today.en}`;
  $("today-goal").textContent = today.goal;
  $("stat-streak").textContent = calcStreak();
  $("stat-minutes").textContent = Math.round(sessions().reduce((a, s) => a + (s.durationSec || 0), 0) / 60);
  $("stat-phrases").textContent = phrases().length;
  $("key-warning").classList.toggle("hidden", !!settings().key);
  $("btn-review-quiz").disabled = phrases().length < 3;
  $("btn-review-quiz").textContent = phrases().length < 3
    ? "🔁 복습 퀴즈 (표현 3개 이상 저장되면 열려요)" : `🔁 저장한 표현 복습 퀴즈 (${phrases().length}개)`;
  const list = $("scenario-list");
  list.innerHTML = "";
  for (const s of SCENARIOS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.innerHTML = `${s.ko}<small>${s.en}</small>`;
    b.onclick = () => startLesson(s);
    list.appendChild(b);
  }
}
$("btn-start-today").onclick = () => startLesson(todayScenario());
$("btn-review-quiz").onclick = () => {
  const pool = phrases();
  const pick = pool.slice(0, 30).sort(() => Math.random() - 0.5).slice(0, 8);
  startLesson({ id: "review", ko: "복습 퀴즈", en: "Review quiz" }, pick);
};

// ---------- 처음 설정 (키 발급·붙여넣기 도우미) ----------
const isStandalone = () => window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function renderSetup() {
  const showInstall = !isStandalone() && /Mobi|iPhone|Android/.test(navigator.userAgent);
  $("step-install").classList.toggle("hidden", !showInstall);
  $("install-guide").innerHTML = isIOS()
    ? "사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>“홈 화면에 추가”</b> → 홈 화면의 <b>출근영어</b> 아이콘으로 다시 열기"
    : "브라우저 메뉴(⋮) → <b>“홈 화면에 추가”</b> 또는 <b>“앱 설치”</b> → 홈 화면 아이콘으로 다시 열기";
  const has = !!settings().key;
  $("setup-key").value = settings().key;
  $("setup-done").classList.toggle("hidden", !has);
  setSetupMsg(has ? "이미 키가 저장돼 있어요. 바꾸려면 새 키를 붙여넣으세요." : "", "");
}
function setSetupMsg(text, kind) { const m = $("setup-msg"); m.textContent = text; m.className = "msg " + (kind || ""); }

function extractKey(text) {
  const t = (text || "").trim();
  const m = t.match(/AIza[0-9A-Za-z_\-]{20,}/); // 구글 API 키 형식
  return m ? m[0] : t.replace(/\s+/g, "");
}

async function saveKeyFromSetup(raw) {
  const key = extractKey(raw);
  if (!key) return setSetupMsg("키가 비어 있어요. 먼저 1번에서 키를 복사해 주세요.", "err");
  $("setup-key").value = key;
  if (!key.startsWith("AIza")) setSetupMsg("구글 키는 보통 AIza로 시작해요. 확인 중…", "");
  else setSetupMsg("키 확인 중…", "");
  try {
    await testKey(key, settings().model);
    store.set("settings", { ...settings(), key });
    setSetupMsg("✅ 키 확인 완료! 저장했어요.", "ok");
    $("setup-done").classList.remove("hidden");
    $("setup-done").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) {
    setSetupMsg("❌ " + err.message + "\n키 전체가 복사됐는지 확인하고 다시 시도해 주세요.", "err");
  }
}

$("btn-paste-key").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    await saveKeyFromSetup(text);
  } catch {
    $("setup-key").focus();
    setSetupMsg("자동 붙여넣기가 막혀 있어요. 아래 칸을 길게 눌러 ‘붙여넣기’ 해주세요.", "err");
  }
};
$("setup-key").addEventListener("input", (e) => {
  if (extractKey(e.target.value).length >= 30) saveKeyFromSetup(e.target.value);
});
$("btn-show-key").onclick = () => {
  const i = $("setup-key"); const show = i.type === "password";
  i.type = show ? "text" : "password"; $("btn-show-key").textContent = show ? "키 숨기기" : "키 보기";
};

// ---------- 친구에게 공유 ----------
$("btn-share").onclick = async () => {
  const url = location.origin + location.pathname;
  const text = "출퇴근 운전하면서 AI랑 영어회화 연습하는 무료 앱이에요. 링크 열고 ‘홈 화면에 추가’ 한 다음 시작하기 누르면 돼요!";
  try {
    if (navigator.share) await navigator.share({ title: "출근영어", text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); alert("링크를 복사했어요. 카톡에 붙여넣어 보내세요!"); }
  } catch {}
};

// ---------- 설정 ----------
function renderSettings() {
  const s = settings();
  $("set-key").value = s.key; $("set-minutes").value = String(s.minutes);
  $("set-pace").value = s.pace;
  $("set-help").value = s.help; $("set-voice").value = s.voice; $("set-model").value = s.model;
  $("settings-msg").textContent = "";
}
function readSettingsForm() {
  return {
    key: $("set-key").value.trim(), minutes: Number($("set-minutes").value),
    pace: $("set-pace").value, help: $("set-help").value,
    voice: $("set-voice").value, model: $("set-model").value.trim() || DEFAULTS.model,
  };
}
$("btn-save-settings").onclick = () => {
  store.set("settings", readSettingsForm());
  $("settings-msg").textContent = "✅ 저장했어요.";
};
$("btn-test-key").onclick = async () => {
  store.set("settings", readSettingsForm());
  $("settings-msg").textContent = "테스트 중…";
  try {
    const s = settings();
    if (!s.key) throw new Error("API 키를 입력해 주세요.");
    const m = await testKey(s.key, s.model);
    $("settings-msg").textContent = `✅ 키 확인 완료! (${m.displayName || s.model})`;
  } catch (err) {
    $("settings-msg").textContent = "❌ " + err.message;
  }
};
$("btn-clear-data").onclick = () => {
  if (!confirm("저장한 표현과 대화 기록을 모두 지울까요? (API 키·설정은 유지)")) return;
  store.set("phrases", []); store.set("sessions", []);
  $("settings-msg").textContent = "삭제했어요.";
};

// ---------- 복습 ----------
function speak(text, lang = "en-US", rate = 0.85) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = rate;
  speechSynthesis.speak(u);
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function renderReview() {
  const list = phrases();
  $("phrase-count").textContent = list.length ? `(${list.length})` : "";
  const ul = $("phrase-list");
  ul.innerHTML = list.length ? "" : `<p class="empty">레슨을 하면 AI가 가르쳐준 표현이 자동으로 여기 쌓여요.</p>`;
  list.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="txt"><div class="en">${esc(p.en)}</div><div class="ko">${esc(p.ko)}</div></div>
      <button aria-label="듣기">🔊</button><button aria-label="삭제">🗑</button>`;
    const [play, del] = li.querySelectorAll("button");
    play.onclick = () => speak(p.en);
    del.onclick = () => { const l = phrases(); l.splice(i, 1); store.set("phrases", l); renderReview(); };
    ul.appendChild(li);
  });
  const sl = $("session-list");
  const ss = sessions();
  sl.innerHTML = ss.length ? "" : `<p class="empty">아직 대화 기록이 없어요.</p>`;
  for (const s of ss.slice(0, 30)) {
    const d = document.createElement("details");
    const when = new Date(s.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    d.innerHTML = `<summary>${when} · ${esc(s.topic)} · ${Math.round(s.durationSec / 60)}분</summary>` +
      (s.transcript.length ? s.transcript.map((t) => `<div class="line ${t.role}">${esc(t.text)}</div>`).join("")
        : `<p class="empty">대화 내용 없음</p>`);
    sl.appendChild(d);
  }
}

// ---------- 효과음 (화면 안 봐도 상태를 알 수 있게) ----------
let actx;
function tone(freqs, dur = 0.12) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    let t = actx.currentTime;
    for (const f of freqs) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
      t += dur + 0.03;
    }
  } catch {}
}
const chime = { start: () => tone([523, 659, 784]), end: () => tone([784, 659, 523]), error: () => tone([300, 220], 0.25) };

// ---------- 레슨 세션 (Gemini Live) ----------
const S = {}; // 현재 세션 상태

function setStatus(kind, text) {
  $("drive-orb").className = "orb " + kind;
  $("drive-status").textContent = text;
}
function fmt(sec) { return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; }

async function startLesson(scenario, reviewPhrases = []) {
  const s = settings();
  if (!s.key) { go("setup"); return; }
  chime.start(); // 사용자 탭 안에서 오디오 잠금 해제
  Object.assign(S, {
    scenario, s, transcript: [], startedAt: Date.now(), elapsed: 0,
    wrapSent: false, ending: false, retries: 0, active: true, stopTapped: false,
  });
  $("drive-topic").textContent = scenario.ko;
  $("drive-timer").textContent = "00:00";
  $("drive-caption").textContent = "";
  go("drive");
  setStatus("thinking", "연결 중…");

  S.live = new LiveSession({
    key: s.key, model: s.model, voice: s.voice, tools: TOOLS,
    instructions: buildInstructions({ scenario, minutes: s.minutes, koreanHelp: s.help, pace: s.pace, reviewPhrases }),
  }, {
    onReady: (isResume) => { if (!isResume) chime.start(); setStatus("thinking", isResume ? "다시 연결됨" : "선생님 준비 중…"); },
    onState: (k) => {
      if (k === "speaking") setStatus("speaking", "선생님 말하는 중");
      else if (k === "listening") setStatus("listening", "듣고 있어요 👂");
      else if (k === "idle") setStatus("listening", "말해보세요 🎤");
    },
    onAiText: (t) => { S.transcript.push({ role: "ai", text: t }); $("drive-caption").textContent = t; },
    onMeText: (t) => S.transcript.push({ role: "me", text: t }),
    onTool: (name, args) => {
      if (name === "save_phrase") addPhrase(args.en, args.ko);
      if (name === "end_session") {
        S.ending = true;
        // 작별 인사가 끝까지 나오도록: 선생님 음성이 2.5초 연속 조용하면 종료 (최대 15초)
        const t0 = Date.now(); let quietSince = 0;
        const iv = setInterval(() => {
          if (!S.active) return clearInterval(iv);
          const speaking = S.live.aiSpeaking;
          if (speaking) quietSince = 0; else if (!quietSince) quietSince = Date.now();
          if ((quietSince && Date.now() - quietSince > 2500 && Date.now() - t0 > 1500) || Date.now() - t0 > 15000) {
            clearInterval(iv); finish("bye");
          }
        }, 250);
      }
    },
    onClose: (info) => onDrop(info),
  });

  try {
    await S.live.initAudio();
    try { S.wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    await S.live.connect(false);
    S.timer = setInterval(tick, 1000);
  } catch (err) {
    console.error(err);
    chime.error();
    setStatus("error", "연결 실패");
    $("drive-caption").textContent = err.message || String(err);
    speak("연결에 실패했어요. 화면을 확인해 주세요.", "ko-KR", 1);
    S.active = false;
    cleanup();
  }
}

function sendWrapUp() {
  if (S.wrapSent) return;
  S.wrapSent = true;
  S.live?.sendText("(Time is up. Wrap up now: briefly recap the best 2-3 phrases from today, say goodbye, then call end_session.)");
}

function tick() {
  if (!S.active) return;
  S.elapsed = Math.floor((Date.now() - S.startedAt) / 1000);
  $("drive-timer").textContent = fmt(S.elapsed);
  if (S.elapsed >= S.s.minutes * 60 && !S.live?.aiSpeaking) sendWrapUp();
  if (S.elapsed >= S.s.minutes * 60 + 120) finish("timeout"); // 최종 안전장치
}

async function onDrop(info) {
  if (!S.active || S.ending || info.byUser) return;
  const remain = S.s.minutes * 60 - S.elapsed;
  // goAway(세션 시간 만료 예고)는 조용히 이어붙이기
  if (info.goAway && info.resumable) {
    S.live.goAway = false;
    try { await S.live.connect(true); return; } catch {}
  }
  if (S.retries < 2 && remain > 60) {
    S.retries++;
    chime.error();
    setStatus("error", "다시 연결 중…");
    speak("연결이 끊겼어요. 다시 연결할게요.", "ko-KR", 1);
    await new Promise((r) => setTimeout(r, 2500));
    if (!S.active) return;
    try {
      await S.live.connect(true);
      if (!info.resumable) S.live.sendText("(Connection was restored. Say 'Sorry, we got disconnected.' and continue the lesson.)");
    } catch (e) { onDrop({ ...info, goAway: false }); }
  } else {
    $("drive-caption").textContent = info.reason || "";
    finish("dropped");
  }
}

function cleanup() {
  try { S.live?.close(); } catch {}
  clearInterval(S.timer);
  try { S.wakeLock?.release(); } catch {}
}

function finish(reason) {
  if (!S.active) return;
  S.active = false;
  cleanup();
  chime.end();
  if (reason === "dropped") speak("연결이 끊겨서 레슨을 마칠게요. 수고했어요!", "ko-KR", 1);
  const durationSec = Math.floor((Date.now() - S.startedAt) / 1000);
  const rec = { at: S.startedAt, topic: S.scenario.ko, durationSec, transcript: S.transcript };
  store.set("sessions", [rec, ...sessions()].slice(0, 100));
  go("review");
  const box = $("last-session");
  box.classList.remove("hidden");
  box.innerHTML = `<b>🎉 수고했어요!</b><br><span class="empty">${esc(S.scenario.ko)} · ${fmt(durationSec)} · 오늘 배운 표현은 아래 노트에 자동 저장됐어요.</span>`;
}

$("btn-stop").onclick = () => {
  if (!S.active) return go("home");
  if (S.elapsed > 30 && !S.ending && S.live?.ready) {
    // 한 번 누르면 짧게 정리하고 종료, 두 번 누르면 즉시 종료
    if (S.stopTapped) return finish("user");
    S.stopTapped = true;
    $("btn-stop").textContent = "■ 한 번 더 누르면 바로 종료";
    S.live.stopPlayback();
    sendWrapUp();
    setTimeout(() => S.active && finish("user"), 25000);
  } else finish("user");
};
// 종료 버튼 문구 복구
new MutationObserver(() => { if (!$("view-drive").classList.contains("active")) { $("btn-stop").textContent = "■ 종료"; S.stopTapped = false; } })
  .observe($("view-drive"), { attributes: true, attributeFilter: ["class"] });

// ---------- PWA ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// 처음 연 사람(키 없음)은 바로 시작하기 도우미로
go(settings().key ? "home" : "setup");
