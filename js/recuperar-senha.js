(() => {
  'use strict';

  const app = window.HEURO;
  const form = document.getElementById('recoveryForm');
  const emailInput = document.getElementById('recoveryEmail');
  const submitButton = document.getElementById('recoverySubmit');
  const message = document.getElementById('recoveryMessage');

  const showMessage = (text, success = false) => {
    message.textContent = text;
    message.className = `message ${success ? 'success' : 'error'}`;
  };

  const translateError = (value = '') => {
    const text = String(value).toLowerCase();
    if (text.includes('rate limit') || text.includes('too many')) return 'Foram feitas muitas tentativas. Aguarde alguns minutos e tente novamente.';
    if (text.includes('invalid email')) return 'Informe um endereço de e-mail válido.';
    return 'Não foi possível enviar o e-mail de recuperação agora. Tente novamente em alguns instantes.';
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.className = 'message';

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Enviando...';

    try {
      const redirectTo = new URL('redefinir-senha.html', window.location.href).href;
      const response = await fetch(
        `${app.SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
        {
          method: 'POST',
          headers: {
            apikey: app.SUPABASE_KEY,
            Authorization: `Bearer ${app.SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: emailInput.value.trim().toLowerCase() })
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || 'Falha no envio');

      showMessage('E-mail enviado. Abra sua caixa de entrada, toque no link de recuperação e crie uma nova senha.', true);
      form.reset();
    } catch (error) {
      showMessage(translateError(error instanceof Error ? error.message : ''));
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Enviar link de recuperação';
    }
  });
})();
