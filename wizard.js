/**
 * wizard.js — Logique du wizard de configuration initiale AeroKiosk
 *
 * 6 étapes :
 *   0. Choix de la langue
 *   1. Clé de licence
 *   2. Recherche aérodrome (OACI ou nom)
 *   3. Vérification des pistes
 *   4. Personnalisation (branding, thème, mot de passe)
 *   5. Résumé → lancement
 */

// ============================================================
// STATE
// ============================================================

const TOTAL_STEPS = 6;
let currentStep = 0;

// Données collectées par le wizard
const wizData = {
  language: 'fr',
  license: { key: '', mode: 'demo' },
  airport: null,          // objet complet de la base
  airportId: '',          // code OACI ou FR-XXXX
  runways: [],            // [{name, heading, length}]
  branding: {
    clubName: '',
    appTitle: 'AEROKIOSK',
    logoDay: '',
    logoNight: ''
  },
  themeName: 'auto',
  adminPassword: ''
};

// ============================================================
// NAVIGATION
// ============================================================

function goToStep(step) {
  if (step < 0 || step >= TOTAL_STEPS) return;
  currentStep = step;

  // Afficher le bon step
  document.querySelectorAll('.wizard-step').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });

  // Mettre à jour le stepper
  document.querySelectorAll('.wizard-step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === step);
    dot.classList.toggle('done', i < step);
  });
  document.querySelectorAll('.wizard-step-line').forEach((line, i) => {
    line.classList.toggle('done', i < step);
  });

  // Boutons
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnSkip = document.getElementById('btnSkipLicense');

  btnPrev.style.visibility = step === 0 ? 'hidden' : 'visible';
  btnSkip.style.display = step === 1 ? 'inline-flex' : 'none';
  const btnBuy = document.getElementById('btnBuyLicense');
  if (btnBuy) btnBuy.style.display = step === 1 ? 'inline-flex' : 'none';

  if (step === TOTAL_STEPS - 1) {
    btnNext.textContent = t('wizard.launch');
  } else {
    btnNext.textContent = t('wizard.next');
  }

  // Pré-remplir le résumé à la dernière étape
  if (step === 5) buildSummary();
}

function nextStep() {
  if (!validateStep(currentStep)) return;
  if (currentStep === TOTAL_STEPS - 1) {
    finishWizard();
  } else {
    goToStep(currentStep + 1);
  }
}

function prevStep() {
  goToStep(currentStep - 1);
}

// ============================================================
// VALIDATION PAR ÉTAPE
// ============================================================

function validateStep(step) {
  switch (step) {
    case 0: return true; // Langue — toujours OK
    case 1: return validateLicenseStep();
    case 2: return validateAirportStep();
    case 3: return validateRunwayStep();
    case 4: return validateCustomStep();
    case 5: return true;
  }
  return true;
}

function validateLicenseStep() {
  const key = document.getElementById('licenseKey').value.trim();
  if (!key) {
    // Pas de clé = demo, c'est OK (le bouton "Suivant" marche aussi)
    wizData.license = { key: '', mode: 'demo' };
    return true;
  }
  // Valider la clé
  // On a déjà validé en live, vérifier le state
  if (wizData.license.mode === 'full') return true;
  document.getElementById('licenseError').textContent = t('wizard.license.invalid');
  return false;
}

function validateAirportStep() {
  if (!wizData.airport) {
    document.getElementById('airportSearch').classList.add('error');
    return false;
  }
  return true;
}

function validateRunwayStep() {
  // Les pistes sont optionnelles (certains terrains n'en ont pas dans la base)
  wizData.runways = collectRunways();
  return true;
}

function validateCustomStep() {
  const pwd = document.getElementById('adminPassword').value;
  const pwd2 = document.getElementById('adminPasswordConfirm').value;
  const errEl = document.getElementById('passwordError');

  if (pwd && pwd !== pwd2) {
    errEl.textContent = t('wizard.customization.passwordMismatch');
    return false;
  }
  errEl.textContent = '';

  wizData.branding.clubName = document.getElementById('clubName').value.trim();
  wizData.branding.appTitle = document.getElementById('appTitle').value.trim() || 'AEROKIOSK';
  wizData.adminPassword = pwd;

  return true;
}

// ============================================================
// STEP 0 : LANGUE
// ============================================================

const LANG_FLAGS = { fr: '🇫🇷', de: '🇩🇪', en: '🇬🇧', it: '🇮🇹', es: '🇪🇸', pt: '🇵🇹', el: '🇬🇷' };

function initLangStep() {
  const grid = document.getElementById('langGrid');
  grid.innerHTML = '';
  Object.entries(I18N_LANGUAGES).forEach(([code, info]) => {
    const card = document.createElement('div');
    card.className = 'lang-card' + (code === wizData.language ? ' selected' : '');
    card.dataset.lang = code;
    card.innerHTML = '<span class="lang-flag">' + (LANG_FLAGS[code] || '🌐') + '</span>'
      + '<span class="lang-name">' + info.nativeName + '</span>';
    grid.appendChild(card);
  });

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.lang-card');
    if (!card) return;
    grid.querySelectorAll('.lang-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const lang = card.dataset.lang;
    wizData.language = lang;
    setLanguage(lang);
    applyI18n();
  });
}

// ============================================================
// STEP 1 : LICENCE
// ============================================================

function initLicenseStep() {
  const input = document.getElementById('licenseKey');
  const errorEl = document.getElementById('licenseError');
  const statusEl = document.getElementById('licenseStatus');

  let validateTimeout = null;

  input.addEventListener('input', () => {
    errorEl.textContent = '';
    statusEl.innerHTML = '';
    wizData.license = { key: '', mode: 'demo' };

    if (validateTimeout) clearTimeout(validateTimeout);

    const val = input.value.trim();
    if (val.length < 5) return;

    // Valider après 800ms sans frappe (appel en ligne)
    validateTimeout = setTimeout(async () => {
      statusEl.innerHTML = '<span style="color:var(--wiz-text-dim);">' + t('wizard.license.checking') + '</span>';

      const result = await platform.validateLicense(val);
      if (result.valid) {
        wizData.license = { key: val, mode: 'full', expiresAt: result.expiresAt };
        statusEl.innerHTML = '<span class="status-badge status-valid">' + t('wizard.license.valid') + '</span>';
      } else if (result.offline) {
        wizData.license = { key: '', mode: 'demo' };
        errorEl.textContent = t('wizard.license.offline');
      } else {
        wizData.license = { key: '', mode: 'demo' };
        errorEl.textContent = result.reason || t('settings.license.invalidKey');
      }
    }, 800);
  });
}

// ============================================================
// STEP 1 : RECHERCHE AÉRODROME
// ============================================================

let searchTimeout = null;

function initAirportSearch() {
  const input = document.getElementById('airportSearch');
  const resultsEl = document.getElementById('airportResults');

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();

    if (q.length < 2) {
      resultsEl.classList.remove('open');
      return;
    }

    // Recherche avec délai (éviter de spammer pendant la saisie)
    searchTimeout = setTimeout(async () => {
      const results = await platform.searchAirports(q);
      renderSearchResults(results);
    }, 200);
  });

  // Fermer les résultats quand on clique ailleurs
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      resultsEl.classList.remove('open');
    }
  });
}

function renderSearchResults(results) {
  const el = document.getElementById('airportResults');

  if (results.length === 0) {
    el.innerHTML = '<div style="padding:12px;color:var(--wiz-text-dim);font-size:13px;">' + t('wizard.airport.noResult') + '</div>';
    el.classList.add('open');
    return;
  }

  el.innerHTML = results.map(r => {
    const badge = r.type === 'icao'
      ? '<span class="search-result-badge badge-icao">' + t('wizard.airport.icao') + '</span>'
      : '<span class="search-result-badge badge-ulm">' + t('wizard.airport.ulm') + '</span>';
    const detail = r.type === 'ulm' && r.metarStation
      ? `${r.city || ''} — ${t('wizard.airport.metarStation')} ${r.metarStation} (${r.metarDistance} km)`
      : r.city || '';
    return `
      <div class="search-result-item" data-id="${r.id}">
        <div class="search-result-name">${r.id} — ${r.name} ${badge}</div>
        <div class="search-result-detail">${detail}</div>
      </div>`;
  }).join('');

  el.classList.add('open');

  // Click handler sur chaque résultat
  el.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => selectAirport(item.dataset.id));
  });
}

async function selectAirport(id) {
  const airport = await platform.getAirport(id);
  if (!airport) return;

  wizData.airport = airport;
  wizData.airportId = id;
  wizData.runways = airport.runways ? [...airport.runways] : [];

  // Mettre à jour l'input
  document.getElementById('airportSearch').value = `${id} — ${airport.name}`;
  document.getElementById('airportSearch').classList.remove('error');
  document.getElementById('airportResults').classList.remove('open');

  // Afficher les infos
  const infoEl = document.getElementById('airportInfo');
  infoEl.style.display = 'block';

  const metarStation = airport.metarStation || id;
  const card = document.getElementById('airportInfoCard');
  card.innerHTML = `
    <div class="info-row"><span class="info-label">${t('wizard.airport.fieldLabel')}</span><span class="info-value">${id} — ${airport.name}</span></div>
    <div class="info-row"><span class="info-label">${t('wizard.airport.city')}</span><span class="info-value">${airport.city || '—'}</span></div>
    <div class="info-row"><span class="info-label">${t('wizard.airport.coordinates')}</span><span class="info-value">${airport.lat}° N, ${airport.lon}° ${airport.lon >= 0 ? 'E' : 'O'}</span></div>
    <div class="info-row"><span class="info-label">${t('wizard.airport.altitude')}</span><span class="info-value">${airport.elev} ft</span></div>
    <div class="info-row"><span class="info-label">${t('wizard.airport.metarStation')}</span><span class="info-value">${metarStation}</span></div>
    <div class="info-row"><span class="info-label">${t('wizard.airport.fir')}</span><span class="info-value">${airport.fir || '—'} (${airport.firName || '—'})</span></div>
    <div class="info-row"><span class="info-label">${t('wizard.airport.runways')}</span><span class="info-value">${t('wizard.airport.runwaysCount', {count: airport.runways?.length || 0})}</span></div>
  `;

  // Notice pour les bases ULM
  const noticeEl = document.getElementById('metarNotice');
  if (airport.type === 'ulm' && airport.metarStation) {
    noticeEl.style.display = 'flex';
    noticeEl.textContent = t('wizard.airport.ulmNotice', {station: airport.metarStation, distance: airport.metarDistance});
  } else {
    noticeEl.style.display = 'none';
  }
}

// ============================================================
// STEP 2 : PISTES
// ============================================================

function initRunwayStep() {
  document.getElementById('btnAddRunway').addEventListener('click', addRunway);
}

function renderRunways() {
  const list = document.getElementById('runwayList');

  if (wizData.runways.length === 0) {
    list.innerHTML = '<div style="color:var(--wiz-text-dim);font-size:13px;padding:12px;">' + t('wizard.runways.noneDetected') + '</div>';
    return;
  }

  list.innerHTML = wizData.runways.map((rwy, i) => `
    <div class="runway-item">
      <span class="rwy-name">${rwy.name}</span>
      <span class="rwy-heading">${rwy.heading}°</span>
      <span class="rwy-length">${rwy.length ? rwy.length + 'm' : ''}</span>
      <button class="rwy-delete" data-idx="${i}" title="Supprimer">✕</button>
    </div>
  `).join('');

  // Delete handlers
  list.querySelectorAll('.rwy-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      wizData.runways.splice(parseInt(btn.dataset.idx), 1);
      renderRunways();
    });
  });
}

function addRunway() {
  const nameEl = document.getElementById('newRwyName');
  const headingEl = document.getElementById('newRwyHeading');
  const name = nameEl.value.trim().toUpperCase();
  const heading = parseInt(headingEl.value);

  if (!name) { nameEl.classList.add('error'); return; }
  if (isNaN(heading) || heading < 0 || heading > 360) { headingEl.classList.add('error'); return; }

  nameEl.classList.remove('error');
  headingEl.classList.remove('error');

  wizData.runways.push({ name, heading, length: 0 });
  nameEl.value = '';
  headingEl.value = '';
  renderRunways();
}

function collectRunways() {
  return [...wizData.runways];
}

// ============================================================
// STEP 3 : PERSONNALISATION
// ============================================================

function initCustomStep() {
  // Thème selector
  document.getElementById('themeGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    wizData.themeName = card.dataset.theme;
  });

  // Toggle password visibility
  document.getElementById('btnTogglePwd').addEventListener('click', () => {
    const pwd = document.getElementById('adminPassword');
    const confirm = document.getElementById('adminPasswordConfirm');
    const isPassword = pwd.type === 'password';
    pwd.type = isPassword ? 'text' : 'password';
    confirm.type = isPassword ? 'text' : 'password';
  });

  // Logo pickers
  document.getElementById('btnLogoDayPick').addEventListener('click', async () => {
    const result = await platform.selectFile({ title: t('settings.branding.chooseLogoDay') });
    if (result.canceled) return;
    const copy = await platform.copyLogo(result.path);
    if (copy.success) {
      wizData.branding.logoDay = copy.fileName;
      // Afficher juste le nom court pour les URLs longues
      const displayName = copy.fileName.length > 40 ? copy.fileName.split('/').pop() : copy.fileName;
      document.getElementById('logoDayName').textContent = displayName;
    }
  });

  document.getElementById('btnLogoNightPick').addEventListener('click', async () => {
    const result = await platform.selectFile({ title: t('settings.branding.chooseLogoNight') });
    if (result.canceled) return;
    const copy = await platform.copyLogo(result.path);
    if (copy.success) {
      wizData.branding.logoNight = copy.fileName;
      const displayName = copy.fileName.length > 40 ? copy.fileName.split('/').pop() : copy.fileName;
      document.getElementById('logoNightName').textContent = displayName;
    }
  });
}

// Pré-remplir le nom du club depuis le nom de l'aérodrome
function prefillCustomStep() {
  if (wizData.airport && !document.getElementById('clubName').value) {
    document.getElementById('clubName').value = wizData.airport.name || '';
  }
  if (wizData.airport && !document.getElementById('appTitle').value) {
    const name = wizData.airport.name || '';
    document.getElementById('appTitle').value = name.toUpperCase();
  }
}

// ============================================================
// STEP 4 : RÉSUMÉ
// ============================================================

function buildSummary() {
  const grid = document.getElementById('summaryGrid');
  const ap = wizData.airport;
  const metarStation = ap?.metarStation || wizData.airportId;
  const themeLabels = {
    auto: t('wizard.summary.themeAuto'),
    cockpit: t('wizard.summary.themeCockpit'),
    ocean: t('wizard.summary.themeOcean'),
    aeroclub: t('wizard.summary.themeAeroclub'),
    daylight: t('wizard.summary.themeDaylight')
  };

  const items = [
    { label: t('wizard.summary.terrain'), value: `${wizData.airportId} — ${ap?.name || ''}` },
    { label: t('wizard.summary.metarStation'), value: metarStation },
    { label: t('wizard.summary.coordinates'), value: ap ? `${ap.lat}°, ${ap.lon}°` : '—' },
    { label: t('wizard.summary.fir'), value: ap?.fir ? `${ap.fir} (${ap.firName})` : '—' },
    { label: t('wizard.summary.runways'), value: wizData.runways.map(r => r.name).join(', ') || t('wizard.summary.none') },
    { label: t('wizard.summary.club'), value: wizData.branding.clubName || '—' },
    { label: t('wizard.summary.theme'), value: themeLabels[wizData.themeName] || wizData.themeName },
    { label: t('wizard.summary.license'), value: wizData.license.mode === 'full' ? `<span class="status-badge status-valid">${t('wizard.summary.active')}</span>` : `<span class="status-badge status-demo">${t('wizard.summary.demo')}</span>` }
  ];

  grid.innerHTML = items.map(item => `
    <div class="summary-item">
      <div class="summary-label">${item.label}</div>
      <div class="summary-value">${item.value}</div>
    </div>
  `).join('');
}

// ============================================================
// ASSEMBLAGE CONFIG & FINALISATION
// ============================================================

async function finishWizard() {
  const ap = wizData.airport;
  if (!ap) return;

  const metarStation = ap.metarStation || wizData.airportId;
  const isUlm = ap.type === 'ulm';

  // Hash du mot de passe admin (si fourni)
  let passwordHash = '';
  if (wizData.adminPassword) {
    passwordHash = await platform.hashPassword(wizData.adminPassword);
  }

  // Construire la config complète
  const config = {
    language: wizData.language,
    admin: {
      passwordHash,
      setupComplete: true
    },
    license: {
      key: wizData.license.key,
      mode: wizData.license.mode,
      lastCheck: wizData.license.mode === 'full' ? new Date().toISOString() : null,
      expiresAt: wizData.license.expiresAt || null
    },
    station: {
      icao: metarStation,
      displayName: `${metarStation} — ${ap.name}`,
      lat: ap.lat,
      lon: ap.lon,
      firs: ap.fir ? [ap.fir] : [],
      firName: ap.firName || '',
      sigmetRegion: 'eur'
    },
    runways: wizData.runways.map(r => ({ name: r.name, heading: r.heading })),
    thresholds: {
      profile: 'easa',
      vfr: { visibility: 5000, ceiling: 1500 },
      vfrSpecial: { visibility: 1500, ceiling: 600 },
      wind: { crosswindDanger: 25, crosswindWarning: 17, tailwindDanger: 11, tailwindWarning: 6 },
      fog: { danger: 1, warning: 2, watch: 4 },
      metarAge: { danger: 60, warning: 45 },
      sunsetWarning: { showMinutes: 60, criticalMinutes: 15, nightBannerMinutes: -10 }
    },
    units: { pressure: 'hPa', visibility: 'metric', temperature: 'C', wind: 'kt' },
    aeroNight: { morningOffsetMin: -30, eveningOffsetMin: 30 },
    apiKeys: { openWeatherMap: '' },
    maps: {
      provider: 'owm',
      rotationSeconds: 20,
      basemapBrightnessDay: 52,
      basemapBrightnessNight: 37,
      center: [ap.lat, ap.lon],
      zoom: 7,
      offsetLat: 0,
      offsetLon: 0,
      layers: [
        { id: 'clouds_new', label: 'NUAGES', enabled: true, duration: 20 },
        { id: 'precipitation_new', label: 'PRÉCIPITATIONS', enabled: true, duration: 20 },
        { id: 'pressure_new', label: 'PRESSION', enabled: true, duration: 20 },
        { id: 'wind_new', label: 'VENT', enabled: true, duration: 20 },
        { id: 'temp_new', label: 'TEMPÉRATURE', enabled: true, duration: 20 },
        { id: 'snow_new', label: 'NEIGE', enabled: false, duration: 20 },
        { id: 'gusts', label: 'RAFALES', enabled: false, duration: 20 },
        { id: 'dewpoint', label: 'POINT DE ROSÉE', enabled: false, duration: 20 },
        { id: 'cape', label: 'CAPE', enabled: false, duration: 20 },
        { id: 'pbl', label: 'COUCHE LIMITE', enabled: false, duration: 20 },
        { id: 'uv', label: 'INDICE UV', enabled: false, duration: 20, dayOnly: true },
        { id: 'wind_altitude', label: 'VENT EN ALTITUDE', enabled: false, duration: 20 }
      ]
    },
    kiosk: { enabled: false, displayIndex: 0 },
    layout: 'full',
    screens: [{ displayIndex: 0, view: 'full' }],
    fleet: {
      enabled: false,
      source: 'manual',
      durationSeconds: 15,
      showHours: true,
      apiEndpoint: '',
      apiKey: ''
    },
    refresh: { dataIntervalMs: 600000, sunIntervalMs: 3600000 },
    branding: {
      appTitle: wizData.branding.appTitle || 'AEROKIOSK',
      logoDay: wizData.branding.logoDay || '',
      logoNight: wizData.branding.logoNight || '',
      clubName: wizData.branding.clubName || ''
    },
    sections: {
      sunTimes: true, conditions: true, fogAlert: true, runwayComponents: true,
      preferredRunway: true, metar: true, taf: true, sigmet: true,
      flightCategory: true, sunsetWarning: true
    },
    tafDisplay: 'both',
    themeName: wizData.themeName,
    themeAuto: { day: 'daylight', night: 'cockpit' },
    theme: {
      bg: '#0a0e14', panel: '#111820', border: '#1e2a36',
      text: '#d4dce6', textDim: '#6b7f94', accent: '#00d4ff',
      vfr: '#22c55e', mvfr: '#3b82f6', ifr: '#ef4444',
      lifr: '#d946ef', warn: '#f59e0b',
      headerDay: '#111d28', headerNight: '#0d0a14'
    },
    themes: {
      cockpit: {
        bg: '#0a0e14', panel: '#111820', border: '#1e2a36',
        text: '#d4dce6', textDim: '#6b7f94', accent: '#00d4ff',
        vfr: '#22c55e', mvfr: '#3b82f6', ifr: '#ef4444',
        lifr: '#d946ef', warn: '#f59e0b',
        headerDay: '#111d28', headerNight: '#0d0a14'
      },
      ocean: {
        bg: '#0b1622', panel: '#122233', border: '#1a3350',
        text: '#c8ddf0', textDim: '#5a7fa0', accent: '#4fc3f7',
        vfr: '#66bb6a', mvfr: '#42a5f5', ifr: '#ef5350',
        lifr: '#ab47bc', warn: '#ffa726',
        headerDay: '#0f2035', headerNight: '#080e18'
      },
      aeroclub: {
        bg: '#1a1a2e', panel: '#16213e', border: '#0f3460',
        text: '#e0e0e0', textDim: '#7f8fa6', accent: '#e94560',
        vfr: '#4ecca3', mvfr: '#3b82f6', ifr: '#ff6b6b',
        lifr: '#c084fc', warn: '#ffd93d',
        headerDay: '#1a1a3e', headerNight: '#0e0e1a'
      },
      daylight: {
        bg: '#f0f2f5', panel: '#ffffff', border: '#d1d5db',
        text: '#1f2937', textDim: '#6b7280', accent: '#2563eb',
        vfr: '#16a34a', mvfr: '#2563eb', ifr: '#dc2626',
        lifr: '#9333ea', warn: '#d97706',
        headerDay: '#e5e7eb', headerNight: '#374151'
      }
    }
  };

  // Si c'est une base ULM, stocker aussi les coords de la base (pas celles du METAR)
  if (isUlm) {
    config.station.baseLat = ap.lat;
    config.station.baseLon = ap.lon;
    config.station.baseName = `${wizData.airportId} — ${ap.name}`;
  }

  // Sauvegarder la config
  const result = await platform.saveConfig(config);
  if (!result.success) {
    alert(t('wizard.saveError') + ' ' + (result.errors || []).join(', '));
    return;
  }

  // Basculer vers le dashboard
  await platform.wizardComplete();
}

// ============================================================
// BOUTON "MODE DÉMO" (skip licence)
// ============================================================

function skipLicense() {
  wizData.license = { key: '', mode: 'demo' };
  document.getElementById('licenseKey').value = '';
  document.getElementById('licenseError').textContent = '';
  document.getElementById('licenseStatus').innerHTML = '<span class="status-badge status-demo">' + t('wizard.summary.demo') + '</span>';
  goToStep(2);
}

// ============================================================
// INIT — Quand la page se charge
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Initialiser i18n (français par défaut au premier lancement)
  var lang = 'fr';
  try {
    if (platform) {
      var cfg = await platform.getConfig();
      if (cfg && cfg.language) lang = cfg.language;
    }
  } catch (e) { /* premier lancement, pas de config */ }
  await initI18n(lang);
  applyI18n();

  // Navigation
  document.getElementById('btnNext').addEventListener('click', nextStep);
  document.getElementById('btnPrev').addEventListener('click', prevStep);
  document.getElementById('btnSkipLicense').addEventListener('click', skipLicense);

  // Initialiser chaque étape
  initLangStep();
  initLicenseStep();
  initAirportSearch();
  initRunwayStep();
  initCustomStep();

  // Observer le changement d'étape pour pré-remplir les données
  const observer = new MutationObserver(() => {
    // Quand on arrive sur l'étape pistes, afficher les pistes de l'aérodrome sélectionné
    if (document.getElementById('step-3').classList.contains('active')) {
      renderRunways();
      const count = wizData.runways.length;
      document.getElementById('runwaySubtitle').textContent = count > 0
        ? t('wizard.runways.detected', {count: count, id: wizData.airportId})
        : t('wizard.runways.noneFound');
    }
    // Quand on arrive sur l'étape perso, pré-remplir
    if (document.getElementById('step-4').classList.contains('active')) {
      prefillCustomStep();
    }
  });

  document.querySelectorAll('.wizard-step').forEach(step => {
    observer.observe(step, { attributes: true, attributeFilter: ['class'] });
  });

  // Démarrer à l'étape 0
  goToStep(0);
});
