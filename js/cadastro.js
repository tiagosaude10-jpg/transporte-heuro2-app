(() => {
  'use strict';

  const form = document.getElementById('registrationForm');
  const cpf = document.getElementById('cpf');
  const phone = document.getElementById('phone');
  const birthDate = document.getElementById('birthDate');
  const clearBirthDate = document.getElementById('clearBirthDate');
  const password = document.getElementById('password');
  const confirmPassword = document.getElementById('confirmPassword');
  const message = document.getElementById('registrationMessage');

  const onlyDigits = (value) => value.replace(/\D/g, '');

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

  clearBirthDate?.addEventListener('click', () => {
    if (birthDate) birthDate.value = '';
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (password?.value !== confirmPassword?.value) {
      message.textContent = 'As senhas informadas não coincidem.';
      confirmPassword?.focus();
      return;
    }

    message.textContent = 'Tela pronta. O envio ao banco será ativado na próxima etapa.';
  });
})();