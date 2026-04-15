const params = new URLSearchParams(location.search);
const setupToken = params.get('token');
const BASE_URL = location.origin;
const toggleStates = { 1: false, 2: false, 3: false, 4: false };
let savedNotionToken = '';
let currentPlan = 'free';
let allWidgets = [];

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const stored = sessionStorage.getItem('tce_notion_token');
    if (stored && stored.startsWith('http')) {
      sessionStorage.removeItem('tce_notion_token');
    }
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
        checkStep2();
        return;
      }
      const isValid = (val.startsWith('ntn_') || val.startsWith('secret_')) && val.length > 20;
      const looksLikeUrl = val.startsWith('http') || val.includes('setup.html') || val.includes('token=');
      if (looksLikeUrl) {
        tokenHint.style.color = '#c0392b';
        tokenHint.innerHTML = 'Eso parece una URL, no un token. Ve a notion.so/my-integrations y copia el Internal Integration Token ó Secreto de integración interna — empieza con <code>ntn_</code> o <code>secret_</code>.';
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

  grid.innerHTML = allWidgets.map((w, i) => {
    const colors = ['#F2EDE8', '#EAF4EE', '#EBF0F8', '#F8EBF0', '#F0EBF8'];
    const bg = colors[i % colors.length];
    const short = w.widgetId.slice(0, 7);
    const date = w.createdAt ? new Date(w.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `
      <div class="widget-card" style="--card-bg:${bg}">
        <div class="widget-card-top">
          <div class="widget-card-icon">✦</div>
          <button class="widget-card-menu" onclick="toggleWidgetMenu('${w.widgetId}')" title="Opciones">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
          <div class="widget-dropdown" id="menu-${w.widgetId}">
            <button onclick="startRename('${w.widgetId}', ${i})">Renombrar</button>
            <button onclick="copyWidgetUrl('${w.embedUrl}', '${w.widgetId}')">Copiar URL</button>
            <button class="danger" onclick="confirmDelete('${w.widgetId}')">Eliminar</button>
          </div>
        </div>
        <div class="widget-card-name" id="name-${w.widgetId}">${w.name || 'Widget #' + (i + 1)}</div>
        <div class="widget-card-id">${date ? date : '#' + short}</div>
        <div class="widget-card-url">${w.embedUrl}</div>
        <button class="widget-card-btn" onclick="copyWidgetUrl('${w.embedUrl}', '${w.widgetId}')">
          <span id="copylabel-${w.widgetId}">Copiar URL</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
    `;
  }).join('');

  // Upgrade card al final si es free
  const upgradeCard = document.getElementById('dashboardUpgrade');
  if (upgradeCard) {
    upgradeCard.style.display = currentPlan === 'pro' ? 'none' : 'block';
  }
}

function toggleWidgetMenu(widgetId) {
  // Cerrar todos los demás
  document.querySelectorAll('.widget-dropdown').forEach(d => {
    if (d.id !== `menu-${widgetId}`) d.classList.remove('open');
  });
  document.getElementById(`menu-${widgetId}`).classList.toggle('open');
}

// Cerrar menús al click afuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('.widget-card-menu') && !e.target.closest('.widget-dropdown')) {
    document.querySelectorAll('.widget-dropdown').forEach(d => d.classList.remove('open'));
  }
});

function copyWidgetUrl(url, widgetId) {
  navigator.clipboard.writeText(url).then(() => {
    const label = document.getElementById(`copylabel-${widgetId}`);
    if (label) {
      label.textContent = '✓ Copiada';
      setTimeout(() => label.textContent = 'Copiar URL', 2000);
    }
  });
  // Cerrar dropdown si está abierto
  const menu = document.getElementById(`menu-${widgetId}`);
  if (menu) menu.classList.remove('open');
}

function startRename(widgetId, idx) {
  document.getElementById(`menu-${widgetId}`).classList.remove('open');
  const nameEl = document.getElementById(`name-${widgetId}`);
  const currentName = nameEl.textContent;
  nameEl.innerHTML = `<input class="rename-input" id="rename-${widgetId}" value="${currentName}" maxlength="60" onblur="submitRename('${widgetId}', ${idx})" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape')cancelRename('${widgetId}','${currentName}')"/>`;
  const input = document.getElementById(`rename-${widgetId}`);
  input.focus();
  input.select();
}

async function submitRename(widgetId, idx) {
  const input = document.getElementById(`rename-${widgetId}`);
  if (!input) return;
  const newName = input.value.trim() || allWidgets[idx].name;
  document.getElementById(`name-${widgetId}`).textContent = newName;
  allWidgets[idx].name = newName;

  try {
    await fetch(`${BASE_URL}/api/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId, name: newName }),
    });
  } catch(e) { console.error('Error al renombrar', e); }
}

function cancelRename(widgetId, originalName) {
  document.getElementById(`name-${widgetId}`).textContent = originalName;
}

async function confirmDelete(widgetId) {
  document.getElementById(`menu-${widgetId}`).classList.remove('open');
  const widget = allWidgets.find(w => w.widgetId === widgetId);
  const name = widget ? widget.name : 'este widget';
  if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer. El embed en Notion dejará de funcionar.`)) return;

  try {
    await fetch(`${BASE_URL}/api/setup`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId }),
    });
    allWidgets = allWidgets.filter(w => w.widgetId !== widgetId);
    renderDashboard();
  } catch(e) {
    alert('Error al eliminar. Intenta de nuevo.');
  }
}

function goToDashboard() {
  renderDashboard();
  showScreen('screenDashboard');
  // Resetear estado del flujo de setup
  toggleStates[1] = false; toggleStates[2] = false;
  toggleStates[3] = false; toggleStates[4] = false;
  ['toggle1','toggle2','toggle3','toggle4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('confirmed');
  });
  ['btn1','btn2','btn3','btn4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
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
    status.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Token inválido. Regresa al paso 2 y vuelve a pegarlo.`;
    return;
  }
  if (!dbId) {
    status.className = 'status error';
    status.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> No encontré el ID de tu DB en esa URL. Verifica que sea la URL correcta.`;
    return;
  }

  status.className = 'status loading';
  status.innerHTML = `<div class="spinner"></div> Conectando con Notion…`;
  btn.disabled = true;

  // Nombre por defecto
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
      status.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${data.error || 'Error al conectar'}`;
      btn.disabled = false;
      return;
    }

    status.className = 'status success';
    status.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ¡Conexión exitosa!`;
    try { sessionStorage.removeItem('tce_notion_token'); } catch(e) {}

    // Agregar nuevo widget a la lista local
    allWidgets.push({
      widgetId: data.widgetId,
      name: data.widgetName || widgetName,
      createdAt: new Date().toISOString(),
      embedUrl: data.embedUrl,
    });
    currentPlan = data.plan || currentPlan;

    // Mostrar paso 5
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
    status.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Error de conexión. Intenta de nuevo.`;
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

function toggleHowto(btn) {
  const collapsible = btn.nextElementSibling;
  const isOpen = collapsible.classList.contains('open');
  collapsible.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  btn.querySelector('span') && (btn.querySelector('span').textContent = isOpen ? 'Ver instrucciones' : 'Ocultar instrucciones');
}

init();
