(() => {
  'use strict';

  const app = window.HEURO;
  const session = app?.readSession?.();
  const form = document.getElementById('transportWhatsappForm');
  const basicInput = document.getElementById('basicWhatsapp');
  const advancedInput = document.getElementById('advancedWhatsapp');
  const message = document.getElementById('whatsappSettingsMessage');
  const saveButton = document.getElementById('saveWhatsappSettings');

  if (!app || !form || !basicInput || !advancedInput || !message || !saveButton) return;
  if (!session?.access_token || session.access !== 'administrador_geral') {
    form.hidden = true;
    return;
  }

  const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 15);
  const displayPhone = (value) => {
    const digits = normalizePhone(value);
    if (!digits) return '';
    if (digits.startsWith('55') && digits.length >= 12) {
      const ddd = digits.slice(2, 4);
      const number = digits.slice(4);
      return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    }
    return `+${digits}`;
  };

  const showMessage = (text, success = false) => {
    message.textContent = text;
    message.className = `settings-message ${success ? 'success' : 'error'}`;
  };

  const validate = (value, label) => {
    const digits = normalizePhone(value);
    if (!digits) throw new Error(`Informe o ${label}.`);
    if (!digits.startsWith('55')) throw new Error(`${label}: inclua o código do Brasil 55.`);
    if (digits.length < 12 || digits.length > 13) throw new Error(`${label}: informe DDI, DDD e número completo.`);
    return digits;
  };

  const loadSettings = async () => {
    saveButton.disabled = true;
    try {
      const response = await fetch(app.apiUrl('/rest/v1/transport_app_settings?id=eq.1&select=basic_whatsapp,advanced_uti_whatsapp'), {
        headers: app.authenticatedHeaders(session.access_token)
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data?.message || 'Não foi possível carregar os números cadastrados.');
      const settings = Array.isArray(data) ? data[0] : null;
      basicInput.value = displayPhone(settings?.basic_whatsapp);
      advancedInput.value = displayPhone(settings?.advanced_uti_whatsapp);
      message.textContent = '';
      message.className = 'settings-message';
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Falha ao carregar as configurações.');
    } finally {
      saveButton.disabled = false;
    }
  };

  [basicInput, advancedInput].forEach((input) => {
    input.addEventListener('blur', () => {
      const digits = normalizePhone(input.value);
      input.value = digits ? displayPhone(digits) : '';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando...';
    try {
      const basicWhatsapp = validate(basicInput.value, 'WhatsApp do Suporte Básico');
      const advancedWhatsapp = validate(advancedInput.value, 'WhatsApp do Suporte Avançado / UTI');
      const response = await fetch(app.apiUrl('/rest/v1/transport_app_settings?id=eq.1'), {
        method: 'PATCH',
        headers: { ...app.authenticatedHeaders(session.access_token), Prefer: 'return=representation' },
        body: JSON.stringify({
          basic_whatsapp: basicWhatsapp,
          advanced_uti_whatsapp: advancedWhatsapp,
          updated_at: new Date().toISOString()
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || 'Não foi possível salvar os números.');
      basicInput.value = displayPhone(basicWhatsapp);
      advancedInput.value = displayPhone(advancedWhatsapp);
      showMessage('Números salvos com sucesso. As próximas solicitações usarão estes contatos automaticamente.', true);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Falha ao salvar os números.');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Salvar números do WhatsApp';
    }
  });

  loadSettings();
})();