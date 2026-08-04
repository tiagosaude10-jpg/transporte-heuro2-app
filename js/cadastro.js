(() => {
  'use strict';

  const form = document.getElementById('registrationForm');
  const institutionalLink = document.getElementById('institutionalLink');
  const heuroSectorField = document.getElementById('heuroSectorField');
  const heuroSector = document.getElementById('heuroSector');
  const transportCompanyField = document.getElementById('transportCompanyField');
  const transportCompany = document.getElementById('transportCompany');
  const accessType = document.getElementById('accessType');
  const accessTypeField = accessType?.closest('.field');
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

  // Administrador não é uma opção comum de solicitação.
  // Administração Geral recebe esse perfil internamente.
  accessType?.querySelector('option[value="administrador"]')?.remove();

  const updateInstitutionalFields = () => {
    const value = institutionalLink?.value || '';
    const isHeuro = value === 'heuro';
    const isCompany = value === 'empresa';
    const isGeneralAdministration = value === 'administracao';

    if (heuroSectorField) heuroSectorField.hidden = !isHeuro;
    if (transportCompanyField) transportCompanyField.hidden = !isCompany;

    if (heuroSector) {
      heuroSector.required = isHeuro;
      if (!isHeuro) heuroSector.value = '';
    }

    if (transportCompany) {
      transportCompany.required = isCompany;
      if (!isCompany) transportCompany.value = '';
    }

    if (accessTypeField) accessTypeField.hidden = isGeneralAdministration;

    if (accessType) {
      accessType.required = !isGeneralAdministration;
      if (isGeneralAdministration) accessType.value = '';
    }

    if (form) {
      form.dataset.effectiveAccessType = isGeneralAdministration
        ? 'administrador_geral'
        : (accessType?.value || '');
    }
  };

  institutionalLink?.addEventListener('change', updateInstitutionalFields);
  accessType?.addEventListener('change', () => {
    if (form && institutionalLink?.value !== 'administracao') {
      form.dataset.effectiveAccessType = accessType.value;
    }
  });
  updateInstitutionalFields();

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
      } catch (_) {}
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
      message.textContent = 'Informe a data de nascimento no formato DD/MM/AAAA.';
      birthDateText?.focus();
      return;
    }

    if (password?.value !== confirmPassword?.value) {
      message.textContent = 'As senhas informadas não coincidem.';
      confirmPassword?.focus();
      return;
    }

    message.textContent = 'Cadastro validado. O envio ao banco será ativado na próxima etapa.';
  });
})();