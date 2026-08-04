(() => {
  'use strict';

  const form = document.getElementById('registrationForm');
  const institutionalLink = document.getElementById('institutionalLink');
  const heuroSectorField = document.getElementById('heuroSectorField');
  const heuroSector = document.getElementById('heuroSector');
  const transportCompanyField = document.getElementById('transportCompanyField');
  const transportCompany = document.getElementById('transportCompany');
  const accessTypeField = document.getElementById('accessTypeField');
  const accessInputs = Array.from(
    document.querySelectorAll('input[name="accessType"]')
  );
  const cpf = document.getElementById('cpf');
  const phone = document.getElementById('phone');
  const birthDateText = document.getElementById('birthDateText');
  const birthDatePicker = document.getElementById('birthDatePicker');
  const clearBirthDate = document.getElementById('clearBirthDate');
  const openBirthDatePicker = document.getElementById('openBirthDatePicker');
  const password = document.getElementById('password');
  const confirmPassword = document.getElementById('confirmPassword');
  const message = document.getElementById('registrationMessage');

  const onlyDigits = (value) => value.replace(/\D/g, '');

  const getSelectedAccessType = () =>
    accessInputs.find((input) => input.checked)?.value || '';

  const updateInstitutionalFields = () => {
    const institutionalValue = institutionalLink?.value || '';
    const isHeuro = institutionalValue === 'heuro';
    const isCompany = institutionalValue === 'empresa';
    const isGeneralAdministration = institutionalValue === 'administracao';

    if (heuroSectorField) {
      heuroSectorField.hidden = !isHeuro;
    }

    if (transportCompanyField) {
      transportCompanyField.hidden = !isCompany;
    }

    if (accessTypeField) {
      accessTypeField.hidden = isGeneralAdministration;
    }

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
  accessInputs.forEach((input) => {
    input.addEventListener('change', updateInstitutionalFields);
  });

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
      } catch (_error) {
        // O clique nativo abaixo mantém compatibilidade com o iPhone.
      }
    }

    birthDatePicker.click();
  });

  birthDatePicker?.addEventListener('change', () => {
    if (!birthDatePicker.value || !birthDateText) return;

    const [year, month, day] = birthDatePicker.value.split('-');
    birthDateText.value = `${day}/${month}/${year}`;
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    updateInstitutionalFields();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateText?.value || '')) {
      message.textContent =
        'Informe a data de nascimento no formato DD/MM/AAAA.';
      birthDateText?.focus();
      return;
    }

    if (password?.value !== confirmPassword?.value) {
      message.textContent = 'As senhas informadas não coincidem.';
      confirmPassword?.focus();
      return;
    }

    message.textContent =
      'Cadastro validado. O envio ao banco será ativado na próxima etapa.';
  });

  updateInstitutionalFields();
})();