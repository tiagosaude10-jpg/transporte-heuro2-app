(() => {
  'use strict';

  const SUPABASE_URL = 'https://hahozrotaaqaftamvwmm.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MLu7DsPF-xoVswv9Qeb1wg_7NDET0di';

  const form = document.getElementById('registrationForm');
  const institutionalLink = document.getElementById('institutionalLink');
  const heuroSectorField = document.getElementById('heuroSectorField');
  const heuroSector = document.getElementById('heuroSector');
  const transportCompanyField = document.getElementById('transportCompanyField');
  const transportCompany = document.getElementById('transportCompany');
  const accessTypeField = document.getElementById('accessTypeField');
  const accessInputs = Array.from(document.querySelectorAll('input[name="accessType"]'));
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

  const onlyDigits = (value) => value.replace(/\D/g, '');

  const getSelectedAccessType = () =>
    accessInputs.find((input) => input.checked)?.value || '';

  const updateInstitutionalFields = () => {
    const institutionalValue = institutionalLink?.value || '';
    const isHeuro = institutionalValue === 'heuro';
    const isCompany = institutionalValue === 'empresa';
    const isGeneralAdministration = institutionalValue === 'administracao';

    if (heuroSectorField) heuroSectorField.hidden = !isHeuro;
    if (transportCompanyField) transportCompanyField.hidden = !isCompany;
    if (accessTypeField) accessTypeField.hidden = isGeneralAdministration;

    if (heuroSector) {
      heuroSector.required = isHeuro;
      if (!isHeuro) heuroSector.value = '';
    }

    if (transportCompany) {
      transportCompany.required = isCompany;
      if (!isCompany) transportCompany.value = '';
    }

    accessInputs.forEach((input, index) => {
      input.required = !isGeneralAdministration && index === 0;
      input.disabled = isGeneralAdministration;
      if (isGeneralAdministration) input.checked = false;
    });

    if (form) {
      form.dataset.effectiveAccessType = isGeneralAdministration
        ? 'administrador_geral'
        : getSelectedAccessType();
    }
  };

  institutionalLink?.addEventListener('change', updateInstitutionalFields);
  accessInputs.forEach((input) => input.addEventListener('change', updateInstitutionalFields));

  cpf?.addEventListener('input', () => {
    const digits = onlyDigits(cpf.value).slice(0, 11);
    cpf.value = digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  });

  phone?.addEventListener('input', () => {
    const digits = onlyDigits(phone.value).slice(0, 11);
    phone.value = digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d{4})$/, '$1-$2');
  });

  birthDateText?.addEventListener('input', () => {
    const digits = onlyDigits(birthDateText.value).slice(0, 8);
    birthDateText.value = digits
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
      try {
        birthDatePicker.showPicker();
        return;
      } catch (_error) {}
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

  const setSubmitting = (isSubmitting) => {
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.style.opacity = isSubmitting ? '0.7' : '';
    submitButton.setAttribute('aria-busy', String(isSubmitting));
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    updateInstitutionalFields();
    message.textContent = '';

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

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

    const formData = new FormData(form);
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const displayName = String(formData.get('displayName') || '').trim();
    const requestedAccess = form.dataset.effectiveAccessType || '';
    const redirectUrl = new URL('login.html', window.location.href).href;

    const payload = {
      email,
      password: String(formData.get('password') || ''),
      data: {
        username: displayName,
        full_name: String(formData.get('fullName') || '').trim(),
        display_name: displayName,
        cpf: onlyDigits(String(formData.get('cpf') || '')),
        phone: onlyDigits(String(formData.get('phone') || '')),
        birth_date: toIsoDate(String(formData.get('birthDateText') || '')),
        institutional_link: String(formData.get('institutionalLink') || ''),
        heuro_sector: String(formData.get('heuroSector') || '').trim() || null,
        transport_company: String(formData.get('transportCompany') || '').trim() || null,
        job_role: String(formData.get('jobRole') || '').trim(),
        requested_access: requestedAccess
      }
    };

    setSubmitting(true);
    message.textContent = 'Enviando cadastro com segurança...';

    try {
      const response = await fetch(
        `${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectUrl)}`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorText = result.msg || result.message || result.error_description || 'Não foi possível criar o cadastro.';
        throw new Error(errorText);
      }

      form.reset();
      updateInstitutionalFields();
      message.textContent =
        'Cadastro enviado. Abra o seu e-mail e confirme a conta. Depois volte ao aplicativo.';
    } catch (error) {
      console.error('Erro ao criar cadastro:', error);
      message.textContent = `Falha ao enviar o cadastro: ${error.message}`;
    } finally {
      setSubmitting(false);
    }
  });

  updateInstitutionalFields();
})();