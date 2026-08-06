(() => {
  'use strict';

  const { SUPABASE_URL, SUPABASE_KEY, saveSession, clearLegacyCaches } = window.HEURO;

  const identifierInput = document.getElementById('loginIdentifier');
  const passwordInput = document.getElementById('loginPassword');
  const togglePasswordButton = document.getElementById('togglePassword');
  const loginForm = document.getElementById('loginForm');
  const submitButton = loginForm?.querySelector('button[type="submit"]');
  const firstRegistrationLink = document.getElementById('firstRegistrationLink');

  const message = document.createElement('p');
  message.id = 'loginMessage';
  message.setAttribute('role', 'alert');
  message.style.cssText = [
    'position:absolute','left:8%','right:8%','top:64%','z-index:8','margin:0',
    'padding:10px 12px','border-radius:12px','background:rgba(255,255,255,.95)',
    'color:#9b1c1c','font:700 14px/1.3 system-ui,-apple-system,sans-serif',
    'text-align:center','display:none'
  ].join(';');
  loginForm?.appendChild(message);

  const showMessage = (text, isSuccess = false) => {
    message.textContent = text;
    message.style.color = isSuccess ? '#0b6b35' : '#9b1c1c';
    message.style.display = 'block';
  };

  const translateAuthError = (rawMessage = '') => {
    const normalized = String(rawMessage).trim().toLowerCase();

    if (normalized.includes('email not confirmed')) {
      return 'Cadastro pendente de confirmação de e-mail. Acesse o e-mail informado no cadastro e confirme sua conta para liberar o acesso ao sistema.';
    }
    if (normalized.includes('invalid login credentials')) {
      return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
    }
    if (normalized.includes('user already registered') || normalized.includes('already been registered')) {
      return 'Já existe um cadastro com este e-mail. Faça o login ou procure o administrador do sistema.';
    }
    if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
      return 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.';
    }
    if (normalized.includes('user not found')) {
      return 'Usuário não encontrado. Verifique o e-mail informado ou realize o primeiro cadastro.';
    }
    if (normalized.includes('signup is disabled')) {
      return 'Novos cadastros estão temporariamente indisponíveis. Procure o administrador do sistema.';
    }

    return rawMessage || 'Não foi possível entrar no sistema. Tente novamente.';
  };

  const setLoading = (loading) => {
    if (!submitButton) return;
    submitButton.disabled = loading;
    submitButton.setAttribute('aria-busy', String(loading));
    submitButton.classList.toggle('is-pressed', loading);
    submitButton.style.opacity = '';
  };

  togglePasswordButton?.addEventListener('click', () => {
    if (!passwordInput) return;
    const visible = passwordInput.type === 'text';
    passwordInput.type = visible ? 'password' : 'text';
    togglePasswordButton.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.style.display = 'none';

    if (!loginForm.checkValidity()) {
      submitButton?.classList.add('is-pressed');
      window.setTimeout(() => submitButton?.classList.remove('is-pressed'), 180);
      loginForm.reportValidity();
      return;
    }

    const identifier = identifierInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    if (!identifier.includes('@')) {
      submitButton?.classList.add('is-pressed');
      window.setTimeout(() => submitButton?.classList.remove('is-pressed'), 180);
      showMessage('Neste momento, entre usando o e-mail cadastrado. O acesso por CPF será ativado depois.');
      identifierInput?.focus();
      return;
    }

    setLoading(true);

    try {
      const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier, password })
      });
      const authData = await authResponse.json();
      if (!authResponse.ok) {
        const technicalMessage = authData?.error_description || authData?.msg || authData?.message || '';
        throw new Error(translateAuthError(technicalMessage));
      }

      const userId = authData?.user?.id;
      const accessToken = authData?.access_token;
      if (!userId || !accessToken) throw new Error('Não foi possível validar a sessão. Tente novamente.');

      const profileResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,status,authorized_access`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
      );
      const profiles = await profileResponse.json();
      if (!profileResponse.ok || !Array.isArray(profiles) || profiles.length === 0) throw new Error('Seu perfil não foi localizado. Procure o administrador do sistema.');

      const profile = profiles[0];
      if (profile.status === 'pendente') throw new Error('Seu cadastro ainda está aguardando aprovação do administrador.');
      if (profile.status === 'bloqueado') throw new Error('Seu acesso está bloqueado. Procure o administrador do sistema.');
      if (profile.status !== 'aprovado' || !profile.authorized_access) throw new Error('Seu perfil ainda não possui autorização de acesso.');

      saveSession({
        access_token: accessToken,
        refresh_token: authData.refresh_token || '',
        expires_at: authData.expires_at || 0,
        user_id: userId,
        display_name: profile.display_name || '',
        access: profile.authorized_access,
        status: profile.status
      });

      showMessage('Acesso autorizado. Abrindo a tela de comando…', true);
      window.setTimeout(() => window.location.replace('./comando.html'), 180);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Não foi possível entrar.');
      setLoading(false);
    }
  });

  firstRegistrationLink?.addEventListener('click', (event) => {
    event.preventDefault();
    firstRegistrationLink.classList.add('is-pressed');
    window.setTimeout(() => window.location.assign(firstRegistrationLink.href), 140);
  });

  clearLegacyCaches();
})();
