(() => {
  'use strict';

  const APP_VERSION = '20260805.1';
  const SUPABASE_URL = 'https://hahozrotaaqaftamvwmm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_MLu7DsPF-xoVswv9Qeb1wg_7NDET0di';
  const SESSION_KEY = 'heuro_session';

  const readSession = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (_) {
      return null;
    }
  };

  const saveSession = (session) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.clear();
  };

  const clearLegacyCaches = async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    }

    if ('caches' in window) {
      const names = await caches.keys().catch(() => []);
      await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
    }
  };

  window.HEURO = Object.freeze({
    APP_VERSION,
    SUPABASE_URL,
    SUPABASE_KEY,
    SESSION_KEY,
    readSession,
    saveSession,
    clearSession,
    clearLegacyCaches
  });
})();
