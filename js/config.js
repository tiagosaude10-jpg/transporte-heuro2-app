(() => {
  'use strict';

  const APP_VERSION = '20260806.57';
  const SUPABASE_URL = 'https://hahozrotaaqaftamvwmm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_MLu7DsPF-xoVswv9Qeb1wg_7NDET0di';
  const SESSION_KEY = 'heuro_session';
  const CACHE_CLEANUP_KEY = `heuro_cache_cleaned_${APP_VERSION}`;

  const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } };
  const saveSession = (session) => localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const clearSession = () => { localStorage.removeItem(SESSION_KEY); sessionStorage.clear(); };
  const clearLegacyCaches = async () => {
    if (localStorage.getItem(CACHE_CLEANUP_KEY) === '1') return;
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    }
    if ('caches' in window) {
      const names = await caches.keys().catch(() => []);
      await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
    }
    localStorage.setItem(CACHE_CLEANUP_KEY, '1');
  };
  const apiUrl = (path) => `${SUPABASE_URL}${path}`;
  const publicHeaders = () => ({ apikey: SUPABASE_KEY, Accept: 'application/json' });
  const authenticatedHeaders = (token, includeJson = true) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json', ...(includeJson ? { 'Content-Type': 'application/json' } : {}) });
  const jsonHeaders = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' });
  window.HEURO = Object.freeze({ APP_VERSION, SUPABASE_URL, SUPABASE_KEY, SESSION_KEY, readSession, saveSession, clearSession, clearLegacyCaches, apiUrl, publicHeaders, authenticatedHeaders, jsonHeaders });

  if (/admin-cadastros\.html$/i.test(location.pathname)) {
    const organizeApprovalPage = () => {
      document.querySelector('.transport-settings')?.remove();
      const backLink = document.querySelector('.back-link');
      if (backLink) {
        backLink.href = './admin-central.html?v=20260806.57';
        backLink.setAttribute('aria-label', 'Voltar ao painel do administrador');
      }
      const title = document.querySelector('.admin-header__text h1');
      const subtitle = document.querySelector('.admin-header__text span');
      if (title) title.textContent = 'Aprovação de cadastros';
      if (subtitle) subtitle.textContent = 'Analise e gerencie as solicitações de acesso ao HEURO Transportes.';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', organizeApprovalPage, { once: true });
    else organizeApprovalPage();
  }
})();