const params = new URLSearchParams(location.search);
const setupToken = params.get('token');
const BASE_URL = location.origin;
const toggleStates = { 1: false, 2: false, 3: false };

async function init() {
  if (!setupToken) { showScreen('screenInvalid'); return; }
  try {
    const res = await fetch(`${BASE_URL}/api/setup?token=${setupToken}`);
    if (!res.ok) { showScreen('screenInvalid'); return; }
    const data = await res.json();
    if (data.activated && data.widgetUrl) {
      document.getElementById('alreadyEmbedUrl').textContent = data.widgetUrl;

      if (data.plan === 'pro') {
        // Pro: mostrar URL de bio, ocultar botón upgrade
        document.getElementById('alreadyBioUrl').textContent = data.widgetUrl + '?mode=bio';
        document.getElementById('already-bio-block').style.display = 'block';
        document.getElementById('upgrade-card').style.display = 'none';
      } else {
        // Free: ocultar URL de bio, mostrar botón upgrade
        document.getElementById('already-bio-block').style.display = 'none';
        document.getElementById('upgrade-card').style.display = 'block';
      }

      showScreen('screenAlreadyDone'); return;
    }
    showScreen('screenStep1');
  } catch { showScreen('screenInvalid'); }
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function goStep(n) { showScreen('screenStep' + n); }

function toggleConfirm(n) {
  toggleStates[n] = !toggleStates[n];
  document.getElementById('toggle' + n).classList.toggle('confirmed', toggleStates[n]);
  if (n === 1) document.getElementById('btn1').disabled = !toggleStates[1];
  if (n === 2) checkStep2();
  if (n === 3) checkStep3();
}

function checkStep2() {
  const token = document.getElementById('notionToken').value.trim();
  document.getElementById('btn2').disabled = !(toggleStates[2] && token.length > 10);
}

function checkStep3() {
  const url = document.getElementById('notionDbUrl').value.trim();
  document.getElementById('btn3').disabled = !(toggleStates[3] && url.length > 20);
}

function extractDbId(input) {
  const clean = input.trim().replace(/-/g, '');
  const match = clean.match(/([a-f0-9]{32})/i);
  return match ? match[1] : null;
}

async function connectNotion() {
  const token = document.getElementById('notionToken').value.trim();
  const dbUrl = document.getElementById('notionDbUrl').value.trim();
  const dbId = extractDbId(dbUrl);
  const status = document.getElementById('connectStatus');
  const btn = document.getElementById('btn3');

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

    document.getElementById('embedUrl').textContent = data.embedUrl;

    // Solo mostrar Bio URL si es Pro
    const bioBlock = document.getElementById('step4-bio-block');
    const upgradeCardStep4 = document.getElementById('upgrade-card-step4');
    if (data.plan === 'pro') {
      document.getElementById('embedBioUrl').textContent = data.embedUrl + '?mode=bio';
      if (bioBlock) bioBlock.style.display = 'block';
      if (upgradeCardStep4) upgradeCardStep4.style.display = 'none';
    } else {
      if (bioBlock) bioBlock.style.display = 'none';
      if (upgradeCardStep4) upgradeCardStep4.style.display = 'block';
    }

    setTimeout(() => goStep(4), 900);

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
