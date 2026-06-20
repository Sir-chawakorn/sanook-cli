const I18N = {
  en: {
    productName: 'Sanook Dashboard',
    tagline: 'Configure models, sessions, MCP, gateway, and your second brain',
    nav: {
      home: 'Home',
      terminal: 'Terminal',
      chat: 'Chat',
      models: 'Models',
      sessions: 'Sessions',
      skills: 'Skills',
      memory: 'Memory',
      usage: 'Usage',
      selfimprove: 'Self-improve',
      files: 'Files',
      logs: 'Logs',
      cron: 'Cron',
      channels: 'Channels',
      config: 'Config',
      mcp: 'MCP',
      brain: 'Brain',
      install: 'Install',
    },
    terminal: {
      title: 'Web terminal',
      hint: 'Run Sanook AI right here — streams text, tools, 🧠 memory and ✨ skills like the real REPL.',
      agent: 'Agent console',
      shell: 'Raw shell',
      run: 'Run',
      stop: 'Stop',
      placeholder: 'Type a prompt and press Enter (Shift+Enter = newline)…',
      shellOff: 'Raw shell is disabled. Install optional deps to enable: npm i node-pty ws',
      thinking: 'thinking…',
    },
    skills: { title: 'Skills', empty: 'No skills yet — Sanook will auto-create them from repeated tasks.', auto: 'auto', when: 'When to use' },
    memory: { title: 'Memory', empty: 'No remembered facts yet. Ask Sanook to remember something.', brain: 'Also synced to second brain', importance: 'importance' },
    usage: { title: 'Usage & cost', empty: 'No usage recorded yet.', turns: 'turns', tokens: 'tokens', cost: 'cost', daily: 'Daily breakdown' },
    selfimprove: { title: 'Self-improvement', empty: 'No recurring tasks detected yet.', enabled: 'enabled', disabled: 'disabled', threshold: 'threshold', repeats: 'repeats', skill: 'skill' },
    install: { title: 'Install Sanook CLI', ready: 'Ready', soon: 'Needs infra' },
    home: {
      title: 'System status',
      cliVersion: 'CLI version',
      model: 'Default model',
      brainPath: 'Second brain',
      gateway: 'Gateway hint',
      openRepl: 'Run sanook in your terminal to chat',
    },
    chat: {
      title: 'Chat',
      hint: 'Primary chat runs in the terminal REPL. Start the gateway for HTTP/mobile access.',
    },
    models: { title: 'Models', hint: 'Change with sanook config set model <spec> or /model in REPL.' },
    sessions: { title: 'Sessions', empty: 'No resumable sessions yet.' },
    files: { title: 'Files', open: 'Open' },
    logs: { title: 'Gateway logs', empty: 'No log file yet.' },
    cron: { title: 'Scheduled tasks', empty: 'No cron tasks — sanook cron add "every 1h" "task"' },
    channels: { title: 'Messaging channels', configured: 'configured', setup: 'Setup command' },
    config: { title: 'Configuration', save: 'Save JSON' },
    mcp: { title: 'MCP servers', empty: 'No MCP servers configured.' },
    brain: { title: 'Second brain', empty: 'Not configured — run sanook brain init' },
  },
  th: {
    productName: 'Sanook Dashboard',
    tagline: 'จัดการ model, session, MCP, gateway และ second brain',
    nav: {
      home: 'หน้าแรก',
      terminal: 'เทอร์มินอล',
      chat: 'Chat',
      models: 'Models',
      sessions: 'Sessions',
      skills: 'Skills',
      memory: 'Memory',
      usage: 'การใช้งาน',
      selfimprove: 'เรียนรู้เอง',
      files: 'Files',
      logs: 'Logs',
      cron: 'Cron',
      channels: 'Channels',
      config: 'Config',
      mcp: 'MCP',
      brain: 'Brain',
      install: 'ติดตั้ง',
    },
    terminal: {
      title: 'เทอร์มินอลในเว็บ',
      hint: 'รัน Sanook AI ได้เลยในเว็บ — สตรีมข้อความ, tool, 🧠 ความจำ และ ✨ skill เหมือน REPL จริง',
      agent: 'Agent console',
      shell: 'Raw shell',
      run: 'รัน',
      stop: 'หยุด',
      placeholder: 'พิมพ์คำสั่งแล้วกด Enter (Shift+Enter = ขึ้นบรรทัดใหม่)…',
      shellOff: 'Raw shell ปิดอยู่ — ติดตั้ง dependency เสริมเพื่อเปิด: npm i node-pty ws',
      thinking: 'กำลังคิด…',
    },
    skills: { title: 'Skills', empty: 'ยังไม่มี skill — Sanook จะสร้างให้อัตโนมัติจากงานที่ทำซ้ำ', auto: 'อัตโนมัติ', when: 'ใช้เมื่อ' },
    memory: { title: 'ความจำ', empty: 'ยังไม่มีสิ่งที่จำไว้ — ลองสั่งให้ Sanook จำอะไรดู', brain: 'sync เข้า second brain ด้วย', importance: 'ความสำคัญ' },
    usage: { title: 'การใช้งาน & ค่าใช้จ่าย', empty: 'ยังไม่มีข้อมูลการใช้งาน', turns: 'turn', tokens: 'tokens', cost: 'ค่าใช้จ่าย', daily: 'แยกตามวัน' },
    selfimprove: { title: 'การเรียนรู้เอง (Self-improvement)', empty: 'ยังไม่เจองานที่ทำซ้ำ', enabled: 'เปิด', disabled: 'ปิด', threshold: 'เกณฑ์', repeats: 'ครั้ง', skill: 'skill' },
    install: { title: 'ติดตั้ง Sanook CLI', ready: 'พร้อมใช้', soon: 'ต้องตั้ง infra' },
    home: {
      title: 'สถานะระบบ',
      cliVersion: 'เวอร์ชัน CLI',
      model: 'Model หลัก',
      brainPath: 'Second brain',
      gateway: 'คำสั่ง Gateway',
      openRepl: 'รัน sanook ใน terminal เพื่อแชท',
    },
    chat: { title: 'Chat', hint: 'แชทหลักอยู่ใน terminal · รัน sanook serve สำหรับ HTTP/mobile' },
    models: { title: 'Models', hint: 'เปลี่ยนด้วย sanook config set model หรือ /model ใน REPL' },
    sessions: { title: 'Sessions', empty: 'ยังไม่มี session ที่ resume ได้' },
    files: { title: 'Files', open: 'เปิด' },
    logs: { title: 'Gateway logs', empty: 'ยังไม่มี log' },
    cron: { title: 'Scheduled tasks', empty: 'ยังไม่มี cron — sanook cron add "every 1h" "task"' },
    channels: { title: 'Messaging channels', configured: 'ตั้งแล้ว', setup: 'คำสั่ง setup' },
    config: { title: 'Configuration', save: 'บันทึก JSON' },
    mcp: { title: 'MCP servers', empty: 'ยังไม่ได้ตั้ง MCP server' },
    brain: { title: 'Second brain', empty: 'ยังไม่ตั้ง — รัน sanook brain init' },
  },
};

const routes = [
  { id: 'home', path: '#/' },
  { id: 'terminal', path: '#/terminal' },
  { id: 'chat', path: '#/chat' },
  { id: 'models', path: '#/models' },
  { id: 'sessions', path: '#/sessions' },
  { id: 'skills', path: '#/skills' },
  { id: 'memory', path: '#/memory' },
  { id: 'usage', path: '#/usage' },
  { id: 'selfimprove', path: '#/selfimprove' },
  { id: 'files', path: '#/files' },
  { id: 'logs', path: '#/logs' },
  { id: 'cron', path: '#/cron' },
  { id: 'channels', path: '#/channels' },
  { id: 'config', path: '#/config' },
  { id: 'mcp', path: '#/mcp' },
  { id: 'brain', path: '#/brain' },
  { id: 'install', path: '#/install' },
];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let filesPath = '';
let termSessionId = localStorage.getItem('sanook-term-session') || `web-${Math.random().toString(36).slice(2, 10)}`;
localStorage.setItem('sanook-term-session', termSessionId);
let termAbort = null;

function locale() {
  return localStorage.getItem('sanook-dashboard-locale') || 'en';
}

function t(key) {
  const loc = I18N[locale()] ?? I18N.en;
  return key.split('.').reduce((o, k) => o?.[k], loc) ?? key;
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

function renderNav(active) {
  document.getElementById('nav').innerHTML = routes
    .map((r) => `<a class="nav-link${active === r.id ? ' active' : ''}" href="${r.path}">${t(`nav.${r.id}`)}</a>`)
    .join('');
}

async function renderHome(page) {
  const status = await api('/api/status');
  page.innerHTML = `<div class="card"><h2>${t('home.title')}</h2>
    <dl class="kv">
      <dt>${t('home.cliVersion')}</dt><dd><span class="pill">${status.version ?? 'dev'}</span></dd>
      <dt>${t('home.model')}</dt><dd>${status.model ?? '(not set)'}</dd>
      <dt>${t('home.brainPath')}</dt><dd>${status.brainPath ?? '(not set)'}</dd>
      <dt>${t('home.gateway')}</dt><dd><code>${status.gatewayHint ?? 'sanook serve'}</code></dd>
    </dl>
    <p class="hint">${t('home.openRepl')}</p></div>`;
}

async function renderChat(page) {
  const status = await api('/api/chat/status');
  page.innerHTML = `<div class="card"><h2>${t('chat.title')}</h2>
    <p class="hint">${t('chat.hint')}</p>
    <dl class="kv"><dt>gateway</dt><dd><code>${status.gateway ?? 'sanook serve'}</code></dd></dl>
    <textarea id="chat-draft" placeholder="Draft a prompt to copy into terminal…" style="width:100%;min-height:120px;background:#0a1020;color:#e8edf7;border:1px solid #2a3550;border-radius:12px;padding:12px;"></textarea>
  </div>`;
}

async function renderModels(page) {
  const status = await api('/api/status');
  page.innerHTML = `<div class="card"><h2>${t('models.title')}</h2>
    <dl class="kv"><dt>model</dt><dd>${status.model ?? '(not set)'}</dd></dl>
    <p class="hint">${t('models.hint')}</p></div>`;
}

async function renderSessions(page) {
  const { sessions } = await api('/api/sessions');
  if (!sessions?.length) {
    page.innerHTML = `<div class="card"><h2>${t('sessions.title')}</h2><p class="hint">${t('sessions.empty')}</p></div>`;
    return;
  }
  page.innerHTML = `<div class="card"><h2>${t('sessions.title')}</h2>
    <table class="table"><thead><tr><th>id</th><th>model</th><th>updated</th></tr></thead><tbody>
    ${sessions.slice(0, 50).map((s) => `<tr><td>${s.id ?? ''}</td><td>${s.model ?? ''}</td><td>${s.updated ?? ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function renderFiles(page) {
  const data = await api(`/api/files?path=${encodeURIComponent(filesPath)}`);
  const entries = (data.entries ?? [])
    .map((e) => {
      const next = filesPath ? `${filesPath}/${e.name}` : e.name;
      if (e.dir) return `<tr><td>📁 ${e.name}</td><td><a href="#" data-path="${next}">${t('files.open')}</a></td></tr>`;
      return `<tr><td>${e.name}</td><td><a href="#" data-read="${next}">${t('files.open')}</a></td></tr>`;
    })
    .join('');
  page.innerHTML = `<div class="card"><h2>${t('files.title')}</h2>
    <p class="hint">~/.sanook · path: ${filesPath || '/'}</p>
    <table class="table"><thead><tr><th>name</th><th></th></tr></thead><tbody>${entries}</tbody></table>
    <pre id="file-preview" class="hint" style="white-space:pre-wrap;margin-top:12px;"></pre></div>`;
  page.querySelectorAll('[data-path]').forEach((el) => {
    el.onclick = (ev) => {
      ev.preventDefault();
      filesPath = el.getAttribute('data-path') ?? '';
      void renderFiles(page);
    };
  });
  page.querySelectorAll('[data-read]').forEach((el) => {
    el.onclick = async (ev) => {
      ev.preventDefault();
      const file = await api(`/api/files/read?path=${encodeURIComponent(el.getAttribute('data-read') ?? '')}`);
      document.getElementById('file-preview').textContent = file.content ?? '';
    };
  });
}

async function renderLogs(page) {
  const data = await api('/api/logs');
  const body = (data.lines ?? []).join('\n') || t('logs.empty');
  page.innerHTML = `<div class="card"><h2>${t('logs.title')}</h2>
    <p class="hint">${data.path ?? ''}</p>
    <pre style="white-space:pre-wrap;max-height:480px;overflow:auto;background:#0a1020;padding:12px;border-radius:12px;border:1px solid #2a3550;">${body}</pre></div>`;
}

async function renderCron(page) {
  const { tasks } = await api('/api/cron');
  if (!tasks?.length) {
    page.innerHTML = `<div class="card"><h2>${t('cron.title')}</h2><p class="hint">${t('cron.empty')}</p></div>`;
    return;
  }
  page.innerHTML = `<div class="card"><h2>${t('cron.title')}</h2>
    <table class="table"><thead><tr><th>id</th><th>status</th><th>schedule</th><th>spec</th></tr></thead><tbody>
    ${tasks.map((task) => `<tr><td>${task.id}</td><td>${task.status}</td><td>${task.schedule ?? 'once'}</td><td>${(task.spec ?? '').slice(0, 60)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function renderChannels(page) {
  const data = await api('/api/channels');
  page.innerHTML = `<div class="card"><h2>${t('channels.title')}</h2>
    <p class="hint">service: ${data.serviceRunning ? 'running' : 'stopped'}</p>
    <table class="table"><thead><tr><th>platform</th><th>status</th><th>${t('channels.setup')}</th></tr></thead><tbody>
    ${(data.channels ?? []).map((c) => `<tr><td>${c.label}</td><td>${c.configured ? t('channels.configured') : '—'}</td><td><code>${c.setupCommand}</code></td></tr>`).join('')}
    </tbody></table></div>`;
}

async function renderConfig(page) {
  const config = await api('/api/config');
  page.innerHTML = `<div class="card"><h2>${t('config.title')}</h2>
    <textarea id="config-json" style="width:100%;min-height:320px;background:#0a1020;color:#e8edf7;border:1px solid #2a3550;border-radius:12px;padding:12px;font-family:ui-monospace,monospace;">${JSON.stringify(config, null, 2)}</textarea>
    <p><button id="save-config" style="margin-top:12px;padding:8px 14px;border-radius:10px;border:0;background:#38bdf8;color:#041018;font-weight:600;cursor:pointer">${t('config.save')}</button></p></div>`;
  document.getElementById('save-config').onclick = async () => {
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: document.getElementById('config-json').value });
    alert('Saved');
  };
}

async function renderMcp(page) {
  const { servers } = await api('/api/mcp');
  const names = Object.keys(servers ?? {});
  if (!names.length) {
    page.innerHTML = `<div class="card"><h2>${t('mcp.title')}</h2><p class="hint">${t('mcp.empty')}</p></div>`;
    return;
  }
  page.innerHTML = `<div class="card"><h2>${t('mcp.title')}</h2>
    <table class="table"><thead><tr><th>name</th><th>command</th><th>enabled</th></tr></thead><tbody>
    ${names.map((name) => { const s = servers[name]; return `<tr><td>${name}</td><td>${s.command ?? s.url ?? ''}</td><td>${s.enabled === false ? 'no' : 'yes'}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}

async function renderBrain(page) {
  const { brainPath } = await api('/api/brain');
  page.innerHTML = `<div class="card"><h2>${t('brain.title')}</h2>
    <p>${brainPath ?? `<span class="hint">${t('brain.empty')}</span>`}</p></div>`;
}

async function renderSkills(page) {
  const { skills } = await api('/api/skills');
  if (!skills?.length) {
    page.innerHTML = `<div class="card"><h2>${t('skills.title')}</h2><p class="hint">${t('skills.empty')}</p></div>`;
    return;
  }
  const cards = skills
    .map((s) => `<div class="card" style="margin-bottom:10px;">
      <h3 style="margin:0 0 4px;">${escapeHtml(s.name)} ${s.auto ? `<span class="pill" style="background:#1e3a2f;color:#7ee0a8;">✨ ${t('skills.auto')}</span>` : ''}</h3>
      <p style="margin:0 0 6px;">${escapeHtml(s.description)}</p>
      ${s.whenToUse ? `<p class="hint" style="margin:0;">${t('skills.when')}: ${escapeHtml(s.whenToUse)}</p>` : ''}
    </div>`)
    .join('');
  page.innerHTML = `<h2 style="margin:0 0 12px;">${t('skills.title')} <span class="pill">${skills.length}</span></h2>${cards}`;
}

async function renderMemory(page) {
  const { facts, brainPath } = await api('/api/memory');
  if (!facts?.length) {
    page.innerHTML = `<div class="card"><h2>🧠 ${t('memory.title')}</h2><p class="hint">${t('memory.empty')}</p></div>`;
    return;
  }
  const rows = facts
    .map((f) => `<tr>
      <td>${escapeHtml(f.text)}</td>
      <td><span class="pill">${escapeHtml(f.noteType)}</span></td>
      <td>${escapeHtml(f.trust)}${f.tier === 'protected' ? ' 🔒' : ''}</td>
      <td>${f.importance}</td>
    </tr>`)
    .join('');
  page.innerHTML = `<div class="card"><h2>🧠 ${t('memory.title')} <span class="pill">${facts.length}</span></h2>
    ${brainPath ? `<p class="hint">${t('memory.brain')}: ${escapeHtml(brainPath)}</p>` : ''}
    <table class="table"><thead><tr><th>fact</th><th>type</th><th>trust</th><th>${t('memory.importance')}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function renderUsage(page) {
  const { totals, daily } = await api('/api/usage');
  if (!totals || totals.turns === 0) {
    page.innerHTML = `<div class="card"><h2>💰 ${t('usage.title')}</h2><p class="hint">${t('usage.empty')}</p></div>`;
    return;
  }
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const rows = daily
    .map((d) => `<tr><td>${escapeHtml(d.label)}</td><td>${d.turns}</td><td>${fmt(d.totalTokens)}</td><td>$${d.costUsd.toFixed(4)}</td></tr>`)
    .reverse()
    .join('');
  page.innerHTML = `<div class="card"><h2>💰 ${t('usage.title')}</h2>
    <dl class="kv">
      <dt>${t('usage.turns')}</dt><dd><span class="pill">${totals.turns}</span></dd>
      <dt>${t('usage.tokens')}</dt><dd>${fmt(totals.totalTokens)}</dd>
      <dt>${t('usage.cost')}</dt><dd><strong>$${totals.costUsd.toFixed(4)}</strong></dd>
    </dl></div>
    <div class="card"><h3>${t('usage.daily')}</h3>
    <table class="table"><thead><tr><th>date</th><th>${t('usage.turns')}</th><th>${t('usage.tokens')}</th><th>${t('usage.cost')}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function renderSelfimprove(page) {
  const data = await api('/api/self-improve');
  const head = `<div class="card"><h2>📈 ${t('selfimprove.title')}</h2>
    <dl class="kv">
      <dt>status</dt><dd><span class="pill" style="background:${data.enabled ? '#1e3a2f' : '#3a1e1e'};color:${data.enabled ? '#7ee0a8' : '#e0a8a8'};">${data.enabled ? t('selfimprove.enabled') : t('selfimprove.disabled')}</span></dd>
      <dt>${t('selfimprove.threshold')}</dt><dd>${data.threshold} ${t('selfimprove.repeats')}</dd>
    </dl></div>`;
  if (!data.families?.length) {
    page.innerHTML = `${head}<div class="card"><p class="hint">${t('selfimprove.empty')}</p></div>`;
    return;
  }
  const rows = data.families
    .map((f) => {
      const pct = Math.min(100, Math.round((f.count / data.threshold) * 100));
      const bar = `<div style="background:#1a2236;border-radius:6px;overflow:hidden;height:8px;width:120px;"><div style="background:${f.skillCreated ? '#7ee0a8' : '#38bdf8'};height:8px;width:${pct}%;"></div></div>`;
      return `<tr>
        <td>${escapeHtml(f.sample)}</td>
        <td>${f.count}/${data.threshold} ${bar}</td>
        <td>${f.skillCreated ? `✨ ${escapeHtml(f.skillName ?? '')}` : '—'}</td>
      </tr>`;
    })
    .join('');
  page.innerHTML = `${head}<div class="card">
    <table class="table"><thead><tr><th>task</th><th>${t('selfimprove.repeats')}</th><th>${t('selfimprove.skill')}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function renderInstall(page) {
  const data = await api('/api/install');
  const blocks = data.methods
    .map((m) => {
      const badge = m.ready
        ? `<span class="pill" style="background:#1e3a2f;color:#7ee0a8;">${t('install.ready')}</span>`
        : `<span class="pill" style="background:#3a341e;color:#e0d08a;">${t('install.soon')}</span>`;
      const cmds = m.commands
        .map((c) => `<div style="margin:6px 0;"><div class="hint" style="margin:0 0 2px;">${escapeHtml(c.os)}</div>
          <div style="display:flex;gap:8px;align-items:center;"><code style="flex:1;background:#0a1020;border:1px solid #2a3550;border-radius:8px;padding:8px 10px;display:block;overflow-x:auto;">${escapeHtml(c.cmd)}</code>
          <button class="copy-btn" data-cmd="${escapeHtml(c.cmd)}" style="padding:6px 10px;border-radius:8px;border:0;background:#243049;color:#cfe0ff;cursor:pointer;">copy</button></div></div>`)
        .join('');
      return `<div class="card" style="margin-bottom:12px;">
        <h3 style="margin:0 0 8px;">${escapeHtml(m.label)} ${m.recommended ? '<span class="pill">recommended</span>' : ''} ${badge}</h3>
        ${cmds}
        ${m.note ? `<p class="hint" style="margin:8px 0 0;">${escapeHtml(m.note)}</p>` : ''}
      </div>`;
    })
    .join('');
  page.innerHTML = `<h2 style="margin:0 0 12px;">${t('install.title')}</h2>${blocks}`;
  page.querySelectorAll('.copy-btn').forEach((el) => {
    el.onclick = async () => {
      try {
        await navigator.clipboard.writeText(el.getAttribute('data-cmd') ?? '');
        const prev = el.textContent;
        el.textContent = '✓';
        setTimeout(() => (el.textContent = prev), 1200);
      } catch {
        /* clipboard may be blocked on http */
      }
    };
  });
}

function appendConsole(out, html) {
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  out.insertAdjacentHTML('beforeend', html);
  if (atBottom) out.scrollTop = out.scrollHeight;
}

async function streamAgentRun(prompt, out, opts) {
  const ctrl = new AbortController();
  termAbort = ctrl;
  appendConsole(out, `<div class="term-line term-user">❯ ${escapeHtml(prompt)}</div>`);
  const answerEl = document.createElement('div');
  answerEl.className = 'term-line term-assistant';
  out.appendChild(answerEl);
  let answer = '';
  try {
    const res = await fetch('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, sessionId: termSessionId, autoApprove: opts.autoApprove }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (ev.type === 'text') {
          answer += ev.text;
          answerEl.textContent = answer;
          if (out.scrollHeight - out.scrollTop - out.clientHeight < 80) out.scrollTop = out.scrollHeight;
        } else if (ev.type === 'status') {
          // lightweight status, skip noisy
        } else if (ev.type === 'tool-call') {
          appendConsole(out, `<div class="term-line term-tool">› ${escapeHtml(ev.tool)} ${escapeHtml(ev.detail || '')}</div>`);
        } else if (ev.type === 'memory') {
          appendConsole(out, `<div class="term-line term-memory">🧠 ${escapeHtml(ev.fact)}</div>`);
        } else if (ev.type === 'skill') {
          appendConsole(out, `<div class="term-line term-skill">✨ Self-improvement: สร้าง skill \`${escapeHtml(ev.name)}\` จากงานที่ทำซ้ำ ${ev.count ?? ''} ครั้ง</div>`);
        } else if (ev.type === 'error') {
          appendConsole(out, `<div class="term-line term-error">⚠ ${escapeHtml(ev.message)}</div>`);
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') appendConsole(out, `<div class="term-line term-error">⚠ ${escapeHtml(e.message)}</div>`);
  } finally {
    termAbort = null;
  }
}

async function renderTerminal(page) {
  const tab = localStorage.getItem('sanook-term-tab') || 'agent';
  page.innerHTML = `<div class="card">
    <h2>${t('terminal.title')}</h2>
    <p class="hint">${t('terminal.hint')}</p>
    <div class="term-tabs">
      <button class="term-tab${tab === 'agent' ? ' active' : ''}" data-tab="agent">${t('terminal.agent')}</button>
      <button class="term-tab${tab === 'shell' ? ' active' : ''}" data-tab="shell">${t('terminal.shell')}</button>
    </div>
    <div id="term-body"></div>
  </div>`;
  page.querySelectorAll('.term-tab').forEach((el) => {
    el.onclick = () => {
      localStorage.setItem('sanook-term-tab', el.getAttribute('data-tab'));
      renderTerminal(page);
    };
  });
  const body = page.querySelector('#term-body');
  if (tab === 'agent') renderAgentConsole(body);
  else renderRawShell(body);
}

function renderAgentConsole(body) {
  body.innerHTML = `
    <div id="term-out" class="term-out"></div>
    <div class="term-input-row">
      <textarea id="term-input" rows="1" placeholder="${t('terminal.placeholder')}"></textarea>
      <button id="term-run" class="term-run">${t('terminal.run')}</button>
    </div>
    <label class="term-approve"><input type="checkbox" id="term-auto" checked /> auto-approve tools</label>`;
  const out = body.querySelector('#term-out');
  const input = body.querySelector('#term-input');
  const runBtn = body.querySelector('#term-run');
  const auto = body.querySelector('#term-auto');
  const submit = async () => {
    const prompt = input.value.trim();
    if (!prompt || termAbort) return;
    input.value = '';
    runBtn.textContent = t('terminal.stop');
    await streamAgentRun(prompt, out, { autoApprove: auto.checked });
    runBtn.textContent = t('terminal.run');
  };
  runBtn.onclick = () => {
    if (termAbort) {
      termAbort.abort();
      return;
    }
    void submit();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };
  input.focus();
}

async function renderRawShell(body) {
  body.innerHTML = `<p class="hint">Loading…</p>`;
  const status = await api('/api/terminal/shell-status');
  if (!status.available) {
    body.innerHTML = `<div class="term-out term-disabled"><p>${t('terminal.shellOff')}</p><p class="hint">${escapeHtml(status.reason)}</p></div>`;
    return;
  }
  body.innerHTML = `<div id="xterm" class="term-xterm"></div>`;
  try {
    await loadXterm();
  } catch {
    body.innerHTML = `<div class="term-out term-disabled"><p>${t('terminal.shellOff')}</p><p class="hint">xterm.js failed to load (offline?)</p></div>`;
    return;
  }
  const term = new window.Terminal({ cursorBlink: true, fontSize: 13, theme: { background: '#0a1020' } });
  term.open(body.querySelector('#xterm'));
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/terminal/shell`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'data') term.write(msg.data);
    } catch {
      /* ignore */
    }
  };
  term.onData((d) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'data', data: d })));
  term.onResize(({ cols, rows }) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols, rows })));
  ws.onclose = () => term.write('\r\n\x1b[31m[shell closed]\x1b[0m\r\n');
}

function loadXterm() {
  if (window.Terminal) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('xterm load failed'));
    document.head.appendChild(s);
  });
}

async function renderRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const route = routes.find((r) => r.path === `#${hash}`) ?? routes[0];
  document.getElementById('page-title').textContent = t(`nav.${route.id}`);
  document.querySelector('.brand-title').textContent = t('productName');
  document.querySelector('.brand-tagline').textContent = t('tagline');
  renderNav(route.id);
  const page = document.getElementById('page');
  page.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const map = {
      home: renderHome,
      terminal: renderTerminal,
      chat: renderChat,
      models: renderModels,
      sessions: renderSessions,
      skills: renderSkills,
      memory: renderMemory,
      usage: renderUsage,
      selfimprove: renderSelfimprove,
      files: renderFiles,
      logs: renderLogs,
      cron: renderCron,
      channels: renderChannels,
      config: renderConfig,
      mcp: renderMcp,
      brain: renderBrain,
      install: renderInstall,
    };
    await (map[route.id] ?? renderHome)(page);
  } catch (e) {
    page.innerHTML = `<div class="card"><p class="hint">${e.message}</p></div>`;
  }
}

document.getElementById('locale-select').value = locale();
document.getElementById('locale-select').onchange = (e) => {
  localStorage.setItem('sanook-dashboard-locale', e.target.value);
  renderRoute();
};
window.addEventListener('hashchange', renderRoute);
renderRoute();
