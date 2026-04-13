/**
 * BanterAgent DevLog — real-time debug dashboard at http://localhost:4321
 * Shows every Claude API call: system prompt, history, response, tokens, mode, reasoning.
 */
import http from "http";
import { EventEmitter } from "events";

export type LogType = "chat" | "auto" | "structured" | "content" | "command" | "scheduled";

export interface LogEntry {
  id: number;
  ts: string;
  type: LogType;
  groupId?: string;
  mode?: string;
  sender?: string;
  command?: string;
  args?: string;
  // Claude API call
  systemPrompt?: string;
  history?: Array<{ role: string; content: string }>;
  prompt?: string;
  response?: string;
  inputTokens?: number;
  outputTokens?: number;
  // Auto-response
  silent?: boolean;
  recentMessages?: string[];
  // Meta
  durationMs?: number;
  error?: string;
}

const logs: LogEntry[] = [];
let nextId = 1;
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function devlog(entry: Omit<LogEntry, "id" | "ts">): void {
  const full: LogEntry = { id: nextId++, ts: new Date().toISOString(), ...entry };
  logs.unshift(full);
  if (logs.length > 300) logs.pop();
  emitter.emit("log", full);
}

// ===== Dashboard HTML =====
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BanterAgent DevLog</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}
header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;align-items:center;gap:16px;flex-shrink:0}
header h1{font-size:15px;font-weight:600;color:#58a6ff}
#stats{display:flex;gap:12px;font-size:12px;color:#8b949e;margin-left:auto}
#stats span{background:#21262d;padding:3px 8px;border-radius:4px}
#stats span b{color:#e6edf3}
.main{display:flex;flex:1;overflow:hidden}
#list{width:380px;flex-shrink:0;overflow-y:auto;border-right:1px solid #30363d}
#detail{flex:1;overflow-y:auto;padding:16px}
.entry{padding:10px 12px;border-bottom:1px solid #21262d;cursor:pointer;transition:background .1s}
.entry:hover{background:#161b22}
.entry.active{background:#1c2128;border-left:3px solid #58a6ff}
.entry-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.badge{font-size:10px;font-weight:600;padding:2px 6px;border-radius:3px;text-transform:uppercase}
.badge-chat{background:#1f4a8a;color:#79c0ff}
.badge-auto{background:#2d4a1e;color:#7ee787}
.badge-auto.silent{background:#3d2b1f;color:#ff7b72}
.badge-structured{background:#4a2d8a;color:#d2a8ff}
.badge-content{background:#4a3d1f;color:#e3b341}
.badge-command{background:#21262d;color:#8b949e}
.badge-scheduled{background:#1a3a4a;color:#56d3fb}
.mode-badge{font-size:10px;padding:2px 6px;border-radius:3px;background:#21262d;color:#8b949e}
.entry-sender{font-size:12px;color:#e6edf3;font-weight:500}
.entry-preview{font-size:11px;color:#8b949e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}
.entry-meta{font-size:10px;color:#484f58;margin-top:2px;display:flex;gap:8px}
.entry-meta .tokens{color:#58a6ff}
.entry-meta .dur{color:#7ee787}
/* Detail panel */
.detail-empty{color:#484f58;font-size:14px;padding:40px;text-align:center}
.section{margin-bottom:16px}
.section-title{font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:between;gap:8px}
.section-title .toggle{margin-left:auto;cursor:pointer;color:#58a6ff;font-size:11px;user-select:none}
.section-content{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;font-family:'Cascadia Code','Fira Code',monospace;color:#e6edf3;max-height:300px;overflow-y:auto}
.section-content.collapsed{max-height:80px;overflow:hidden;position:relative}
.section-content.collapsed::after{content:'';position:absolute;bottom:0;left:0;right:0;height:30px;background:linear-gradient(transparent,#161b22)}
.msg{margin-bottom:8px;padding:8px 10px;border-radius:4px}
.msg-user{background:#1c2128;border-left:3px solid #58a6ff}
.msg-assistant{background:#1a2718;border-left:3px solid #7ee787}
.msg-role{font-size:10px;font-weight:600;color:#8b949e;margin-bottom:4px;text-transform:uppercase}
.msg-content{font-size:12px;white-space:pre-wrap;word-break:break-word}
.response-box{background:#1a2718;border:1px solid #2ea043;border-radius:6px;padding:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#e6edf3}
.response-box.error{background:#2d1b1b;border-color:#f85149;color:#ff7b72}
.detail-header{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #30363d}
.detail-header h2{font-size:14px;font-weight:600}
.detail-meta{font-size:11px;color:#8b949e;margin-left:auto;display:flex;gap:12px}
.detail-meta .tok{color:#58a6ff}
.detail-meta .dur{color:#7ee787}
#filters{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #30363d;flex-shrink:0}
.filter-btn{font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid #30363d;background:#21262d;color:#8b949e;cursor:pointer}
.filter-btn.active{border-color:#58a6ff;color:#58a6ff;background:#1c2b3a}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#0d1117}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}
</style>
</head>
<body>
<header>
  <h1>🤖 BanterAgent DevLog</h1>
  <div id="stats">
    <span>Total: <b id="s-total">0</b></span>
    <span>Chat: <b id="s-chat">0</b></span>
    <span>Auto: <b id="s-auto">0</b></span>
    <span>Silent: <b id="s-silent">0</b></span>
    <span id="s-live" style="color:#7ee787">● LIVE</span>
  </div>
</header>
<div id="filters">
  <button class="filter-btn active" data-filter="all">All</button>
  <button class="filter-btn" data-filter="chat">Chat</button>
  <button class="filter-btn" data-filter="auto">Auto</button>
  <button class="filter-btn" data-filter="structured">Games</button>
  <button class="filter-btn" data-filter="content">Content</button>
  <button class="filter-btn" data-filter="command">Commands</button>
</div>
<div class="main">
  <div id="list"></div>
  <div id="detail"><div class="detail-empty">← Select an entry to see full details</div></div>
</div>
<script>
const logs = [];
let selected = null;
let filter = 'all';
let counts = {total:0,chat:0,auto:0,silent:0};

function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-IN', {hour12:false}) + '.' + String(d.getMilliseconds()).padStart(3,'0');
}

function badgeClass(e) {
  if (e.type === 'auto') return e.silent ? 'badge-auto silent' : 'badge-auto';
  return 'badge-' + e.type;
}
function badgeLabel(e) {
  if (e.type === 'auto') return e.silent ? 'silent' : 'auto-reply';
  if (e.type === 'structured') return 'game';
  return e.type;
}

function renderList() {
  const list = document.getElementById('list');
  const visible = filter === 'all' ? logs : logs.filter(e => e.type === filter);
  list.innerHTML = visible.map(e => \`
    <div class="entry\${selected?.id === e.id ? ' active' : ''}" onclick="select(\${e.id})">
      <div class="entry-top">
        <span class="badge \${badgeClass(e)}">\${badgeLabel(e)}</span>
        \${e.mode ? \`<span class="mode-badge">\${e.mode}</span>\` : ''}
        <span class="entry-sender">\${e.sender || e.command || e.type}</span>
      </div>
      <div class="entry-preview">\${e.response?.slice(0,80) || e.prompt?.slice(0,80) || e.args?.slice(0,80) || '—'}</div>
      <div class="entry-meta">
        <span>\${timeStr(e.ts)}</span>
        \${e.inputTokens ? \`<span class="tokens">↑\${e.inputTokens} ↓\${e.outputTokens}</span>\` : ''}
        \${e.durationMs ? \`<span class="dur">\${e.durationMs}ms</span>\` : ''}
        \${e.groupId ? \`<span>\${e.groupId.slice(0,20)}...</span>\` : ''}
      </div>
    </div>
  \`).join('');
}

function toggle(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('collapsed');
  const btn = el.previousElementSibling?.querySelector('.toggle');
  if (btn) btn.textContent = el.classList.contains('collapsed') ? '[expand]' : '[collapse]';
}

function renderDetail(e) {
  if (!e) return '<div class="detail-empty">← Select an entry</div>';
  let html = \`<div class="detail-header">
    <span class="badge \${badgeClass(e)}">\${badgeLabel(e)}</span>
    \${e.mode ? \`<span class="mode-badge">\${e.mode}</span>\` : ''}
    <h2>\${e.sender || e.command || e.type}</h2>
    <div class="detail-meta">
      <span>\${new Date(e.ts).toLocaleString('en-IN')}</span>
      \${e.inputTokens ? \`<span class="tok">↑\${e.inputTokens} input · ↓\${e.outputTokens} output tokens</span>\` : ''}
      \${e.durationMs ? \`<span class="dur">\${e.durationMs}ms</span>\` : ''}
    </div>
  </div>\`;

  if (e.command) html += \`<div class="section"><div class="section-title">Command</div><div class="section-content">!\${e.command}\${e.args ? ' ' + e.args : ''}</div></div>\`;
  if (e.groupId) html += \`<div class="section"><div class="section-title">Group</div><div class="section-content">\${e.groupId}</div></div>\`;

  if (e.systemPrompt) html += \`<div class="section"><div class="section-title">System Prompt <span class="toggle" onclick="toggle('sp-\${e.id}')">[collapse]</span></div><div class="section-content" id="sp-\${e.id}">\${escHtml(e.systemPrompt)}</div></div>\`;

  if (e.recentMessages?.length) html += \`<div class="section"><div class="section-title">Recent Messages Buffer <span class="toggle" onclick="toggle('rm-\${e.id}')">[expand]</span></div><div class="section-content collapsed" id="rm-\${e.id}">\${e.recentMessages.map(m => escHtml(m)).join('\\n')}</div></div>\`;

  if (e.history?.length) {
    const msgs = e.history.map(m => \`<div class="msg msg-\${m.role}"><div class="msg-role">\${m.role}</div><div class="msg-content">\${escHtml(m.content)}</div></div>\`).join('');
    html += \`<div class="section"><div class="section-title">Conversation History (\${e.history.length} msgs) <span class="toggle" onclick="toggle('h-\${e.id}')">[expand]</span></div><div class="section-content collapsed" id="h-\${e.id}" style="padding:8px;max-height:400px">\${msgs}</div></div>\`;
  }

  if (e.prompt) html += \`<div class="section"><div class="section-title">Prompt</div><div class="section-content">\${escHtml(e.prompt)}</div></div>\`;

  if (e.response || e.error) html += \`<div class="section"><div class="section-title">Response</div><div class="response-box\${e.error ? ' error' : ''}">\${escHtml(e.error || e.response || '')}</div></div>\`;

  return html;
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function select(id) {
  selected = logs.find(e => e.id === id);
  document.getElementById('detail').innerHTML = renderDetail(selected);
  renderList();
}

function addLog(e) {
  logs.unshift(e);
  if (logs.length > 300) logs.pop();
  counts.total++;
  if (e.type === 'chat') counts.chat++;
  if (e.type === 'auto' && !e.silent) counts.auto++;
  if (e.type === 'auto' && e.silent) counts.silent++;
  document.getElementById('s-total').textContent = counts.total;
  document.getElementById('s-chat').textContent = counts.chat;
  document.getElementById('s-auto').textContent = counts.auto;
  document.getElementById('s-silent').textContent = counts.silent;
  renderList();
}

// Filters
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    renderList();
  });
});

// SSE
const es = new EventSource('/events');
es.onmessage = e => addLog(JSON.parse(e.data));
es.onerror = () => { document.getElementById('s-live').textContent = '● DISCONNECTED'; document.getElementById('s-live').style.color = '#f85149'; };
es.onopen = () => { document.getElementById('s-live').textContent = '● LIVE'; document.getElementById('s-live').style.color = '#7ee787'; };
</script>
</body>
</html>`;

// ===== HTTP Server =====
let serverStarted = false;

export function startDevServer(port = 4321): void {
  if (serverStarted) return;
  serverStarted = true;

  const server = http.createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      // Send existing logs to new client
      for (const log of [...logs].reverse()) {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }
      const handler = (log: LogEntry) => res.write(`data: ${JSON.stringify(log)}\n\n`);
      emitter.on("log", handler);
      req.on("close", () => emitter.off("log", handler));
      return;
    }
    if (req.url === "/logs") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(logs));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`\n🔍 DevLog dashboard → http://localhost:${port}\n`);
  });
}
