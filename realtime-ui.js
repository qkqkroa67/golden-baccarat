(() => {
  const client = window.GB_SUPABASE_CLIENT;
  if (!client) return;

  const $ = (selector) => document.querySelector(selector);
  let presenceChannel = null;
  let betChannel = null;
  let activeRoom = null;
  let betObserver = null;
  let betSyncTimer = null;
  let lastPresenceRoom = null;
  let betSyncQueue = Promise.resolve();

  const money = (value) => '₩' + Number(value || 0).toLocaleString('ko-KR');
  const currentNickname = () => (
    localStorage.gbNickname ||
    window.GB_AUTH_USER?.user_metadata?.username ||
    '플레이어'
  ).trim().slice(0, 16) || '플레이어';

  function ensureLobbyPanel() {
    const card = $('.entrycard');
    if (!card || $('#globalOnlinePanel')) return;
    const panel = document.createElement('section');
    panel.id = 'globalOnlinePanel';
    panel.style.cssText = 'margin-top:18px;padding:13px;border:1px solid #e8c57455;border-radius:12px;background:#0b1914aa;text-align:left';
    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-weight:800;color:#f2d488;font-size:13px';
    const title = document.createElement('span');
    title.textContent = '전체 접속자';
    const count = document.createElement('span');
    count.id = 'globalOnlineCount';
    count.textContent = '연결 중…';
    heading.append(title, count);
    const list = document.createElement('div');
    list.id = 'globalOnlineList';
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-top:10px';
    const note = document.createElement('div');
    note.textContent = '현재 골든 바카라에 접속한 로그인 유저';
    note.style.cssText = 'margin-top:8px;color:#a9c5b7;font-size:10px';
    panel.append(heading, list, note);
    const fine = $('.entryfine');
    if (fine) fine.before(panel);
    else card.append(panel);
  }

  function renderGlobalPresence() {
    const list = $('#globalOnlineList');
    const count = $('#globalOnlineCount');
    if (!list || !count || !presenceChannel) return;
    const state = presenceChannel.presenceState();
    const byUser = new Map();
    Object.values(state).flat().forEach((entry) => {
      if (entry?.user_id) byUser.set(entry.user_id, entry);
    });
    const users = [...byUser.values()].sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), 'ko'));
    count.textContent = users.length + '명';
    list.replaceChildren();
    if (!users.length) {
      const empty = document.createElement('span');
      empty.textContent = '접속자가 없습니다.';
      empty.style.color = '#a9c5b7';
      empty.style.fontSize = '12px';
      list.append(empty);
      return;
    }
    users.forEach((user) => {
      const pill = document.createElement('span');
      pill.style.cssText = 'padding:6px 9px;border:1px solid #ffffff25;border-radius:20px;background:#172c23;color:#fff7e8;font-size:11px';
      pill.textContent = user.nickname + (user.room_code ? ' · ' + user.room_code : ' · 로비');
      list.append(pill);
    });
  }

  async function startPresence(user) {
    if (presenceChannel) {
      await client.removeChannel(presenceChannel);
      presenceChannel = null;
    }
    if (!user) {
      renderGlobalPresence();
      return;
    }
    ensureLobbyPanel();
    presenceChannel = client.channel('golden-baccarat-global-lobby', {
      config: { presence: { key: user.id } },
    });
    presenceChannel
      .on('presence', { event: 'sync' }, renderGlobalPresence)
      .on('presence', { event: 'join' }, renderGlobalPresence)
      .on('presence', { event: 'leave' }, renderGlobalPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await trackPresence(user);
          renderGlobalPresence();
        }
      });
  }

  async function trackPresence(user = window.GB_AUTH_USER) {
    if (!presenceChannel || !user) return;
    const roomCode = window.GB_ROOM_CODE || null;
    const page = location.pathname.split('/').pop() || 'index.html';
    const signature = roomCode + '|' + page + '|' + currentNickname();
    if (signature === lastPresenceRoom) return;
    lastPresenceRoom = signature;
    const { error } = await presenceChannel.track({
      user_id: user.id,
      nickname: currentNickname(),
      room_code: roomCode,
      page,
      online_at: new Date().toISOString(),
    });
    if (error) console.warn('Presence update failed:', error.message);
  }

  function ensureLiveBetsPanel() {
    const players = $('#players');
    if (!players || $('#liveBetsPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'liveBetsPanel';
    panel.style.cssText = 'margin-top:10px;padding-top:9px;border-top:1px solid #ffffff20';
    const heading = document.createElement('div');
    heading.textContent = '실시간 베팅 현황';
    heading.style.cssText = 'font-size:11px;font-weight:800;color:#f2d488;margin-bottom:7px';
    const list = document.createElement('div');
    list.id = 'liveBetsList';
    list.style.cssText = 'display:grid;gap:5px';
    const empty = document.createElement('span');
    empty.id = 'liveBetsEmpty';
    empty.textContent = '아직 베팅한 사람이 없습니다.';
    empty.style.cssText = 'font-size:11px;color:#a9c5b7';
    list.append(empty);
    panel.append(heading, list);
    players.parentElement?.append(panel);
  }

  function renderLiveBets(rows) {
    ensureLiveBetsPanel();
    const list = $('#liveBetsList');
    if (!list) return;
    list.replaceChildren();
    const entries = (rows || []).sort((a, b) =>
      String(a.nickname).localeCompare(String(b.nickname), 'ko') ||
      String(a.side).localeCompare(String(b.side))
    );
    if (!entries.length) {
      const empty = document.createElement('span');
      empty.textContent = '아직 베팅한 사람이 없습니다.';
      empty.style.cssText = 'font-size:11px;color:#a9c5b7';
      list.append(empty);
      return;
    }
    const labels = { P: '플레이어', B: '뱅커', T: '타이' };
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:5px 8px;border-radius:7px;background:#0c2119;font-size:11px';
      const who = document.createElement('span');
      who.textContent = entry.nickname + ' · ' + labels[entry.side];
      const amount = document.createElement('strong');
      amount.textContent = money(entry.amount);
      amount.style.color = '#f2d488';
      row.append(who, amount);
      list.append(row);
    });
  }

  async function refreshLiveBets(code = activeRoom) {
    if (!code) return;
    const { data, error } = await client.from('game_room_bets')
      .select('user_id,nickname,side,amount,updated_at')
      .eq('room_code', code);
    if (error) {
      console.warn('Could not load live bets:', error.message);
      return;
    }
    renderLiveBets(data || []);
  }

  function localBetAmounts() {
    const amount = (side) => {
      const badge = $('.bet[data-side="' + side + '"] .amt');
      return badge ? Number(badge.textContent.replace(/[^0-9]/g, '')) || 0 : 0;
    };
    return { P: amount('P'), B: amount('B'), T: amount('T') };
  }

  function scheduleBetSync() {
    if (!activeRoom || !window.GB_AUTH_USER) return;
    clearTimeout(betSyncTimer);
    betSyncTimer = setTimeout(() => {
      const code = activeRoom;
      const bets = localBetAmounts();
      betSyncQueue = betSyncQueue.then(async () => {
        if (activeRoom !== code) return;
        const { error } = await client.rpc('sync_game_room_bets', {
          p_code: code,
          p_bets: bets,
        });
        if (error) console.warn('Could not sync live bets:', error.message);
      }).catch((error) => console.warn('Live bet sync failed:', error));
    }, 180);
  }

  async function enterRoom(code) {
    if (!code || activeRoom === code) return;
    activeRoom = code;
    ensureLiveBetsPanel();
    if (betChannel) await client.removeChannel(betChannel);
    await refreshLiveBets(code);
    betChannel = client.channel('game-room-bets-' + code)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'game_room_bets',
        filter: 'room_code=eq.' + code,
      }, () => refreshLiveBets(code))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refreshLiveBets(code);
      });
    scheduleBetSync();
  }

  async function leaveRoom() {
    if (betSyncTimer) clearTimeout(betSyncTimer);
    if (activeRoom && window.GB_AUTH_USER) {
      try {
        await client.rpc('sync_game_room_bets', {
          p_code: activeRoom,
          p_bets: { P: 0, B: 0, T: 0 },
        });
      } catch (error) {
        console.warn('Could not clear live bets:', error);
      }
    }
    activeRoom = null;
    if (betChannel) {
      await client.removeChannel(betChannel);
      betChannel = null;
    }
    renderLiveBets([]);
  }

  function watchBetChanges() {
    const area = $('.bets');
    if (!area || betObserver) return;
    betObserver = new MutationObserver(scheduleBetSync);
    betObserver.observe(area, { childList: true, subtree: true, characterData: true });
  }

  async function initialize() {
    ensureLobbyPanel();
    ensureLiveBetsPanel();
    watchBetChanges();
    const { data } = await client.auth.getSession();
    if (data?.session?.user) {
      window.GB_AUTH_USER = data.session.user;
      await startPresence(data.session.user);
    }
    client.auth.onAuthStateChange((event, session) => {
      setTimeout(async () => {
        const user = session?.user || null;
        window.GB_AUTH_USER = user;
        if (user) await startPresence(user);
        else {
          await startPresence(null);
          await leaveRoom();
        }
      }, 0);
    });
    setInterval(async () => {
      await trackPresence();
      const code = window.GB_ROOM_CODE || null;
      if (code && code !== activeRoom) await enterRoom(code);
      if (!code && activeRoom) await leaveRoom();
    }, 900);
  }

  initialize().catch((error) => console.warn('Realtime UI initialization failed:', error));
})();