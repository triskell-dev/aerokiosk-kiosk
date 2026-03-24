/**
 * i18n.js — Module d'internationalisation pour AeroKiosk (renderer)
 *
 * Usage :
 *   1. Charger dans le HTML : <script src="lib/i18n.js"></script>
 *   2. Appeler await initI18n('fr') avec le code langue
 *   3. Utiliser t('section.key') ou t('section.key', {param: 'valeur'})
 *   4. HTML statique : <span data-i18n="section.key">Texte fallback</span>
 */

(function () {
  'use strict';

  let _locale = {};
  let _fallback = {};
  let _lang = 'fr';

  // Langues supportées (noms dans leur propre langue)
  var LANGUAGES = {
    fr: { name: 'Français', nativeName: 'Français' },
    de: { name: 'Deutsch', nativeName: 'Deutsch' },
    en: { name: 'English', nativeName: 'English' },
    it: { name: 'Italiano', nativeName: 'Italiano' },
    es: { name: 'Español', nativeName: 'Español' }
  };

  /**
   * Charger un fichier locale JSON
   */
  async function loadLocale(lang) {
    try {
      var resp = await fetch('locales/' + lang + '.json');
      if (!resp.ok) return {};
      return await resp.json();
    } catch (e) {
      console.warn('i18n: impossible de charger locales/' + lang + '.json', e.message);
      return {};
    }
  }

  /**
   * Initialiser l'i18n avec une langue donnée.
   * Charge toujours le français comme fallback.
   */
  async function initI18n(lang) {
    _lang = lang || 'fr';
    _fallback = await loadLocale('fr');
    if (_lang === 'fr') {
      _locale = _fallback;
    } else {
      _locale = await loadLocale(_lang);
    }
    applyI18n();
  }

  /**
   * Résoudre une valeur imbriquée via chemin à points.
   * resolve(obj, 'fog.highRisk') → obj.fog.highRisk
   */
  function resolve(obj, path) {
    return path.split('.').reduce(function (o, k) {
      return (o && o[k] !== undefined) ? o[k] : undefined;
    }, obj);
  }

  /**
   * Traduire une clé avec interpolation optionnelle.
   * Fallback : locale active → français → nom de la clé.
   *
   * Interpolation {{param}} :
   *   t('fog.highRisk', {spread: '2'}) → "RISQUE BROUILLARD ÉLEVÉ — Spread 2°C"
   */
  function t(key, params) {
    var text = resolve(_locale, key);
    if (text === undefined) text = resolve(_fallback, key);
    if (text === undefined) {
      console.warn('i18n: clé manquante "' + key + '"');
      return key;
    }
    if (params && typeof text === 'string') {
      Object.keys(params).forEach(function (k) {
        text = text.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), String(params[k]));
      });
    }
    return text;
  }

  /**
   * Parcourir le DOM et appliquer les traductions.
   * Supporte :
   *   data-i18n="key"              → textContent
   *   data-i18n-placeholder="key"  → placeholder
   *   data-i18n-title="key"        → title
   *   data-i18n-html="key"         → innerHTML
   */
  function applyI18n(root) {
    var container = root || document;

    container.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });

    container.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });

    container.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });

    container.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
  }

  /**
   * Changer de langue à chaud (depuis Settings ou Wizard).
   */
  async function setLanguage(lang) {
    await initI18n(lang);
  }

  /**
   * Retourner le code BCP 47 pour les dates localisées.
   * 'fr' → 'fr-FR', 'de' → 'de-DE'
   */
  function getDateLocale() {
    var map = { fr: 'fr-FR', de: 'de-DE', en: 'en-GB', it: 'it-IT', es: 'es-ES', pt: 'pt-PT', el: 'el-GR' };
    return map[_lang] || 'fr-FR';
  }

  // Exposer en global
  window.t = t;
  window.initI18n = initI18n;
  window.setLanguage = setLanguage;
  window.applyI18n = applyI18n;
  window.I18N_LANGUAGES = LANGUAGES;
  window.getI18nLang = function () { return _lang; };
  window.getDateLocale = getDateLocale;
})();
