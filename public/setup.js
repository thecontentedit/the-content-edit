const params = new URLSearchParams(location.search);
const setupToken = params.get('token');
const BASE_URL = location.origin;
const toggleStates = { 1: false, 2: false, 3: false, 4: false };
let savedNotionToken = '';
let currentPlan = 'free';
let allWidgets = [];
let activeWidgetId = null; // widget actualmente en detalle

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const stored = sessionStorage.getItem('tce_notion_token');
    if (stored && stored.startsWith('http')) sessionStorage.removeItem('tce_notion_token');
  } catch(e) {}

  if (!setupToken) { showScreen('screenInvalid'); return; }

  try {
    const res = await fetch(`${BASE_URL}/api/setup?token=${setupToken}`);
    if (!res.ok) { showScreen('screenInvalid'); return; }
    const data = await res.json();

    currentPlan = data.plan || 'free';
    allWidgets = data.widgets || [];

    if (data.activated && allWidgets.length > 0) {
      renderDashboard();
      showScreen('screenDashboard');
      return;
    }
    showScreen('screenStep1');
  } catch { showScreen('screenInvalid'); }

  // Validación en tiempo real del token
  const tokenInput = document.getElementById('notionToken');
  const tokenHint = document.getElementById('tokenHint');
  if (tokenInput && tokenHint) {
    const validateToken = () => {
      const val = tokenInput.value.trim();
      if (val.length === 0) {
        tokenHint.style.color = '';
        tokenHint.innerHTML = 'El token empieza con <code>ntn_</code> o <code>secret_</code> y tiene ~50 caracteres.';
        checkStep2(); return;
      }
      const isValid = (val.startsWith('ntn_') || val.startsWith('secret_')) && val.length > 20;
      const looksLikeUrl = val.startsWith('http') || val.includes('setup.html') || val.includes('token=');
      if (looksLikeUrl) {
        tokenHint.style.color = '#c0392b';
        tokenHint.innerHTML = 'Eso parece una URL, no un token. Ve a notion.so/my-integrations y copia el Internal Integration Token — empieza con <code>ntn_</code> o <code>secret_</code>.';
      } else if (val.length > 5 && !isValid) {
        tokenHint.style.color = '#c0392b';
        tokenHint.innerHTML = '⚠️ El token debe empezar con <code>ntn_</code> o <code>secret_</code>.';
      } else if (isValid) {
        tokenHint.style.color = '#2e7d32';
        tokenHint.innerHTML = '✓ Token válido.';
        savedNotionToken = val;
        try { sessionStorage.setItem('tce_notion_token', val); } catch(e) {}
      } else {
        tokenHint.style.color = '';
        tokenHint.innerHTML = 'El token empieza con <code>ntn_</code> o <code>secret_</code> y tiene ~50 caracteres.';
      }
      checkStep2();
    };
    tokenInput.addEventListener('input', validateToken);
    tokenInput.addEventListener('change', validateToken);
    tokenInput.addEventListener('paste', () => setTimeout(validateToken, 50));
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function renderDashboard() {
  const grid = document.getElementById('widgetsGrid');
  const emptyState = document.getElementById('dashboardEmpty');
  const planBadge = document.getElementById('dashboardPlan');

  if (planBadge) {
    planBadge.textContent = currentPlan === 'pro' ? 'Pro' : 'Free';
    planBadge.className = 'plan-badge ' + (currentPlan === 'pro' ? 'pro' : 'free');
  }

  if (!allWidgets.length) {
    if (grid) grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (grid) grid.style.display = 'grid';

  const colors = ['#F2EDE8', '#EAF4EE', '#EBF0F8', '#F8EBF0', '#F0EBF8'];
  grid.innerHTML = allWidgets.map((w, i) => {
    const bg = colors[i % colors.length];
    const date = w.createdAt
      ? new Date(w.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    return `
      <div class="widget-card" style="--card-bg:${bg}" onclick="openWidgetDetail('${w.widgetId}')">
        <div class="widget-card-icon">✦</div>
        <div class="widget-card-name">${w.name || 'Widget #' + (i + 1)}</div>
        <div class="widget-card-date">${date}</div>
        <div class="widget-card-url">${w.embedUrl}</div>
        <div class="widget-card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </div>
      </div>
    `;
  }).join('');

  const upgradeCard = document.getElementById('dashboardUpgrade');
  if (upgradeCard) upgradeCard.style.display = currentPlan === 'pro' ? 'none' : 'block';
}

// ─── WIDGET DETAIL ────────────────────────────────────────────────────────────
function openWidgetDetail(widgetId) {
  const widget = allWidgets.find(w => w.widgetId === widgetId);
  if (!widget) return;
  activeWidgetId = widgetId;

  document.getElementById('detailName').textContent = widget.name || 'Widget';
  document.getElementById('detailEmbedUrl').textContent = widget.embedUrl;
  document.getElementById('detailToken').textContent = widget.maskedToken || '••••••••••••••••••••••••••••••';

  const dbId = widget.notionDbId || '';
  const dbEl = document.getElementById('detailDbId');
  const dbLinkEl = document.getElementById('detailDbLink');
  if (dbEl) dbEl.textContent = dbId;
  if (dbLinkEl) {
    if (dbId) {
      const formatted = dbId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
      dbLinkEl.href = `https://www.notion.so/${formatted}`;
      dbLinkEl.style.display = 'inline';
    } else {
      dbLinkEl.style.display = 'none';
    }
  }

  // Reconect form: limpiar
  document.getElementById('reconnectStatus').className = 'status idle';
  document.getElementById('reconnectStatus').innerHTML = '';
  document.getElementById('reconnectSection').style.display = 'none';
  document.getElementById('btnShowReconnect').style.display = 'inline-flex';

  showScreen('screenWidgetDetail');
}

function toggleReconnectSection() {
  const section = document.getElementById('reconnectSection');
  const btn = document.getElementById('btnShowReconnect');
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  btn.style.display = isOpen ? 'inline-flex' : 'none';
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
    status.innerHTML = errorIcon() + ' No encontré el ID de tu DB en esa URL.';
    return;
  }

  status.className = 'status loading';
  status.innerHTML = '<div class="spinner"></div> Reconectando…';
  btn.disabled = true;

  try {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId: activeWidgetId, notionToken: token, notionDbId: dbId }),
    });
    const data = await res.json();

    if (!res.ok) {
      status.className = 'status error';
      status.innerHTML = errorIcon() + ' ' + (data.error || 'Error al reconectar');
      btn.disabled = false;
      return;
    }

    // Actualizar datos locales
    const idx = allWidgets.findIndex(w => w.widgetId === activeWidgetId);
    if (idx !== -1) {
      allWidgets[idx].notionDbId = dbId;
      allWidgets[idx].maskedToken = token.slice(0, 8) + '•'.repeat(Math.max(0, token.length - 8));
    }

    status.className = 'status success';
    status.innerHTML = successIcon() + ' ¡Reconectado correctamente!';
    document.getElementById('detailToken').textContent = allWidgets[idx]?.maskedToken || '';
    document.getElementById('detailDbId').textContent = dbId;
    document.getElementById('reconnectToken').value = '';
    document.getElementById('reconnectDbUrl').value = '';
    btn.disabled = false;
  } catch {
    status.className = 'status error';
    status.innerHTML = errorIcon() + ' Error de conexión. Intenta de nuevo.';
    btn.disabled = false;
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
    input.value = '';
    document.getElementById('renameSection').style.display = 'none';
    document.getElementById('btnShowRename').style.display = 'inline-flex';
  } catch(e) { console.error('Error al renombrar', e); }
}

function toggleRenameSection() {
  const section = document.getElementById('renameSection');
  const btn = document.getElementById('btnShowRename');
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  btn.style.display = isOpen ? 'inline-flex' : 'none';
  if (section.style.display !== 'none') {
    const input = document.getElementById('detailRenameInput');
    const widget = allWidgets.find(w => w.widgetId === activeWidgetId);
    input.value = widget ? widget.name : '';
    input.focus();
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
    showScreen('screenDashboard');
  } catch(e) {
    alert('Error al eliminar. Intenta de nuevo.');
  }
}

// ─── DASHBOARD / SETUP FLOW ───────────────────────────────────────────────────
function goToDashboard() {
  renderDashboard();
  showScreen('screenDashboard');
  // Resetear estado del flujo
  [1,2,3,4].forEach(n => {
    toggleStates[n] = false;
    const el = document.getElementById('toggle' + n);
    if (el) el.classList.remove('confirmed');
    const btn = document.getElementById('btn' + n);
    if (btn) btn.disabled = true;
  });
  const tokenInput = document.getElementById('notionToken');
  if (tokenInput) tokenInput.value = '';
  const dbUrl = document.getElementById('notionDbUrl');
  if (dbUrl) dbUrl.value = '';
  savedNotionToken = '';
  try { sessionStorage.removeItem('tce_notion_token'); } catch(e) {}
}

function startNewWidget() {
  showScreen('screenStep1');
}

// ─── SCREENS ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function goStep(n) {
  if (n === 3) {
    const tokenInput = document.getElementById('notionToken');
    const tokenFromInput = tokenInput ? tokenInput.value.trim() : '';
    if (tokenFromInput.length > 10) {
      savedNotionToken = tokenFromInput;
      try { sessionStorage.setItem('tce_notion_token', tokenFromInput); } catch(e) {}
    }
  }
  showScreen('screenStep' + n);
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
  const isValidToken = (token.startsWith('ntn_') || token.startsWith('secret_')) && token.length > 20;
  document.getElementById('btn2').disabled = !(toggleStates[2] && isValidToken);
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
  const tokenInput = document.getElementById('notionToken');
  const tokenFromInput = tokenInput ? tokenInput.value.trim() : '';
  const token = (tokenFromInput.length > 10 ? tokenFromInput : null)
    || (savedNotionToken.length > 10 ? savedNotionToken : null)
    || (function(){ try { return sessionStorage.getItem('tce_notion_token') || ''; } catch(e) { return ''; } })();

  const dbUrl = document.getElementById('notionDbUrl').value.trim();
  const dbId = extractDbId(dbUrl);
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
      body: JSON.stringify({ setupToken, notionToken: token, notionDbId: dbId, widgetName }),
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

// ─── UTILS ───────────────────────────────────────────────────────────────────
function copyEmbed(id, btn) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = '✓ copiado';
    setTimeout(() => btn.textContent = original, 2000);
  });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = original, 2000);
  });
}

function copyById(id, btn) {
  const text = document.getElementById(id).textContent;
  copyText(text, btn);
}

function toggleHowto(btn) {
  const collapsible = btn.nextElementSibling;
  const isOpen = collapsible.classList.contains('open');
  collapsible.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  btn.querySelector('span') && (btn.querySelector('span').textContent = isOpen ? 'Ver instrucciones' : 'Ocultar instrucciones');
}

function errorIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
}
function successIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
}

init();
