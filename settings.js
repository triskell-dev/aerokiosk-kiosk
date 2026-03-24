/**
 * settings.js — Logique du panneau Settings AeroKiosk
 *
 * Chargé dynamiquement par index.html quand l'admin clique sur le logo.
 * Gère les 9 onglets, la sauvegarde, la preview en direct, etc.
 */

// ============================================================
// STATE
// ============================================================

let settingsConfig = null;   // Copie de travail de la config (modifiable)
let originalConfig = null;   // Copie originale (pour annuler)
let settingsLoaded = false;

// ============================================================
// OUVERTURE / FERMETURE
// ============================================================

async function openSettings() {
  // Charger le CSS en amont (nécessaire pour le modal mot de passe)
  if (!document.querySelector('link[href="settings.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'settings.css';
    document.head.appendChild(link);
  }

  // Vérifier le mot de passe si défini
  const cfg = await platform.getConfig();
  if (cfg.admin && cfg.admin.passwordHash) {
    const ok = await showPasswordModal();
    if (!ok) return;
  }

  // Charger le HTML du panneau si pas déjà fait
  if (!settingsLoaded) {
    await loadSettingsHTML();
    settingsLoaded = true;
  }

  // Copie de travail de la config
  originalConfig = JSON.parse(JSON.stringify(cfg));
  settingsConfig = JSON.parse(JSON.stringify(cfg));

  // Remplir tous les champs
  populateAllTabs();

  // Ouvrir le panneau
  document.getElementById('settingsBackdrop').classList.add('open');
  document.getElementById('settingsPanel').classList.add('open');
}

function closeSettings(restoreOriginal) {
  document.getElementById('settingsBackdrop').classList.remove('open');
  document.getElementById('settingsPanel').classList.remove('open');

  // Si annulation, restaurer le thème original
  if (restoreOriginal && originalConfig && typeof applyTheme === 'function') {
    const theme = originalConfig.theme;
    if (theme) applyTheme(theme);
  }
}

// ============================================================
// CHARGEMENT HTML
// ============================================================

async function loadSettingsHTML() {
  const container = document.getElementById('settingsContainer');
  const resp = await fetch('settings.html');
  const html = await resp.text();
  container.innerHTML = html;
  applyI18n(container);

  // Charger le CSS si pas déjà fait
  if (!document.querySelector('link[href="settings.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'settings.css';
    document.head.appendChild(link);
  }

  // Event listeners
  initSettingsEvents();
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function initSettingsEvents() {
  // Fermer
  document.getElementById('btnSettingsClose').addEventListener('click', () => closeSettings(true));
  document.getElementById('btnSettingsCancel').addEventListener('click', () => closeSettings(true));
  document.getElementById('settingsBackdrop').addEventListener('click', () => closeSettings(true));

  // Sauvegarder
  document.getElementById('btnSettingsSave').addEventListener('click', saveSettings);

  // Tabs
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Station search
  initStationSearch();

  // Pistes
  document.getElementById('sBtnAddRunway').addEventListener('click', addSettingsRunway);

  // Seuils — profil dropdown
  document.getElementById('sThresholdProfile').addEventListener('change', () => updateThresholdFieldsState());

  // Cartes — sliders avec affichage valeur en direct
  bindSlider('sMapZoom', 'sMapZoomVal');
  bindSlider('sMapOffLat', 'sMapOffLatVal');
  bindSlider('sMapOffLon', 'sMapOffLonVal');
  bindSlider('sRotation', 'sRotationVal');
  bindSlider('sMapBrightnessDay', 'sMapBrightnessDayVal');
  bindSlider('sMapBrightnessNight', 'sMapBrightnessNightVal');
  bindSlider('sWeatherDark', 'sWeatherDarkVal');
  bindSlider('sWeatherLight', 'sWeatherLightVal');
  // Preview live de la luminosité (jour et nuit)
  function brightnessPreview(slider) {
    if (!slider) return;
    slider.addEventListener('input', function() {
      document.documentElement.style.setProperty('--basemap-brightness', this.value / 100);
      document.getElementById('settingsBackdrop').classList.add('preview-brightness');
      document.getElementById('settingsPanel').classList.add('preview-brightness');
      var clubOv = document.getElementById('clubOverlay');
      var fleetOv = document.getElementById('fleetOverlay');
      if (clubOv) clubOv.classList.remove('visible');
      if (fleetOv) fleetOv.classList.remove('visible');
      if (typeof rotationSlots !== 'undefined') {
        var weatherSlot = rotationSlots.find(function(s) { return s.type === 'weather' || s.type === 'openmeteo-velocity' || s.type === 'openmeteo-scalar'; });
        if (weatherSlot && typeof dispatchSlot === 'function') dispatchSlot(weatherSlot);
      }
    });
    slider.addEventListener('change', function() {
      document.getElementById('settingsBackdrop').classList.remove('preview-brightness');
      document.getElementById('settingsPanel').classList.remove('preview-brightness');
    });
  }
  brightnessPreview(document.getElementById('sMapBrightnessDay'));
  brightnessPreview(document.getElementById('sMapBrightnessNight'));

  // Trafic aérien — sliders + toggle visibilité
  bindSlider('sTrafficRefresh', 'sTrafficRefreshVal');
  bindSlider('sTrafficRadius', 'sTrafficRadiusVal');
  bindSlider('sTrafficAlt', 'sTrafficAltVal');
  document.getElementById('sTrafficEnabled').addEventListener('change', () => {
    document.getElementById('trafficSettingsGroup').style.display =
      document.getElementById('sTrafficEnabled').checked ? '' : 'none';
  });
  document.getElementById('sTrafficWatchlist').addEventListener('input', () => {
    const hasItems = document.getElementById('sTrafficWatchlist').value.trim().length > 0;
    document.getElementById('watchModeGroup').style.display = hasItems ? '' : 'none';
  });

  // OGN — toggle visibilité + slider
  bindSlider('sOgnRadius', 'sOgnRadiusVal');
  document.getElementById('sOgnEnabled').addEventListener('change', () => {
    document.getElementById('ognSettingsGroup').style.display =
      document.getElementById('sOgnEnabled').checked ? '' : 'none';
  });

  // FR24 — toggle visibilité
  document.getElementById('sFr24Enabled').addEventListener('change', () => {
    document.getElementById('fr24SettingsGroup').style.display =
      document.getElementById('sFr24Enabled').checked ? '' : 'none';
  });

  // Thème — mode auto/fixe
  document.querySelectorAll('input[name="sThemeMode"]').forEach(r => {
    r.addEventListener('change', () => {
      const isAuto = r.value === 'auto' && r.checked;
      document.getElementById('sThemeAutoConfig').style.display = isAuto ? 'block' : 'none';
      document.getElementById('sThemeFixedConfig').style.display = isAuto ? 'none' : 'block';
    });
  });

  // Branding — logo pickers
  document.getElementById('sBtnLogoDayPick').addEventListener('click', async () => {
    const result = await platform.selectFile({ title: t('settings.branding.chooseLogoDay') });
    if (result.canceled) return;
    const copy = await platform.copyLogo(result.path);
    if (copy.success) {
      settingsConfig.branding.logoDay = copy.fileName;
      const displayName = copy.fileName.length > 40 ? copy.fileName.split('/').pop() : copy.fileName;
      document.getElementById('sLogoDayName').textContent = displayName;
    }
  });

  document.getElementById('sBtnLogoNightPick').addEventListener('click', async () => {
    const result = await platform.selectFile({ title: t('settings.branding.chooseLogoNight') });
    if (result.canceled) return;
    const copy = await platform.copyLogo(result.path);
    if (copy.success) {
      settingsConfig.branding.logoNight = copy.fileName;
      const displayName = copy.fileName.length > 40 ? copy.fileName.split('/').pop() : copy.fileName;
      document.getElementById('sLogoNightName').textContent = displayName;
    }
  });

  // Licence
  document.getElementById('sBtnValidateLicense').addEventListener('click', validateSettingsLicense);

  // Licence input — auto-tirets
  document.getElementById('sLicenseKey').addEventListener('input', (e) => {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const clean = val.replace(/-/g, '');
    if (clean.length > 4) val = clean.match(/.{1,4}/g).join('-');
    e.target.value = val;
  });

  // Quitter l'application
  document.getElementById('sBtnQuitApp').addEventListener('click', async () => {
    if (confirm(t('settings.footer.confirmQuit'))) {
      await platform.quitApp();
    }
  });

  // Vérifier les mises à jour
  document.getElementById('sBtnCheckUpdate').addEventListener('click', async () => {
    const btn = document.getElementById('sBtnCheckUpdate');
    const res = document.getElementById('sUpdateResult');
    btn.disabled = true;
    btn.textContent = t('settings.app.checking');
    res.textContent = '';
    try {
      const result = await platform.checkForUpdate();
      if (result && result.ok) {
        res.innerHTML = '<span style="color:var(--wiz-accent);">' + t('settings.app.checkDone') + '</span>';
      } else {
        res.innerHTML = '<span style="color:var(--wiz-warn);">' + (result?.error || t('settings.app.checkError')) + '</span>';
      }
    } catch (e) {
      res.innerHTML = '<span style="color:var(--wiz-warn);">' + t('settings.app.checkError') + '</span>';
    }
    btn.disabled = false;
    btn.textContent = t('settings.app.checkUpdate');
  });

  // Changement de mot de passe
  document.getElementById('sBtnChangePassword').addEventListener('click', () => {
    const form = document.getElementById('passwordChangeForm');
    const btn = document.getElementById('sBtnChangePassword');
    form.style.display = '';
    btn.style.display = 'none';
    // Masquer le champ "ancien mot de passe" si aucun n'est défini
    const hasPassword = !!(settingsConfig.admin && settingsConfig.admin.passwordHash);
    document.getElementById('passwordOldGroup').style.display = hasPassword ? '' : 'none';
    document.getElementById('sPwdNew').focus();
  });

  document.getElementById('sBtnPwdCancel').addEventListener('click', () => {
    document.getElementById('passwordChangeForm').style.display = 'none';
    document.getElementById('sBtnChangePassword').style.display = '';
    document.getElementById('sPwdOld').value = '';
    document.getElementById('sPwdNew').value = '';
    document.getElementById('sPwdConfirm').value = '';
    document.getElementById('sPwdChangeError').textContent = '';
    document.getElementById('sPwdChangeSuccess').style.display = 'none';
  });

  document.getElementById('sBtnPwdSave').addEventListener('click', async () => {
    const errorEl = document.getElementById('sPwdChangeError');
    const successEl = document.getElementById('sPwdChangeSuccess');
    errorEl.textContent = '';
    successEl.style.display = 'none';

    const hasPassword = !!(settingsConfig.admin && settingsConfig.admin.passwordHash);
    const oldPwd = document.getElementById('sPwdOld').value;
    const newPwd = document.getElementById('sPwdNew').value;
    const confirmPwd = document.getElementById('sPwdConfirm').value;

    // Vérifier l'ancien mot de passe si existant
    if (hasPassword) {
      if (!oldPwd) { errorEl.textContent = t('settings.password.required'); return; }
      const ok = await platform.verifyPassword(oldPwd);
      if (!ok) { errorEl.textContent = t('settings.general.passwordOldIncorrect'); return; }
    }

    // Nouveau mot de passe peut être vide (= suppression)
    if (newPwd === '' && confirmPwd === '') {
      // Suppression du mot de passe
      settingsConfig.admin.passwordHash = '';
      updatePasswordStatus();
      document.getElementById('passwordChangeForm').style.display = 'none';
      document.getElementById('sBtnChangePassword').style.display = '';
      document.getElementById('sPwdOld').value = '';
      successEl.textContent = t('settings.general.passwordRemoved');
      successEl.style.display = '';
      setTimeout(() => { successEl.style.display = 'none'; }, 3000);
      return;
    }

    if (!newPwd) { errorEl.textContent = t('settings.general.passwordNewRequired'); return; }
    if (newPwd !== confirmPwd) { errorEl.textContent = t('settings.general.passwordMismatch'); return; }

    // Hasher et sauvegarder
    const hash = await platform.hashPassword(newPwd);
    settingsConfig.admin.passwordHash = hash;
    updatePasswordStatus();

    document.getElementById('passwordChangeForm').style.display = 'none';
    document.getElementById('sBtnChangePassword').style.display = '';
    document.getElementById('sPwdOld').value = '';
    document.getElementById('sPwdNew').value = '';
    document.getElementById('sPwdConfirm').value = '';

    const msg = hasPassword ? t('settings.general.passwordChanged') : t('settings.general.passwordSet');
    successEl.textContent = msg;
    successEl.style.display = '';
    setTimeout(() => { successEl.style.display = 'none'; }, 3000);
  });

  // Export / Import
  document.getElementById('sBtnExport').addEventListener('click', exportConfig);
  document.getElementById('sBtnImport').addEventListener('click', importConfig);

  // Test connexion
  document.getElementById('sBtnTestConn').addEventListener('click', testConnection);

  // Relancer wizard
  document.getElementById('btnRerunWizard').addEventListener('click', async () => {
    if (confirm(t('settings.station.confirmRerunWizard'))) {
      await platform.openWizard();
    }
  });

  // Affichage club — toggles + slider
  bindSlider('sClubDuration', 'sClubDurationVal');
  document.getElementById('sClubServerEnabled').addEventListener('change', () => {
    updateClubDisplayVisibility();
    updateClubAdminUrl();
  });
  document.getElementById('sClubServerPort').addEventListener('change', () => {
    updateClubAdminUrl();
  });

  // Flotte — toggles + sliders + modal
  bindSlider('sFleetDuration', 'sFleetDurationVal');
  bindSlider('sFleetStatusScroll', 'sFleetStatusScrollVal');
  bindSlider('sFleetOverlayScroll', 'sFleetOverlayScrollVal');
  document.getElementById('sFleetShowOverlay').addEventListener('change', updateFleetVisibility);
  document.getElementById('sFleetShowStatusBar').addEventListener('change', updateFleetVisibility);
  document.getElementById('sFleetSource').addEventListener('change', updateFleetVisibility);

  // Planification (salles) + connecteur GearUp — toggles + sliders + test
  bindSlider('sRoomsBrief', 'sRoomsBriefVal');
  bindSlider('sRoomsDebrief', 'sRoomsDebriefVal');
  bindSlider('sGearupPoll', 'sGearupPollVal');
  document.getElementById('sGearupEnabled').addEventListener('change', updateGearupVisibility);
  document.getElementById('sGearupApiSource').addEventListener('change', updateGearupVisibility);
  document.getElementById('btnTestGearUp').addEventListener('click', testGearUpConnection);
  document.getElementById('btnFleetManage').addEventListener('click', openFleetModal);
  document.getElementById('btnFleetModalClose').addEventListener('click', closeFleetModal);
  document.getElementById('fleetModalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFleetModal();
  });
  document.getElementById('btnFleetAdd').addEventListener('click', () => showFleetForm(null));
  document.getElementById('btnFleetFormCancel').addEventListener('click', showFleetList);
  document.getElementById('btnFleetFormSave').addEventListener('click', saveFleetItem);
  document.getElementById('btnSfMelAdd').addEventListener('click', addSfMelItem);
  document.querySelectorAll('input[name="sfStatus"]').forEach(r => {
    r.addEventListener('change', updateSfStatusSections);
  });

  // Multi-écran web
  const btnOpenWebScreen = document.getElementById('sBtnOpenWebScreen');
  if (btnOpenWebScreen) {
    btnOpenWebScreen.addEventListener('click', openWebScreen);
  }
}

// ============================================================
// TABS
// ============================================================

function switchTab(tabName) {
  document.querySelectorAll('.settings-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.settings-content').forEach(c =>
    c.classList.toggle('active', c.dataset.content === tabName));
}

// ============================================================
// REMPLISSAGE DES CHAMPS
// ============================================================

function populateAllTabs() {
  const c = settingsConfig;

  // Langue
  const langSelect = document.getElementById('sLanguage');
  langSelect.innerHTML = '';
  Object.entries(I18N_LANGUAGES).forEach(([code, info]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = info.nativeName;
    langSelect.appendChild(opt);
  });
  langSelect.value = c.language || 'fr';

  // Mot de passe admin — statut
  updatePasswordStatus();

  // Station
  document.getElementById('sStationSearch').value = c.station.icao + ' — ' + (c.station.displayName || '').replace(/^.*— /, '');
  document.getElementById('sDisplayName').value = c.station.displayName || '';
  document.getElementById('sLat').value = c.station.lat;
  document.getElementById('sLon').value = c.station.lon;
  document.getElementById('sFir').value = (c.station.firs || [])[0] || '';
  document.getElementById('sFirName').value = c.station.firName || '';
  document.getElementById('sSigmetRegion').value = c.station.sigmetRegion || 'eur';

  // Pistes
  renderSettingsRunways();

  // Seuils
  let profile = c.thresholds?.profile || 'easa';
  if (profile === 'dgac') profile = 'easa';
  document.getElementById('sThresholdProfile').value = profile;
  document.getElementById('sThrVfrVis').value = c.thresholds?.vfr?.visibility ?? 5000;
  document.getElementById('sThrVfrCeil').value = c.thresholds?.vfr?.ceiling ?? 1500;
  document.getElementById('sThrSpecVis').value = c.thresholds?.vfrSpecial?.visibility ?? 1500;
  document.getElementById('sThrSpecCeil').value = c.thresholds?.vfrSpecial?.ceiling ?? 600;
  document.getElementById('sThrGreenVis').value = c.thresholds?.green?.visibility ?? 9999;
  document.getElementById('sThrGreenCeil').value = c.thresholds?.green?.ceiling ?? 5000;
  document.getElementById('sThrXwindDgr').value = c.thresholds?.wind?.crosswindDanger ?? 25;
  document.getElementById('sThrXwindWrn').value = c.thresholds?.wind?.crosswindWarning ?? 17;
  document.getElementById('sThrTailDgr').value = c.thresholds?.wind?.tailwindDanger ?? 11;
  document.getElementById('sThrTailWrn').value = c.thresholds?.wind?.tailwindWarning ?? 6;
  document.getElementById('sThrFogDgr').value = c.thresholds?.fog?.danger ?? 1;
  document.getElementById('sThrFogWrn').value = c.thresholds?.fog?.warning ?? 2;
  document.getElementById('sThrFogWatch').value = c.thresholds?.fog?.watch ?? 4;
  document.getElementById('sThrMetarDgr').value = c.thresholds?.metarAge?.danger ?? 60;
  document.getElementById('sThrMetarWrn').value = c.thresholds?.metarAge?.warning ?? 45;
  document.getElementById('sThrSunsetShow').value = c.thresholds?.sunsetWarning?.showMinutes ?? 30;
  document.getElementById('sThrSunsetCrit').value = c.thresholds?.sunsetWarning?.criticalMinutes ?? 15;
  updateThresholdFieldsState();

  // Unités
  const units = c.units || {};
  document.getElementById('sUnitPressure').value = units.pressure || 'hPa';
  document.getElementById('sUnitVisibility').value = units.visibility || 'metric';
  document.getElementById('sUnitTemperature').value = units.temperature || 'C';
  document.getElementById('sUnitWind').value = units.wind || 'kt';

  // Cartes
  document.getElementById('sMapBasemap').value = c.maps?.basemap || 'dark';
  const bmAuto = document.getElementById('sMapBasemapAuto');
  bmAuto.checked = !!c.maps?.basemapAuto;
  document.getElementById('sMapBasemapDay').value = c.maps?.basemapDay || 'voyager';
  document.getElementById('sMapBasemapNight').value = c.maps?.basemapNight || 'dark';
  document.getElementById('sBasemapFixedGroup').style.display = bmAuto.checked ? 'none' : '';
  document.getElementById('basemapAutoGroup').style.display = bmAuto.checked ? '' : 'none';
  bmAuto.addEventListener('change', () => {
    document.getElementById('sBasemapFixedGroup').style.display = bmAuto.checked ? 'none' : '';
    document.getElementById('basemapAutoGroup').style.display = bmAuto.checked ? '' : 'none';
  });
  document.getElementById('sMapAirports').value = c.maps?.airportDisplay || 'icao';
  setSlider('sMapZoom', 'sMapZoomVal', c.maps?.zoom ?? 7);
  setSlider('sMapOffLat', 'sMapOffLatVal', c.maps?.offsetLat ?? 0);
  setSlider('sMapOffLon', 'sMapOffLonVal', c.maps?.offsetLon ?? 0);
  setSlider('sRotation', 'sRotationVal', c.maps?.rotationSeconds ?? 20);
  setSlider('sMapBrightnessDay', 'sMapBrightnessDayVal', c.maps?.basemapBrightnessDay ?? c.maps?.basemapBrightness ?? 52);
  setSlider('sMapBrightnessNight', 'sMapBrightnessNightVal', c.maps?.basemapBrightnessNight ?? 37);
  setSlider('sWeatherDark', 'sWeatherDarkVal', c.maps?.weatherIntensityDark ?? 250);
  setSlider('sWeatherLight', 'sWeatherLightVal', c.maps?.weatherIntensityLight ?? 90);
  renderMapLayers();

  // Trafic aérien
  const trafficCfg = c.traffic || {};
  document.getElementById('sTrafficEnabled').checked = trafficCfg.enabled !== false;
  document.getElementById('sTrafficDetail').value = trafficCfg.detail || 'callsign';
  setSlider('sTrafficRefresh', 'sTrafficRefreshVal', trafficCfg.refreshSeconds ?? 10);
  setSlider('sTrafficRadius', 'sTrafficRadiusVal', trafficCfg.radiusNm ?? 135);
  setSlider('sTrafficAlt', 'sTrafficAltVal', trafficCfg.maxAltitude ?? 10000);
  document.getElementById('sTrafficWatchlist').value = (trafficCfg.watchlist || []).join(', ');
  document.getElementById('sTrafficWatchMode').value = trafficCfg.watchMode || 'highlight';
  document.getElementById('watchModeGroup').style.display =
    (trafficCfg.watchlist || []).length > 0 ? '' : 'none';
  document.getElementById('trafficSettingsGroup').style.display =
    trafficCfg.enabled !== false ? '' : 'none';

  // OGN / FLARM
  document.getElementById('sOgnEnabled').checked = trafficCfg.ognEnabled === true;
  setSlider('sOgnRadius', 'sOgnRadiusVal', trafficCfg.ognRadiusKm ?? 250);
  document.getElementById('ognSettingsGroup').style.display =
    trafficCfg.ognEnabled === true ? '' : 'none';

  // FlightRadar24
  document.getElementById('sFr24Enabled').checked = trafficCfg.fr24Enabled === true;
  document.getElementById('sFr24ApiKey').value = trafficCfg.fr24ApiKey || '';
  document.getElementById('fr24SettingsGroup').style.display =
    trafficCfg.fr24Enabled === true ? '' : 'none';

  // Sections
  document.getElementById('sActivityProfile').value = c.activityProfile || 'standard';
  renderSectionToggles();
  document.getElementById('sTafDisplay').value = c.tafDisplay || 'both';
  document.getElementById('sSidebarPosition').value = c.sidebarPosition || 'right';

  // Kiosque
  document.getElementById('sKioskEnabled').checked = c.kiosk?.enabled === true;

  // Multi-écran
  populateScreenList();

  // Thème
  const isAuto = c.themeName === 'auto';
  document.querySelector(`input[name="sThemeMode"][value="${isAuto ? 'auto' : 'fixed'}"]`).checked = true;
  document.getElementById('sThemeAutoConfig').style.display = isAuto ? 'block' : 'none';
  document.getElementById('sThemeFixedConfig').style.display = isAuto ? 'none' : 'block';
  renderThemeGrids();

  // Branding
  document.getElementById('sAppTitle').value = c.branding?.appTitle || '';
  document.getElementById('sClubName').value = c.branding?.clubName || '';
  const logoDay = c.branding?.logoDay || '—';
  const logoNight = c.branding?.logoNight || '—';
  document.getElementById('sLogoDayName').textContent = logoDay.length > 40 ? logoDay.split('/').pop() : logoDay;
  document.getElementById('sLogoNightName').textContent = logoNight.length > 40 ? logoNight.split('/').pop() : logoNight;

  // Affichage club
  populateClubDisplay();

  // Flotte
  populateFleet();

  // Planification (salles)
  populateRooms();

  // Version de l'app
  if (platform?.getAppVersion) {
    platform.getAppVersion().then(v => {
      document.getElementById('sAppVersion').textContent = 'v' + (v || '?');
    }).catch(() => {});
  }
  // Badge update dans settings
  if (platform?.getUpdateStatus) {
    platform.getUpdateStatus().then(s => {
      const badge = document.getElementById('sUpdateBadge');
      if (badge && s && s.status === 'downloaded') {
        badge.textContent = t('settings.app.updateReady') + (s.version ? ' v' + s.version : '');
        badge.style.display = '';
      }
    }).catch(() => {});
  }

  // Licence
  const key = c.license?.key || '';
  const mode = c.license?.mode || 'demo';
  document.getElementById('sLicenseKeyDisplay').textContent = key ? maskKey(key) : '—';
  document.getElementById('sLicenseStatusBadge').innerHTML = mode === 'full'
    ? '<span class="status-badge status-valid">' + t('settings.license.active') + '</span>'
    : '<span class="status-badge status-demo">' + t('settings.license.demo') + '</span>';
  const buyBox = document.getElementById('sBuyLicenseBox');
  if (buyBox) buyBox.style.display = mode === 'full' ? 'none' : 'block';

  // Expiration et dernière vérification
  const expiresAt = c.license?.expiresAt;
  const lastCheck = c.license?.lastCheck;
  document.getElementById('sLicenseExpires').textContent = expiresAt
    ? new Date(expiresAt).toLocaleDateString(getDateLocale()) : '—';
  document.getElementById('sLicenseLastCheck').textContent = lastCheck
    ? new Date(lastCheck).toLocaleDateString(getDateLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  // Liste des appareils
  renderDeviceList();
}

// ============================================================
// HELPERS
// ============================================================

function bindSlider(sliderId, valueId) {
  const slider = document.getElementById(sliderId);
  const val = document.getElementById(valueId);
  slider.addEventListener('input', () => { val.textContent = slider.value; });
}

function setSlider(sliderId, valueId, value) {
  document.getElementById(sliderId).value = value;
  document.getElementById(valueId).textContent = value;
}

let _availableDisplays = [];

async function populateScreenList() {
  try {
    _availableDisplays = await platform.getDisplays();
  } catch (e) {
    _availableDisplays = [{ index: 0, label: '1920×1080 (principal)', primary: true }];
  }
  const screens = settingsConfig.screens || [{ displayIndex: 0 }];

  // Sélecteur écran principal (screens[0])
  const mainSel = document.getElementById('sMainDisplay');
  if (mainSel) {
    mainSel.innerHTML = '';
    _availableDisplays.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.index;
      opt.textContent = `${d.index + 1} — ${d.label}`;
      if (d.index === (screens[0]?.displayIndex || 0)) opt.selected = true;
      mainSel.appendChild(opt);
    });
  }

  // ── Toggles écran principal (flotte, club, couches) ──
  const mainToggles = document.getElementById('sMainScreenToggles');
  const mainLayers = document.getElementById('sMainScreenLayers');
  if (mainToggles) {
    mainToggles.innerHTML = '';
    const scr0 = screens[0] || {};
    function makeMainToggle(labelText, checked, cls) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.className = cls;
      const span = document.createElement('span');
      span.textContent = labelText;
      wrap.appendChild(cb);
      wrap.appendChild(span);
      return { wrap, cb };
    }
    const fleetChecked0 = scr0.fleet !== undefined ? scr0.fleet : (settingsConfig.fleet?.showOverlay !== undefined ? settingsConfig.fleet.showOverlay : (settingsConfig.fleet?.enabled || false));
    const clubChecked0 = scr0.clubDisplay !== undefined ? scr0.clubDisplay : false;
    const fleetTgl0 = makeMainToggle(t('settings.screens.fleet') || 'Flotte', fleetChecked0, 'main-screen-fleet');
    const clubTgl0 = makeMainToggle(t('settings.screens.clubDisplay') || 'Contenu club', clubChecked0, 'main-screen-club');
    mainToggles.appendChild(fleetTgl0.wrap);
    mainToggles.appendChild(clubTgl0.wrap);
  }
  // Écrans supplémentaires (screens[1+])
  const container = document.getElementById('sScreenList');
  container.innerHTML = '';
  screens.slice(1).forEach((scr, i) => addScreenRow(container, scr, i + 1));

  document.getElementById('sBtnAddScreen').onclick = () => {
    const mainIdx = parseInt(mainSel?.value || 0);
    const usedIdxs = [mainIdx, ...getScreenRows().map(r => parseInt(r.querySelector('.screen-display').value))];
    const freeDisplay = _availableDisplays.find(d => !usedIdxs.includes(d.index));
    const newIdx = freeDisplay ? freeDisplay.index : 0;
    addScreenRow(container, { displayIndex: newIdx, showMap: true, showSidebar: true }, container.children.length + 1);
  };

  // En mode web, populer la section multi-écran web
  if (isWebMode()) {
    populateWebScreens();
  }
}

function renderScreenLayers(container, scr, classPrefix) {
  const globalLayers = settingsConfig.maps?.layers || [];
  if (globalLayers.length === 0) return;
  const scrLayers = scr.layers || {};
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:rgba(255,255,255,0.03);';
  const title = document.createElement('div');
  title.textContent = t('settings.screens.layersTitle') || 'Couches météo';
  title.style.cssText = 'font-size:11px; color:var(--text-dim,#999); margin-bottom:6px; font-weight:600;';
  wrap.appendChild(title);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:2px 12px;';
  globalLayers.forEach(layer => {
    const checked = scrLayers[layer.id] !== undefined ? scrLayers[layer.id] : layer.enabled;
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:11px; cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.className = classPrefix;
    cb.dataset.layerId = layer.id;
    const span = document.createElement('span');
    span.textContent = t('mapLayers.' + layer.id) || layer.id;
    lbl.appendChild(cb);
    lbl.appendChild(span);
    grid.appendChild(lbl);
  });
  wrap.appendChild(grid);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function addScreenRow(container, scr, idx) {
  const row = document.createElement('div');
  row.className = 'screen-row';
  row.style.cssText = 'padding:10px; border:1px solid var(--border); border-radius:6px; background:var(--panel);';

  // ── Ligne 1 : sélecteur écran + bouton supprimer ──
  const line1 = document.createElement('div');
  line1.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px;';

  const displaySel = document.createElement('select');
  displaySel.className = 'form-input screen-display';
  displaySel.style.flex = '1';
  _availableDisplays.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.index;
    opt.textContent = `${d.index + 1} — ${d.label}`;
    if (d.index === scr.displayIndex) opt.selected = true;
    displaySel.appendChild(opt);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-ghost btn-small';
  removeBtn.textContent = '✕';
  removeBtn.title = t('settings.screens.remove') || 'Supprimer';
  removeBtn.onclick = () => {
    row.remove();
  };

  line1.appendChild(displaySel);
  line1.appendChild(removeBtn);

  // ── Ligne 2 : toggles carte / planning / sidebar / flotte / club ──
  const line2 = document.createElement('div');
  line2.style.cssText = 'display:flex; gap:16px; align-items:center; flex-wrap:wrap;';

  function makeToggle(labelText, checked, cls) {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.className = cls;
    const span = document.createElement('span');
    span.textContent = labelText;
    wrap.appendChild(cb);
    wrap.appendChild(span);
    return { wrap, cb };
  }

  const globalSections = settingsConfig.sections || {};
  const mapChecked = scr.showMap !== false;
  const planningChecked = scr.showPlanning === true;
  const sidebarChecked = scr.showSidebar !== false;
  const fleetChecked = scr.fleet !== undefined ? scr.fleet : (settingsConfig.fleet?.enabled !== false);
  const clubChecked = scr.clubDisplay !== undefined ? scr.clubDisplay : false;

  const mapTgl = makeToggle(t('settings.screens.showMap') || 'Carte', mapChecked, 'screen-map');
  const planningTgl = makeToggle(t('settings.screens.showPlanning') || 'Planning', planningChecked, 'screen-planning');
  const sidebarTgl = makeToggle(t('settings.screens.sidebar') || 'Sidebar', sidebarChecked, 'screen-sidebar');
  const fleetTgl = makeToggle(t('settings.screens.fleet') || 'Flotte', fleetChecked, 'screen-fleet');
  const clubTgl = makeToggle(t('settings.screens.clubDisplay') || 'Contenu club', clubChecked, 'screen-club');

  line2.appendChild(mapTgl.wrap);
  line2.appendChild(planningTgl.wrap);
  line2.appendChild(sidebarTgl.wrap);
  line2.appendChild(fleetTgl.wrap);
  line2.appendChild(clubTgl.wrap);

  // ── Ligne 3 : sections sidebar (visible si sidebar activée) ──
  const sectionsWrap = document.createElement('div');
  sectionsWrap.className = 'screen-sections-wrap';
  sectionsWrap.style.cssText = 'margin-top:8px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:rgba(255,255,255,0.03);' + (sidebarChecked ? '' : ' display:none;');

  const sectionsTitle = document.createElement('div');
  sectionsTitle.textContent = t('settings.screens.sectionsTitle') || 'Sections sidebar';
  sectionsTitle.style.cssText = 'font-size:11px; color:var(--text-dim); margin-bottom:6px; font-weight:600;';
  sectionsWrap.appendChild(sectionsTitle);

  const sectionsGrid = document.createElement('div');
  sectionsGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:2px 12px;';

  const effectiveSections = scr.sections || globalSections;
  const sectionLabels = getSectionLabels();
  Object.entries(sectionLabels).forEach(([key, label]) => {
    if (!label) return;
    const stgl = makeToggle(label, effectiveSections[key] !== false, 'screen-section');
    stgl.cb.dataset.screenSection = key;
    stgl.wrap.style.fontSize = '11px';
    sectionsGrid.appendChild(stgl.wrap);
  });

  sectionsWrap.appendChild(sectionsGrid);

  // Toggle sidebar → afficher/masquer les sections
  sidebarTgl.cb.addEventListener('change', () => {
    sectionsWrap.style.display = sidebarTgl.cb.checked ? '' : 'none';
  });

  // ── Ligne 4 : couches météo (visible si carte activée) ──
  const layersWrap = document.createElement('div');
  layersWrap.className = 'screen-layers-wrap';
  layersWrap.style.cssText = mapChecked ? 'margin-top:8px;' : 'margin-top:8px; display:none;';
  renderScreenLayers(layersWrap, scr, 'screen-layer');
  mapTgl.cb.addEventListener('change', () => {
    layersWrap.style.display = mapTgl.cb.checked ? '' : 'none';
  });

  row.appendChild(line1);
  row.appendChild(line2);
  row.appendChild(sectionsWrap);
  row.appendChild(layersWrap);
  container.appendChild(row);
}

function getScreenRows() {
  return Array.from(document.getElementById('sScreenList').children);
}

function collectScreenLayers(container, classPrefix) {
  const globalLayers = settingsConfig.maps?.layers || [];
  const layers = {};
  let hasDiff = false;
  container.querySelectorAll('.' + classPrefix + '[data-layer-id]').forEach(cb => {
    const id = cb.dataset.layerId;
    layers[id] = cb.checked;
    const globalLayer = globalLayers.find(l => l.id === id);
    if (globalLayer && cb.checked !== !!globalLayer.enabled) hasDiff = true;
  });
  return hasDiff ? layers : null;
}

function collectScreens() {
  const globalSections = settingsConfig.sections || {};

  // screens[0] = écran principal (displayIndex + fleet + clubDisplay + layers)
  const mainSel = document.getElementById('sMainDisplay');
  const mainScreen = { displayIndex: parseInt(mainSel?.value || 0) };
  const mainToggles = document.getElementById('sMainScreenToggles');
  if (mainToggles) {
    const fleetCb = mainToggles.querySelector('.main-screen-fleet');
    const clubCb = mainToggles.querySelector('.main-screen-club');
    if (fleetCb) mainScreen.fleet = fleetCb.checked;
    if (clubCb) mainScreen.clubDisplay = clubCb.checked;
  }
  // screens[1+] = écrans supplémentaires
  const additionalScreens = getScreenRows().map(row => {
    const displayIndex = parseInt(row.querySelector('.screen-display').value) || 0;
    const showMap = row.querySelector('.screen-map').checked;
    const showPlanning = row.querySelector('.screen-planning').checked;
    const showSidebar = row.querySelector('.screen-sidebar').checked;
    const fleet = row.querySelector('.screen-fleet').checked;
    const clubDisplay = row.querySelector('.screen-club').checked;

    const result = { displayIndex, showMap, showSidebar, fleet, clubDisplay };

    // Sauver showPlanning seulement si activé
    if (showPlanning) result.showPlanning = true;

    // Sauver sections seulement si différent du global (héritage)
    const sections = {};
    let hasDiff = false;
    row.querySelectorAll('[data-screen-section]').forEach(cb => {
      const key = cb.dataset.screenSection;
      sections[key] = cb.checked;
      if (cb.checked !== (globalSections[key] !== false)) hasDiff = true;
    });
    if (hasDiff) result.sections = sections;

    // Sauver layers seulement si différent du global
    const layers = collectScreenLayers(row, 'screen-layer');
    if (layers) result.layers = layers;

    return result;
  });

  return [mainScreen, ...additionalScreens];
}

function maskKey(key) {
  if (!key || key.length < 8) return key;
  return key.substring(0, 9) + '****-****';
}

// ============================================================
// STATION SEARCH
// ============================================================

let sSearchTimeout = null;

function initStationSearch() {
  const input = document.getElementById('sStationSearch');
  const resultsEl = document.getElementById('sStationResults');

  input.addEventListener('input', () => {
    clearTimeout(sSearchTimeout);
    const q = input.value.trim();
    if (q.length < 2) { resultsEl.classList.remove('open'); return; }

    sSearchTimeout = setTimeout(async () => {
      const results = await platform.searchAirports(q);
      if (results.length === 0) {
        resultsEl.innerHTML = '<div style="padding:12px;color:var(--wiz-text-dim);font-size:13px;">' + t('settings.station.noResult') + '</div>';
      } else {
        resultsEl.innerHTML = results.map(r => `
          <div class="search-result-item" data-id="${r.id}">
            <div class="search-result-name">${r.id} — ${r.name}</div>
            <div class="search-result-detail">${r.city || ''}</div>
          </div>`).join('');
        resultsEl.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => selectSettingsAirport(item.dataset.id));
        });
      }
      resultsEl.classList.add('open');
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) resultsEl.classList.remove('open');
  });
}

async function selectSettingsAirport(id) {
  const airport = await platform.getAirport(id);
  if (!airport) return;

  const metarStation = airport.metarStation || id;
  settingsConfig.station.icao = metarStation;
  settingsConfig.station.displayName = `${metarStation} — ${airport.name}`;
  settingsConfig.station.lat = airport.lat;
  settingsConfig.station.lon = airport.lon;
  settingsConfig.station.firs = airport.fir ? [airport.fir] : [];
  settingsConfig.station.firName = airport.firName || '';

  // Mettre à jour les coords cartes aussi
  settingsConfig.maps.center = [airport.lat, airport.lon];

  // Pistes
  if (airport.runways && airport.runways.length > 0) {
    settingsConfig.runways = airport.runways.map(r => ({ name: r.name, heading: r.heading }));
  }

  // Mettre à jour l'UI
  document.getElementById('sStationSearch').value = `${metarStation} — ${airport.name}`;
  document.getElementById('sStationResults').classList.remove('open');
  document.getElementById('sDisplayName').value = settingsConfig.station.displayName;
  document.getElementById('sLat').value = airport.lat;
  document.getElementById('sLon').value = airport.lon;
  document.getElementById('sFir').value = (settingsConfig.station.firs || [])[0] || '';
  document.getElementById('sFirName').value = settingsConfig.station.firName || '';
  renderSettingsRunways();
}

// ============================================================
// PISTES
// ============================================================

function renderSettingsRunways() {
  const list = document.getElementById('sRunwayList');
  const rwys = settingsConfig.runways || [];

  if (rwys.length === 0) {
    list.innerHTML = '<div style="color:var(--wiz-text-dim);font-size:13px;padding:12px;">' + t('settings.runways.noRunway') + '</div>';
    return;
  }

  list.innerHTML = rwys.map((rwy, i) => `
    <div class="runway-item">
      <span class="rwy-name">${rwy.name}</span>
      <span class="rwy-heading">${rwy.heading}°</span>
      <button class="rwy-delete" data-idx="${i}" title="Supprimer">✕</button>
    </div>`).join('');

  list.querySelectorAll('.rwy-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      settingsConfig.runways.splice(parseInt(btn.dataset.idx), 1);
      renderSettingsRunways();
    });
  });
}

function addSettingsRunway() {
  const nameEl = document.getElementById('sNewRwyName');
  const headingEl = document.getElementById('sNewRwyHeading');
  const name = nameEl.value.trim().toUpperCase();
  const heading = parseInt(headingEl.value);

  if (!name || isNaN(heading) || heading < 0 || heading > 360) return;

  if (!settingsConfig.runways) settingsConfig.runways = [];
  settingsConfig.runways.push({ name, heading });
  nameEl.value = '';
  headingEl.value = '';
  renderSettingsRunways();
}

// ============================================================
// SEUILS
// ============================================================

function updateThresholdFieldsState() {
  const profile = document.getElementById('sThresholdProfile').value;
  const isCustom = profile === 'custom';
  const customFields = document.getElementById('customThresholdFields');
  const presetInfo = document.getElementById('presetInfo');

  // Afficher/masquer les champs custom vs preset info
  customFields.style.display = isCustom ? 'block' : 'none';

  if (isCustom) {
    presetInfo.innerHTML = '';
    return;
  }

  // Affichage read-only des catégories du preset
  const presets = {
    easa: [
      { cat: 'VFR', color: '#22c55e', vis: '≥ 5000 m', ceil: '≥ 1500 ft' },
      { cat: 'VFR SPECIAL', color: '#f59e0b', vis: '≥ 1500 m', ceil: '≥ 600 ft' },
      { cat: 'IFR', color: '#ef4444', vis: '< 1500 m', ceil: '< 600 ft' }
    ],
    caa: [
      { cat: 'VFR', color: '#22c55e', vis: '≥ 5000 m', ceil: '≥ 1500 ft' },
      { cat: 'VFR SPECIAL', color: '#f59e0b', vis: '≥ 1500 m', ceil: '≥ 600 ft' },
      { cat: 'IFR', color: '#ef4444', vis: '< 1500 m', ceil: '< 600 ft' }
    ],
    faa: [
      { cat: 'VFR', color: '#22c55e', vis: '> 5 SM (8050 m)', ceil: '> 3000 ft' },
      { cat: 'MVFR', color: '#3b82f6', vis: '3–5 SM (4828–8050 m)', ceil: '1000–3000 ft' },
      { cat: 'IFR', color: '#ef4444', vis: '1–3 SM (1609–4828 m)', ceil: '500–1000 ft' },
      { cat: 'LIFR', color: '#d946ef', vis: '< 1 SM (1609 m)', ceil: '< 500 ft' }
    ],
    tcca: [
      { cat: 'VFR', color: '#22c55e', vis: '> 5 SM (8050 m)', ceil: '> 3000 ft' },
      { cat: 'MVFR', color: '#3b82f6', vis: '3–5 SM (4828–8050 m)', ceil: '1000–3000 ft' },
      { cat: 'IFR', color: '#ef4444', vis: '< 3 SM (4828 m)', ceil: '< 1000 ft' }
    ]
  };

  const cats = presets[profile] || presets.easa;
  let html = '<div style="display:grid; grid-template-columns:auto 1fr 1fr; gap:4px 12px; font-size:12px; padding:10px 12px; background:rgba(255,255,255,0.06); border-radius:6px; border:1px solid var(--wiz-border);">';
  html += '<div style="font-weight:600; color:var(--wiz-text-dim);">' + t('settings.thresholds.category') + '</div>';
  html += '<div style="font-weight:600; color:var(--wiz-text-dim);">' + t('settings.thresholds.visibility') + '</div>';
  html += '<div style="font-weight:600; color:var(--wiz-text-dim);">' + t('settings.thresholds.ceiling') + '</div>';
  cats.forEach(c => {
    html += '<div style="color:' + c.color + '; font-weight:600;">' + c.cat + '</div>';
    html += '<div style="color:' + c.color + ';">' + c.vis + '</div>';
    html += '<div style="color:' + c.color + ';">' + c.ceil + '</div>';
  });
  html += '</div>';
  presetInfo.innerHTML = html;
}

// ============================================================
// MAP LAYERS (OWM)
// ============================================================

function renderMapLayers() {
  const container = document.getElementById('sMapLayers');
  const layers = settingsConfig.maps?.layers || [];
  const defaultDuration = settingsConfig.maps?.rotationSeconds || 20;
  container.innerHTML = layers.map((layer, i) => `
    <div class="toggle-row">
      <span class="toggle-label">${t('mapLayers.' + layer.id)}</span>
      <div style="display:flex; align-items:center; gap:8px;">
        <label style="font-size:11px; color:var(--wiz-text-dim); cursor:pointer;" title="Ne pas afficher cette couche de nuit">
          <input type="checkbox" data-layer-dayonly="${i}" ${layer.dayOnly ? 'checked' : ''} style="margin-right:3px;">${t('settings.maps.dayOnly')}
        </label>
        <input type="number" class="form-input" data-layer-duration="${i}"
               value="${layer.duration || defaultDuration}" min="5" max="120"
               style="width:60px; padding:4px 6px; font-size:12px; text-align:center;"
               title="Durée d'affichage (secondes)">
        <span style="font-size:11px; color:var(--wiz-text-dim);">s</span>
        <label class="toggle-switch">
          <input type="checkbox" data-layer-idx="${i}" ${layer.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`).join('');
}

// ============================================================
// SECTIONS
// ============================================================

function getSectionLabels() {
  return {
    sunTimes: t('settings.sections.sunTimes'),
    conditions: t('settings.sections.conditions'),
    fogAlert: t('settings.sections.fogAlert'),
    runwayComponents: t('settings.sections.runwayComponents'),
    preferredRunway: t('settings.sections.preferredRunway'),
    metar: t('settings.sections.metar'),
    taf: t('settings.sections.taf'),
    tafBar: t('settings.sections.tafBar'),
    sigmet: t('settings.sections.sigmet'),
    flightCategory: t('settings.sections.flightCategory'),
    sunsetWarning: t('settings.sections.sunsetWarning'),
    ramadan: t('settings.sections.ramadan')
  };
}

// Presets par profil d'activité
const ACTIVITY_PROFILES = {
  standard: {
    sections: { sunTimes: true, conditions: true, fogAlert: true, runwayComponents: true, preferredRunway: true, metar: true, taf: true, tafBar: true, sigmet: true, flightCategory: true, sunsetWarning: true },
    tafDisplay: 'both',
    layers: { clouds_new: true, precipitation_new: true, pressure_new: true, wind_new: true, temp_new: true, snow_new: false, gusts: false, dewpoint: false, cape: false, pbl: false, uv: false, wind_altitude: false }
  },
  glider: {
    sections: { sunTimes: true, conditions: true, fogAlert: true, runwayComponents: false, preferredRunway: false, metar: true, taf: true, tafBar: true, sigmet: true, flightCategory: true, sunsetWarning: true },
    tafDisplay: 'bar',
    layers: { clouds_new: true, precipitation_new: true, pressure_new: true, wind_new: true, temp_new: true, snow_new: false, gusts: true, dewpoint: true, cape: true, pbl: true, uv: false, wind_altitude: true }
  },
  aeromodel: {
    sections: { sunTimes: true, conditions: true, fogAlert: true, runwayComponents: false, preferredRunway: false, metar: false, taf: true, tafBar: false, sigmet: false, flightCategory: false, sunsetWarning: true },
    tafDisplay: 'decoded',
    layers: { clouds_new: true, precipitation_new: true, pressure_new: false, wind_new: true, temp_new: true, snow_new: false, gusts: true, dewpoint: false, cape: false, pbl: false, uv: true, wind_altitude: false },
    fleet: false
  }
};

function applyActivityProfile(profileId) {
  const profile = ACTIVITY_PROFILES[profileId];
  if (!profile) return;

  // Appliquer sections
  document.querySelectorAll('#sSectionToggles input[data-section]').forEach(cb => {
    const key = cb.dataset.section;
    if (profile.sections[key] !== undefined) {
      cb.checked = profile.sections[key];
      previewSectionToggle(key, cb.checked);
    }
  });

  // Appliquer tafDisplay
  document.getElementById('sTafDisplay').value = profile.tafDisplay;

  // Appliquer couches carte
  document.querySelectorAll('#sMapLayers input[data-layer-idx]').forEach(cb => {
    const idx = parseInt(cb.dataset.layerIdx);
    const layer = settingsConfig.maps?.layers?.[idx];
    if (layer && profile.layers[layer.id] !== undefined) {
      cb.checked = profile.layers[layer.id];
    }
  });

  // Appliquer fleet
  if (profile.fleet !== undefined) {
    const overlayCb = document.getElementById('sFleetShowOverlay');
    const statusBarCb = document.getElementById('sFleetShowStatusBar');
    if (overlayCb) overlayCb.checked = profile.fleet;
    if (statusBarCb) statusBarCb.checked = profile.fleet;
    updateFleetVisibility();
  }
}

function renderSectionToggles() {
  const container = document.getElementById('sSectionToggles');
  const sections = settingsConfig.sections || {};
  container.innerHTML = Object.entries(getSectionLabels()).map(([key, label]) => `
    <div class="toggle-row">
      <span class="toggle-label">${label}</span>
      <label class="toggle-switch">
        <input type="checkbox" data-section="${key}" ${key === 'ramadan' ? (sections[key] === true ? 'checked' : '') : (sections[key] !== false ? 'checked' : '')}>
        <span class="toggle-slider"></span>
      </label>
    </div>`).join('');

  // Preview en direct : quand on toggle une section, l'effet est visible derrière
  container.querySelectorAll('input[data-section]').forEach(cb => {
    cb.addEventListener('change', () => {
      previewSectionToggle(cb.dataset.section, cb.checked);
      // Passer en custom si on modifie manuellement
      document.getElementById('sActivityProfile').value = 'custom';
    });
  });

  // Handler profil d'activité
  document.getElementById('sActivityProfile').addEventListener('change', (e) => {
    if (e.target.value !== 'custom') {
      applyActivityProfile(e.target.value);
    }
  });
}

function previewSectionToggle(sectionKey, enabled) {
  // Mapping clé config → id HTML de la section dans le dashboard
  const sectionMap = {
    sunTimes: 'sunSection',
    conditions: 'condSection',
    fogAlert: 'fogSection',
    runwayComponents: 'rwySection',
    preferredRunway: 'prefRwySection',
    metar: 'metarSection',
    taf: 'tafSection',
    sigmet: 'sigmetSection',
    flightCategory: 'flightCat',
    sunsetWarning: 'sunsetWarn'
  };
  const elId = sectionMap[sectionKey];
  if (elId) {
    const el = document.getElementById(elId);
    if (el) el.style.display = enabled ? '' : 'none';
  }
}

// ============================================================
// THÈMES
// ============================================================

function getThemeNames() {
  return {
    cockpit: t('settings.theme.cockpit'),
    ocean: t('settings.theme.ocean'),
    aeroclub: t('settings.theme.aeroclub'),
    daylight: t('settings.theme.daylight')
  };
}

function renderThemeGrids() {
  const themes = settingsConfig.themes || {};
  const dayTheme = settingsConfig.themeAuto?.day || 'daylight';
  const nightTheme = settingsConfig.themeAuto?.night || 'cockpit';
  const fixedTheme = settingsConfig.themeName !== 'auto' ? settingsConfig.themeName : 'cockpit';

  // Générer les cartes de thème
  function buildGrid(containerId, selectedTheme, dataAttr) {
    const container = document.getElementById(containerId);
    container.innerHTML = Object.entries(getThemeNames()).map(([key, name]) => {
      const t = themes[key] || {};
      return `
        <div class="theme-card ${key === selectedTheme ? 'selected' : ''}" data-theme="${key}">
          <div class="theme-preview" style="background: ${t.bg || '#0a0e14'};"></div>
          <div class="theme-name">${name}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
        container.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        // Preview en direct
        const themeName = card.dataset.theme;
        const themeObj = themes[themeName];
        if (themeObj && typeof applyTheme === 'function') {
          applyTheme(themeObj);
        }
      });
    });
  }

  buildGrid('sThemeDayGrid', dayTheme, 'day');
  buildGrid('sThemeNightGrid', nightTheme, 'night');
  buildGrid('sThemeFixedGrid', fixedTheme, 'fixed');
}

// ============================================================
// LICENCE
// ============================================================

async function validateSettingsLicense() {
  const input = document.getElementById('sLicenseKey');
  const errorEl = document.getElementById('sLicenseError');
  const btn = document.getElementById('sBtnValidateLicense');
  const key = input.value.trim();

  if (!key) { errorEl.textContent = t('settings.license.enterKey'); return; }

  btn.disabled = true;
  btn.textContent = t('settings.license.validating');
  errorEl.textContent = '';

  const result = await platform.validateLicense(key);

  btn.disabled = false;
  btn.textContent = t('settings.license.validate');

  if (result.valid) {
    settingsConfig.license = {
      key,
      mode: 'full',
      lastCheck: new Date().toISOString(),
      expiresAt: result.expiresAt
    };
    document.getElementById('sLicenseKeyDisplay').textContent = maskKey(key);
    document.getElementById('sLicenseStatusBadge').innerHTML = '<span class="status-badge status-valid">' + t('settings.license.active') + '</span>';
    const buyBox2 = document.getElementById('sBuyLicenseBox');
    if (buyBox2) buyBox2.style.display = 'none';
    document.getElementById('sLicenseExpires').textContent = result.expiresAt
      ? new Date(result.expiresAt).toLocaleDateString(getDateLocale()) : '—';
    document.getElementById('sLicenseLastCheck').textContent = new Date().toLocaleDateString(getDateLocale(),
      { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    errorEl.textContent = '';
    input.value = '';
    renderDeviceList();
  } else {
    errorEl.textContent = result.offline
      ? t('settings.license.serverError')
      : (result.reason || t('settings.license.invalidKey'));
  }
}

async function renderDeviceList() {
  const container = document.getElementById('sDeviceList');
  const status = await platform.getLicenseStatus();

  if (!status.key) {
    container.innerHTML = '<div style="color:var(--wiz-text-dim); font-size:13px;">' + t('settings.license.noLicense') + '</div>';
    return;
  }

  // Récupérer la liste des appareils depuis Supabase
  const result = await platform.validateLicense(status.key);

  if (!result.valid && !result.devices) {
    container.innerHTML = '<div style="color:var(--wiz-text-dim); font-size:13px;">' + t('settings.license.loadError') + '</div>';
    return;
  }

  const devices = result.devices || [];
  const maxDevices = result.maxDevices || 3;
  const currentUuid = status.deviceUuid;

  if (devices.length === 0) {
    container.innerHTML = '<div style="color:var(--wiz-text-dim); font-size:13px;">' + t('settings.license.noDevices') + '</div>';
    return;
  }

  let html = `<div style="color:var(--wiz-text-dim); font-size:12px; margin-bottom:8px;">${devices.length}/${maxDevices} appareils</div>`;

  devices.forEach(d => {
    const isCurrent = d.uuid === currentUuid;
    const lastSeen = d.last_seen ? new Date(d.last_seen).toLocaleDateString(getDateLocale()) : '—';
    html += `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; margin-bottom:4px; background:var(--wiz-panel); border:1px solid var(--wiz-border); border-radius:8px;">
        <div>
          <div style="font-size:14px; color:var(--wiz-text);">${d.name || 'Inconnu'}${isCurrent ? ' <span style="color:var(--wiz-accent); font-size:11px;">' + t('settings.license.thisDevice') + '</span>' : ''}</div>
          <div style="font-size:11px; color:var(--wiz-text-dim);">${t('settings.license.lastSeen')} ${lastSeen}</div>
        </div>
        ${!isCurrent ? `<button class="btn btn-danger btn-small" onclick="removeDeviceFromLicense('${d.uuid}')" style="font-size:11px; padding:4px 10px;">${t('settings.license.remove')}</button>` : ''}
      </div>`;
  });

  html += `<div style="margin-top:12px; text-align:right;">
    <button class="btn btn-danger" onclick="resetAllDevices()" style="font-size:12px; padding:6px 14px;">${t('settings.license.resetAll') || 'Reset tous les appareils'}</button>
  </div>`;

  container.innerHTML = html;
}

async function removeDeviceFromLicense(uuid) {
  if (!confirm(t('settings.license.confirmRemove'))) return;

  const status = await platform.getLicenseStatus();
  const result = await platform.removeLicenseDevice(uuid);

  if (result.success) {
    renderDeviceList();
  } else {
    alert(t('settings.license.removeError') + ' ' + (result.reason || ''));
  }
}

async function resetAllDevices() {
  if (!confirm(t('settings.license.confirmResetAll') || 'Supprimer TOUS les appareils de cette licence ? L\'appareil actuel devra se réenregistrer.')) return;

  const result = await platform.resetAllDevices();
  if (result.success) {
    renderDeviceList();
  } else {
    alert((t('settings.license.removeError') || 'Erreur') + ' ' + (result.reason || ''));
  }
}

// ============================================================
// EXPORT / IMPORT
// ============================================================

async function exportConfig() {
  const result = await platform.exportConfig();
  if (result.success) {
    alert(t('settings.footer.exportSuccess'));
  } else if (!result.canceled) {
    alert('Erreur : ' + (result.errors || []).join(', '));
  }
}

async function importConfig() {
  const result = await platform.importConfig();
  if (result.canceled) return;
  if (!result.success) {
    alert('Erreur : ' + (result.errors || []).join(', '));
    return;
  }
  // Appliquer la config importée
  settingsConfig = result.config;
  populateAllTabs();
  alert(t('settings.footer.importSuccess'));
}

// ============================================================
// TEST CONNEXION
// ============================================================

async function testConnection() {
  const btn = document.getElementById('sBtnTestConn');
  btn.disabled = true;
  btn.textContent = t('settings.footer.testing');

  // Retirer les anciens résultats
  let resultsEl = document.getElementById('connTestResults');
  if (resultsEl) resultsEl.remove();

  const results = await platform.testConnection();

  const labels = { metar: t('settings.connection.metarLabel'), owm: t('settings.connection.owmLabel') };

  let html = '<div class="conn-test-results" id="connTestResults">';
  for (const [key, label] of Object.entries(labels)) {
    const r = results[key];
    const ok = r && r.ok;
    const latency = r ? r.latency + ' ms' : '—';
    html += `
      <div class="conn-test-item">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="conn-test-dot ${ok ? 'ok' : 'fail'}"></div>
          <span>${label}</span>
        </div>
        <span style="color:var(--wiz-text-dim);font-size:12px;">${ok ? latency : (r?.error || t('settings.connection.failure'))}</span>
      </div>`;
  }
  html += '</div>';

  btn.insertAdjacentHTML('afterend', html);
  btn.disabled = false;
  btn.textContent = t('settings.footer.testConnection');
}

// ============================================================
// MOT DE PASSE — Statut dans l'onglet Général
// ============================================================

function updatePasswordStatus() {
  const hint = document.getElementById('passwordStatusHint');
  if (!hint) return;
  const hasPassword = !!(settingsConfig.admin && settingsConfig.admin.passwordHash);
  hint.textContent = hasPassword
    ? t('settings.general.passwordStatusSet')
    : t('settings.general.passwordStatusNone');
  hint.style.color = hasPassword ? 'var(--vfr, #22c55e)' : 'var(--text-dim, #6b7f94)';
}

// ============================================================
// PASSWORD MODAL
// ============================================================

function showPasswordModal() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'password-modal';
    modal.innerHTML = `
      <div class="password-modal-box">
        <div id="pwdViewLogin">
          <h3>${t('settings.password.title')}</h3>
          <input type="password" class="form-input" id="pwdInput" placeholder="${t('settings.password.placeholder')}" autofocus>
          <div class="form-error" id="pwdError"></div>
          <button class="btn btn-primary" id="pwdSubmit">${t('settings.license.validate')}</button>
          <button class="btn btn-ghost" id="pwdCancel" style="width:100%;margin-top:4px;">${t('settings.cancel')}</button>
          <div style="text-align:center;margin-top:12px;">
            <a href="#" id="pwdForgotLink" style="color:var(--accent,#00d4ff);font-size:13px;text-decoration:none;">${t('settings.password.forgot')}</a>
          </div>
        </div>
        <div id="pwdViewReset" style="display:none;">
          <h3>${t('settings.password.resetTitle')}</h3>
          <p style="font-size:13px;color:var(--text-dim,#6b7f94);margin-bottom:12px;">${t('settings.password.resetInstructions')}</p>
          <input type="text" class="form-input" id="pwdResetKeyInput" placeholder="${t('settings.password.resetPlaceholder')}" autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:1px;">
          <div class="form-error" id="pwdResetError"></div>
          <button class="btn btn-primary" id="pwdResetSubmit">${t('settings.password.resetButton')}</button>
          <div style="text-align:center;margin-top:12px;">
            <a href="#" id="pwdResetBack" style="color:var(--accent,#00d4ff);font-size:13px;text-decoration:none;">${t('settings.password.resetBack')}</a>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const input = document.getElementById('pwdInput');
    const errorEl = document.getElementById('pwdError');
    const loginView = document.getElementById('pwdViewLogin');
    const resetView = document.getElementById('pwdViewReset');

    // --- Vue Login ---
    async function tryPassword() {
      const pwd = input.value;
      if (!pwd) { errorEl.textContent = t('settings.password.required'); return; }
      const ok = await platform.verifyPassword(pwd);
      if (ok) {
        modal.remove();
        resolve(true);
      } else {
        errorEl.textContent = t('settings.password.incorrect');
        input.value = '';
        input.focus();
      }
    }

    document.getElementById('pwdSubmit').addEventListener('click', tryPassword);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPassword(); });
    document.getElementById('pwdCancel').addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });

    // --- Lien "Mot de passe oublié" ---
    document.getElementById('pwdForgotLink').addEventListener('click', (e) => {
      e.preventDefault();
      loginView.style.display = 'none';
      resetView.style.display = '';
      document.getElementById('pwdResetKeyInput').focus();
    });

    // --- Vue Reset ---
    const resetKeyInput = document.getElementById('pwdResetKeyInput');
    const resetErrorEl = document.getElementById('pwdResetError');

    async function tryReset() {
      const key = resetKeyInput.value.trim();
      if (!key) { resetErrorEl.textContent = t('settings.password.required'); return; }
      const result = await platform.resetPasswordWithLicense(key);
      if (result.success) {
        modal.remove();
        resolve(true);
      } else {
        resetErrorEl.textContent = t('settings.password.resetInvalidKey');
        resetKeyInput.value = '';
        resetKeyInput.focus();
      }
    }

    document.getElementById('pwdResetSubmit').addEventListener('click', tryReset);
    resetKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryReset(); });

    document.getElementById('pwdResetBack').addEventListener('click', (e) => {
      e.preventDefault();
      resetView.style.display = 'none';
      loginView.style.display = '';
      resetErrorEl.textContent = '';
      input.focus();
    });

    input.focus();
  });
}

// ============================================================
// SAUVEGARDE
// ============================================================

// ============================================================
// AFFICHAGE CLUB — Populate & helpers
// ============================================================

async function populateClubDisplay() {
  const cd = settingsConfig.clubDisplay || {};

  document.getElementById('sClubServerEnabled').checked = cd.serverEnabled !== false;
  document.getElementById('sClubServerPort').value = cd.serverPort || 3000;
  document.getElementById('sClubPlacement').value = cd.placement || 'interleaved';
  setSlider('sClubDuration', 'sClubDurationVal', cd.defaultDuration || 15);

  // Visibilité des sous-groupes
  updateClubDisplayVisibility();

  // Afficher l'URL locale + QR code
  await updateClubAdminUrl();
}

function updateClubDisplayVisibility() {
  const serverOn = document.getElementById('sClubServerEnabled').checked;
  document.getElementById('clubServerSettingsGroup').style.display = serverOn ? '' : 'none';
}

async function updateClubAdminUrl() {
  const urlDisplay = document.getElementById('clubAdminUrlDisplay');
  const canvas = document.getElementById('clubQrCanvas');

  const serverOn = document.getElementById('sClubServerEnabled').checked;

  if (!serverOn) {
    urlDisplay.textContent = t('settings.display.serverOff');
    urlDisplay.style.color = 'var(--wiz-text-dim)';
    canvas.style.display = 'none';
    return;
  }

  try {
    const result = await platform.getLocalIp();
    const ip = result.ip || result;
    const port = document.getElementById('sClubServerPort').value || 3000;
    const url = 'http://' + ip + ':' + port;

    urlDisplay.textContent = url;
    urlDisplay.style.color = 'var(--wiz-accent)';

    // Générer le QR code
    generateQrCode(canvas, url);
    canvas.style.display = 'block';
  } catch (e) {
    urlDisplay.textContent = '—';
    urlDisplay.style.color = 'var(--wiz-text-dim)';
    canvas.style.display = 'none';
  }
}

// ============================================================
// FLOTTE — Populate & helpers
// ============================================================

function populateFleet() {
  const fl = settingsConfig.fleet || {};
  // Rétrocompat: ancien fleet.enabled → les deux activés
  const overlayOn = fl.showOverlay !== undefined ? fl.showOverlay : (fl.enabled === true);
  const statusBarOn = fl.showStatusBar !== undefined ? fl.showStatusBar : (fl.enabled === true);
  document.getElementById('sFleetShowOverlay').checked = overlayOn;
  document.getElementById('sFleetShowStatusBar').checked = statusBarOn;
  document.getElementById('sFleetSource').value = fl.source || 'manual';
  document.getElementById('sFleetApiEndpoint').value = fl.apiEndpoint || '';
  document.getElementById('sFleetApiKey').value = fl.apiKey || '';
  setSlider('sFleetDuration', 'sFleetDurationVal', fl.durationSeconds || 15);
  setSlider('sFleetStatusScroll', 'sFleetStatusScrollVal', fl.statusScrollSeconds || 5);
  setSlider('sFleetOverlayScroll', 'sFleetOverlayScrollVal', fl.overlayScrollSeconds || 8);
  document.getElementById('sFleetShowHours').checked = fl.showHours !== false;
  document.getElementById('sFleetShowGo').checked = fl.showGoSidebar === true;
  document.getElementById('sFleetShowMaint').checked = fl.showMaintSidebar !== false;
  document.getElementById('sFleetShowSim').checked = fl.showSimSidebar === true;
  document.getElementById('sFleetAutoWatchlist').checked = fl.autoWatchlist === true;
  updateFleetVisibility();
}

function updateFleetVisibility() {
  const anyEnabled = document.getElementById('sFleetShowOverlay').checked || document.getElementById('sFleetShowStatusBar').checked;
  document.getElementById('fleetSettingsGroup').style.display = anyEnabled ? '' : 'none';
  const isApi = document.getElementById('sFleetSource').value === 'api';
  document.getElementById('fleetApiGroup').style.display = (anyEnabled && isApi) ? '' : 'none';
  const sidebarOn = document.getElementById('sFleetShowStatusBar').checked;
  document.getElementById('fleetSidebarGroup').style.display = sidebarOn ? '' : 'none';
}

// ============================================================
// PLANIFICATION (SALLES) — Chargement + visibilité + test
// ============================================================

function populateRooms() {
  const rm = settingsConfig.rooms || {};
  const gu = settingsConfig.gearup || {};
  document.getElementById('sGearupEnabled').checked = rm.enabled === true;
  document.getElementById('sGearupApiSource').value = gu.apiSource || '';
  document.getElementById('sGearupApiEndpoint').value = gu.apiEndpoint || '';
  document.getElementById('sGearupApiKey').value = gu.apiKey || '';
  setSlider('sGearupPoll', 'sGearupPollVal', Math.round((gu.pollIntervalMs || 300000) / 1000));
  setSlider('sRoomsBrief', 'sRoomsBriefVal', rm.defaultBriefingMinutes || 30);
  setSlider('sRoomsDebrief', 'sRoomsDebriefVal', rm.defaultDebriefingMinutes ?? 15);
  updateGearupVisibility();
}

function updateGearupVisibility() {
  const enabled = document.getElementById('sGearupEnabled').checked;
  document.getElementById('gearupSettingsGroup').style.display = enabled ? '' : 'none';
  const isGearUp = document.getElementById('sGearupApiSource').value === 'gearup';
  document.getElementById('gearupApiGroup').style.display = (enabled && isGearUp) ? '' : 'none';
}

async function testGearUpConnection() {
  const btn = document.getElementById('btnTestGearUp');
  const result = document.getElementById('gearupTestResult');
  const endpoint = document.getElementById('sGearupApiEndpoint').value.trim();
  const apiKey = document.getElementById('sGearupApiKey').value.trim();

  if (!endpoint || !apiKey) {
    result.textContent = t('settings.gearup.testMissing');
    result.style.color = '#ef4444';
    return;
  }

  btn.disabled = true;
  result.textContent = '...';
  result.style.color = '';

  try {
    const resp = await platform.testGearUp(endpoint, apiKey);
    if (resp.ok) {
      result.textContent = t('settings.gearup.testOk') + ` (${resp.latency}ms)`;
      result.style.color = '#22c55e';
    } else {
      result.textContent = t('settings.gearup.testFail') + ` (HTTP ${resp.status})`;
      result.style.color = '#ef4444';
    }
  } catch (e) {
    result.textContent = t('settings.gearup.testFail') + ': ' + e.message;
    result.style.color = '#ef4444';
  }
  btn.disabled = false;
}

// ============================================================
// FLEET MODAL — Gestion des aéronefs
// ============================================================

let fleetItems = [];
let editingFleetId = null;

async function openFleetModal() {
  document.getElementById('fleetModalOverlay').classList.add('open');
  applyI18n(document.getElementById('fleetModalOverlay'));
  await loadFleetItems();
  showFleetList();
}

function closeFleetModal() {
  document.getElementById('fleetModalOverlay').classList.remove('open');
}

async function loadFleetItems() {
  if (platform && platform.getFleet) {
    try {
      fleetItems = await platform.getFleet() || [];
    } catch (e) {
      fleetItems = [];
    }
  }
}

function showFleetList() {
  document.getElementById('fleetListView').style.display = '';
  document.getElementById('fleetFormView').style.display = 'none';
  renderFleetList();
}

function renderFleetList() {
  const container = document.getElementById('fleetList');
  if (fleetItems.length === 0) {
    container.innerHTML = '<div class="fleet-empty">' + t('settings.fleet.empty') + '</div>';
    return;
  }
  const statusLabels = { go: 'GO', mel: 'MEL', nogo: 'NO GO', maint: 'MAINT' };
  container.innerHTML = fleetItems.map(item => {
    const s = item.status || 'go';
    return '<div class="fleet-item">'
      + '<div class="fleet-item-dot ' + s + '"></div>'
      + '<div class="fleet-item-info">'
      + '<div class="fleet-item-reg">' + escapeSettingsHtml(item.registration || '') + '</div>'
      + '<div class="fleet-item-type">' + escapeSettingsHtml(item.type || '') + '</div>'
      + '</div>'
      + '<span class="fleet-item-badge ' + s + '">' + statusLabels[s] + '</span>'
      + '<div class="fleet-item-actions">'
      + '<button onclick="showFleetForm(\'' + item.id + '\')" title="Edit">✎</button>'
      + '<button class="delete" onclick="deleteFleetItem(\'' + item.id + '\')" title="Delete">✕</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function escapeSettingsHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showFleetForm(id) {
  document.getElementById('fleetListView').style.display = 'none';
  document.getElementById('fleetFormView').style.display = '';
  document.getElementById('sfError').textContent = '';
  editingFleetId = id;

  const titleEl = document.getElementById('fleetFormTitle');
  if (id) {
    titleEl.textContent = t('settings.fleet.edit');
    const item = fleetItems.find(a => a.id === id);
    if (item) {
      document.getElementById('sfReg').value = item.registration || '';
      document.getElementById('sfType').value = item.type || '';
      document.getElementById('sfHours').value = item.total_hours || '';
      const radio = document.querySelector('input[name="sfStatus"][value="' + (item.status || 'go') + '"]');
      if (radio) radio.checked = true;
      document.getElementById('sfNogoReason').value = item.nogo_reason || '';
      document.getElementById('sfMaintReason').value = item.maint_reason || '';
      document.getElementById('sfSimulator').checked = item.is_simulator === true;
      renderSfMelItems(item.mel_items || []);
    }
  } else {
    titleEl.textContent = t('settings.fleet.add');
    document.getElementById('sfReg').value = '';
    document.getElementById('sfType').value = '';
    document.getElementById('sfHours').value = '';
    document.querySelector('input[name="sfStatus"][value="go"]').checked = true;
    document.getElementById('sfNogoReason').value = '';
    document.getElementById('sfMaintReason').value = '';
    document.getElementById('sfSimulator').checked = false;
    renderSfMelItems([]);
  }
  updateSfStatusSections();
}

function updateSfStatusSections() {
  const status = document.querySelector('input[name="sfStatus"]:checked').value;
  document.getElementById('sfMelSection').style.display = status === 'mel' ? '' : 'none';
  document.getElementById('sfNogoSection').style.display = status === 'nogo' ? '' : 'none';
  document.getElementById('sfMaintSection').style.display = status === 'maint' ? '' : 'none';
}

function renderSfMelItems(items) {
  const container = document.getElementById('sfMelList');
  container.innerHTML = items.map((m, i) =>
    '<div class="sf-mel-row">'
    + '<input class="form-input" placeholder="' + t('settings.fleet.melCode') + '" value="' + escapeSettingsHtml(m.code || '') + '" data-mel-idx="' + i + '" data-mel-field="code">'
    + '<input class="form-input" placeholder="' + t('settings.fleet.melDesc') + '" value="' + escapeSettingsHtml(m.description || '') + '" data-mel-idx="' + i + '" data-mel-field="description">'
    + '<select class="form-select" data-mel-idx="' + i + '" data-mel-field="category" style="width:80px;">'
    + '<option value="A"' + (m.category === 'A' ? ' selected' : '') + '>A</option>'
    + '<option value="B"' + (m.category === 'B' ? ' selected' : '') + '>B</option>'
    + '<option value="C"' + (m.category === 'C' ? ' selected' : '') + '>C</option>'
    + '<option value="D"' + (m.category === 'D' ? ' selected' : '') + '>D</option>'
    + '</select>'
    + '<button type="button" class="sf-mel-delete" onclick="removeSfMelItem(' + i + ')">✕</button>'
    + '</div>'
  ).join('');
}

function addSfMelItem() {
  const items = collectSfMelItems();
  items.push({ code: '', description: '', category: 'B' });
  renderSfMelItems(items);
}

function removeSfMelItem(idx) {
  const items = collectSfMelItems();
  items.splice(idx, 1);
  renderSfMelItems(items);
}

function collectSfMelItems() {
  const items = [];
  const rows = document.querySelectorAll('#sfMelList .sf-mel-row');
  rows.forEach(row => {
    const code = row.querySelector('[data-mel-field="code"]').value.trim();
    const description = row.querySelector('[data-mel-field="description"]').value.trim();
    const category = row.querySelector('[data-mel-field="category"]').value;
    items.push({ code, description, category });
  });
  return items;
}

async function saveFleetItem() {
  const reg = document.getElementById('sfReg').value.trim().toUpperCase();
  if (!reg) {
    document.getElementById('sfError').textContent = t('settings.fleet.regRequired');
    return;
  }

  const status = document.querySelector('input[name="sfStatus"]:checked').value;
  const item = {
    id: editingFleetId || crypto.randomUUID(),
    registration: reg,
    type: document.getElementById('sfType').value.trim(),
    total_hours: parseFloat(document.getElementById('sfHours').value) || null,
    status: status,
    mel_items: status === 'mel' ? collectSfMelItems().filter(m => m.code || m.description) : [],
    nogo_reason: status === 'nogo' ? document.getElementById('sfNogoReason').value.trim() : '',
    maint_reason: status === 'maint' ? document.getElementById('sfMaintReason').value.trim() : '',
    is_simulator: document.getElementById('sfSimulator').checked,
    updated_at: new Date().toISOString()
  };

  if (editingFleetId) {
    const idx = fleetItems.findIndex(a => a.id === editingFleetId);
    if (idx >= 0) fleetItems[idx] = { ...fleetItems[idx], ...item };
  } else {
    fleetItems.push(item);
  }

  if (platform && platform.saveFleet) {
    const result = await platform.saveFleet(fleetItems);
    if (result && !result.success) {
      document.getElementById('sfError').textContent = result.error || 'Error';
      return;
    }
  }

  showFleetList();
}

async function deleteFleetItem(id) {
  if (!confirm(t('settings.fleet.confirmDelete'))) return;
  fleetItems = fleetItems.filter(a => a.id !== id);
  if (platform && platform.saveFleet) {
    await platform.saveFleet(fleetItems);
  }
  renderFleetList();
}

/**
 * Mini QR Code generator — Mode Byte, ECC Level L, Version auto (1-6)
 * Dessine directement sur un canvas. Pas de dépendance externe.
 */
function generateQrCode(canvas, text) {
  // Use a simple encoding: we generate a QR code via a compact algorithm
  // For URLs up to ~80 chars, version 2-4 suffices
  const modules = encodeQr(text);
  if (!modules) { canvas.style.display = 'none'; return; }

  const size = modules.length;
  const scale = Math.floor(canvas.width / (size + 8)); // quiet zone of 4 modules each side
  const offset = Math.floor((canvas.width - size * scale) / 2);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) {
        ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale);
      }
    }
  }
}

/**
 * Minimal QR encoder — byte mode, ECC L, versions 1-6
 * Returns 2D boolean array or null on failure
 */
function encodeQr(text) {
  const data = new TextEncoder().encode(text);
  const len = data.length;

  // Version capacities (byte mode, ECC L) — versions 1-10
  const caps = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    if (len <= caps[v]) { ver = v; break; }
  }
  if (!ver) return null; // too long

  const size = 17 + ver * 4;
  // Create module grid: 0=white, 1=black, null=unset
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  // ── Finder patterns ──
  function drawFinder(cy, cx) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const y = cy + dy, x = cx + dx;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        const outer = Math.max(Math.abs(dy), Math.abs(dx));
        grid[y][x] = outer === 4 ? 0 : (outer <= 1 || outer === 3) ? 1 : 0;
        reserved[y][x] = true;
      }
    }
  }
  drawFinder(3, 3);
  drawFinder(3, size - 4);
  drawFinder(size - 4, 3);

  // ── Timing patterns ──
  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = i % 2 === 0 ? 1 : 0; reserved[6][i] = true;
    grid[i][6] = i % 2 === 0 ? 1 : 0; reserved[i][6] = true;
  }

  // ── Alignment patterns (versions 2+) ──
  if (ver >= 2) {
    const positions = getAlignmentPositions(ver);
    for (const ay of positions) {
      for (const ax of positions) {
        if (reserved[ay] && reserved[ay][ax]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const y = ay + dy, x = ax + dx;
            if (y < 0 || y >= size || x < 0 || x >= size) continue;
            const d = Math.max(Math.abs(dy), Math.abs(dx));
            grid[y][x] = (d === 0 || d === 2) ? 1 : 0;
            reserved[y][x] = true;
          }
        }
      }
    }
  }

  // ── Dark module ──
  grid[size - 8][8] = 1; reserved[size - 8][8] = true;

  // ── Reserve format info areas ──
  for (let i = 0; i < 9; i++) {
    if (i < size) { reserved[8][i] = true; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // ── Reserve version info (ver >= 7) ──
  // versions 1-6 don't need version info

  // ── Encode data ──
  const eccL = getEccInfo(ver);
  const totalBytes = eccL.totalCodewords;
  const dataBytes = eccL.dataCodewords;

  // Build data bitstream: mode(4) + count(8 or 16) + data + terminator + padding
  const countBits = ver <= 9 ? 8 : 16;
  let bits = '';
  bits += '0100'; // byte mode
  bits += len.toString(2).padStart(countBits, '0');
  for (const b of data) bits += b.toString(2).padStart(8, '0');
  // terminator
  const terminatorLen = Math.min(4, dataBytes * 8 - bits.length);
  bits += '0'.repeat(terminatorLen);
  // pad to byte boundary
  while (bits.length % 8 !== 0) bits += '0';
  // pad bytes
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < dataBytes * 8) {
    bits += padBytes[padIdx % 2].toString(2).padStart(8, '0');
    padIdx++;
  }

  // Convert to byte array
  const dataArr = [];
  for (let i = 0; i < bits.length; i += 8) {
    dataArr.push(parseInt(bits.substring(i, i + 8), 2));
  }

  // Reed-Solomon ECC
  const eccBytes = totalBytes - dataBytes;
  const eccArr = rsEncode(dataArr, eccBytes);
  const allBytes = dataArr.concat(eccArr);

  // ── Place data bits ──
  let bitIndex = 0;
  const totalBits = allBytes.length * 8;
  // Traverse in upward/downward columns, right to left, skipping column 6
  let up = true;
  for (let right = size - 1; right >= 0; right -= 2) {
    if (right === 6) right = 5; // skip timing column
    const colPair = [right, right - 1];
    const rows = up ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const row of rows) {
      for (const col of colPair) {
        if (col < 0 || col >= size) continue;
        if (reserved[row][col]) continue;
        if (bitIndex < totalBits) {
          const byteIdx = Math.floor(bitIndex / 8);
          const bitPos = 7 - (bitIndex % 8);
          grid[row][col] = (allBytes[byteIdx] >> bitPos) & 1;
        } else {
          grid[row][col] = 0;
        }
        bitIndex++;
      }
    }
    up = !up;
  }

  // ── Apply mask (pattern 0: (row + col) % 2 === 0) ──
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x]) {
        if ((y + x) % 2 === 0) grid[y][x] ^= 1;
      }
    }
  }

  // ── Format info (ECC L = 01, mask 0 = 000) ──
  const formatBits = getFormatBits(0, 1); // mask 0, ECC L
  // Horizontal: bits 0-7 along row 8 (columns 0-7, skip col 6 = timing)
  const hCols = [0, 1, 2, 3, 4, 5, 7, 8, size - 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2];
  for (let i = 0; i < 15; i++) {
    if (i < 8) {
      grid[8][hCols[i]] = (formatBits >> (14 - i)) & 1;
    } else {
      grid[8][hCols[i]] = (formatBits >> (14 - i)) & 1;
    }
  }
  // Vertical: bits along column 8
  const vRows = [0, 1, 2, 3, 4, 5, 7, 8, size - 7, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1];
  for (let i = 0; i < 15; i++) {
    grid[vRows[14 - i]][8] = (formatBits >> (14 - i)) & 1;
  }

  return grid;
}

function getAlignmentPositions(ver) {
  if (ver === 1) return [];
  const table = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];
  return table[ver - 1] || [];
}

function getEccInfo(ver) {
  // [totalCodewords, dataCodewords] for ECC Level L
  const table = {
    1: [26, 19], 2: [44, 34], 3: [70, 55], 4: [100, 80],
    5: [134, 108], 6: [172, 136], 7: [196, 156], 8: [242, 194],
    9: [292, 232], 10: [346, 274]
  };
  const [total, data] = table[ver];
  return { totalCodewords: total, dataCodewords: data };
}

/**
 * Reed-Solomon encoding over GF(256) with generator polynomial x^n
 */
function rsEncode(data, eccCount) {
  // GF(256) log/exp tables
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = v;
    log[v] = i;
    v <<= 1;
    if (v >= 256) v ^= 0x11d;
  }
  exp[255] = exp[0];

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return exp[(log[a] + log[b]) % 255];
  }

  // Build generator polynomial
  let gen = [1];
  for (let i = 0; i < eccCount; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const factor = exp[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], factor);
    }
    gen = next;
  }

  // Divide
  const result = new Array(eccCount).fill(0);
  const msg = data.slice();
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i] ^ result[0];
    result.shift();
    result.push(0);
    if (coef !== 0) {
      for (let j = 0; j < eccCount; j++) {
        result[j] ^= gfMul(gen[j + 1], coef);
      }
    }
  }
  return result;
}

function getFormatBits(mask, eccLevel) {
  // ECC level indicators: L=1, M=0, Q=3, H=2
  const eccIndicator = [1, 0, 3, 2][eccLevel];
  let data = (eccIndicator << 3) | mask;
  // BCH(15,5) encoding
  let bits = data << 10;
  let gen = 0x537; // generator polynomial
  for (let i = 4; i >= 0; i--) {
    if (bits & (1 << (i + 10))) {
      bits ^= gen << i;
    }
  }
  bits = (data << 10) | bits;
  bits ^= 0x5412; // XOR mask
  return bits;
}

// ============================================================
// SAUVEGARDE
// ============================================================

async function saveSettings() {
  const c = settingsConfig;

  // Langue
  c.language = document.getElementById('sLanguage').value;

  // Collecter les valeurs des champs
  c.station.displayName = document.getElementById('sDisplayName').value;
  c.station.lat = parseFloat(document.getElementById('sLat').value) || 0;
  c.station.lon = parseFloat(document.getElementById('sLon').value) || 0;
  c.station.firs = [document.getElementById('sFir').value.trim()].filter(Boolean);
  c.station.firName = document.getElementById('sFirName').value.trim();
  c.station.sigmetRegion = document.getElementById('sSigmetRegion').value;

  // Seuils
  c.thresholds.profile = document.getElementById('sThresholdProfile').value;
  // Vent, brouillard, METAR age, sunset — toujours sauvegardés
  c.thresholds.wind.crosswindDanger = parseInt(document.getElementById('sThrXwindDgr').value) || 25;
  c.thresholds.wind.crosswindWarning = parseInt(document.getElementById('sThrXwindWrn').value) || 17;
  c.thresholds.wind.tailwindDanger = parseInt(document.getElementById('sThrTailDgr').value) || 11;
  c.thresholds.wind.tailwindWarning = parseInt(document.getElementById('sThrTailWrn').value) || 6;
  c.thresholds.fog.danger = parseInt(document.getElementById('sThrFogDgr').value) || 1;
  c.thresholds.fog.warning = parseInt(document.getElementById('sThrFogWrn').value) || 2;
  c.thresholds.fog.watch = parseInt(document.getElementById('sThrFogWatch').value) || 4;
  c.thresholds.metarAge.danger = parseInt(document.getElementById('sThrMetarDgr').value) || 60;
  c.thresholds.metarAge.warning = parseInt(document.getElementById('sThrMetarWrn').value) || 45;
  if (!c.thresholds.sunsetWarning) c.thresholds.sunsetWarning = {};
  c.thresholds.sunsetWarning.showMinutes = parseInt(document.getElementById('sThrSunsetShow').value) || 30;
  c.thresholds.sunsetWarning.criticalMinutes = parseInt(document.getElementById('sThrSunsetCrit').value) || 15;
  if (c.thresholds.profile === 'custom') {
    c.thresholds.vfr.visibility = parseInt(document.getElementById('sThrVfrVis').value) || 5000;
    c.thresholds.vfr.ceiling = parseInt(document.getElementById('sThrVfrCeil').value) || 1500;
    c.thresholds.vfrSpecial.visibility = parseInt(document.getElementById('sThrSpecVis').value) || 1500;
    c.thresholds.vfrSpecial.ceiling = parseInt(document.getElementById('sThrSpecCeil').value) || 600;
    if (!c.thresholds.green) c.thresholds.green = {};
    c.thresholds.green.visibility = parseInt(document.getElementById('sThrGreenVis').value) || 9999;
    c.thresholds.green.ceiling = parseInt(document.getElementById('sThrGreenCeil').value) || 5000;
  }

  // Unités
  if (!c.units) c.units = {};
  c.units.pressure = document.getElementById('sUnitPressure').value;
  c.units.visibility = document.getElementById('sUnitVisibility').value;
  c.units.temperature = document.getElementById('sUnitTemperature').value;
  c.units.wind = document.getElementById('sUnitWind').value;

  // Cartes
  c.maps.basemap = document.getElementById('sMapBasemap').value;
  c.maps.basemapAuto = document.getElementById('sMapBasemapAuto').checked;
  c.maps.basemapDay = document.getElementById('sMapBasemapDay').value;
  c.maps.basemapNight = document.getElementById('sMapBasemapNight').value;
  c.maps.airportDisplay = document.getElementById('sMapAirports').value;
  c.maps.zoom = parseFloat(document.getElementById('sMapZoom').value);
  c.maps.offsetLat = parseFloat(document.getElementById('sMapOffLat').value);
  c.maps.offsetLon = parseFloat(document.getElementById('sMapOffLon').value);
  c.maps.rotationSeconds = parseInt(document.getElementById('sRotation').value);
  c.maps.basemapBrightnessDay = parseInt(document.getElementById('sMapBrightnessDay').value);
  c.maps.basemapBrightnessNight = parseInt(document.getElementById('sMapBrightnessNight').value);
  c.maps.weatherIntensityDark = parseInt(document.getElementById('sWeatherDark').value);
  c.maps.weatherIntensityLight = parseInt(document.getElementById('sWeatherLight').value);

  // OWM layers (enabled + durée individuelle)
  document.querySelectorAll('#sMapLayers input[data-layer-idx]').forEach(cb => {
    const idx = parseInt(cb.dataset.layerIdx);
    if (c.maps.layers[idx]) {
      c.maps.layers[idx].enabled = cb.checked;
    }
  });
  document.querySelectorAll('#sMapLayers input[data-layer-duration]').forEach(input => {
    const idx = parseInt(input.dataset.layerDuration);
    const dur = parseInt(input.value);
    if (c.maps.layers[idx] && dur >= 5) {
      c.maps.layers[idx].duration = dur;
    }
  });
  document.querySelectorAll('#sMapLayers input[data-layer-dayonly]').forEach(cb => {
    const idx = parseInt(cb.dataset.layerDayonly);
    if (c.maps.layers[idx]) {
      c.maps.layers[idx].dayOnly = cb.checked;
    }
  });

  // Trafic aérien
  if (!c.traffic) c.traffic = {};
  c.traffic.enabled = document.getElementById('sTrafficEnabled').checked;
  c.traffic.detail = document.getElementById('sTrafficDetail').value;
  c.traffic.refreshSeconds = parseInt(document.getElementById('sTrafficRefresh').value) || 10;
  c.traffic.radiusNm = parseInt(document.getElementById('sTrafficRadius').value) || 135;
  c.traffic.maxAltitude = parseInt(document.getElementById('sTrafficAlt').value) || 0;
  const wlRaw = document.getElementById('sTrafficWatchlist').value.trim();
  c.traffic.watchlist = wlRaw ? wlRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  c.traffic.watchMode = document.getElementById('sTrafficWatchMode').value || 'highlight';

  // OGN / FLARM
  c.traffic.ognEnabled = document.getElementById('sOgnEnabled').checked;
  c.traffic.ognRadiusKm = parseInt(document.getElementById('sOgnRadius').value) || 250;

  // FlightRadar24
  c.traffic.fr24Enabled = document.getElementById('sFr24Enabled').checked;
  c.traffic.fr24ApiKey = document.getElementById('sFr24ApiKey').value.trim();

  // Sections
  c.activityProfile = document.getElementById('sActivityProfile').value;
  document.querySelectorAll('#sSectionToggles input[data-section]').forEach(cb => {
    c.sections[cb.dataset.section] = cb.checked;
  });
  c.tafDisplay = document.getElementById('sTafDisplay').value;
  c.sidebarPosition = document.getElementById('sSidebarPosition').value;

  // Kiosque
  if (!c.kiosk) c.kiosk = {};
  const newKioskState = document.getElementById('sKioskEnabled').checked;
  const kioskChanged = newKioskState !== (originalConfig.kiosk?.enabled === true);
  c.kiosk.enabled = newKioskState;

  // Multi-écran
  c.screens = collectScreens();
  // Rétro-compatibilité : garder kiosk.displayIndex et layout synchronisés
  c.kiosk.displayIndex = c.screens[0]?.displayIndex || 0;
  const s0 = c.screens[0];
  c.layout = (s0?.showMap && s0?.showSidebar === false) ? 'mapOnly' : 'full';
  // Dériver clubDisplay.enabled depuis les écrans (pour le serveur)
  if (!c.clubDisplay) c.clubDisplay = {};
  c.clubDisplay.enabled = c.screens.some(s => s.clubDisplay === true);

  // Thème
  const isAuto = document.querySelector('input[name="sThemeMode"]:checked').value === 'auto';
  if (isAuto) {
    c.themeName = 'auto';
    const dayCard = document.querySelector('#sThemeDayGrid .theme-card.selected');
    const nightCard = document.querySelector('#sThemeNightGrid .theme-card.selected');
    c.themeAuto = {
      day: dayCard ? dayCard.dataset.theme : 'daylight',
      night: nightCard ? nightCard.dataset.theme : 'cockpit'
    };
  } else {
    const fixedCard = document.querySelector('#sThemeFixedGrid .theme-card.selected');
    c.themeName = fixedCard ? fixedCard.dataset.theme : 'cockpit';
  }

  // Branding
  if (!c.branding) c.branding = {};
  c.branding.appTitle = document.getElementById('sAppTitle').value.trim() || 'AEROKIOSK';
  c.branding.clubName = document.getElementById('sClubName').value.trim();

  // Affichage club
  if (!c.clubDisplay) c.clubDisplay = {};
  c.clubDisplay.serverEnabled = document.getElementById('sClubServerEnabled').checked;
  c.clubDisplay.serverPort = parseInt(document.getElementById('sClubServerPort').value) || 3000;
  c.clubDisplay.placement = document.getElementById('sClubPlacement').value;
  c.clubDisplay.defaultDuration = parseInt(document.getElementById('sClubDuration').value) || 15;

  // Flotte
  if (!c.fleet) c.fleet = {};
  c.fleet.showOverlay = document.getElementById('sFleetShowOverlay').checked;
  c.fleet.showStatusBar = document.getElementById('sFleetShowStatusBar').checked;
  // Rétrocompat : enabled = au moins un des deux actif
  c.fleet.enabled = c.fleet.showOverlay || c.fleet.showStatusBar;
  c.fleet.source = document.getElementById('sFleetSource').value || 'manual';
  c.fleet.apiEndpoint = document.getElementById('sFleetApiEndpoint').value.trim();
  c.fleet.apiKey = document.getElementById('sFleetApiKey').value.trim();
  c.fleet.durationSeconds = parseInt(document.getElementById('sFleetDuration').value) || 15;
  c.fleet.showHours = document.getElementById('sFleetShowHours').checked;
  c.fleet.statusScrollSeconds = parseInt(document.getElementById('sFleetStatusScroll').value) || 5;
  c.fleet.overlayScrollSeconds = parseInt(document.getElementById('sFleetOverlayScroll').value) || 8;
  c.fleet.showGoSidebar = document.getElementById('sFleetShowGo').checked;
  c.fleet.showMaintSidebar = document.getElementById('sFleetShowMaint').checked;
  c.fleet.showSimSidebar = document.getElementById('sFleetShowSim').checked;
  c.fleet.autoWatchlist = document.getElementById('sFleetAutoWatchlist').checked;

  // Planification (salles)
  if (!c.rooms) c.rooms = {};
  c.rooms.enabled = document.getElementById('sGearupEnabled').checked;
  c.rooms.defaultBriefingMinutes = parseInt(document.getElementById('sRoomsBrief').value) || 30;
  c.rooms.defaultDebriefingMinutes = parseInt(document.getElementById('sRoomsDebrief').value) ?? 15;

  // Connecteur GearUp
  if (!c.gearup) c.gearup = {};
  c.gearup.apiSource = document.getElementById('sGearupApiSource').value || '';
  c.gearup.apiEndpoint = document.getElementById('sGearupApiEndpoint').value.trim();
  c.gearup.apiKey = document.getElementById('sGearupApiKey').value.trim();
  c.gearup.pollIntervalMs = parseInt(document.getElementById('sGearupPoll').value) * 1000 || 300000;

  // Sauvegarder
  const result = await platform.saveConfig(c);
  if (result.success) {
    closeSettings(false);
    if (kioskChanged) {
      // Le mode kiosque change les options de la fenêtre → redémarrage complet
      await platform.restartApp();
    } else {
      // Simple rechargement du dashboard
      await platform.reloadDashboard();
    }
  } else {
    alert(t('settings.footer.saveError') + ' ' + (result.errors || []).join(', '));
  }
}

// ============================================================
// MULTI-ÉCRAN WEB
// ============================================================

function isWebMode() {
  return document.body.classList.contains('web-mode');
}

function openWebScreen() {
  const screens = settingsConfig.screens || [{}];
  const nextIdx = screens.length; // index du prochain écran (1, 2, ...)
  const key = new URLSearchParams(window.location.search).get('key') || localStorage.getItem('aerokiosk_license_key') || '';
  let url = 'index.html?screen=' + nextIdx;
  if (key) url += '&key=' + encodeURIComponent(key);
  window.open(url, '_blank');
  populateWebScreens();
}

function populateWebScreens() {
  const container = document.getElementById('sWebScreenList');
  if (!container) return;
  const screens = settingsConfig.screens || [{}];
  const key = new URLSearchParams(window.location.search).get('key') || localStorage.getItem('aerokiosk_license_key') || '';

  if (screens.length <= 1) {
    container.innerHTML = '<div style="color:var(--wiz-text-dim);font-size:13px;padding:8px 0;">Aucun écran supplémentaire configuré. Cliquez sur "Ouvrir un écran supplémentaire" pour en ajouter.</div>';
    return;
  }

  container.innerHTML = screens.slice(1).map(function(scr, i) {
    const idx = i + 1;
    let url = 'index.html?screen=' + idx;
    if (key) url += '&key=' + encodeURIComponent(key);
    const features = [];
    if (scr.showMap !== false) features.push('Carte');
    if (scr.showSidebar !== false) features.push('Sidebar');
    if (scr.showPlanning) features.push('Planning');
    if (scr.fleet) features.push('Flotte');
    if (scr.clubDisplay) features.push('Club');
    return '<div style="display:flex; align-items:center; gap:8px; padding:8px 12px; border:1px solid var(--border,#1e2a36); border-radius:6px; background:var(--panel,#111820);">'
      + '<span style="font-size:13px; flex:1;">Écran ' + (idx + 1) + ' — ' + (features.join(', ') || 'Défaut') + '</span>'
      + '<a href="' + url + '" target="_blank" class="btn btn-secondary btn-small" style="text-decoration:none;">Ouvrir</a>'
      + '</div>';
  }).join('');
}
