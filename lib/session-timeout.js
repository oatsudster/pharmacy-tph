/**
 * Session Timeout — 15 นาที inactivity → logout ไป index.html
 * แสดง warning modal 2 นาทีก่อน timeout พร้อม countdown
 */
(function () {
  const TIMEOUT_MS  = 15 * 60 * 1000;   // 15 นาที
  const WARNING_MS  =  2 * 60 * 1000;   // แจ้งเตือนก่อน 2 นาที
  const AUTH_KEY    = 'tph_auth_v1';
  const LOGOUT_PAGE = 'index.html';

  let warnTimer, logoutTimer, countdownInterval;

  // ---------- Modal UI ----------
  const style = document.createElement('style');
  style.textContent = `
    #st-overlay {
      display: none; position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,.55); align-items: center; justify-content: center;
      font-family: 'Noto Sans Thai', 'Sarabun', sans-serif;
    }
    #st-overlay.st-show { display: flex; }
    #st-box {
      background: #fff; border-radius: 16px; padding: 36px 32px 28px;
      max-width: 360px; width: 90%; text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,.22);
    }
    #st-icon { font-size: 2.6rem; margin-bottom: 10px; }
    #st-title { font-size: 1.15rem; font-weight: 700; color: #1C2B22; margin-bottom: 8px; }
    #st-msg   { font-size: .92rem; color: #3D5A47; margin-bottom: 20px; line-height: 1.6; }
    #st-countdown {
      display: inline-block; font-size: 2rem; font-weight: 800;
      color: #b91c1c; margin-bottom: 22px; min-width: 72px;
    }
    #st-btn-stay {
      display: block; width: 100%; padding: 12px;
      background: #1A5E38; color: #fff; border: none; border-radius: 10px;
      font-size: 1rem; font-family: inherit; font-weight: 600;
      cursor: pointer; margin-bottom: 10px;
    }
    #st-btn-stay:hover { background: #124228; }
    #st-btn-logout {
      background: none; border: none; color: #7A9A85; font-size: .85rem;
      font-family: inherit; cursor: pointer; text-decoration: underline;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'st-overlay';
  overlay.innerHTML = `
    <div id="st-box">
      <div id="st-icon">⏱️</div>
      <div id="st-title">ระบบจะออกจากระบบอัตโนมัติ</div>
      <div id="st-msg">ไม่พบการใช้งานนานกว่า 13 นาที<br>กรุณากดปุ่มด้านล่างเพื่อทำงานต่อ</div>
      <div id="st-countdown">2:00</div>
      <button id="st-btn-stay">ยังอยู่ — ทำงานต่อ</button>
      <button id="st-btn-logout">ออกจากระบบเลย</button>
    </div>
  `;
  document.body ? document.body.appendChild(overlay) : document.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));

  // ---------- Logout ----------
  function doLogout() {
    clearAll();
    localStorage.removeItem(AUTH_KEY);
    location.replace(LOGOUT_PAGE);
  }

  // ---------- Countdown ----------
  function startCountdown() {
    let remaining = WARNING_MS / 1000; // seconds
    const el = document.getElementById('st-countdown');
    const update = () => {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      el.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (remaining <= 0) { doLogout(); return; }
      remaining--;
    };
    update();
    countdownInterval = setInterval(update, 1000);
  }

  // ---------- Show / Hide Modal ----------
  function showWarning() {
    overlay.classList.add('st-show');
    startCountdown();
    logoutTimer = setTimeout(doLogout, WARNING_MS + 1000);
  }

  function hideWarning() {
    overlay.classList.remove('st-show');
    clearInterval(countdownInterval);
    clearTimeout(logoutTimer);
  }

  // ---------- Timer Reset ----------
  function clearAll() {
    clearTimeout(warnTimer);
    clearTimeout(logoutTimer);
    clearInterval(countdownInterval);
  }

  function resetTimer() {
    clearAll();
    hideWarning();
    warnTimer = setTimeout(showWarning, TIMEOUT_MS - WARNING_MS);
  }

  // ---------- Activity Events ----------
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
    document.addEventListener(ev, resetTimer, { passive: true })
  );

  // ---------- Modal Buttons ----------
  document.addEventListener('click', function (e) {
    if (e.target.id === 'st-btn-stay')   resetTimer();
    if (e.target.id === 'st-btn-logout') doLogout();
  });

  // ---------- Start ----------
  resetTimer();
})();
