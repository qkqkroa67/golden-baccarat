(() => {
  const $ = (selector) => document.querySelector(selector);
  const emailInput = $('#accountEmail');
  const passwordInput = $('#accountPassword');
  const status = $('#accountStatus');
  const signInButton = $('#accountSignIn');
  const signUpButton = $('#accountSignUp');
  const signOutButton = $('#accountSignOut');
  const configReady = Boolean(
    window.GB_SUPABASE_URL && window.GB_SUPABASE_PUBLISHABLE_KEY && window.supabase?.createClient,
  );
  window.GB_AUTH_ENABLED = configReady;
  window.GB_AUTH_USER = null;

  if (!emailInput || !passwordInput || !status) return;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const setBusy = (busy) => {
    signInButton.disabled = busy || !configReady;
    signUpButton.disabled = busy || !configReady;
    if (signOutButton) signOutButton.disabled = busy;
  };

  if (!configReady) {
    setBusy(false);
    setStatus('계정 저장 서버를 연결해야 이메일 로그인과 저장을 사용할 수 있어요.');
    return;
  }

  const client = window.supabase.createClient(
    window.GB_SUPABASE_URL,
    window.GB_SUPABASE_PUBLISHABLE_KEY,
  );
  const saveKeys = ['gbBalance', 'gbXp', 'gbHome', 'gbCosmetics', 'gbFriends', 'gbHistory', 'gbNickname'];
  let currentUser = null;
  let applyingCloudState = false;
  let saveTimer = null;
  let authRun = 0;

  function localSave() {
    return {
      balance: Number(localStorage.gbBalance || 10000),
      xp: Number(localStorage.gbXp || 0),
      home: localStorage.gbHome || '기본 오두막',
      cosmetics: JSON.parse(localStorage.gbCosmetics || '[]'),
      friends: JSON.parse(localStorage.gbFriends || '[]'),
      history: JSON.parse(localStorage.gbHistory || '[]'),
      nickname: localStorage.gbNickname || '',
    };
  }

  function applyCloudSave(state) {
    const before = JSON.stringify(localSave());
    localStorage.gbBalance = String(Number(state.balance ?? 10000));
    localStorage.gbXp = String(Number(state.xp ?? 0));
    localStorage.gbHome = String(state.home || '기본 오두막');
    localStorage.gbCosmetics = JSON.stringify(Array.isArray(state.cosmetics) ? state.cosmetics : []);
    localStorage.gbFriends = JSON.stringify(Array.isArray(state.friends) ? state.friends : []);
    localStorage.gbHistory = JSON.stringify(Array.isArray(state.history) ? state.history : []);
    if (typeof state.nickname === 'string') localStorage.gbNickname = state.nickname;
    return before !== JSON.stringify(localSave());
  }

  async function uploadSave(user = currentUser) {
    if (!user || applyingCloudState) return;
    const { error } = await client.from('game_saves').upsert(
      { user_id: user.id, state: localSave(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }

  async function loadOrMigrate(user) {
    const { data, error } = await client
      .from('game_saves')
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;

    if (data?.state && Object.keys(data.state).length > 0) {
      applyingCloudState = true;
      const changed = applyCloudSave(data.state);
      applyingCloudState = false;
      if (changed) location.reload();
      setStatus(`로그인됨: ${user.email} · 저장된 게임을 불러왔어요.`);
    } else {
      await uploadSave(user);
      setStatus(`로그인됨: ${user.email} · 이 기기의 게임을 계정에 저장했어요.`);
    }
  }

  async function activateUser(user) {
    const run = ++authRun;
    currentUser = user;
    window.GB_AUTH_USER = user;
    if (signOutButton) signOutButton.hidden = !user;
    if (!user) {
      setStatus('이메일과 비밀번호로 로그인하거나 계정을 만들어 주세요.');
      const page = location.pathname.split('/').pop();
      if (page && page !== 'index.html') location.replace('index.html');
      return;
    }
    try {
      await loadOrMigrate(user);
      if (run !== authRun) return;
    } catch (error) {
      if (run === authRun) setStatus(`저장 정보를 불러오지 못했어요: ${error.message}`, true);
    }
  }

  window.gbSaveGame = () => {
    if (!currentUser || applyingCloudState) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await uploadSave();
        setStatus(`로그인됨: ${currentUser.email} · 저장 완료`);
      } catch (error) {
        setStatus(`저장하지 못했어요: ${error.message}`, true);
      }
    }, 500);
  };

  async function signIn() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return setStatus('이메일과 비밀번호를 입력해 주세요.', true);
    setBusy(true);
    setStatus('로그인 중…');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setStatus(`로그인에 실패했어요: ${error.message}`, true);
    await activateUser(data.user);
  }

  async function signUp() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return setStatus('이메일과 비밀번호를 입력해 주세요.', true);
    if (password.length < 8) return setStatus('비밀번호는 8자 이상으로 입력해 주세요.', true);
    setBusy(true);
    setStatus('계정을 만드는 중…');
    const { data, error } = await client.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setStatus(`가입에 실패했어요: ${error.message}`, true);
    if (data.session && data.user) {
      await activateUser(data.user);
    } else {
      setStatus('인증 메일을 보냈어요. 메일의 확인 링크를 누른 뒤 로그인해 주세요.');
    }
  }

  signInButton.addEventListener('click', signIn);
  signUpButton.addEventListener('click', signUp);
  signOutButton?.addEventListener('click', async () => {
    setBusy(true);
    const { error } = await client.auth.signOut();
    setBusy(false);
    if (error) setStatus(`로그아웃에 실패했어요: ${error.message}`, true);
    else location.href = 'index.html';
  });
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') signIn();
  });

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => activateUser(session?.user || null), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) setStatus(`로그인 상태를 확인하지 못했어요: ${error.message}`, true);
    else if (data.session?.user) activateUser(data.session.user);
  });
})();

