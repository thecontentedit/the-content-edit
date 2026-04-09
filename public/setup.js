const params = new URLSearchParams(location.search);
const setupToken = params.get('token');
const BASE_URL = location.origin;
const toggleStates = { 1: false, 2: false, 3: false, 4: false };
let savedNotionToken = '';

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
    if (data.activated && data.widgetUrl) {
      document.getElementById('alreadyEmbedUrl').textContent = data.widgetUrl;
      if (data.plan === 'pro') {
        document.getElementById('alreadyBioUrl').textContent = data.widgetUrl + '?mode=bio';
        document.getElementById('already-bio-block').style.display = 'block';
        document.getElementById('upgrade-card').style.display = 'none';
      } else {
        document.getElementById('already-bio-block').style.display = 'none';
        document.getElementById('upgrade-card').style.display = 'block';
      }
      showScreen('screenAlreadyDone'); return;
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
        tokenHint.innerHTML = '⚠️ Eso parece una URL, no un token. Ve a <strong>notion.so/my-integrations</strong> (o "Mis integraciones" si tienes Notion en español) y copia el <strong>Internal Integration Token</strong> — empieza con <code>ntn_</code> o <code>secret_</code>.';
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

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function goStep(n) {
  // Guardar token al salir del paso 2
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

  try {
    const res = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, notionToken: token, notionDbId: dbId }),
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
