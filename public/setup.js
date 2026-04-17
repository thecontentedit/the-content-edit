const params = new URLSearchParams(location.search);
const setupToken = params.get('token');
const BASE_URL = location.origin;
const toggleStates = { 1: false, 2: false, 3: false, 4: false };
let savedNotionToken = '';
let currentPlan = 'free';
let allWidgets = [];
let activeWidgetId = null;
let accountData = {};

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const stored = sessionStorage.getItem('tce_notion_token');
    if (stored && stored.startsWith('http')) sessionStorage.removeItem('tce_notion_token');
  } catch(e) {}

  if (!setupToken) {
    document.getElementById('appLoading').style.display = 'none';
    document.getElementById('appInvalid').style.display = 'flex';
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/setup?token=${setupToken}`);
    if (!res.ok) throw new Error('invalid');
    const data = await res.json();

    currentPlan = data.plan || 'free';
    allWidgets = data.widgets || [];
    accountData = data;

    document.getElementById('appLoading').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';

    renderAccount();

    if (data.activated && allWidgets.length > 0) {
      switchTab('widgets');
    } else {
      switchTab('welcome');
    }

  } catch(e) {
    document.getElementById('appLoading').style.display = 'none';
    document.getElementById('appInvalid').style.display = 'flex';
  }

  // Validación token en tiempo real
  const tokenInput = document.getElementById('notionToken');
  const tokenHint = document.getElementById('tokenHint');
  if (tokenInput && tokenHint) {
    const validateToken = () => {
      const val = tokenInput.value.trim();
      if (!val.length) {
        tokenHint.style.color = '';
        tokenHint.innerHTML = 'El token empieza con <code>ntn_</code> o <code>secret_</code> y tiene ~50 caracteres.';
        savedNotionToken = '';
        checkStep2(); return;
      }
      const isValid = (val.startsWith('ntn_') || val.startsWith('secret_')) && val.length > 20;
      const looksLikeUrl = val.startsWith('http') || val.includes('setup.html') || val.includes('token=');
      if (looksLikeUrl) {
        tokenHint.style.color = '#c0392b';
        tokenHint.innerHTML = 'Eso parece una URL, no un token. Ve a notion.so/my-integrations y copia el Internal Integration Token.';
        savedNotionToken = '';
      } else if (val.length > 5 && !isValid) {
        tokenHint.style.color = '#c0392b';
        tokenHint.innerHTML = '⚠️ El token debe empezar con <code>ntn_</code> o <code>secret_</code>.';
        savedNotionToken = '';
      } else if (isValid) {
        tokenHint.style.color = '#2e7d32';
        tokenHint.innerHTML = '✓ Token válido.';
        savedNotionToken = val;
        try { sessionStorage.setItem('tce_notion_token', val); } catch(e) {}
      } else {
        tokenHint.style.color = '';
        tokenHint.innerHTML = 'El token empieza con <code>ntn_</code> o <code>secret_</code> y tiene ~50 caracteres.';
        savedNotionToken = '';
      }
      checkStep2();
    };
    tokenInput.addEventListener('input', validateToken);
    tokenInput.addEventListener('change', validateToken);
    tokenInput.addEventListener('paste', () => setTimeout(validateToken, 50));
  }
}

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById('nav-' + tab);
  if (navEl) navEl.classList.add('active');
  const panelEl = document.getElementById('panel-' + tab);
  if (panelEl) panelEl.classList.add('active');
  if (tab === 'widgets') renderDashboard();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function renderDashboard() {
  showWidgetsDashboard();
  const grid = document.getElementById('widgetsGrid');
  const empty = document.getElementById('widgetsEmpty');
  const upgradeEl = document.getElementById('dashboardUpgrade');
  const planBadge = document.getElementById('dashboardPlan');

  if (planBadge) {
    planBadge.textContent = currentPlan === 'pro' ? 'Pro' : 'Free';
    planBadge.className = 'plan-badge ' + currentPlan;
  }

  if (!allWidgets.length) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    if (upgradeEl) upgradeEl.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  grid.style.display = 'grid';

  const colors = ['#F2EDE8', '#EAF4EE', '#EBF0F8', '#F8EBF0', '#F0EBF8', '#FFF8E7'];
  grid.innerHTML = allWidgets.map((w, i) => {
    const bg = colors[i % colors.length];
    const date = w.createdAt
      ? new Date(w.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    const shortUrl = w.embedUrl ? w.embedUrl.replace('https://', '') : '';
    return `
      <div class="widget-card" style="--card-bg:${bg}" onclick="openWidgetDetail('${w.widgetId}')">
        <div class="widget-card-icon">✦</div>
        <div class="widget-card-name">${escHtml(w.name || 'Widget #' + (i + 1))}</div>
        <div class="widget-card-date">${date}</div>
        <div class="widget-card-url">${shortUrl}</div>
      </div>
    `;
  }).join('');

  if (upgradeEl) upgradeEl.style.display = currentPlan === 'pro' ? 'none' : 'block';
}

function showWidgetsDashboard() {
  document.getElementById('widgetsDashboard').style.display = 'block';
  document.getElementById('widgetDetail').style.display = 'none';
}

function startNewWidget() {
  resetWizard();
  switchTab('setup');
}

// ─── WIDGET DETAIL ────────────────────────────────────────────────────────────
function openWidgetDetail(widgetId) {
  const widget = allWidgets.find(w => w.widgetId === widgetId);
  if (!widget) return;
  activeWidgetId = widgetId;

  document.getElementById('detailName').textContent = widget.name || 'Widget';
  document.getElementById('detailEmbedUrl').textContent = widget.embedUrl || '';
  document.getElementById('detailToken').textContent = widget.maskedToken || '••••••••••••••••••••••••••••••';
  document.getElementById('detailDbId').textContent = widget.notionDbId || '';

  const dbLink = document.getElementById('detailDbLink');
  if (widget.notionDbUrl) {
    dbLink.href = widget.notionDbUrl;
    dbLink.style.display = 'inline';
  } else if (widget.notionDbId) {
    const fmt = widget.notionDbId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    dbLink.href = `https://www.notion.so/${fmt}`;
    dbLink.style.display = 'inline';
  } else {
    dbLink.style.display = 'none';
  }

  const previewIframe = document.getElementById('widgetPreviewIframe');
  if (previewIframe && widget.embedUrl) {
    previewIframe.src = widget.embedUrl;
  }

  document.getElementById('reconnectStatus').className = 'status idle';
  document.getElementById('reconnectStatus').innerHTML = '';
  document.getElementById('reconnectSection').style.display = 'none';
  document.getElementById('renameSection').style.display = 'none';
  document.getElementById('btnShowReconnect').style.display = 'inline-flex';
  document.getElementById('btnShowRename').style.display = 'inline-flex';

  document.getElementById('widgetsDashboard').style.display = 'none';
  document.getElementById('widgetDetail').style.display = 'flex';
}

function toggleReconnectSection() {
  const s = document.getElementById('reconnectSection');
  const btn = document.getElementById('btnShowReconnect');
  const isOpen = s.style.display !== 'none';
  s.style.display = isOpen ? 'none' : 'block';
  btn.style.display = isOpen ? 'inline-flex' : 'none';
}

function toggleRenameSection() {
  const s = document.getElementById('renameSection');
  const btn = document.getElementById('btnShowRename');
  const isOpen = s.style.display !== 'none';
  s.style.display = isOpen ? 'none' : 'block';
  btn.style.display = isOpen ? 'inline-flex' : 'none';
  if (s.style.display !== 'none') {
    const widget = allWidgets.find(w => w.widgetId === activeWidgetId);
    const input = document.getElementById('detailRenameInput');
    input.value = widget ? widget.name : '';
    input.focus();
  }
}

async function renameWidgetFromDetail() {
  const input = document.getElementById('detailRenameInput');
  const newName = input.value.trim();
  if (!newName || !activeWidgetId) return;
  try {
    await fetch(`${BASE_URL}/api/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId: activeWidgetId, name: newName }),
    });
    const idx = allWidgets.findIndex(w => w.widgetId === activeWidgetId);
    if (idx !== -1) allWidgets[idx].name = newName;
    document.getElementById('detailName').textContent = newName;
    toggleRenameSection();
  } catch(e) { console.error(e); }
}

async function reconnectWidget() {
  const token = document.getElementById('reconnectToken').value.trim();
  const dbUrl = document.getElementById('reconnectDbUrl').value.trim();
  const dbId = extractDbId(dbUrl);
  const status = document.getElementById('reconnectStatus');
  const btn = document.getElementById('btnReconnect');

  if (!token || token.length < 10) {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' Token inválido.';
    return;
  }
  if (!dbId) {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' No encontré el ID en esa URL.';
    return;
  }

  status.className = 'status loading';
  status.innerHTML = '<div class="spinner"></div> Reconectando…';
  btn.disabled = true;

  try {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId: activeWidgetId, notionToken: token, notionDbId: dbId, notionDbUrl: dbUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      status.className = 'status error';
      status.innerHTML = errorIcon() + ' ' + (data.error || 'Error al reconectar');
      btn.disabled = false;
      return;
    }
    const idx = allWidgets.findIndex(w => w.widgetId === activeWidgetId);
    if (idx !== -1) {
      allWidgets[idx].notionDbId = dbId;
      allWidgets[idx].notionDbUrl = dbUrl;
      allWidgets[idx].maskedToken = token.slice(0, 8) + '•'.repeat(Math.max(0, token.length - 8));
      document.getElementById('detailToken').textContent = allWidgets[idx].maskedToken;
      document.getElementById('detailDbId').textContent = dbId;
      const dbLink = document.getElementById('detailDbLink');
      dbLink.href = dbUrl;
      dbLink.style.display = 'inline';
      const iframe = document.getElementById('widgetPreviewIframe');
      if (iframe) iframe.src = iframe.src;
    }
    status.className = 'status success';
    status.innerHTML = successIcon() + ' ¡Reconectado correctamente!';
    document.getElementById('reconnectToken').value = '';
    document.getElementById('reconnectDbUrl').value = '';
    btn.disabled = false;
  } catch {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' Error de conexión. Intenta de nuevo.';
    btn.disabled = false;
  }
}

async function deleteWidgetFromDetail() {
  const widget = allWidgets.find(w => w.widgetId === activeWidgetId);
  const name = widget ? widget.name : 'este widget';
  if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer. El embed en Notion dejará de funcionar.`)) return;
  try {
    await fetch(`${BASE_URL}/api/setup`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId: activeWidgetId }),
    });
    allWidgets = allWidgets.filter(w => w.widgetId !== activeWidgetId);
    activeWidgetId = null;
    renderDashboard();
  } catch(e) { alert('Error al eliminar. Intenta de nuevo.'); }
}

// ─── ACCOUNT ─────────────────────────────────────────────────────────────────
function renderAccount() {
  const emailEl = document.getElementById('accountEmail');
  const planEl = document.getElementById('accountPlan');
  const licenseEl = document.getElementById('accountLicenseKey');
  const upgradeEl = document.getElementById('accountUpgrade');

  if (emailEl) emailEl.textContent = accountData.email || '—';
  if (planEl) {
    planEl.textContent = currentPlan === 'pro' ? 'Pro' : 'Free';
    planEl.className = 'account-row-val' + (currentPlan === 'pro' ? ' pro' : '');
  }
  if (licenseEl && accountData.licenseKey) {
    const date = accountData.purchaseDate
      ? new Date(accountData.purchaseDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    licenseEl.innerHTML = `
      <div class="license-item">
        <div class="license-meta">
          <span class="license-type">${currentPlan === 'pro' ? 'Pro' : 'Free'} License Key</span>
          <span class="license-date">${date}</span>
        </div>
        <div class="license-key">${accountData.licenseKey}</div>
      </div>
    `;
  }
  if (upgradeEl) upgradeEl.style.display = currentPlan === 'pro' ? 'none' : 'block';
}

// ─── WIZARD ───────────────────────────────────────────────────────────────────
function resetWizard() {
  [1,2,3,4].forEach(n => {
    toggleStates[n] = false;
    const el = document.getElementById('toggle' + n);
    if (el) el.classList.remove('confirmed');
    const btn = document.getElementById('btn' + n);
    if (btn) btn.disabled = true;
  });

  // ✅ FIX: limpiar token input y hint visualmente
  const tokenInput = document.getElementById('notionToken');
  if (tokenInput) tokenInput.value = '';

  const tokenHint = document.getElementById('tokenHint');
  if (tokenHint) {
    tokenHint.style.color = '';
    tokenHint.innerHTML = 'El token empieza con <code>ntn_</code> o <code>secret_</code> y tiene ~50 caracteres.';
  }

  const dbUrl = document.getElementById('notionDbUrl');
  if (dbUrl) dbUrl.value = '';

  const status = document.getElementById('connectStatus');
  if (status) {
    status.className = 'status idle';
    status.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Ingresa la URL para continuar';
  }

  // ✅ FIX: limpiar token en memoria y sessionStorage
  savedNotionToken = '';
  try { sessionStorage.removeItem('tce_notion_token'); } catch(e) {}

  goStep(1);
}

function goStep(n) {
  if (n === 3) {
    const tokenInput = document.getElementById('notionToken');
    const val = tokenInput ? tokenInput.value.trim() : '';
    if (val.length > 10) {
      savedNotionToken = val;
      try { sessionStorage.setItem('tce_notion_token', val); } catch(e) {}
    }
  }
  document.querySelectorAll('.wscreen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screenStep' + n);
  if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

function toggleConfirm(n) {
  toggleStates[n] = !toggleStates[n];
  document.getElementById('toggle' + n).classList.toggle('confirmed', toggleStates[n]);
  if (n === 1) document.getElementById('btn1').disabled = !toggleStates[1];
  if (n === 2) checkStep2();
  if (n === 3) document.getElementById('btn3').disabled = !toggleStates[3];
  if (n === 4) checkStep4();
}

function checkStep2() {
  const token = document.getElementById('notionToken').value.trim();
  const isValid = (token.startsWith('ntn_') || token.startsWith('secret_')) && token.length > 20;
  document.getElementById('btn2').disabled = !(toggleStates[2] && isValid);
}

function checkStep4() {
  const url = document.getElementById('notionDbUrl').value.trim();
  document.getElementById('btn4').disabled = !(toggleStates[4] && url.length > 20);
}

function extractDbId(input) {
  const clean = input.trim().replace(/-/g, '');
  const match = clean.match(/([a-f0-9]{32})/i);
  return match ? match[1] : null;
}

// ─── CONNECT NOTION ──────────────────────────────────────────────────────────
async function connectNotion() {
  // ✅ FIX: solo usar token del input, no de sessionStorage
  const tokenInput = document.getElementById('notionToken');
  const token = tokenInput ? tokenInput.value.trim() : '';

  const dbUrlInput = document.getElementById('notionDbUrl').value.trim();
  const dbId = extractDbId(dbUrlInput);
  const status = document.getElementById('connectStatus');
  const btn = document.getElementById('btn4');

  if (!token || token.length < 10) {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' Token inválido. Regresa al paso 2 y vuelve a pegarlo.';
    return;
  }
  if (!dbId) {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' No encontré el ID de tu DB en esa URL.';
    return;
  }

  status.className = 'status loading';
  status.innerHTML = '<div class="spinner"></div> Conectando con Notion…';
  btn.disabled = true;

  const widgetName = `Widget #${allWidgets.length + 1}`;

  try {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, notionToken: token, notionDbId: dbId, notionDbUrl: dbUrlInput, widgetName }),
    });
    const data = await res.json();

    if (!res.ok) {
      status.className = 'status error';
      status.innerHTML = errorIcon() + ' ' + (data.error || 'Error al conectar');
      btn.disabled = false;
      return;
    }

    status.className = 'status success';
    status.innerHTML = successIcon() + ' ¡Conexión exitosa!';
    try { sessionStorage.removeItem('tce_notion_token'); } catch(e) {}

    allWidgets.push({
      widgetId: data.widgetId,
      name: data.widgetName || widgetName,
      createdAt: new Date().toISOString(),
      embedUrl: data.embedUrl,
      maskedToken: token.slice(0, 8) + '•'.repeat(Math.max(0, token.length - 8)),
      notionDbId: dbId,
      notionDbUrl: dbUrlInput,
    });
    currentPlan = data.plan || currentPlan;

    document.getElementById('embedUrl').textContent = data.embedUrl;
    const bioBlock = document.getElementById('step5-bio-block');
    const upgradeCardStep5 = document.getElementById('upgrade-card-step5');
    if (data.plan === 'pro') {
      document.getElementById('embedBioUrl').textContent = data.embedUrl + '?mode=bio';
      if (bioBlock) bioBlock.style.display = 'block';
      if (upgradeCardStep5) upgradeCardStep5.style.display = 'none';
    } else {
      if (bioBlock) bioBlock.style.display = 'none';
      if (upgradeCardStep5) upgradeCardStep5.style.display = 'block';
    }

    setTimeout(() => goStep(5), 900);

  } catch {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' Error de conexión. Intenta de nuevo.';
    btn.disabled = false;
  }
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
function toggleFaq(header) {
  header.parentElement.classList.toggle('open');
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function copyEmbed(id, btn) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ copiado';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

function copyById(id, btn) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

function toggleHowto(btn) {
  const collapsible = btn.nextElementSibling;
  const isOpen = collapsible.classList.contains('open');
  collapsible.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  if (btn.querySelector('span')) {
    btn.querySelector('span').textContent = isOpen ? 'Ver instrucciones' : 'Ocultar instrucciones';
  }
}

function errorIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
}
function successIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
}
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
