/**
 * platform-adapter.js — Couche d'abstraction Electron <-> Web
 *
 * Expose `window.platform` avec la meme API que `window.electronAPI` (preload.js).
 * - Mode Electron (quand electronAPI existe) : proxy transparent, zero changement.
 * - Mode Web (navigateur standard) : appels directs Supabase / fetch / Realtime.
 *
 * Le dashboard (index.html) et settings.js appellent `platform.xxx()` partout.
 * Ce fichier doit etre charge AVANT le code principal du dashboard.
 */

(function() {
  'use strict';

  // ============================================================
  // MODE ELECTRON — proxy transparent
  // ============================================================

  if (window.electronAPI) {
    window.platform = window.electronAPI;
    console.log('[Platform] Mode Electron — proxy transparent');
    return;
  }

  // ============================================================
  // MODE WEB — implementations directes
  // ============================================================

  console.log('[Platform] Mode Web — Supabase direct');

  // Marquer le mode web sur le body (pour masquer les éléments Electron-only via CSS)
  document.addEventListener('DOMContentLoaded', function() {
    document.body.classList.add('web-mode');
  });
  // Si le DOM est déjà chargé (script en bas de page)
  if (document.body) document.body.classList.add('web-mode');

  var SUPABASE_URL = 'https://yfucrljbqdoiuqmgvrjx.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_85vUBMn6NPS6loJefBuZ8A_v7I_TakV';
  var API_TIMEOUT = 15000;

  // --- Helpers ---

  function getLicenseKey() {
    var params = new URLSearchParams(window.location.search);
    return params.get('key') || localStorage.getItem('aerokiosk_license_key') || '';
  }

  function saveLicenseKey(key) {
    if (key) localStorage.setItem('aerokiosk_license_key', key);
  }

  function supabaseHeaders(extra) {
    var headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    };
    var key = getLicenseKey();
    if (key) headers['x-license-key'] = key;
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        headers[keys[i]] = extra[keys[i]];
      }
    }
    return headers;
  }

  // Persister la cle si elle vient de l'URL
  var urlKey = new URLSearchParams(window.location.search).get('key');
  if (urlKey) saveLicenseKey(urlKey);

  // Cache config pour eviter les appels multiples
  var cachedConfig = null;

  // ============================================================
  // Chargement dynamique de scripts (pour Supabase SDK)
  // ============================================================

  function loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  // ============================================================
  // Client Supabase Realtime (lazy init)
  // ============================================================

  var _supabaseClient = null;
  var _supabaseReady = null;

  function initSupabase() {
    if (_supabaseReady) return _supabaseReady;
    _supabaseReady = loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js')
      .then(function() {
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Platform] Supabase Realtime client initialized');
        return _supabaseClient;
      })
      .catch(function(err) {
        console.error('[Platform] Failed to load Supabase SDK:', err.message);
        _supabaseReady = null; // Permettre un retry
        return null;
      });
    return _supabaseReady;
  }

  // Callbacks Realtime (plusieurs listeners possibles par type)
  var fleetCallbacks = [];
  var fleetSubscribed = false;
  var slidesCallbacks = [];
  var slidesSubscribed = false;

  // FR24 polling (Edge Function proxy)
  var fr24Callbacks = [];
  var fr24Timer = null;

  // OGN polling (Edge Function proxy)
  var ognCallbacks = [];
  var ognTimer = null;

  // ============================================================
  // Open-Meteo — port de lib/openmeteo.js pour le navigateur
  // ============================================================

  var OPENMETEO_URL = 'https://api.open-meteo.com/v1/forecast';
  var OM_CURRENT_VARS = 'wind_speed_10m,wind_direction_10m,temperature_2m,pressure_msl,wind_gusts_10m,dewpoint_2m,cloud_cover,precipitation';
  var OM_HOURLY_VARS = 'cape,boundary_layer_height,uv_index,wind_speed_850hPa,wind_direction_850hPa';
  var omCache = {};
  var OM_CACHE_TTL = 3600000;     // 1h
  var OM_STALE_TTL = 6 * 3600000; // 6h — donnees perimees mais utilisables si API down

  function buildGrid(centerLat, centerLon, radiusDeg, step, radiusLonDeg) {
    var radiusLat = radiusDeg;
    var radiusLon = radiusLonDeg || radiusDeg;
    var lats = [];
    var lons = [];
    for (var lat = centerLat + radiusLat; lat >= centerLat - radiusLat; lat -= step) {
      lats.push(Math.round(lat * 100) / 100);
    }
    for (var lon = centerLon - radiusLon; lon <= centerLon + radiusLon; lon += step) {
      lons.push(Math.round(lon * 100) / 100);
    }
    return { lats: lats, lons: lons, nx: lons.length, ny: lats.length };
  }

  function fetchOpenMeteoGrid(centerLat, centerLon, options) {
    var radiusDeg = (options && options.radiusDeg) || 3;
    var radiusLonDeg = options && options.radiusLonDeg;
    var step = (options && options.step) || 0.75;
    var timeoutMs = (options && options.timeoutMs) || 10000;

    var cacheKey = 'all_' + centerLat + '_' + centerLon + '_' + radiusDeg + '_' + (radiusLonDeg || '') + '_' + step;
    var cached = omCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < OM_CACHE_TTL)) {
      return Promise.resolve(cached.data);
    }

    var grid = buildGrid(centerLat, centerLon, radiusDeg, step, radiusLonDeg);
    var pairsLat = [];
    var pairsLon = [];
    for (var li = 0; li < grid.lats.length; li++) {
      for (var lj = 0; lj < grid.lons.length; lj++) {
        pairsLat.push(grid.lats[li]);
        pairsLon.push(grid.lons[lj]);
      }
    }

    var url = OPENMETEO_URL +
      '?latitude=' + pairsLat.join(',') +
      '&longitude=' + pairsLon.join(',') +
      '&current=' + OM_CURRENT_VARS +
      '&hourly=' + OM_HOURLY_VARS +
      '&forecast_hours=1&timezone=auto';

    return fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      .then(function(res) {
        if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
        return res.json();
      })
      .then(function(raw) {
        var points = Array.isArray(raw) ? raw : [raw];
        if (points.length !== pairsLat.length) {
          throw new Error('Expected ' + pairsLat.length + ' points, got ' + points.length);
        }

        var uData = [], vData = [];
        var u850 = [], v850 = [];
        var tempValues = [], pressValues = [], gustValues = [];
        var dewpointValues = [], capeValues = [], pblValues = [];
        var uvValues = [], cloudValues = [], precipValues = [];

        for (var i = 0; i < points.length; i++) {
          var c = points[i].current;
          var h = points[i].hourly;

          if (c) {
            var speedMs = (c.wind_speed_10m || 0) / 3.6;
            var dirDeg = c.wind_direction_10m || 0;
            var rad = (dirDeg * Math.PI) / 180;
            uData.push(-speedMs * Math.sin(rad));
            vData.push(-speedMs * Math.cos(rad));
            tempValues.push(c.temperature_2m != null ? c.temperature_2m : 0);
            pressValues.push(c.pressure_msl != null ? c.pressure_msl : 0);
            gustValues.push(c.wind_gusts_10m != null ? c.wind_gusts_10m / 3.6 * 1.944 : 0);
            dewpointValues.push(c.dewpoint_2m != null ? c.dewpoint_2m : 0);
            cloudValues.push(c.cloud_cover != null ? c.cloud_cover : 0);
            precipValues.push(c.precipitation != null ? c.precipitation : 0);
          } else {
            uData.push(0); vData.push(0);
            tempValues.push(0); pressValues.push(0);
            gustValues.push(0); dewpointValues.push(0);
            cloudValues.push(0); precipValues.push(0);
          }

          if (h) {
            capeValues.push(h.cape && h.cape[0] != null ? h.cape[0] : 0);
            pblValues.push(h.boundary_layer_height && h.boundary_layer_height[0] != null ? h.boundary_layer_height[0] : 0);
            uvValues.push(h.uv_index && h.uv_index[0] != null ? h.uv_index[0] : 0);
            var speed850 = (h.wind_speed_850hPa && h.wind_speed_850hPa[0]) || 0;
            var dir850 = (h.wind_direction_850hPa && h.wind_direction_850hPa[0]) || 0;
            var speedMs850 = speed850 / 3.6;
            var rad850 = (dir850 * Math.PI) / 180;
            u850.push(-speedMs850 * Math.sin(rad850));
            v850.push(-speedMs850 * Math.cos(rad850));
          } else {
            capeValues.push(0); pblValues.push(0); uvValues.push(0);
            u850.push(0); v850.push(0);
          }
        }

        // Format grib2json pour leaflet-velocity (vent surface)
        var header = {
          parameterCategory: 2, parameterNumber: 2,
          lo1: grid.lons[0], la1: grid.lats[0],
          lo2: grid.lons[grid.lons.length - 1], la2: grid.lats[grid.lats.length - 1],
          dx: step, dy: step, nx: grid.nx, ny: grid.ny
        };
        var velocity = [
          { header: Object.assign({}, header, { parameterNumber: 2 }), data: uData },
          { header: Object.assign({}, header, { parameterNumber: 3 }), data: vData }
        ];
        // Vent altitude 850 hPa
        var velocity850 = [
          { header: Object.assign({}, header, { parameterNumber: 2 }), data: u850 },
          { header: Object.assign({}, header, { parameterNumber: 3 }), data: v850 }
        ];

        // Format grille pour ScalarOverlay
        var bounds = {
          north: grid.lats[0], south: grid.lats[grid.lats.length - 1],
          east: grid.lons[grid.lons.length - 1], west: grid.lons[0]
        };
        function mkGrid(values) { return { bounds: bounds, nx: grid.nx, ny: grid.ny, values: values }; }
        var scalars = {
          temperature_2m: mkGrid(tempValues),
          pressure_msl: mkGrid(pressValues),
          wind_gusts_10m: mkGrid(gustValues),
          dewpoint_2m: mkGrid(dewpointValues),
          cape: mkGrid(capeValues),
          boundary_layer_height: mkGrid(pblValues),
          uv_index: mkGrid(uvValues),
          cloud_cover: mkGrid(cloudValues),
          precipitation: mkGrid(precipValues)
        };

        var result = { velocity: velocity, velocity850: velocity850, scalars: scalars };
        omCache[cacheKey] = { data: result, timestamp: Date.now() };
        return result;
      })
      .catch(function(err) {
        if (cached && (Date.now() - cached.timestamp < OM_STALE_TTL)) {
          console.warn('[OpenMeteo] Fetch failed, using stale cache:', err.message);
          return cached.data;
        }
        console.error('[OpenMeteo] Fetch failed:', err.message);
        return null;
      });
  }

  // ============================================================
  // Base aeroports — pays du club + pays limitrophes
  // ============================================================

  // Mapping prefixe ICAO (2 lettres) -> code pays ISO 2
  var ICAO_TO_COUNTRY = {
    'LA': 'al', 'LO': 'at', 'LQ': 'ba', 'EB': 'be', 'LB': 'bg',
    'UM': 'by', 'LS': 'ch', 'LK': 'cz', 'ED': 'de', 'ET': 'de',
    'EK': 'dk', 'EE': 'ee', 'LE': 'es', 'GC': 'es', 'EF': 'fi',
    'LF': 'fr', 'EG': 'gb', 'UG': 'ge', 'LG': 'gr', 'LD': 'hr',
    'LH': 'hu', 'EI': 'ie', 'BI': 'is', 'LI': 'it', 'EY': 'lt',
    'EL': 'lu', 'EV': 'lv', 'LU': 'md', 'LY': 'rs', 'LW': 'mk',
    'LM': 'mt', 'EH': 'nl', 'EN': 'no', 'EP': 'pl', 'LP': 'pt',
    'LR': 'ro', 'ES': 'se', 'LJ': 'si', 'LZ': 'sk', 'LT': 'tr',
    'UK': 'ua', 'LX': 'gi'
  };

  // Pays limitrophes (geographie)
  var COUNTRY_NEIGHBORS = {
    'fr': ['be', 'lu', 'de', 'ch', 'it', 'es', 'gb'],
    'de': ['fr', 'be', 'lu', 'nl', 'dk', 'pl', 'cz', 'at', 'ch'],
    'it': ['fr', 'ch', 'at', 'si', 'hr', 'sm'],
    'es': ['fr', 'pt', 'gi'],
    'ch': ['fr', 'de', 'it', 'at'],
    'be': ['fr', 'nl', 'de', 'lu'],
    'nl': ['be', 'de'],
    'at': ['de', 'ch', 'it', 'si', 'hu', 'sk', 'cz'],
    'gb': ['ie', 'fr', 'gg', 'je', 'im'],
    'ie': ['gb'],
    'lu': ['fr', 'be', 'de'],
    'dk': ['de', 'se', 'no', 'fo'],
    'se': ['no', 'dk', 'fi'],
    'no': ['se', 'fi', 'dk', 'ru'],
    'fi': ['se', 'no', 'ee', 'ru'],
    'pl': ['de', 'cz', 'sk', 'ua', 'lt', 'by'],
    'cz': ['de', 'pl', 'sk', 'at'],
    'sk': ['cz', 'pl', 'ua', 'hu', 'at'],
    'hu': ['at', 'sk', 'ua', 'ro', 'rs', 'hr', 'si'],
    'ro': ['hu', 'ua', 'md', 'bg', 'rs'],
    'bg': ['ro', 'rs', 'mk', 'gr', 'tr'],
    'gr': ['bg', 'tr', 'al', 'mk'],
    'hr': ['si', 'hu', 'rs', 'ba'],
    'si': ['it', 'at', 'hu', 'hr'],
    'ba': ['hr', 'rs', 'me'],
    'rs': ['hu', 'ro', 'bg', 'mk', 'ba', 'hr', 'me', 'xk', 'al'],
    'me': ['ba', 'rs', 'al', 'xk', 'hr'],
    'mk': ['gr', 'bg', 'rs', 'al', 'xk'],
    'al': ['gr', 'mk', 'rs', 'me', 'xk'],
    'xk': ['rs', 'me', 'al', 'mk'],
    'tr': ['bg', 'gr', 'ge'],
    'ua': ['pl', 'sk', 'hu', 'ro', 'md', 'by', 'ru'],
    'by': ['pl', 'lt', 'lv', 'ru', 'ua'],
    'lt': ['pl', 'lv', 'by'],
    'lv': ['lt', 'ee', 'by', 'ru'],
    'ee': ['fi', 'lv', 'ru'],
    'md': ['ua', 'ro'],
    'pt': ['es'],
    'ge': ['tr', 'ru'],
    'mt': ['it'],
    'is': [],
    'fo': ['dk'],
    'gi': ['es'],
    'gg': ['gb', 'fr'],
    'je': ['gb', 'fr'],
    'im': ['gb', 'ie'],
    'sm': ['it'],
    'us': ['ca'],
    'ca': ['us'],
    'ru': ['by', 'ua', 'ee', 'lv', 'fi', 'no', 'ge']
  };

  var airportDB = null;
  var airportIndex = null;
  var airportLoadPromise = null;

  function detectCountry(icao) {
    if (!icao || icao.length < 2) return null;
    // Prefixes mono-lettre
    if (icao.charAt(0) === 'K') return 'us';
    if (icao.charAt(0) === 'C') return 'ca';
    // Prefixe 2 lettres
    var prefix2 = icao.substring(0, 2);
    var country = ICAO_TO_COUNTRY[prefix2];
    if (country) return country;
    // Fallback : U* = Russie (sauf UK=Ukraine, UM=Belarus, UG=Georgie)
    if (icao.charAt(0) === 'U') return 'ru';
    return null;
  }

  function getCountriesToLoad(icao) {
    var country = detectCountry(icao);
    if (!country) return ['fr']; // defaut France
    var neighbors = COUNTRY_NEIGHBORS[country] || [];
    var countries = [country];
    for (var i = 0; i < neighbors.length; i++) {
      if (countries.indexOf(neighbors[i]) === -1) countries.push(neighbors[i]);
    }
    return countries;
  }

  function loadAirports() {
    if (airportLoadPromise) return airportLoadPromise;

    var cfg = cachedConfig;
    var icao = (cfg && cfg.station && cfg.station.icao) || '';
    var countries = getCountriesToLoad(icao);
    console.log('[Platform] Loading airports for:', countries.join(', '));

    var fetches = [];
    for (var i = 0; i < countries.length; i++) {
      (function(cc) {
        fetches.push(
          fetch('data/airports-' + cc + '.json')
            .then(function(res) {
              if (!res.ok) throw new Error(res.status);
              return res.json();
            })
            .catch(function(err) {
              console.warn('[Platform] airports-' + cc + '.json:', err.message);
              return {};
            })
        );
      })(countries[i]);
    }

    airportLoadPromise = Promise.all(fetches).then(function(results) {
      airportDB = {};
      for (var r = 0; r < results.length; r++) {
        var keys = Object.keys(results[r]);
        for (var k = 0; k < keys.length; k++) {
          airportDB[keys[k]] = results[r][keys[k]];
        }
      }
      airportIndex = [];
      var dbKeys = Object.keys(airportDB);
      for (var j = 0; j < dbKeys.length; j++) {
        var id = dbKeys[j];
        var d = airportDB[id];
        airportIndex.push({
          id: id,
          searchText: (id + ' ' + (d.name || '') + ' ' + (d.city || '')).toLowerCase(),
          name: d.name,
          city: d.city,
          type: d.type,
          metarStation: d.metarStation,
          metarDistance: d.metarDistance
        });
      }
      console.log('[Platform] Airports loaded:', airportIndex.length, 'terrains');
      return airportDB;
    });

    return airportLoadPromise;
  }

  // ============================================================
  // Helpers ecran — reproduit la logique de main.js get-screen-config
  // ============================================================

  function buildScreenConfig(cfg, screenIndex) {
    if (!cfg) return { showMap: true, showPlanning: false, showSidebar: true, fleet: false, clubDisplay: false };
    var screens = cfg.screens || [];
    var scr = screens[screenIndex] || {};
    var globalSections = cfg.sections || {};
    var globalLayers = (cfg.maps && cfg.maps.layers) || [];
    var fleetCfg = cfg.fleet || {};

    // Layers : merge per-screen overrides avec les layers globales
    var resolvedLayers = null;
    if (scr.layers) {
      resolvedLayers = {};
      for (var i = 0; i < globalLayers.length; i++) {
        var l = globalLayers[i];
        resolvedLayers[l.id] = scr.layers[l.id] !== undefined ? scr.layers[l.id] : l.enabled;
      }
    }

    return {
      displayIndex: scr.displayIndex || 0,
      showMap: scr.showMap !== undefined ? scr.showMap : true,
      showPlanning: scr.showPlanning || false,
      showSidebar: scr.showSidebar !== undefined ? scr.showSidebar : true,
      sections: scr.sections || Object.assign({}, globalSections),
      fleet: scr.fleet !== undefined ? scr.fleet : (fleetCfg.showOverlay !== undefined ? fleetCfg.showOverlay : (fleetCfg.enabled || false)),
      clubDisplay: scr.clubDisplay !== undefined ? scr.clubDisplay : false,
      layers: resolvedLayers
    };
  }

  // ============================================================
  // API — meme interface que preload.js
  // ============================================================

  window.platform = {

    // --- Config ---
    getConfig: function() {
      var key = getLicenseKey();
      if (!key) return Promise.resolve({});
      return fetch(
        SUPABASE_URL + '/rest/v1/club_config?license_key=eq.' + encodeURIComponent(key) + '&select=config',
        { headers: supabaseHeaders(), signal: AbortSignal.timeout(API_TIMEOUT) }
      ).then(function(res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      }).then(function(rows) {
        if (rows.length > 0 && rows[0].config) {
          cachedConfig = rows[0].config;
          return cachedConfig;
        }
        return {};
      }).catch(function(err) {
        console.error('[Platform] getConfig error:', err.message);
        return cachedConfig || {};
      });
    },

    saveConfig: function(config) {
      var key = getLicenseKey();
      if (!key) return Promise.resolve({ success: false, reason: 'no_license' });
      return fetch(SUPABASE_URL + '/rest/v1/club_config', {
        method: 'POST',
        headers: supabaseHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({
          license_key: key,
          config: config,
          updated_at: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(API_TIMEOUT)
      }).then(function(res) {
        if (!res.ok) throw new Error(res.status);
        cachedConfig = config;
        return { success: true, needsRestart: false };
      }).catch(function(err) {
        console.error('[Platform] saveConfig error:', err.message);
        return { success: false, reason: err.message };
      });
    },

    isFirstLaunch: function() {
      return Promise.resolve(!getLicenseKey());
    },

    // --- Recherche aeroports (chargement lazy pays du club + limitrophes) ---
    searchAirports: function(query) {
      return loadAirports().then(function() {
        if (!airportIndex || !query) return [];
        var q = query.toLowerCase().trim();
        if (q.length < 2) return [];
        var results = [];
        for (var i = 0; i < airportIndex.length && results.length < 20; i++) {
          if (airportIndex[i].searchText.indexOf(q) !== -1) {
            var a = airportIndex[i];
            results.push({
              id: a.id, name: a.name, city: a.city, type: a.type,
              metarStation: a.metarStation, metarDistance: a.metarDistance
            });
          }
        }
        return results;
      });
    },

    getAirport: function(id) {
      return loadAirports().then(function() {
        if (!airportDB || !id) return null;
        return airportDB[id.toUpperCase()] || airportDB[id] || null;
      });
    },

    getAllAirports: function() {
      return loadAirports().then(function() {
        return airportDB || {};
      });
    },

    // --- Licence ---
    validateLicense: function(key) {
      if (!key) return Promise.resolve({ valid: false, reason: 'no_key' });
      return fetch(
        SUPABASE_URL + '/rest/v1/club_config?license_key=eq.' + encodeURIComponent(key) + '&select=license_key',
        { headers: supabaseHeaders(), signal: AbortSignal.timeout(API_TIMEOUT) }
      ).then(function(res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      }).then(function(rows) {
        if (rows.length > 0) {
          saveLicenseKey(key);
          return { valid: true };
        }
        return { valid: false, reason: 'not_found' };
      }).catch(function(err) {
        console.error('[Platform] validateLicense error:', err.message);
        return { valid: false, reason: err.message };
      });
    },

    getLicenseStatus: function() {
      var key = getLicenseKey();
      if (!key) return Promise.resolve({ valid: false });
      var cfg = cachedConfig;
      if (cfg && cfg.license) {
        return Promise.resolve({
          valid: cfg.license.mode === 'full',
          mode: cfg.license.mode || 'demo',
          expiresAt: cfg.license.expiresAt || null
        });
      }
      return Promise.resolve({ valid: !!key, mode: key ? 'full' : 'demo' });
    },

    removeLicenseDevice: function() { return Promise.resolve({ success: false }); },
    resetAllDevices: function() { return Promise.resolve({ success: false }); },
    getDeviceInfo: function() {
      return Promise.resolve({ uuid: 'web-' + Date.now(), name: navigator.userAgent.substring(0, 50) });
    },

    // --- Mot de passe admin (Web Crypto API) ---
    hashPassword: function(password) {
      if (!password) return Promise.resolve('');
      var encoder = new TextEncoder();
      var data = encoder.encode(password);
      return crypto.subtle.digest('SHA-256', data).then(function(buffer) {
        var hashArray = Array.from(new Uint8Array(buffer));
        return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    },

    verifyPassword: function(password) {
      if (!password) return Promise.resolve(false);
      var cfg = cachedConfig;
      if (!cfg || !cfg.admin || !cfg.admin.passwordHash) return Promise.resolve(false);
      var storedHash = cfg.admin.passwordHash;
      return window.platform.hashPassword(password).then(function(hash) {
        return hash === storedHash;
      });
    },

    resetPasswordWithLicense: function(key) {
      var storedKey = getLicenseKey();
      if (!key || !storedKey) return Promise.resolve({ success: false });
      if (key.replace(/-/g, '').toUpperCase() !== storedKey.replace(/-/g, '').toUpperCase()) {
        return Promise.resolve({ success: false });
      }
      // Effacer le mot de passe dans la config
      if (cachedConfig && cachedConfig.admin) {
        cachedConfig.admin.passwordHash = '';
      }
      return window.platform.saveConfig(cachedConfig).then(function() {
        return { success: true };
      });
    },

    // --- Export / Import ---
    exportConfig: function() {
      try {
        var cfg = cachedConfig || {};
        var json = JSON.stringify(cfg, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'aerokiosk-config-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return Promise.resolve({ success: true });
      } catch (err) {
        return Promise.resolve({ success: false, errors: [err.message] });
      }
    },

    importConfig: function() {
      return new Promise(function(resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        input.addEventListener('change', function() {
          var file = input.files && input.files[0];
          if (!file) {
            document.body.removeChild(input);
            resolve({ canceled: true });
            return;
          }
          var reader = new FileReader();
          reader.onload = function() {
            try {
              var config = JSON.parse(reader.result);
              document.body.removeChild(input);
              resolve({ success: true, config: config });
            } catch (e) {
              document.body.removeChild(input);
              resolve({ success: false, errors: ['JSON invalide : ' + e.message] });
            }
          };
          reader.onerror = function() {
            document.body.removeChild(input);
            resolve({ success: false, errors: ['Erreur de lecture du fichier'] });
          };
          reader.readAsText(file);
        });
        // Si l'utilisateur annule le dialogue fichier
        input.addEventListener('cancel', function() {
          document.body.removeChild(input);
          resolve({ canceled: true });
        });
        document.body.appendChild(input);
        input.click();
      });
    },

    // --- Fichiers (logos) ---
    selectFile: function() {
      return new Promise(function(resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', function() {
          var file = input.files && input.files[0];
          if (!file) {
            document.body.removeChild(input);
            resolve({ canceled: true });
            return;
          }
          document.body.removeChild(input);
          // Stocker le fichier pour copyLogo
          window._pendingLogoFile = file;
          resolve({ canceled: false, path: file.name });
        });
        input.addEventListener('cancel', function() {
          document.body.removeChild(input);
          resolve({ canceled: true });
        });
        document.body.appendChild(input);
        input.click();
      });
    },

    copyLogo: function() {
      var file = window._pendingLogoFile;
      if (!file) return Promise.resolve({ success: false });
      var key = getLicenseKey();
      var storagePath = (key ? key + '/' : '') + Date.now() + '-' + file.name;
      // Upload vers Supabase Storage
      return fetch(
        SUPABASE_URL + '/storage/v1/object/club-logos/' + encodeURIComponent(storagePath),
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': file.type || 'image/png',
            'x-upsert': 'true'
          },
          body: file
        }
      ).then(function(res) {
        window._pendingLogoFile = null;
        if (!res.ok) throw new Error('Upload failed: ' + res.status);
        var publicUrl = SUPABASE_URL + '/storage/v1/object/public/club-logos/' + storagePath;
        return { success: true, fileName: publicUrl };
      }).catch(function(err) {
        window._pendingLogoFile = null;
        console.error('[Platform] copyLogo error:', err.message);
        // Fallback : convertir en data URL (pas d'upload, stocke en base64 dans la config)
        return new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onload = function() {
            resolve({ success: true, fileName: reader.result });
          };
          reader.onerror = function() {
            resolve({ success: false });
          };
          reader.readAsDataURL(file);
        });
      });
    },

    getLogosDir: function() {
      return Promise.resolve(SUPABASE_URL + '/storage/v1/object/public/club-logos/');
    },

    // --- Test connexion ---
    testConnection: function() { return Promise.resolve({ metar: true, owm: true }); },
    testGearUp: function() { return Promise.resolve({ success: false }); },

    // --- App info ---
    getAppVersion: function() { return Promise.resolve('web'); },

    // --- Navigation ---
    wizardComplete: function() {
      var key = getLicenseKey();
      if (key) {
        window.location.href = 'index.html?key=' + encodeURIComponent(key);
      } else {
        window.location.href = 'index.html';
      }
      return Promise.resolve();
    },
    openWizard: function() {
      var key = getLicenseKey();
      window.location.href = key ? 'wizard.html?key=' + encodeURIComponent(key) : 'wizard.html';
      return Promise.resolve();
    },
    reloadDashboard: function() { window.location.reload(); return Promise.resolve(); },
    restartApp: function() { window.location.reload(); return Promise.resolve(); },
    quitApp: function() { return Promise.resolve(); },

    // --- OGN (Session 19 — Edge Function proxy polling) ---
    onOgnTraffic: function(callback) {
      if (!callback) return;
      ognCallbacks.push(callback);
      if (ognTimer) return; // deja en cours

      var cfg = cachedConfig;
      var lat = (cfg && cfg.station && cfg.station.lat) || 0;
      var lon = (cfg && cfg.station && cfg.station.lon) || 0;
      var radiusKm = (cfg && cfg.traffic && cfg.traffic.radiusKm) || 250;

      function doFetch() {
        var key = getLicenseKey();
        if (!key) return;

        _originalFetch.call(window, SUPABASE_URL + '/functions/v1/ogn-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licenseKey: key,
            lat: lat,
            lon: lon,
            radiusKm: radiusKm
          }),
          signal: AbortSignal.timeout(15000)
        })
        .then(function(res) {
          if (!res.ok) {
            return res.json().catch(function() { return {}; }).then(function(d) {
              console.warn('[OGN web] HTTP ' + res.status + ':', d.error || '');
              return null;
            });
          }
          return res.json();
        })
        .then(function(data) {
          if (!data || !data.aircraft) return;
          // Ajouter lastSeen a chaque position (timestamp client)
          var now = Date.now();
          var arr = data.aircraft;
          for (var j = 0; j < arr.length; j++) {
            arr[j].lastSeen = now;
          }
          for (var i = 0; i < ognCallbacks.length; i++) {
            try { ognCallbacks[i](arr); } catch (e) { console.error('[OGN web] callback error:', e); }
          }
        })
        .catch(function(err) {
          console.warn('[OGN web] fetch error:', err.message);
        });
      }

      // Premier fetch immediat, puis polling toutes les 10s
      doFetch();
      ognTimer = setInterval(doFetch, 10000);
      console.log('[OGN web] Polling started (10s interval)');
    },

    restartOgn: function() {
      if (ognTimer) {
        clearInterval(ognTimer);
        ognTimer = null;
      }
      var cbs = ognCallbacks.slice();
      ognCallbacks = [];
      for (var i = 0; i < cbs.length; i++) {
        window.platform.onOgnTraffic(cbs[i]);
      }
    },

    // --- FR24 (Session 18 — Edge Function proxy) ---
    onFr24Traffic: function(callback) {
      if (!callback) return;
      fr24Callbacks.push(callback);
      if (fr24Timer) return; // deja en cours

      var cfg = cachedConfig;
      var lat = (cfg && cfg.station && cfg.station.lat) || 0;
      var lon = (cfg && cfg.station && cfg.station.lon) || 0;
      var radiusKm = (cfg && cfg.traffic && cfg.traffic.radiusKm) || 250;
      var apiKey = (cfg && cfg.traffic && cfg.traffic.fr24ApiKey) || '';
      var intervalMs = apiKey ? 90000 : 30000; // 90s API, 30s scraper

      function doFetch() {
        var key = getLicenseKey();
        if (!key) return;
        var bodyObj = {
          action: 'traffic',
          licenseKey: key,
          lat: lat,
          lon: lon,
          radiusKm: radiusKm
        };
        if (apiKey) bodyObj.apiKey = apiKey;

        _originalFetch.call(window, SUPABASE_URL + '/functions/v1/fr24-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
          signal: AbortSignal.timeout(15000)
        })
        .then(function(res) {
          if (!res.ok) {
            return res.json().catch(function() { return {}; }).then(function(d) {
              console.warn('[FR24 web] HTTP ' + res.status + ':', d.error || '');
              return null;
            });
          }
          return res.json();
        })
        .then(function(data) {
          if (!data || !data.aircraft) return;
          for (var i = 0; i < fr24Callbacks.length; i++) {
            try { fr24Callbacks[i](data.aircraft); } catch (e) { console.error('[FR24 web] callback error:', e); }
          }
        })
        .catch(function(err) {
          console.warn('[FR24 web] fetch error:', err.message);
        });
      }

      // Premier fetch immediat, puis polling
      doFetch();
      fr24Timer = setInterval(doFetch, intervalMs);
      console.log('[FR24 web] Polling started (' + (apiKey ? 'API 90s' : 'scraper 30s') + ')');
    },

    restartFr24: function() {
      if (fr24Timer) {
        clearInterval(fr24Timer);
        fr24Timer = null;
      }
      var cbs = fr24Callbacks.slice();
      fr24Callbacks = [];
      for (var i = 0; i < cbs.length; i++) {
        window.platform.onFr24Traffic(cbs[i]);
      }
    },

    getFr24TakeoffTime: function(registration) {
      var key = getLicenseKey();
      var cfg = cachedConfig;
      var apiKey = (cfg && cfg.traffic && cfg.traffic.fr24ApiKey) || '';
      if (!key || !registration || !apiKey) return Promise.resolve(null);

      return _originalFetch.call(window, SUPABASE_URL + '/functions/v1/fr24-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'takeoff',
          licenseKey: key,
          registration: registration,
          apiKey: apiKey
        }),
        signal: AbortSignal.timeout(15000)
      })
      .then(function(res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function(data) {
        if (!data || !data.takeoffTime) return null;
        return data.takeoffTime;
      })
      .catch(function(err) {
        console.warn('[FR24 web] takeoff error:', err.message);
        return null;
      });
    },

    // --- Club Display ---
    getClubSlides: function() {
      var key = getLicenseKey();
      if (!key) return Promise.resolve([]);
      return fetch(
        SUPABASE_URL + '/rest/v1/club_slides?license_key=eq.' + encodeURIComponent(key) + '&order=sort_order.asc,created_at.asc',
        { headers: supabaseHeaders(), signal: AbortSignal.timeout(API_TIMEOUT) }
      ).then(function(res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      }).catch(function(err) {
        console.error('[Platform] getClubSlides error:', err.message);
        return [];
      });
    },

    getLocalIp: function() { return Promise.resolve(''); },

    onClubSlidesUpdate: function(callback) {
      slidesCallbacks.push(callback);
      if (slidesSubscribed) return;
      slidesSubscribed = true;
      var key = getLicenseKey();
      if (!key) return;
      initSupabase().then(function(client) {
        if (!client) return;
        client
          .channel('slides-realtime')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'club_slides',
            filter: 'license_key=eq.' + key
          }, function() {
            // Re-fetch complet des slides sur tout changement
            window.platform.getClubSlides().then(function(slides) {
              for (var i = 0; i < slidesCallbacks.length; i++) {
                try { slidesCallbacks[i](slides); } catch (e) { console.error('[Platform] slides callback error:', e); }
              }
            });
          })
          .subscribe(function(status) {
            console.log('[Platform] Slides Realtime:', status);
          });
      });
    },

    // --- Fleet ---
    getFleet: function() {
      var key = getLicenseKey();
      if (!key) return Promise.resolve([]);
      return fetch(
        SUPABASE_URL + '/rest/v1/club_fleet?license_key=eq.' + encodeURIComponent(key) + '&order=sort_order.asc,updated_at.desc',
        { headers: supabaseHeaders(), signal: AbortSignal.timeout(API_TIMEOUT) }
      ).then(function(res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      }).catch(function(err) {
        console.error('[Platform] getFleet error:', err.message);
        return [];
      });
    },

    saveFleet: function() { return Promise.resolve({ success: false }); },

    onFleetUpdate: function(callback) {
      fleetCallbacks.push(callback);
      if (fleetSubscribed) return;
      fleetSubscribed = true;
      var key = getLicenseKey();
      if (!key) return;
      initSupabase().then(function(client) {
        if (!client) return;
        client
          .channel('fleet-realtime')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'club_fleet',
            filter: 'license_key=eq.' + key
          }, function() {
            // Re-fetch complet de la flotte sur tout changement
            window.platform.getFleet().then(function(fleet) {
              for (var i = 0; i < fleetCallbacks.length; i++) {
                try { fleetCallbacks[i](fleet); } catch (e) { console.error('[Platform] fleet callback error:', e); }
              }
            });
          })
          .subscribe(function(status) {
            console.log('[Platform] Fleet Realtime:', status);
          });
      });
    },

    // --- Open-Meteo (fetch direct — meme logique que lib/openmeteo.js) ---
    getOpenMeteoData: function() {
      var cfg = cachedConfig;
      if (!cfg) return Promise.resolve(null);
      var omCfg = cfg.openMeteo || {};
      if (omCfg.enabled === false) return Promise.resolve(null);
      var lat = ((cfg.station && cfg.station.lat) || 0) + ((cfg.maps && cfg.maps.offsetLat) || 0);
      var lon = ((cfg.station && cfg.station.lon) || 0) + ((cfg.maps && cfg.maps.offsetLon) || 0);
      return fetchOpenMeteoGrid(lat, lon, {
        radiusDeg: omCfg.gridRadius || 5,
        radiusLonDeg: omCfg.gridRadiusLon || 7,
        step: omCfg.gridStep || 0.75,
        timeoutMs: omCfg.timeoutMs || 10000
      });
    },

    // --- Ecrans ---
    getDisplays: function() { return Promise.resolve([]); },

    // --- Multi-ecran ---
    getScreenView: function() {
      var params = new URLSearchParams(window.location.search);
      return params.get('view') || 'full';
    },

    getScreenConfig: function() {
      var params = new URLSearchParams(window.location.search);
      var idx = parseInt(params.get('screen') || '0', 10);
      var cfg = cachedConfig;
      if (!cfg) {
        return window.platform.getConfig().then(function(c) {
          return buildScreenConfig(c, idx);
        });
      }
      return Promise.resolve(buildScreenConfig(cfg, idx));
    },

    // --- Rooms (Session 16-17) ---
    getRooms: function() { return Promise.resolve([]); },
    getRoomBookings: function() { return Promise.resolve([]); },
    getFlightBookings: function() { return Promise.resolve([]); },
    runRoomEngine: function() { return Promise.resolve([]); },
    onRoomsUpdate: function() {},

    // --- Lightning ---
    onLightningToggle: function() {},

    // --- Auto-update (no-op en web — le web est toujours a jour) ---
    getUpdateStatus: function() { return Promise.resolve({ status: 'not-available' }); },
    checkForUpdate: function() { return Promise.resolve({ status: 'not-available' }); },
    installUpdate: function() { return Promise.resolve(); },
    onUpdateStatus: function() {}
  };

  // ============================================================
  // Auto-init : detection changement config distante (Realtime)
  // Equivalent de club-sync.js cote Electron
  // ============================================================

  var configReloadTimer = null;

  function initConfigSync() {
    var key = getLicenseKey();
    if (!key) return;
    initSupabase().then(function(client) {
      if (!client) return;
      client
        .channel('config-realtime')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'club_config',
          filter: 'license_key=eq.' + key
        }, function(payload) {
          // Mettre a jour le cache config
          if (payload && payload.new && payload.new.config) {
            var newConfig = payload.new.config;
            var oldJson = JSON.stringify(cachedConfig || {});
            var newJson = JSON.stringify(newConfig);
            if (oldJson !== newJson) {
              cachedConfig = newConfig;
              syncAndroidKioskMode(newConfig);
              console.log('[Platform] Config changed remotely — reloading in 2s');
              if (configReloadTimer) clearTimeout(configReloadTimer);
              configReloadTimer = setTimeout(function() {
                window.location.reload();
              }, 2000);
            }
          }
        })
        .subscribe(function(status) {
          console.log('[Platform] Config sync Realtime:', status);
        });
    });
  }

  // Lancer la synchro config apres un court delai (laisser le dashboard charger)
  setTimeout(initConfigSync, 3000);

  // ============================================================
  // Pont Android — synchro mode kiosque
  // Si on tourne dans le WebView Android, appeler le bridge natif
  // ============================================================

  function syncAndroidKioskMode(config) {
    if (!config) return;
    if (typeof window.AeroKiosk !== 'undefined' && typeof window.AeroKiosk.setKioskMode === 'function') {
      var enabled = config.kioskMode === true;
      console.log('[Platform] Android kiosk mode: ' + (enabled ? 'ON' : 'OFF'));
      window.AeroKiosk.setKioskMode(enabled);
    }
  }

  // Appeler au chargement initial (quand getConfig retourne)
  var _origGetConfig = window.platform.getConfig;
  window.platform.getConfig = function() {
    return _origGetConfig.call(window.platform).then(function(cfg) {
      syncAndroidKioskMode(cfg);
      return cfg;
    });
  };

  // ============================================================
  // Proxy CORS — intercepte fetch() pour les APIs bloquees
  // Route automatiquement via la Edge Function weather-proxy
  // ============================================================

  var PROXY_URL = SUPABASE_URL + '/functions/v1/weather-proxy';
  var PROXY_DOMAINS = ['aviationweather.gov', 'api.adsb.lol'];
  var _originalFetch = window.fetch;

  window.fetch = function(url, options) {
    if (typeof url === 'string') {
      for (var i = 0; i < PROXY_DOMAINS.length; i++) {
        if (url.indexOf(PROXY_DOMAINS[i]) !== -1) {
          var proxied = PROXY_URL + '?url=' + encodeURIComponent(url);
          return _originalFetch.call(window, proxied, options);
        }
      }
    }
    return _originalFetch.call(window, url, options);
  };

  console.log('[Platform] CORS proxy active for:', PROXY_DOMAINS.join(', '));

})();
