(() => {
  const client = window.GB_SUPABASE_CLIENT;
  if (!client) return;
  const $ = (selector) => document.querySelector(selector);
  let roomCode = null;
  let roomChannel = null;
  let heartbeatTimer = null;
  let lastRoundId = null;

  function setRoomStatus(message, error = false) {
    const status = $('#roomStatus');
    if (status) {
      status.textContent = message;
      status.style.color = error ? '#ff9b9b' : '';
    }
  }
  function setOnlineBanner() {
    const label = document.querySelector('.conn b');
    const detail = document.querySelector('.conn .muted');
    if (label) label.textContent = '온라인 서버 연결됨';
    if (detail) detail.textContent = '이 방의 참가자와 라운드를 실시간으로 동기화합니다';
  }
  function nickname() {
    return ($('#entryName')?.value || $('#nickname')?.value || localStorage.gbNickname || '플레이어').trim().slice(0, 16) || '플레이어';
  }
  async function signedInUser() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const user = data.session?.user || null;
    window.GB_AUTH_USER = user;
    return user;
  }
  function drawPlayers(snapshot) {
    const container = $('#players');
    if (!container) return;
    container.replaceChildren();
    (snapshot.players || []).forEach((entry) => {
      const badge = document.createElement('span');
      badge.className = 'player';
      const crown = document.createElement('em');
      crown.textContent = entry.user_id === snapshot.host_user_id ? '♛ ' : '• ';
      badge.append(crown, document.createTextNode(entry.nickname));
      container.append(badge);
    });
  }
  function showSnapshot(snapshot) {
    if (!snapshot) return;
    roomCode = snapshot.code;
    window.GB_ROOM_CODE = snapshot.code;
    window.GB_ROOM_HOST_ID = snapshot.host_user_id;
    lastRoundId = snapshot.state?.round?.id || null;
    const code = $('#roomCode');
    if (code) code.textContent = snapshot.code;
    const share = $('#shareBtn');
    if (share) share.textContent = `초대 · ${snapshot.code}`;
    const message = $('#roomMessage');
    if (message) message.textContent = '실시간 온라인 테이블에 연결됐어요. 초대 링크나 방 코드로 친구를 불러오세요.';
    drawPlayers(snapshot);
    setOnlineBanner();
    const host = snapshot.host_user_id === window.GB_AUTH_USER?.id;
    setRoomStatus(`온라인 · ${snapshot.players?.length || 1}/6명 · ${host ? '방장' : '참가자'}`);
  }
  async function readRoom(code) {
    const { data, error } = await client.rpc('get_game_room', { p_code: code });
    if (error) throw error;
    return data;
  }
  async function joinRoom(code, name = nickname()) {
    const { data, error } = await client.rpc('join_game_room', { p_code: code, p_nickname: name });
    if (error) throw error;
    return data;
  }
  async function enterSnapshot(snapshot) {
    if (!snapshot) return;
    if (roomChannel) await client.removeChannel(roomChannel);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    showSnapshot(snapshot);
    const code = snapshot.code;
    roomChannel = client.channel(`game-room-${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `code=eq.${code}` }, async (event) => {
        if (event.new?.code !== code) return;
        const currentRound = event.new.state?.round;
        if (currentRound?.id && currentRound.id !== lastRoundId) {
          lastRoundId = currentRound.id;
          if (currentRound.hostUserId !== window.GB_AUTH_USER?.id) await window.gbApplyRemoteRound?.(currentRound);
        }
        try { showSnapshot(await readRoom(code)); } catch (error) { setRoomStatus(`방 정보를 갱신하지 못했어요: ${error.message}`, true); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_room_members', filter: `room_code=eq.${code}` }, async () => {
        try { showSnapshot(await readRoom(code)); } catch (error) { setRoomStatus(`참가자 목록을 갱신하지 못했어요: ${error.message}`, true); }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRoomStatus('실시간 연결이 끊겼어요. 새로고침해 주세요.', true);
      });
    heartbeatTimer = setInterval(async () => {
      const { error } = await client.rpc('heartbeat_game_room', { p_code: code });
      if (error) setRoomStatus('방 연결이 만료됐어요. 로비에서 다시 입장해 주세요.', true);
    }, 30000);
    window.gbPublishRoomRound = async (round) => {
      if (!roomCode || window.GB_AUTH_USER?.id !== window.GB_ROOM_HOST_ID) return;
      const { error } = await client.rpc('sync_game_room_round', { p_code: roomCode, p_round: round });
      if (error) setRoomStatus(`라운드를 공유하지 못했어요: ${error.message}`, true);
    };
  }
  async function requireUser() {
    const user = await signedInUser();
    if (!user) throw new Error('먼저 아이디와 비밀번호로 로그인해 주세요.');
    return user;
  }
  const createButton = $('#createRoom');
  if (createButton) createButton.onclick = async () => {
    try {
      await requireUser();
      setRoomStatus('온라인 방을 만드는 중…');
      const { data, error } = await client.rpc('create_game_room', { p_nickname: nickname() });
      if (error) throw error;
      window.gbOpenRoom?.(data.code);
    } catch (error) { setRoomStatus(error.message, true); }
  };
  const joinButton = $('#joinRoom');
  if (joinButton) joinButton.onclick = async () => {
    const code = ($('#roomInput')?.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return setRoomStatus('5자리 방 코드를 입력해 주세요.', true);
    try {
      await requireUser();
      setRoomStatus('방에 입장하는 중…');
      const snapshot = await joinRoom(code);
      await enterSnapshot(snapshot);
      window.gbOpenRoom?.(code);
      showSnapshot(snapshot);
    } catch (error) { setRoomStatus(error.message, true); }
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('#deal') && roomCode && window.GB_AUTH_USER?.id !== window.GB_ROOM_HOST_ID) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setRoomStatus('이번 라운드는 방장이 카드를 나눕니다.');
    }
    if (event.target.closest('#exitLobby, #backLobby') && roomCode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const code = roomCode;
      roomCode = null;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      (async () => {
        try { await client.rpc('leave_game_room', { p_code: code }); }
        finally { location.href = 'index.html'; }
      })();
    }
  }, true);

  const pageFile = location.pathname.split('/').pop() || 'index.html';
  const hashCode = new URLSearchParams(location.hash.slice(1)).get('room');
  if (pageFile === 'table.html' && hashCode) {
    (async () => {
      try {
        await requireUser();
        const snapshot = await joinRoom(hashCode.toUpperCase());
        await enterSnapshot(snapshot);
      } catch (error) {
        setRoomStatus(error.message, true);
      }
    })();
  }
})();

