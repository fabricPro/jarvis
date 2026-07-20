import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// JARVIS — TASARIM REFERANSI (birebir)
// Bu dosyanın AMACI: görünümü %100 sabitlemek.
// CSS, markup ve metinler AYNEN korunmalı.
// Sadece aşağıdaki 4 "adaptör" fonksiyonu kendi Worker API'ne bağla.
//
// >>> CLAUDE CODE'A NOT:
//   - CSS bloğunu, className'leri, renk tokenlarını, fontları,
//     .core / .topbar / .panel / mono göstergeleri, tüm metinleri DEĞİŞTİRME.
//   - Sadece loadState / saveState / askJarvis / makeReport gövdelerini
//     mevcut Worker uç noktalarına göre doldur. Görsele dokunma.
// ============================================================

const API = import.meta.env.VITE_API_BASE || ""; // örn: https://jarvis-api.<sub>.workers.dev
const uid = () =>
  crypto?.randomUUID?.()?.slice(0, 8) || Math.random().toString(36).slice(2, 10);
const now = () =>
  new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

// ---------- VERİ ŞEKLİ ÇEVİRİCİLERİ (Worker <-> tasarım) ----------
// Worker durumu {tasks:[{id,title,group,done,subtasks}], log:[{at,text}]} tutar.
// Bu tasarım {groups:[{id,name,tasks}], log:[{id,time,text}]} bekler.

function fmtTime(at) {
  if (!at) return now();
  try {
    return new Date(at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return now();
  }
}

function tasksToGroups(tasks) {
  const order = [];
  const byName = new Map();
  for (const t of tasks || []) {
    const name = (t.group && String(t.group).trim()) || "Genel";
    if (!byName.has(name)) {
      byName.set(name, []);
      order.push(name);
    }
    byName.get(name).push({
      id: t.id,
      title: t.title,
      done: !!t.done,
      subtasks: (t.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: !!s.done })),
    });
  }
  return order.map((name) => ({ id: "g_" + name, name, tasks: byName.get(name) }));
}

function serverLogToDesign(log) {
  return (log || []).map((l) => ({ id: uid(), time: fmtTime(l.at), text: l.text, at: l.at }));
}

function groupsToTasks(groups) {
  return (groups || []).flatMap((g) =>
    (g.tasks || []).map((t) => ({
      id: t.id,
      title: t.title,
      group: g.name,
      done: !!t.done,
      subtasks: (t.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: !!s.done })),
    }))
  );
}

// ---------- ADAPTÖRLER (Worker'a bağlı) ----------

// Kayıtlı durumu getir. Dönüş: {groups:[], log:[], messages:[]}
async function loadState() {
  const r = await fetch(`${API}/api/state`);
  if (!r.ok) return { groups: [], log: [], messages: [] };
  const data = await r.json(); // { state: { tasks, log } }
  const st = data.state || {};
  // Sohbet geçmişi sunucuda tutulmuyor; oturum boyunca istemcide kalır.
  return { groups: tasksToGroups(st.tasks), log: serverLogToDesign(st.log), messages: [] };
}

// Durumu kaydet (elle işaretleme, yeni gün vb. için) → PUT /api/state.
async function saveState(state) {
  try {
    await fetch(`${API}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: groupsToTasks(state.groups),
        log: (state.log || []).map((l) => ({ at: l.at || new Date().toISOString(), text: l.text })),
      }),
    });
  } catch (e) {}
}

// Kullanıcı mesajını Worker'a gönder; Gemini SUNUCUDA çalışır, anahtar Worker'da.
// Dönüş: {reply, groups, log}
async function askJarvis({ message }) {
  const r = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!r.ok) throw new Error("api " + r.status);
  const data = await r.json(); // { reply, state }
  const st = data.state || {};
  return { reply: data.reply, groups: tasksToGroups(st.tasks), log: serverLogToDesign(st.log) };
}

// Gün sonu raporu → /api/chat "rapor" (Worker'da deterministik üretilir). Dönüş: string.
async function makeReport() {
  const r = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "rapor" }),
  });
  if (!r.ok) throw new Error("api " + r.status);
  const d = await r.json(); // { reply, state }
  return typeof d === "string" ? d : d.reply || d.text || "";
}

// ============================================================

export default function App() {
  const [groups, setGroups] = useState([]);
  const [log, setLog] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("plan");
  const [clock, setClock] = useState(now());
  const chatEnd = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await loadState();
        setGroups(s.groups || []);
        setLog(s.log || []);
        setMessages(s.messages || []);
      } catch (e) {}
      finally { setLoaded(true); }
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    saveState({ groups, log, messages });
  }, [groups, log, messages, loaded]);

  useEffect(() => {
    const id = setInterval(() => setClock(now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    if (/^rapor|gün sonu|özet çıkar/i.test(text)) {
      await report(text);
      setBusy(false);
      return;
    }
    try {
      const history = messages.slice(-6).map((m) => (m.role === "user" ? "Kullanıcı: " : "JARVIS: ") + m.text).join("\n");
      const res = await askJarvis({ message: text, groups, log, history });
      if (Array.isArray(res.groups)) setGroups(res.groups);
      if (Array.isArray(res.log)) setLog(res.log.map((l) => ({ ...l, time: l.time || now() })));
      setMessages((m) => [...m, { role: "assistant", text: res.reply || "Tamamdır, güncelledim." }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: "Bunu tam çözemedim Efendim, biraz farklı ifade eder misiniz?" }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, groups, log, messages]);

  const report = useCallback(async (trigger) => {
    setMessages((m) => (trigger ? m : [...m, { role: "user", text: "rapor" }]));
    try {
      const done = groups.flatMap((g) => g.tasks.filter((t) => t.done).map((t) => "- " + g.name + ": " + t.title));
      const logs = log.map((l) => l.time + " — " + l.text);
      if (!done.length && !logs.length) {
        setMessages((m) => [...m, { role: "assistant", text: "Henüz raporlayacak tamamlanmış iş yok, Efendim." }]);
        return;
      }
      const txt = await makeReport({ done, logs });
      setMessages((m) => [...m, { role: "assistant", text: (txt || "").trim(), report: true }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: "Raporu çıkaramadım." }]);
    }
  }, [groups, log]);

  const toggle = (gid, tid, sid) =>
    setGroups((gs) =>
      gs.map((g) =>
        g.id !== gid ? g : {
          ...g,
          tasks: g.tasks.map((t) => {
            if (t.id !== tid) return t;
            if (sid) return { ...t, subtasks: t.subtasks.map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) };
            return { ...t, done: !t.done };
          }),
        }
      )
    );

  const newDay = () => {
    if (!confirm("Bugünün planını ve günlüğünü temizleyip yeni güne başlansın mı?")) return;
    setGroups([]); setLog([]); setMessages([]);
  };

  const openCount = groups.reduce((n, g) => n + g.tasks.filter((t) => !t.done).length, 0);
  const today = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="jv">
      <style>{CSS}</style>

      {/* sistem çubuğu */}
      <div className="topbar">
        <span>{today}</span>
        <span className="online"><i /> ÇEVRİMİÇİ</span>
      </div>

      <div className="wrap">
        {/* başlık + varlık */}
        <header className="head">
          <div className="brand">
            <div className={"core" + (busy ? " busy" : "")}>
              <span className="ring" /><span className="ring inner" /><span className="dot" />
            </div>
            <div>
              <h1 className="hi">JARVIS</h1>
              <p className="statusline">
                {busy ? "İŞLENİYOR" : "SİSTEM HAZIR"}
                <b> · </b>{loaded ? openCount : "—"} GÖREV<b> · </b>{clock}
              </p>
            </div>
          </div>
          <div className="hactions">
            <button className="link" onClick={() => report()} disabled={busy}>rapor</button>
            <button className="link" onClick={newDay}>yeni gün</button>
          </div>
        </header>

        {/* sekmeler */}
        <div className="tabs">
          <button className={"tab" + (tab === "plan" ? " on" : "")} onClick={() => setTab("plan")}>Bugünün Planı</button>
          <button className={"tab" + (tab === "gunluk" ? " on" : "")} onClick={() => setTab("gunluk")}>
            Günlük {log.length > 0 && <em>{log.length}</em>}
          </button>
        </div>

        {/* panel */}
        <div className="panel">
          <span className="tick tl" /><span className="tick tr" /><span className="tick bl" /><span className="tick br" />
          <div className="board">
            {tab === "plan" ? (
              !loaded ? (
                <p className="empty">bağlanıyor…</p>
              ) : groups.length === 0 ? (
                <p className="empty">Sizi dinliyorum, Efendim. Bugün ne var?</p>
              ) : (
                groups.map((g) => (
                  <div key={g.id} className="group">
                    <p className="gname">{g.name}</p>
                    {g.tasks.map((t) => (
                      <div key={t.id} className={"task" + (t.done ? " done" : "")}>
                        <button className="tick2" onClick={() => toggle(g.id, t.id)}>{t.done && "✓"}</button>
                        <div className="tbody">
                          <span className="ttitle">{t.title}</span>
                          {t.subtasks?.length > 0 && (
                            <ul className="subs">
                              {t.subtasks.map((s) => (
                                <li key={s.id} className={s.done ? "sd" : ""}>
                                  <button className="sc" onClick={() => toggle(g.id, t.id, s.id)}>{s.done ? "✓" : "–"}</button>
                                  {s.title}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )
            ) : log.length === 0 ? (
              <p className="empty">Kayıt yok. "Şunu bitirdim" derseniz buraya işlerim.</p>
            ) : (
              <div className="loglist">
                {log.map((l) => (
                  <div key={l.id} className="logrow">
                    <span className="ltime">{l.time}</span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* sohbet */}
        <div className="chat">
          {messages.length === 0 && !busy && (
            <p className="hintmsg">Örnek: "Bugün müşteriye numune hazırla, tedarikçiyi ara, akşam çamaşır."</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={"msg " + m.role + (m.report ? " rep" : "")}>{m.text}</div>
          ))}
          {busy && <div className="msg assistant think">Değerlendiriyorum<span className="d">…</span></div>}
          <div ref={chatEnd} />
        </div>
      </div>

      {/* girdi */}
      <div className="dock">
        <div className="dockin">
          <textarea
            className="in"
            rows={1}
            placeholder="Buyurun, Efendim… (iş ekle, değiştir, bitir, ya da 'rapor')"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
          />
          <button className="send" onClick={send} disabled={busy || !input.trim()}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ====== TASARIM (AYNEN KORU — hiçbir kuralı değiştirme) ======
const CSS = `
.jv{--bg:#151310;--panel:#1e1a15;--line:rgba(236,227,210,.10);--txt:#ece3d2;--mut:#8f8676;
  --gold:#e0a34a;--goldhi:#f3c877;--steel:#7d93a6;
  --serif:'Iowan Old Style','Palatino Linotype',Georgia,serif;
  --sans:'Inter',system-ui,sans-serif;
  --mono:'JetBrains Mono','SF Mono',ui-monospace,Menlo,monospace;
  position:relative;min-height:100%;color:var(--txt);font-family:var(--sans);
  background:radial-gradient(150% 90% at 50% -25%,rgba(224,163,74,.09),transparent 55%),#151310;
  display:flex;flex-direction:column}
.jv *{box-sizing:border-box}

.topbar{display:flex;justify-content:space-between;align-items:center;
  padding:8px 20px;font-family:var(--mono);font-size:10px;letter-spacing:.22em;
  color:var(--mut);border-bottom:1px solid var(--line);text-transform:uppercase}
.online{display:flex;align-items:center;gap:6px;color:var(--gold)}
.online i{width:6px;height:6px;border-radius:50%;background:var(--gold);
  box-shadow:0 0 6px var(--gold);animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.45}50%{opacity:1}}

.wrap{max-width:680px;width:100%;margin:0 auto;padding:22px 20px 130px;flex:1}

.head{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px}
.brand{display:flex;align-items:center;gap:14px}
.core{position:relative;width:38px;height:38px;flex:none}
.core .ring{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(224,163,74,.30)}
.core .ring.inner{inset:8px;border-color:rgba(224,163,74,.55)}
.core .dot{position:absolute;inset:15px;border-radius:50%;background:radial-gradient(circle,var(--goldhi),var(--gold));
  box-shadow:0 0 10px rgba(224,163,74,.7);animation:breathe 3s ease-in-out infinite}
.core.busy .dot{animation-duration:1s}
.core.busy .ring{animation:spin 3s linear infinite}
.core.busy .ring.inner{animation:spin 2s linear infinite reverse}
@keyframes spin{to{transform:rotate(360deg)}}
.hi{margin:0;font-family:var(--serif);font-weight:500;font-size:23px;letter-spacing:.2em}
.statusline{margin:3px 0 0;font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--mut)}
.statusline b{color:var(--gold);font-weight:400}
.hactions{display:flex;gap:14px}
.link{cursor:pointer;background:none;border:none;color:var(--gold);font-size:12.5px;
  border-bottom:1px solid transparent;padding:0 0 1px}
.link:hover:not(:disabled){border-bottom-color:var(--gold)}
.link:disabled{color:var(--mut);cursor:wait}

.tabs{display:flex;gap:2px;margin:6px 0 12px;border-bottom:1px solid var(--line)}
.tab{cursor:pointer;background:none;border:none;color:var(--mut);font-size:13.5px;padding:8px 14px;position:relative}
.tab:hover{color:var(--txt)}
.tab.on{color:var(--txt)}
.tab.on::after{content:"";position:absolute;left:14px;right:14px;bottom:-1px;height:2px;background:var(--gold);
  box-shadow:0 0 8px rgba(224,163,74,.5)}
.tab em{font-style:normal;font-family:var(--mono);font-size:10px;color:var(--gold);margin-left:3px}

.panel{position:relative;background:linear-gradient(180deg,rgba(30,26,21,.5),rgba(30,26,21,.2));
  border:1px solid var(--line);border-radius:4px;padding:16px 16px 8px;margin-bottom:22px}
.tick{position:absolute;width:9px;height:9px;pointer-events:none}
.tick.tl{top:-1px;left:-1px;border-top:1.5px solid var(--gold);border-left:1.5px solid var(--gold)}
.tick.tr{top:-1px;right:-1px;border-top:1.5px solid var(--gold);border-right:1.5px solid var(--gold)}
.tick.bl{bottom:-1px;left:-1px;border-bottom:1.5px solid var(--gold);border-left:1.5px solid var(--gold)}
.tick.br{bottom:-1px;right:-1px;border-bottom:1.5px solid var(--gold);border-right:1.5px solid var(--gold)}

.empty{text-align:center;padding:26px 16px;color:var(--mut);font-family:var(--serif);font-style:italic;font-size:15px}
.group{margin-bottom:14px}
.gname{margin:0 0 6px;font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.task{display:flex;gap:12px;padding:9px 2px;border-bottom:1px solid var(--line);align-items:flex-start}
.task:last-child{border-bottom:none}
.task.done{opacity:.4}
.task.done .ttitle{text-decoration:line-through}
.tick2{flex:none;width:19px;height:19px;margin-top:1px;border-radius:50%;cursor:pointer;
  border:1.5px solid var(--mut);background:transparent;color:#151310;font-size:11px;font-weight:700;
  display:grid;place-items:center;transition:.15s}
.task.done .tick2{background:var(--gold);border-color:var(--gold);box-shadow:0 0 8px rgba(224,163,74,.4)}
.tbody{flex:1;min-width:0}
.ttitle{font-family:var(--serif);font-size:16px;line-height:1.35;word-break:break-word}
.subs{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.subs li{display:flex;gap:8px;font-size:13.5px;color:var(--txt);align-items:baseline}
.subs li.sd{color:var(--mut);text-decoration:line-through}
.sc{flex:none;background:none;border:none;color:var(--gold);cursor:pointer;font-size:12px;padding:0;width:12px}

.loglist{display:flex;flex-direction:column}
.logrow{display:flex;gap:12px;padding:8px 2px;border-bottom:1px solid var(--line);font-size:14px}
.logrow:last-child{border-bottom:none}
.ltime{flex:none;font-family:var(--mono);color:var(--gold);font-size:11.5px;letter-spacing:.05em;padding-top:2px}

.chat{display:flex;flex-direction:column;gap:10px}
.hintmsg{color:var(--mut);font-style:italic;font-family:var(--serif);font-size:14px;margin:4px 0}
.msg{max-width:88%;padding:10px 14px;font-size:14.5px;line-height:1.55;border-radius:12px;white-space:pre-wrap;word-break:break-word}
.msg.user{align-self:flex-end;background:#282219;border:1px solid var(--line);border-bottom-right-radius:3px;font-family:var(--sans)}
.msg.assistant{align-self:flex-start;font-family:var(--serif);color:var(--txt);border-left:2px solid var(--gold);
  border-radius:0;padding-left:14px}
.msg.assistant.think{color:var(--mut);font-style:italic;border-left-color:var(--gold)}
.msg.assistant.think .d{animation:blink 1.2s steps(1) infinite}
@keyframes blink{50%{opacity:.2}}
.msg.rep{background:var(--panel);border:1px solid var(--line);border-left:2px solid var(--gold);
  border-radius:6px;max-width:100%;padding:14px 16px;box-shadow:0 0 24px rgba(224,163,74,.06)}

.dock{position:sticky;bottom:0;background:linear-gradient(transparent,#151310 24%);padding:14px 20px 18px;
  display:flex;justify-content:center}
.dockin{display:flex;align-items:flex-end;max-width:600px;width:100%}
.in{flex:1;resize:none;min-height:48px;max-height:140px;padding:13px 15px;border-radius:24px;
  background:var(--panel);border:1px solid var(--line);color:var(--txt);font-family:var(--sans);
  font-size:15px;line-height:1.4;outline:none;transition:.15s}
.in::placeholder{color:#6f6656}
.in:focus{border-color:rgba(224,163,74,.55);box-shadow:0 0 0 3px rgba(224,163,74,.08)}
.send{flex:none;width:48px;height:48px;margin-left:10px;border-radius:50%;border:none;cursor:pointer;
  background:radial-gradient(circle at 40% 35%,var(--goldhi),var(--gold));color:#151310;
  font-size:20px;font-weight:700;transition:.15s;box-shadow:0 0 14px rgba(224,163,74,.35)}
.send:hover:not(:disabled){box-shadow:0 0 22px rgba(224,163,74,.6);transform:translateY(-1px)}
.send:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}

@media (max-width:520px){.wrap{padding:20px 16px 130px}.hi{font-size:20px}}
@media (prefers-reduced-motion:reduce){.core .dot,.online i,.core.busy .ring{animation:none!important}}
`;
