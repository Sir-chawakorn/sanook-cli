const I18N = {
  en: {
    productName: 'Sanook Dashboard',
    tagline: 'Configure models, sessions, MCP, gateway, and your second brain',
    nav: {
      home: 'Home',
      chat: 'Chat',
      models: 'Models',
      sessions: 'Sessions',
      files: 'Files',
      logs: 'Logs',
      cron: 'Cron',
      channels: 'Channels',
      config: 'Config',
      mcp: 'MCP',
      brain: 'Brain',
    },
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
      chat: 'Chat',
      models: 'Models',
      sessions: 'Sessions',
      files: 'Files',
      logs: 'Logs',
      cron: 'Cron',
      channels: 'Channels',
      config: 'Config',
      mcp: 'MCP',
      brain: 'Brain',
    },
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
  { id: 'chat', path: '#/chat' },
  { id: 'models', path: '#/models' },
  { id: 'sessions', path: '#/sessions' },
  { id: 'files', path: '#/files' },
  { id: 'logs', path: '#/logs' },
  { id: 'cron', path: '#/cron' },
  { id: 'channels', path: '#/channels' },
  { id: 'config', path: '#/config' },
  { id: 'mcp', path: '#/mcp' },
  { id: 'brain', path: '#/brain' },
];

let filesPath = '';

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
      chat: renderChat,
      models: renderModels,
      sessions: renderSessions,
      files: renderFiles,
      logs: renderLogs,
      cron: renderCron,
      channels: renderChannels,
      config: renderConfig,
      mcp: renderMcp,
      brain: renderBrain,
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
