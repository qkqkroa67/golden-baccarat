(() => {
  const $ = (selector) => document.querySelector(selector);
  const usernameInput = $('#accountUsername');
  const loginPasswordInput = $('#loginPassword');
  const signupEmailInput = $('#signupEmail');
  const signupUsernameInput = $('#signupUsername');
  const signupPasswordInput = $('#signupPassword');
  const status = $('#accountStatus');
  const signInButton = $('#accountSignIn');
  const signUpButton = $('#accountSignUp');
  const signOutButton = $('#accountSignOut');
  const loginFields = $('#loginFields');
  const signupFields = $('#signupFields');
  const showLogin = $('#showLogin');
  const showSignup = $('#showSignup');
  const configReady = Boolean(window.GB_SUPABASE_URL && window.GB_SUPABASE_PUBLISHABLE_KEY && window.supabase?.createClient);
  window.GB_AUTH_ENABLED = configReady;
  window.GB_AUTH_USER = null;
  window.GB_SUPABASE_CLIENT = null;
  if (!usernameInput || !status) return;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const setMode = (mode) => {
    const signup = mode === 'signup';
    loginFields.hidden = signup;
    signupFields.hidden = !signup;
    showLogin.classList.toggle('active', !signup);
    showSignup.classList.toggle('active', signup);
    setStatus(signup ? '이메일, 로그인 아이디, 비밀번호를 입력해 주세요.' : '아이디와 비밀번호로 로그인하세요.');
  };
  showLogin?.addEventListener('click', () => setMode('login'));
  showSignup?.addEventListener('click', () => setMode('signup'));
  const setBusy = (busy) => {
    if (signInButton) signInButton.disabled = busy || !configReady;
    if (signUpButton) signUpButton.disabled = busy || !configReady;
    if (signOutButton) signOutButton.disabled = busy;
  };
  if (!configReady) {
    setBusy(false);
    setStatus('계정 저장 서버 연결 후 가입과 로그인을 사용할 수 있어요.');
    return;
  }

  const client = window.supabase.createClient(window.GB_SUPABASE_URL, window.GB_SUPABASE_PUBLISHABLE_KEY);
  window.GB_SUPABASE_CLIENT = client;
  let currentUser = null;
  let applyingCloudState = false;
  let saveTimer = null;
  let authRun = 0;
  function localSave() {
    return {
      balance: Number(localStorage.gbBalance || 10000), xp: Number(localStorage.gbXp || 0),
      home: localStorage.gbHome || '기본 오두막', cosmetics: JSON.parse(localStorage.gbCosmetics || '[]'),
      friends: JSON.parse(localStorage.gbFriends || '[]'), history: JSON.parse(localStorage.gbHistory || '[]'),
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
      { user_id: user.id, state: localSave(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' },
    );
    if (error) throw error;
  }
  async function loadOrMigrate(user) {
    const { data, error } = await client.from('game_saves').select('state').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const label = user.user_metadata?.username || user.email;
    if (data?.state && Object.keys(data.state).length > 0) {
      applyingCloudState = true;
      const changed = applyCloudSave(data.state);
      applyingCloudState = false;
      if (changed) location.reload();
      setStatus(`로그인됨: ${label} · 저장된 게임을 불러왔어요.`);
    } else {
      await uploadSave(user);
      setStatus(`로그인됨: ${label} · 이 기기의 게임을 계정에 저장했어요.`);
    }
  }
  async function activateUser(user) {
    const run = ++authRun;
    currentUser = user;
    window.GB_AUTH_USER = user;
    if (signOutButton) signOutButton.hidden = !user;
    if (!user) {
      setStatus('아이디와 비밀번호로 로그인하거나 계정을 만들어 주세요.');
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
        setStatus(`로그인됨: ${currentUser.user_metadata?.username || currentUser.email} · 저장 완료`);
      } catch (error) { setStatus(`저장하지 못했어요: ${error.message}`, true); }
    }, 500);
  };
  const validUsername = (value) => /^[a-z0-9_]{3,20}$/.test(value);
  async function signIn() {
    const username = usernameInput.value.trim().toLowerCase();
    const password = loginPasswordInput.value;
    if (!validUsername(username)) return setStatus('아이디는 영문 소문자, 숫자, 밑줄로 3~20자 입력해 주세요.', true);
    if (!password) return setStatus('비밀번호를 입력해 주세요.', true);
    setBusy(true); setStatus('로그인 중…');
    try {
      const { data, error } = await client.functions.invoke('username-login', { body: { username, password } });
      if (error) throw error;
      if (!data?.session?.access_token || !data?.session?.refresh_token) throw new Error('로그인 정보를 받지 못했어요.');
      const { data: sessionData, error: sessionError } = await client.auth.setSession(data.session);
      if (sessionError) throw sessionError;
      await activateUser(sessionData.user || data.session.user);
    } catch {
      setStatus('아이디 또는 비밀번호를 확인해 주세요.', true);
    } finally { setBusy(false); }
  }
  async function signUp() {
    const email = signupEmailInput.value.trim();
    const username = signupUsernameInput.value.trim().toLowerCase();
    const password = signupPasswordInput.value;
    if (!email) return setStatus('이메일을 입력해 주세요.', true);
    if (!validUsername(username)) return setStatus('아이디는 영문 소문자, 숫자, 밑줄로 3~20자 입력해 주세요.', true);
    if (password.length < 8) return setStatus('비밀번호는 8자 이상으로 입력해 주세요.', true);
    setBusy(true); setStatus('계정을 만드는 중…');
    try {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { username } } });
      if (error) throw error;
      if (data.session && data.user) await activateUser(data.user);
      else setStatus('인증 메일을 보냈어요. 메일 확인 후 아이디와 비밀번호로 로그인해 주세요.');
    } catch (error) { setStatus(`가입에 실패했어요: ${error.message}`, true); }
    finally { setBusy(false); }
  }
  signInButton?.addEventListener('click', signIn);
  signUpButton?.addEventListener('click', signUp);
  signOutButton?.addEventListener('click', async () => {
    setBusy(true);
    const { error } = await client.auth.signOut();
    setBusy(false);
    if (error) setStatus(`로그아웃에 실패했어요: ${error.message}`, true);
    else location.href = 'index.html';
  });
  loginPasswordInput?.addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });
  signupPasswordInput?.addEventListener('keydown', (event) => { if (event.key === 'Enter') signUp(); });
  client.auth.onAuthStateChange((_event, session) => setTimeout(() => activateUser(session?.user || null), 0));
  client.auth.getSession().then(({ data, error }) => {
    if (error) setStatus(`로그인 상태를 확인하지 못했어요: ${error.message}`, true);
    else if (data.session?.user) activateUser(data.session.user);
  });
})();

