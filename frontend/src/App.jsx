import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// JARVIS — TASARIM REFERANSI (birebir) + eklenen özellikler
// Mevcut tasarımın CSS/markup/metinleri korunur; şifre kapısı,
// model seçici ve elle düzenleme yeni temalı öğeler olarak eklenir.
// ============================================================

const API = import.meta.env.VITE_API_BASE || ""; // örn: https://jarvis-api.<sub>.workers.dev
const uid = () =>
  crypto?.randomUUID?.()?.slice(0, 8) || Math.random().toString(36).slice(2, 10);
const now = () =>
  new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

// ---------- Oturum (şifre) + model — modül seviyesi köprü ----------
let AUTH_PASS = (typeof localStorage !== "undefined" && localStorage.getItem("jarvis.pass")) || "";
let SEL_MODEL = (typeof localStorage !== "undefined" && localStorage.getItem("jarvis.model")) || "";
const setAuthPass = (p) => { AUTH_PASS = p || ""; };
const setSelModel = (m) => { SEL_MODEL = m || ""; };
function authHeaders(extra) {
  const h = { ...(extra || {}) };
  if (AUTH_PASS) h["x-app-password"] = AUTH_PASS;
  return h;
}

// ---------- VERİ ŞEKLİ ÇEVİRİCİLERİ (Worker <-> tasarım) ----------
function fmtTime(at) {
  if (!at) return now();
  try {
    return new Date(at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return now();
  }
}
function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const opts = { day: "numeric", month: "short" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString("tr-TR", opts);
  } catch {
    return "";
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
      createdAt: t.createdAt,
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
async function loadState() {
  const r = await fetch(`${API}/api/state`, { headers: authHeaders() });
  if (!r.ok) return { groups: [], log: [], messages: [] };
  const data = await r.json(); // { state: { tasks, log } }
  const st = data.state || {};
  return { groups: tasksToGroups(st.tasks), log: serverLogToDesign(st.log), messages: [] };
}

async function saveState(state) {
  try {
    await fetch(`${API}/api/state`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        tasks: groupsToTasks(state.groups),
        log: (state.log || []).map((l) => ({ at: l.at || new Date().toISOString(), text: l.text })),
      }),
    });
  } catch (e) {}
}

// Gemini SUNUCUDA çalışır, anahtar Worker'da. Son konuşma "history" olarak gider.
async function apiErrorMessage(r) {
  // Worker hata gövdesi { error, message } döndürür; gerçek nedeni çıkar.
  try {
    const d = await r.json();
    return d.message || d.error || "";
  } catch {
    return "";
  }
}

async function askJarvis({ message, history }) {
  const r = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message, history, model: SEL_MODEL || undefined }),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("Oturum doğrulanamadı. 'kilitle' deyip şifreyle tekrar girin.");
    const detail = await apiErrorMessage(r);
    throw new Error(detail || `İstek başarısız (HTTP ${r.status})`);
  }
  const data = await r.json(); // { reply, state }
  const st = data.state || {};
  return { reply: data.reply, groups: tasksToGroups(st.tasks), log: serverLogToDesign(st.log) };
}

// Gün sonu raporu → /api/chat "rapor" (Worker'da deterministik). Dönüş: string.
async function makeReport() {
  const r = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message: "rapor" }),
  });
  if (!r.ok) throw new Error("api " + r.status);
  const d = await r.json(); // { reply, state }
  return typeof d === "string" ? d : d.reply || d.text || "";
}

// Seçilebilir modeller. Dönüş: {models:[], default}
async function fetchModels() {
  const r = await fetch(`${API}/api/models`, { headers: authHeaders() });
  if (!r.ok) throw new Error("api " + r.status);
  return await r.json();
}

// Şifre doğrulama: verilen şifreyle GET /api/state (200=doğru, 401=yanlış).
async function verifyAuth(pass) {
  try {
    const r = await fetch(`${API}/api/state`, { headers: pass ? { "x-app-password": pass } : {} });
    return r.ok;
  } catch {
    return false;
  }
}

// ============================================================
// Görev/alt görev düzenleyici (elle ekleme + düzenleme)
function TaskEditor({ task, initialGroup, groupNames, onSave, onCancel, onDelete }) {
  const known = groupNames.includes(initialGroup) ? initialGroup : "";
  const [title, setTitle] = useState(task?.title || "");
  const [groupSel, setGroupSel] = useState(known || (groupNames[0] || "__new__"));
  const [newGroup, setNewGroup] = useState(known ? "" : (initialGroup || ""));
  const [subs, setSubs] = useState((task?.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: !!s.done })));
  const [newSub, setNewSub] = useState("");

  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    setSubs((a) => [...a, { id: uid(), title: t, done: false }]);
    setNewSub("");
  };
  const save = () => {
    const t = title.trim();
    if (!t) return;
    const group = (groupSel === "__new__" ? newGroup.trim() : groupSel) || "Genel";
    onSave({
      title: t,
      group,
      subtasks: subs.map((s) => ({ id: s.id, title: s.title.trim(), done: s.done })).filter((s) => s.title),
    });
  };

  return (
    <div className="tedit">
      <input placeholder="Görev başlığı" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <select value={groupSel} onChange={(e) => setGroupSel(e.target.value)}>
        {groupNames.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
        <option value="__new__">+ Yeni grup…</option>
      </select>
      {groupSel === "__new__" && (
        <input placeholder="Yeni grup adı" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
      )}
      {subs.length > 0 && <span className="lbl">Alt görevler</span>}
      {subs.map((s, i) => (
        <div key={s.id} className="subedit">
          <input value={s.title} onChange={(e) => setSubs((a) => a.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <button className="ticon del" title="Sil" onClick={() => setSubs((a) => a.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="subedit">
        <input
          placeholder="Alt görev ekle…"
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }}
        />
        <button className="ticon" title="Ekle" onClick={addSub}>+</button>
      </div>
      <div className="erow">
        {onDelete && <button className="btnmini danger" onClick={onDelete}>Sil</button>}
        <button className="btnmini" onClick={onCancel}>İptal</button>
        <button className="btnmini ok" onClick={save}>Kaydet</button>
      </div>
    </div>
  );
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

  // oturum + model + düzenleme
  const [authed, setAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [authErr, setAuthErr] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("jarvis.model")) || "");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);

  // Açılışta oturumu doğrula (şifre yoksa sunucu auth kapalıysa direkt girer).
  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem("jarvis.pass") || "";
      const ok = await verifyAuth(stored);
      if (ok) { setAuthPass(stored); setAuthed(true); }
      else if (stored) { localStorage.removeItem("jarvis.pass"); }
      setAuthReady(true);
    })();
  }, []);

  // model seçimini kalıcı yap (adaptörler modül köprüsünden okur)
  useEffect(() => {
    if (model) { setSelModel(model); localStorage.setItem("jarvis.model", model); }
  }, [model]);

  // Giriş yapılınca durumu + modelleri yükle
  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const s = await loadState();
        setGroups(s.groups || []);
        setLog(s.log || []);
        setMessages(s.messages || []);
      } catch (e) {}
      finally { setLoaded(true); }
    })();
    fetchModels()
      .then((info) => {
        setModels(info.models || []);
        setModel((cur) => (cur && (info.models || []).includes(cur) ? cur : info.default));
      })
      .catch(() => {});
  }, [authed]);

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
      const detail = e instanceof Error && e.message ? e.message : "";
      const text = detail
        ? "Bir sorun oldu Efendim: " + detail
        : "Bunu tam çözemedim Efendim, biraz farklı ifade eder misiniz?";
      setMessages((m) => [...m, { role: "assistant", text }]);
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

  // --- elle düzenleme yardımcıları (istemci state; saveState effect'i PUT eder) ---
  const flatten = (gs) => gs.flatMap((g) => g.tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, createdAt: t.createdAt, subtasks: t.subtasks || [], group: g.name })));
  const rebuild = (flat) => {
    const order = [];
    const byName = new Map();
    for (const t of flat) {
      const name = (t.group && String(t.group).trim()) || "Genel";
      if (!byName.has(name)) { byName.set(name, []); order.push(name); }
      byName.get(name).push({ id: t.id, title: t.title, done: t.done, createdAt: t.createdAt, subtasks: t.subtasks || [] });
    }
    return order.map((name) => ({ id: "g_" + name, name, tasks: byName.get(name) }));
  };
  const addTaskFull = (d) => setGroups((gs) => rebuild([...flatten(gs), { id: uid(), title: d.title, done: false, createdAt: new Date().toISOString(), subtasks: d.subtasks || [], group: d.group }]));
  const updateTaskFull = (tid, d) => setGroups((gs) => rebuild(flatten(gs).map((t) => (t.id !== tid ? t : { ...t, title: d.title, group: d.group, subtasks: d.subtasks || [] }))));
  const deleteTaskFull = (tid) => setGroups((gs) => rebuild(flatten(gs).filter((t) => t.id !== tid)));

  const lock = () => { localStorage.removeItem("jarvis.pass"); setAuthPass(""); setAuthed(false); setLoaded(false); setPassInput(""); };
  const doLogin = async () => {
    const p = passInput;
    if (!p || authBusy) return;
    setAuthBusy(true); setAuthErr(null);
    const ok = await verifyAuth(p);
    if (ok) { localStorage.setItem("jarvis.pass", p); setAuthPass(p); setAuthed(true); }
    else { setAuthErr("Şifre hatalı"); }
    setAuthBusy(false);
  };

  const openCount = groups.reduce((n, g) => n + g.tasks.filter((t) => !t.done).length, 0);
  const groupNames = groups.map((g) => g.name);
  const today = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  // ---- Şifre kapısı ----
  if (!authed) {
    return (
      <div className="jv">
        <style>{CSS}</style>
        <div className="gate">
          <div className="core"><span className="ring" /><span className="ring inner" /><span className="dot" /></div>
          <div className="gatebox">
            <h1 className="gatetitle">JARVIS</h1>
            <p className="gatesub">Kimlik Doğrulama</p>
            {!authReady ? (
              <p className="gatesub">bağlanıyor…</p>
            ) : (
              <>
                <input
                  type="password"
                  placeholder="Şifre"
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }}
                  autoFocus
                />
                {authErr && <p className="gateerr">{authErr}</p>}
                <button onClick={doLogin} disabled={authBusy || !passInput}>{authBusy ? "…" : "GİRİŞ"}</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

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
            {models.length > 0 && (
              <select className="modelsel" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} title="Model" aria-label="Model">
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
            <button className="link" onClick={() => report()} disabled={busy}>rapor</button>
            <button className="link" onClick={newDay}>yeni gün</button>
            <button className="link" onClick={lock}>kilitle</button>
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
              ) : groups.length === 0 && !adding ? (
                <>
                  <p className="empty">Sizi dinliyorum, Efendim. Bugün ne var?</p>
                  <button className="addbtn" onClick={() => setAdding(true)}>+ Görev ekle</button>
                </>
              ) : (
                <>
                  {groups.map((g) => (
                    <div key={g.id} className="group">
                      <p className="gname">{g.name}</p>
                      {g.tasks.map((t) =>
                        editId === t.id ? (
                          <TaskEditor
                            key={t.id}
                            task={t}
                            initialGroup={g.name}
                            groupNames={groupNames}
                            onCancel={() => setEditId(null)}
                            onSave={(d) => { updateTaskFull(t.id, d); setEditId(null); }}
                            onDelete={() => { deleteTaskFull(t.id); setEditId(null); }}
                          />
                        ) : (
                          <div key={t.id} className={"task" + (t.done ? " done" : "")}>
                            <button className="tick2" onClick={() => toggle(g.id, t.id)}>{t.done && "✓"}</button>
                            <div className="tbody">
                              <span className="ttitle">{t.title}</span>
                              {t.createdAt && <span className="tdate">{fmtDate(t.createdAt)}</span>}
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
                            <div className="tactions">
                              <button className="ticon" title="Düzenle" onClick={() => setEditId(t.id)}>✎</button>
                              <button className="ticon del" title="Sil" onClick={() => deleteTaskFull(t.id)}>×</button>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ))}
                  {adding ? (
                    <TaskEditor
                      task={null}
                      initialGroup=""
                      groupNames={groupNames}
                      onCancel={() => setAdding(false)}
                      onSave={(d) => { addTaskFull(d); setAdding(false); }}
                    />
                  ) : (
                    <button className="addbtn" onClick={() => setAdding(true)}>+ Görev ekle</button>
                  )}
                </>
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
.tdate{display:block;margin-top:2px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:var(--mut);opacity:.75}
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

/* ===== EKLENEN ÖĞELER (yeni sınıflar; mevcut kurallar değişmedi) ===== */
.gate{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:40px 20px}
.gate .core{width:52px;height:52px}
.gatebox{display:flex;flex-direction:column;gap:10px;width:100%;max-width:280px}
.gatetitle{font-family:var(--serif);font-weight:500;font-size:22px;letter-spacing:.24em;text-align:center;margin:0}
.gatesub{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--mut);text-align:center;margin:0}
.gate input{padding:12px 14px;border-radius:12px;background:var(--panel);border:1px solid var(--line);
  color:var(--txt);font-family:var(--sans);font-size:15px;outline:none;text-align:center;letter-spacing:.15em}
.gate input:focus{border-color:rgba(224,163,74,.55);box-shadow:0 0 0 3px rgba(224,163,74,.08)}
.gate button{padding:11px;border:none;border-radius:12px;cursor:pointer;
  background:radial-gradient(circle at 40% 35%,var(--goldhi),var(--gold));color:#151310;
  font-weight:700;font-size:13px;letter-spacing:.14em;box-shadow:0 0 14px rgba(224,163,74,.35)}
.gate button:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
.gateerr{color:#d98a6a;font-size:12px;text-align:center;font-family:var(--mono);letter-spacing:.05em;margin:0}

.modelsel{background:var(--panel);border:1px solid var(--line);color:var(--txt);font-family:var(--mono);
  font-size:11px;letter-spacing:.03em;padding:4px 6px;border-radius:6px;cursor:pointer;max-width:150px}
.modelsel:focus{outline:none;border-color:rgba(224,163,74,.55)}
.modelsel:disabled{opacity:.5;cursor:wait}

.tactions{display:flex;gap:4px;align-items:center;flex:none;opacity:.45;transition:.15s}
.task:hover .tactions{opacity:1}
.ticon{background:none;border:none;color:var(--mut);cursor:pointer;font-size:13px;padding:3px;line-height:1}
.ticon:hover{color:var(--gold)}
.ticon.del:hover{color:#d98a6a}

.addbtn{margin:2px 0 6px;background:none;border:1px dashed var(--line);color:var(--mut);cursor:pointer;
  font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;padding:9px 10px;border-radius:6px;
  width:100%;text-transform:uppercase}
.addbtn:hover{border-color:rgba(224,163,74,.45);color:var(--gold)}

.tedit{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid rgba(224,163,74,.30);
  border-radius:6px;margin:6px 0;background:rgba(30,26,21,.45)}
.tedit input,.tedit select{padding:8px 10px;border-radius:6px;background:var(--panel);border:1px solid var(--line);
  color:var(--txt);font-family:var(--sans);font-size:14px;outline:none;width:100%}
.tedit input:focus,.tedit select:focus{border-color:rgba(224,163,74,.55)}
.tedit .lbl{font-family:var(--mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--mut)}
.subedit{display:flex;gap:6px;align-items:center}
.subedit input{flex:1}
.erow{display:flex;gap:8px;justify-content:flex-end;margin-top:2px}
.btnmini{background:none;border:1px solid var(--line);color:var(--txt);cursor:pointer;font-size:12px;
  padding:6px 12px;border-radius:6px;font-family:var(--sans)}
.btnmini.ok{background:var(--gold);border-color:var(--gold);color:#151310;font-weight:700}
.btnmini.danger{color:#d98a6a;border-color:rgba(217,138,106,.4)}
.btnmini:hover{border-color:var(--gold)}
`;
