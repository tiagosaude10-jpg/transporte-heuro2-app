(() => {
  'use strict';

  const loadConfig = () => new Promise((resolve, reject) => {
    if (window.HEURO) return resolve(window.HEURO);
    const script = document.createElement('script');
    script.src = 'js/config.js';
    script.onload = () => window.HEURO ? resolve(window.HEURO) : reject(new Error('Configuração não carregada.'));
    script.onerror = () => reject(new Error('Não foi possível carregar a configuração do aplicativo.'));
    document.head.appendChild(script);
  });

  const start = async () => {
    const { SUPABASE_URL, SUPABASE_KEY } = await loadConfig();
    const form = document.getElementById('registrationForm');
    const institutionalLink = document.getElementById('institutionalLink');
    const heuroSectorField = document.getElementById('heuroSectorField');
    const heuroSector = document.getElementById('heuroSector');
    const transportCompanyField = document.getElementById('transportCompanyField');
    const transportCompany = document.getElementById('transportCompany');
    const accessTypeField = document.getElementById('accessTypeField');
    const cpf = document.getElementById('cpf');
    const phone = document.getElementById('phone');
    const birthDateText = document.getElementById('birthDateText');
    const birthDatePicker = document.getElementById('birthDatePicker');
    const clearBirthDate = document.getElementById('clearBirthDate');
    const openBirthDatePicker = document.getElementById('openBirthDatePicker');
    const password = document.getElementById('password');
    const confirmPassword = document.getElementById('confirmPassword');
    const message = document.getElementById('registrationMessage');
    const submitButton = form?.querySelector('button[type="submit"]');
    const accessInputs = Array.from(document.querySelectorAll('input[name="accessType"]'));
    const onlyDigits = (value) => value.replace(/\D/g, '');
    const selectedAccess = () => accessInputs.find((input) => input.checked)?.value || '';

    const updateInstitutionalFields = () => {
      const value = institutionalLink?.value || '';
      const isHeuro = value === 'heuro';
      const isCompany = value === 'empresa';
      const isAdmin = value === 'administracao';

      if (heuroSectorField) heuroSectorField.hidden = !isHeuro;
      if (transportCompanyField) transportCompanyField.hidden = !isCompany;
      if (accessTypeField) accessTypeField.hidden = isAdmin;

      if (heuroSector) {
        heuroSector.required = isHeuro;
        if (!isHeuro) heuroSector.value = '';
      }
      if (transportCompany) {
        transportCompany.required = isCompany;
        if (!isCompany) transportCompany.value = '';
      }

      accessInputs.forEach((input, index) => {
        input.required = !isAdmin && index === 0;
        input.disabled = isAdmin;
        if (isAdmin) input.checked = false;
      });

      if (form) form.dataset.effectiveAccessType = isAdmin ? 'administrador_geral' : selectedAccess();
    };

    institutionalLink?.addEventListener('change', updateInstitutionalFields);
    accessInputs.forEach((input) => input.addEventListener('change', updateInstitutionalFields));

    cpf?.addEventListener('input', () => {
      cpf.value = onlyDigits(cpf.value).slice(0, 11)
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    });

    phone?.addEventListener('input', () => {
      phone.value = onlyDigits(phone.value).slice(0, 11)
        .replace(/^(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d{4})$/, '$1-$2');
    });

    birthDateText?.addEventListener('input', () => {
      birthDateText.value = onlyDigits(birthDateText.value).slice(0, 8)
        .replace(/^(\d{2})(\d)/, '$1/$2')
        .replace(/^(\d{2}\/\d{2})(\d)/, '$1/$2');
    });

    clearBirthDate?.addEventListener('click', () => {
      if (birthDateText) birthDateText.value = '';
      if (birthDatePicker) birthDatePicker.value = '';
    });

    openBirthDatePicker?.addEventListener('click', () => {
      if (!birthDatePicker) return;
      if (typeof birthDatePicker.showPicker === 'function') {
        try { birthDatePicker.showPicker(); return; } catch (_) {}
      }
      birthDatePicker.click();
    });

    birthDatePicker?.addEventListener('change', () => {
      if (!birthDatePicker.value || !birthDateText) return;
      const [year, month, day] = birthDatePicker.value.split('-');
      birthDateText.value = `${day}/${month}/${year}`;
    });

    const toIsoDate = (value) => {
      const [day, month, year] = value.split('/');
      return `${year}-${month}-${day}`;
    };

    const setSubmitting = (submitting) => {
      if (!submitButton) return;
      submitButton.disabled = submitting;
      submitButton.style.opacity = submitting ? '0.7' : '';
      submitButton.setAttribute('aria-busy', String(submitting));
    };

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      updateInstitutionalFields();
      if (message) message.textContent = '';
      if (!form.checkValidity()) return form.reportValidity();

      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateText?.value || '')) {
        message.textContent = 'Informe a data de nascimento no formato DD/MM/AAAA.';
        birthDateText?.focus();
        return;
      }
      if (password?.value !== confirmPassword?.value) {
        message.textContent = 'As senhas informadas não coincidem.';
        confirmPassword?.focus();
        return;
      }

      const data = new FormData(form);
      const email = String(data.get('email') || '').trim().toLowerCase();
      const displayName = String(data.get('displayName') || '').trim();
      const redirectUrl = new URL('login.html', window.location.href).href;
      const payload = {
        email,
        password: String(data.get('password') || ''),
        data: {
          username: displayName,
          full_name: String(data.get('fullName') || '').trim(),
          display_name: displayName,
          cpf: onlyDigits(String(data.get('cpf') || '')),
          phone: onlyDigits(String(data.get('phone') || '')),
          birth_date: toIsoDate(String(data.get('birthDateText') || '')),
          institutional_link: String(data.get('institutionalLink') || ''),
          heuro_sector: String(data.get('heuroSector') || '').trim() || null,
          transport_company: String(data.get('transportCompany') || '').trim() || null,
          job_role: String(data.get('jobRole') || '').trim(),
          requested_access: form.dataset.effectiveAccessType || ''
        }
      };

      setSubmitting(true);
      message.textContent = 'Enviando cadastro com segurança...';
      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectUrl)}`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'Não foi possível criar o cadastro.');
        form.reset();
        updateInstitutionalFields();
        message.textContent = 'Cadastro enviado. Aguarde a análise e a aprovação do administrador.';
      } catch (error) {
        console.error('Erro ao criar cadastro:', error);
        message.textContent = `Falha ao enviar o cadastro: ${error.message}`;
      } finally {
        setSubmitting(false);
      }
    });

    updateInstitutionalFields();
  };

  start().catch((error) => {
    console.error(error);
    const message = document.getElementById('registrationMessage');
    if (message) message.textContent = 'Não foi possível iniciar o cadastro. Atualize a página e tente novamente.';
  });
})();
