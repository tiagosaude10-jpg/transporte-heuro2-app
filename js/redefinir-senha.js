(() => {
  'use strict';

  const app = window.HEURO;
  const form = document.getElementById('newPasswordForm');
  const password = document.getElementById('newPassword');
  const confirmPassword = document.getElementById('confirmNewPassword');
  const submitButton = document.getElementById('newPasswordSubmit');
  const message = document.getElementById('newPasswordMessage');

  const showMessage = (text, success = false) => {
    message.textContent = text;
    message.className = `message ${success ? 'success' : 'error'}`;
  };

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const accessToken = hash.get('access_token') || query.get('access_token') || '';
  const type = hash.get('type') || query.get('type') || '';
  const errorDescription = hash.get('error_description') || query.get('error_description') || '';

  if (errorDescription) {
    showMessage('O link de recuperação é inválido ou expirou. Solicite um novo link.');
    form.querySelectorAll('input,button').forEach((item) => { item.disabled = true; });
  } else if (!accessToken || (type && type !== 'recovery')) {
    showMessage('Abra esta página pelo link enviado ao seu e-mail. Se o link expirou, solicite uma nova recuperação.');
    form.querySelectorAll('input,button').forEach((item) => { item.disabled = true; });
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.className = 'message';

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (password.value !== confirmPassword.value) {
      showMessage('As senhas informadas não coincidem.');
      confirmPassword.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Salvando...';

    try {
      const response = await fetch(`${app.SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: app.SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: password.value })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const text = String(data?.msg || data?.message || data?.error_description || '').toLowerCase();
        if (text.includes('expired') || text.includes('invalid')) throw new Error('expired');
        throw new Error('generic');
      }

      history.replaceState(null, '', 'redefinir-senha.html');
      form.reset();
      form.querySelectorAll('input,button').forEach((item) => { item.disabled = true; });
      showMessage('Senha alterada com sucesso. Você já pode voltar ao login e entrar com a nova senha.', true);
    } catch (error) {
      showMessage(error instanceof Error && error.message === 'expired'
        ? 'O link de recuperação expirou ou já foi utilizado. Solicite um novo link.'
        : 'Não foi possível alterar a senha agora. Solicite um novo link e tente novamente.');
      submitButton.disabled = false;
      submitButton.textContent = 'Salvar nova senha';
    }
  });
})();
