import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Isi dua nilai ini dari Supabase > Project Settings > API.
// Nilai anon/publishable aman digunakan di browser dengan RLS aktif.
const SUPABASE_URL = "https://ftrmasttbgieceypndjp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_K3MwJ28D9r1-deilA-kVJg_ZNqqOnlu";
const MODEL_LABEL = "Nova AI · OpenAI";

const $ = (id) => document.getElementById(id);
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = supabaseReady ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let session = null;
let currentChatId = null;
let messages = [];
let attachedFile = null;
let isBusy = false;
let registerMode = false;

function showNotice(message) { $("authMessage").textContent = message; }
function setBusy(value) {
  isBusy = value;
  $("sendBtn").disabled = value;
  $("sendBtn").textContent = value ? "…" : "↑";
}
function setPage(page) {
  $("welcome").classList.toggle("hidden", page !== "welcome");
  $("chatArea").classList.toggle("hidden", page !== "chat");
  $("adminArea").classList.toggle("hidden", page !== "admin");
  $("composerWrap").classList.toggle("hidden", page === "admin");
  $("pageName").textContent = page.toUpperCase();
}
function safeText(text) {
  return String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function renderMarkdown(text) {
  // Escape HTML first, then add a small safe Markdown subset.
  let s = safeText(text);
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
  s = s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,"<br>")}</p>`).join("");
  return s;
}
function renderMessages() {
  const wrap = $("messages");
  wrap.innerHTML = "";
  messages.forEach(m => {
    const node = document.createElement("article");
    node.className = `message ${m.role}`;
    const text = typeof m.content === "string" ? m.content : (m.content.find(x => x.type === "text")?.text || "[Gambar terlampir]");
    node.innerHTML = `<div class="message-avatar">${m.role === "user" ? "U" : "N"}</div><div class="message-content">${m.role === "assistant" ? renderMarkdown(text) : safeText(text).replace(/\n/g,"<br>")}</div>`;
    wrap.appendChild(node);
  });
  wrap.scrollTop = wrap.scrollHeight;
}
function setUserUI(user) {
  $("userEmail").textContent = user?.email || "Guest mode";
  $("userStatus").textContent = user ? "Signed in" : (supabaseReady ? "Belum login" : "Atur Supabase");
  $("userAvatar").textContent = (user?.email?.[0] || "N").toUpperCase();
  $("authBtn").textContent = user ? "↪" : "↗";
}
async function refreshHistory() {
  if (!session || !supabase) {
    $("chatHistory").innerHTML = '<p class="muted small">Login untuk menyimpan chat.</p>';
    return;
  }
  const { data, error } = await supabase.from("chats").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(30);
  if (error) { $("chatHistory").textContent = "Riwayat belum tersedia."; return; }
  $("chatHistory").innerHTML = "";
  data.forEach(chat => {
    const btn = document.createElement("button");
    btn.className = "history-item";
    btn.textContent = "▱  " + chat.title;
    btn.onclick = () => loadChat(chat.id);
    $("chatHistory").appendChild(btn);
  });
  if (!data.length) $("chatHistory").innerHTML = '<p class="muted small">Belum ada percakapan.</p>';
}
async function saveChat() {
  if (!session || !supabase || !messages.length) return;
  const first = messages.find(m => m.role === "user");
  const title = (typeof first?.content === "string" ? first.content : first?.content?.find(x=>x.type==="text")?.text || "Percakapan gambar").slice(0, 52);
  const payload = { user_id: session.user.id, title, messages, updated_at: new Date().toISOString() };
  if (currentChatId) {
    const { error } = await supabase.from("chats").update(payload).eq("id", currentChatId);
    if (error) console.warn("Chat save:", error.message);
  } else {
    const { data, error } = await supabase.from("chats").insert(payload).select("id").single();
    if (error) console.warn("Chat save:", error.message);
    else currentChatId = data.id;
  }
  refreshHistory();
}
async function loadChat(id) {
  const { data, error } = await supabase.from("chats").select("*").eq("id", id).single();
  if (error || !data) return;
  currentChatId = id; messages = data.messages || [];
  $("welcome").classList.add("hidden"); $("chatArea").classList.remove("hidden"); $("adminArea").classList.add("hidden");
  $("composerWrap").classList.remove("hidden"); $("pageName").textContent = "CHAT";
  renderMessages(); $("sidebar").classList.remove("open");
}
function newChat() {
  currentChatId = null; messages = []; attachedFile = null;
  $("fileInput").value = ""; $("fileLabel").textContent = "";
  $("messages").innerHTML = ""; $("promptInput").value = "";
  setPage("welcome"); $("promptInput").focus(); $("sidebar").classList.remove("open");
}
function addMessage(role, content) { messages.push({ role, content }); renderMessages(); }

async function sendMessage(text) {
  if (isBusy || !text.trim()) return;
  if (!session) {
    $("authDialog").showModal();
    showNotice("Login atau daftar terlebih dahulu untuk menggunakan Nova AI.");
    return;
  }
  let userContent = text.trim();
  let apiContent = userContent;
  if (attachedFile?.kind === "image") {
    apiContent = [
      { type: "text", text: userContent || "Jelaskan gambar ini." },
      { type: "image_url", image_url: { url: attachedFile.data } }
    ];
    userContent += `\n[${attachedFile.name}]`;
  } else if (attachedFile?.kind === "text") {
    apiContent += `\n\nIsi file ${attachedFile.name}:\n${attachedFile.data}`;
    userContent += `\n[File: ${attachedFile.name}]`;
  }
  addMessage("user", userContent);
  const apiMessages = messages.slice(0, -1).map(m => ({ role:m.role, content:m.content }));
  apiMessages.push({ role:"user", content:apiContent });
  $("welcome").classList.add("hidden"); $("chatArea").classList.remove("hidden"); $("pageName").textContent = "CHAT";
  $("promptInput").value = ""; $("fileLabel").textContent = ""; attachedFile = null; $("fileInput").value = "";
  setBusy(true);
  const assistant = { role:"assistant", content:"" }; messages.push(assistant); renderMessages();
  const target = $("messages").lastElementChild.querySelector(".message-content");
  target.innerHTML = '<span class="typing">Nova sedang menyusun jawaban…</span>';
  try {
    const { data: { session: freshSession } } = await supabase.auth.getSession();
    if (!freshSession?.access_token) throw new Error("Sesi login berakhir. Login kembali.");
    const response = await fetch("/api/chat", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${freshSession.access_token}` },
      body:JSON.stringify({ messages: apiMessages })
    });
    if (!response.ok) {
      const error = await response.json().catch(()=>({}));
      throw new Error(error.error || `Request gagal (${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true });
      const chunks = buffer.split("\n\n"); buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find(x=>x.startsWith("data: "));
        if (!line) continue;
        const raw = line.slice(6);
        if (raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw);
          if (event.error) throw new Error(event.error);
          assistant.content += event.text || "";
          target.innerHTML = renderMarkdown(assistant.content);
          $("chatArea").scrollTop = $("chatArea").scrollHeight;
        } catch (e) { if (e.message && !e.message.includes("Unexpected")) throw e; }
      }
    }
    if (!assistant.content) assistant.content = "Maaf, belum ada jawaban yang diterima. Silakan coba lagi.";
    renderMessages(); await saveChat();
  } catch (error) {
    assistant.content = `⚠️ ${error.message}`;
    renderMessages();
  } finally { setBusy(false); }
}

async function openAdmin() {
  setPage("admin"); $("sidebar").classList.remove("open");
  $("adminNotice").textContent = "Memuat statistik…";
  try {
    const { data: { session: s } } = await supabase.auth.getSession();
    const r = await fetch("/api/admin", { headers:{ Authorization:`Bearer ${s.access_token}` } });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Tidak dapat memuat dashboard.");
    $("statUsers").textContent = d.users; $("statMessages").textContent = d.messages; $("statModel").textContent = d.model;
    $("adminNotice").textContent = "Statistik penggunaan project Nova AI.";
  } catch(e) { $("adminNotice").textContent = e.message; }
}

$("chatForm").addEventListener("submit", e => { e.preventDefault(); sendMessage($("promptInput").value); });
$("promptInput").addEventListener("input", e => { e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,180)+"px"; });
$("promptInput").addEventListener("keydown", e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("chatForm").requestSubmit();} });
$("newChatBtn").onclick = newChat;
$("homeBtn").onclick = () => { setPage("welcome"); $("sidebar").classList.remove("open"); };
$("adminBtn").onclick = openAdmin;
$("menuBtn").onclick = () => $("sidebar").classList.toggle("open");
$("themeBtn").onclick = () => { document.body.classList.toggle("dark"); localStorage.setItem("nova-theme",document.body.classList.contains("dark")?"dark":"light"); };
if(localStorage.getItem("nova-theme")==="dark") document.body.classList.add("dark");
$("modelName").textContent = MODEL_LABEL;

$("fileInput").addEventListener("change", async e => {
  const file = e.target.files[0]; if(!file) return;
  if(file.size > 5*1024*1024) { alert("Ukuran file maksimal 5 MB."); e.target.value=""; return; }
  if(file.type.startsWith("image/")) {
    const data = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    attachedFile = {kind:"image",name:file.name,data};
  } else {
    const allowed = ["text/plain","text/markdown","text/csv","application/json",""];
    if(!allowed.includes(file.type) && !/\.(txt|md|csv|json|js|html|css)$/i.test(file.name)) { alert("Format file ini belum didukung. Gunakan gambar atau file teks."); e.target.value=""; return; }
    attachedFile = {kind:"text",name:file.name,data:(await file.text()).slice(0,20000)};
  }
  $("fileLabel").textContent = "📎 " + file.name;
});
document.querySelectorAll("[data-prompt]").forEach(btn=>btn.onclick=()=>{ $("promptInput").value=btn.dataset.prompt; $("promptInput").focus(); });

$("authBtn").onclick = async () => {
  if(session) {
    await supabase.auth.signOut(); session=null; setUserUI(null); newChat(); refreshHistory();
  } else {
    if(!supabaseReady) { $("authDialog").showModal(); showNotice("Isi SUPABASE_URL dan SUPABASE_ANON_KEY di public/app.js terlebih dahulu."); }
    else { registerMode=false; $("authTitle").innerHTML="Masuk ke akunmu<span>.</span>"; $("authSubmit").innerHTML='Masuk <span>↗</span>'; $("authDialog").showModal(); }
  }
};
$("authSwitch").onclick = () => {
  registerMode=!registerMode;
  $("authTitle").innerHTML=registerMode?"Buat akun Nova<span>.</span>":"Masuk ke akunmu<span>.</span>";
  $("authSubmit").innerHTML=registerMode?'Daftar <span>↗</span>':'Masuk <span>↗</span>';
  $("authSwitch").textContent=registerMode?"Sudah punya akun? Masuk":"Belum punya akun? Daftar";
  showNotice("");
};
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  if(!supabaseReady) { showNotice("Konfigurasi Supabase belum diisi di public/app.js."); return; }
  const email=$("emailInput").value.trim(), password=$("passwordInput").value;
  $("authSubmit").disabled=true; showNotice("Memproses…");
  try {
    const result=registerMode
      ? await supabase.auth.signUp({email,password})
      : await supabase.auth.signInWithPassword({email,password});
    if(result.error) throw result.error;
    if(registerMode && !result.data.session) showNotice("Pendaftaran berhasil. Periksa email untuk konfirmasi, lalu login.");
    else { $("authDialog").close(); showNotice(""); }
  } catch(err) { showNotice(err.message); }
  finally { $("authSubmit").disabled=false; }
});

if(supabaseReady) {
  supabase.auth.onAuthStateChange((_event, s) => {
    session=s; setUserUI(s?.user||null); refreshHistory();
  });
  const {data}=await supabase.auth.getSession();
  session=data.session; setUserUI(session?.user||null); refreshHistory();
} else {
  setUserUI(null);
  $("authBtn").onclick=()=>{ $("authDialog").showModal(); showNotice("Isi SUPABASE_URL dan SUPABASE_ANON_KEY di public/app.js."); };
}
