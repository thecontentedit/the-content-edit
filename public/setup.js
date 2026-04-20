const params = new URLSearchParams(location.search);
const setupToken = params.get('token');
const BASE_URL = location.origin;
const toggleStates = { 1: false, 2: false, 3: false, 4: false };
let savedNotionToken = '';
let currentPlan = 'free';
let allWidgets = [];
let activeWidgetId = null;
let accountData = {};

// ─── CARD CUSTOMIZER STATE ────────────────────────────────────────────────────
const CARD_COLORS = [
  { value: '#F2EDE8', label: 'Arena' },
  { value: '#EAF4EE', label: 'Menta' },
  { value: '#EBF0F8', label: 'Cielo' },
  { value: '#F8EBF0', label: 'Rosa' },
  { value: '#F0EBF8', label: 'Lavanda' },
  { value: '#FFF8E7', label: 'Vainilla' },
  { value: '#FBF0E8', label: 'Melocotón' },
  { value: '#E8F4F8', label: 'Agua' },
  { value: '#F5F5F0', label: 'Niebla' },
  { value: '#F0F8F0', label: 'Hoja' },
  { value: '#F8F0F5', label: 'Orquídea' },
  { value: '#FEFCE8', label: 'Limón' },
];

const CARD_EMOJIS = [
  '✦', '✿', '◆', '▲', '✪', '❋',
  '🌸', '🌿', '🍃', '🌙', '⭐', '🦋',
  '📸', '🎞️', '📱', '💫', '🌺', '🍀',
  '🎨', '✏️', '📌', '🔮', '🧿', '💎',
];

let modalState = { color: null, emoji: null, widgetId: null };
let ctxWidgetId = null;

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

  // Cerrar menú contextual al click fuera
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('ctxMenu');
    if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) {
      closeCtxMenu();
    }
  });
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

  const sorted = [...allWidgets].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const DEFAULT_COLORS = ['#F2EDE8', '#EAF4EE', '#EBF0F8', '#F8EBF0', '#F0EBF8', '#FFF8E7'];

  grid.innerHTML = sorted.map((w, i) => {
    const bg = w.cardColor || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    const emoji = w.cardEmoji || null;
    const initials = getInitials(w.name || `Widget #${i + 1}`);
    const date = w.createdAt
      ? new Date(w.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    const shortUrl = w.embedUrl ? w.embedUrl.replace('https://', '') : '';
    const pinnedClass = w.pinned ? ' is-pinned' : '';

    return `
      <div class="widget-card${pinnedClass}" data-widget-id="${w.widgetId}" onclick="handleCardClick(event, '${w.widgetId}')">
        <div class="widget-card-banner" style="background-color:${bg};">
          <div class="pin-badge">Fijado</div>
          <button class="widget-menu-btn" onclick="openCtxMenu(event, '${w.widgetId}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="5" r="1.2" fill="currentColor"/>
              <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
              <circle cx="12" cy="19" r="1.2" fill="currentColor"/>
            </svg>
          </button>
          <div class="widget-initials">${emoji ? `<span style="font-size:17px;line-height:1">${emoji}</span>` : initials}</div>
        </div>
        <div class="widget-card-body">
          <div class="widget-card-name">${escHtml(w.name || 'Widget #' + (i + 1))}</div>
          <div class="widget-card-date">${date}</div>
          <div class="widget-card-url">${shortUrl}</div>
        </div>
      </div>
    `;
  }).join('');

  if (upgradeEl) upgradeEl.style.display = currentPlan === 'pro' ? 'none' : 'block';
}

function handleCardClick(event, widgetId) {
  if (event.target.closest('.widget-menu-btn')) return;
  openWidgetDetail(widgetId);
}

function getInitials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function showWidgetsDashboard() {
  document.getElementById('widgetsDashboard').style.display = 'block';
  document.getElementById('widgetDetail').style.display = 'none';
}

function startNewWidget() {
  resetWizard();
  switchTab('setup');
}

// ─── CONTEXT MENU ─────────────────────────────────────────────────────────────
function openCtxMenu(event, widgetId) {
  event.stopPropagation();
  ctxWidgetId = widgetId;
  const widget = allWidgets.find(w => w.widgetId === widgetId);
  if (!widget) return;

  const pinLabel = document.getElementById('ctxPinLabel');
  if (pinLabel) pinLabel.textContent = widget.pinned ? 'Quitar fijado' : 'Fijar widget';

  const menu = document.getElementById('ctxMenu');
  menu.style.display = 'block';

  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menuW = 190;
  let left = rect.right - menuW;
  let top = rect.bottom + 6;

  if (left < 8) left = 8;
  if (top + 260 > window.innerHeight) top = rect.top - 264;

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function closeCtxMenu() {
  const menu = document.getElementById('ctxMenu');
  if (menu) menu.style.display = 'none';
  ctxWidgetId = null;
}

async function ctxPinWidget() {
  const wId = ctxWidgetId;
  closeCtxMenu();
  const widget = allWidgets.find(w => w.widgetId === wId);
  if (!widget) return;
  const newPinned = !widget.pinned;

  try {
    await fetch(`${BASE_URL}/api/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId: wId, pinned: newPinned }),
    });
    const idx = allWidgets.findIndex(w => w.widgetId === wId);
    if (idx !== -1) allWidgets[idx].pinned = newPinned;
    renderDashboard();
  } catch(e) { console.error(e); }
}

function ctxEditCard() {
  const wId = ctxWidgetId;
  closeCtxMenu();
  openCardModal(wId);
}

function ctxRename() {
  const wId = ctxWidgetId;
  closeCtxMenu();
  openWidgetDetail(wId);
  setTimeout(() => toggleRenameSection(), 120);
}

function ctxOpenDetail() {
  const wId = ctxWidgetId;
  closeCtxMenu();
  openWidgetDetail(wId);
}

async function ctxDelete() {
  const wId = ctxWidgetId;
  closeCtxMenu();
  const widget = allWidgets.find(w => w.widgetId === wId);
  const name = widget ? widget.name : 'este widget';
  if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer. El embed en Notion dejará de funcionar.`)) return;
  try {
    await fetch(`${BASE_URL}/api/setup`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, widgetId: wId }),
    });
    allWidgets = allWidgets.filter(w => w.widgetId !== wId);
    renderDashboard();
  } catch(e) { alert('Error al eliminar. Intenta de nuevo.'); }
}

// ─── CARD CUSTOMIZER MODAL ────────────────────────────────────────────────────
function openCardModal(widgetId) {
  const widget = allWidgets.find(w => w.widgetId === widgetId);
  if (!widget) return;

  modalState = {
    widgetId,
    color: widget.cardColor || CARD_COLORS[0].value,
    emoji: widget.cardEmoji || null,
    name: widget.name || '',
  };

  const nameInput = document.getElementById('modalWidgetName');
  if (nameInput) nameInput.value = modalState.name;

  renderColorSwatches();
  renderEmojiGrid();
  updateModalPreview(widget);

  document.getElementById('cardModal').style.display = 'flex';
}

function onModalNameInput(value) {
  modalState.name = value;
  const initials = document.getElementById('modalCardInitials');
  if (initials) initials.textContent = getInitials(value || 'W');
}

function renderColorSwatches() {
  const container = document.getElementById('colorSwatches');
  container.innerHTML = CARD_COLORS.map(c => `
    <div class="color-swatch ${c.value === modalState.color ? 'selected' : ''}"
      style="background-color:${c.value};"
      title="${c.label}"
      onclick="selectColor('${c.value}')">
    </div>
  `).join('');
}

function renderEmojiGrid() {
  const container = document.getElementById('emojiGrid');
  container.innerHTML = `
    <button class="emoji-btn none-btn ${!modalState.emoji ? 'selected' : ''}" onclick="selectEmoji(null)" title="Sin emoji">—</button>
    ${CARD_EMOJIS.map(e => `
      <button class="emoji-btn ${e === modalState.emoji ? 'selected' : ''}" onclick="selectEmoji('${e}')">${e}</button>
    `).join('')}
  `;
}

function selectColor(color) {
  modalState.color = color;
  renderColorSwatches();
  document.getElementById('modalCardPreview').style.backgroundColor = color;
}

function selectEmoji(emoji) {
  modalState.emoji = emoji;
  renderEmojiGrid();
  const emojiEl = document.getElementById('modalCardEmoji');
  if (emojiEl) emojiEl.textContent = emoji || '';
}

function updateModalPreview(widget) {
  const preview = document.getElementById('modalCardPreview');
  if (preview) preview.style.backgroundColor = modalState.color || '#F2EDE8';

  const initials = document.getElementById('modalCardInitials');
  if (initials) initials.textContent = getInitials(widget.name || 'W');

  const emojiEl = document.getElementById('modalCardEmoji');
  if (emojiEl) emojiEl.textContent = modalState.emoji || '';
}

function closeCardModal(event) {
  if (event && event.target !== document.getElementById('cardModal')) return;
  document.getElementById('cardModal').style.display = 'none';
}

async function saveCardCustomization() {
  const { widgetId, color, emoji, name } = modalState;
  if (!widgetId) return;

  const trimmedName = (name || '').trim().slice(0, 60);

  try {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupToken,
        widgetId,
        cardColor: color,
        cardEmoji: emoji,
        ...(trimmedName ? { name: trimmedName } : {}),
      }),
    });
    if (!res.ok) throw new Error('error');
    const idx = allWidgets.findIndex(w => w.widgetId === widgetId);
    if (idx !== -1) {
      allWidgets[idx].cardColor = color;
      allWidgets[idx].cardEmoji = emoji;
      if (trimmedName) allWidgets[idx].name = trimmedName;
    }
    document.getElementById('cardModal').style.display = 'none';
    renderDashboard();
  } catch(e) {
    alert('Error al guardar. Intenta de nuevo.');
  }
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

  // ✅ Bio link para Pro
  const bioRow = document.getElementById('detailBioRow');
  const bioUrlEl = document.getElementById('detailBioUrl');
  if (currentPlan === 'pro' && widget.embedUrl) {
    if (bioRow) bioRow.style.display = 'flex';
    if (bioUrlEl) bioUrlEl.textContent = widget.embedUrl + '?mode=bio';
  } else {
    if (bioRow) bioRow.style.display = 'none';
  }

  const previewIframe = document.getElementById('widgetPreviewIframe');
  if (previewIframe && widget.embedUrl) previewIframe.src = widget.embedUrl;

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
      pinned: false,
      cardColor: null,
      cardEmoji: null,
    });
    currentPlan = data.plan || currentPlan;

    document.getElementById('embedUrl').textContent = data.embedUrl;
    const bioBlock = document.getElementById('step5-bio-block');
    const upgradeCardStep5 = document.getElementById('upgrade-card-step5');
    const instrFree = document.getElementById('step5-instructions-free');
    const instrPro = document.getElementById('step5-instructions-pro');
    if (data.plan === 'pro') {
      document.getElementById('embedBioUrl').textContent = data.embedUrl + '?mode=bio';
      if (bioBlock) bioBlock.style.display = 'block';
      if (upgradeCardStep5) upgradeCardStep5.style.display = 'none';
      if (instrFree) instrFree.style.display = 'none';
      if (instrPro) instrPro.style.display = 'block';
    } else {
      if (bioBlock) bioBlock.style.display = 'none';
      if (upgradeCardStep5) upgradeCardStep5.style.display = 'block';
      if (instrFree) instrFree.style.display = 'block';
      if (instrPro) instrPro.style.display = 'none';
    }

    const step5Iframe = document.getElementById('step5PreviewIframe');
    if (step5Iframe && data.embedUrl) step5Iframe.src = data.embedUrl;

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
