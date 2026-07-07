// Shared-password gate: hides the whole tool behind a login form until
// /api/session confirms a valid session cookie. The cookie itself is
// HttpOnly (deliberately unreadable from JS) so this always asks the
// server rather than inspecting document.cookie.

const loginGate = /** @type {HTMLElement} */ (document.getElementById('login-gate'));
const appWrap = /** @type {HTMLElement} */ (document.getElementById('app-wrap'));
const loginForm = /** @type {HTMLFormElement} */ (document.getElementById('login-form'));
const loginPassword = /** @type {HTMLInputElement} */ (document.getElementById('login-password'));
const loginError = /** @type {HTMLElement} */ (document.getElementById('login-error'));
const logoutBtn = /** @type {HTMLButtonElement} */ (document.getElementById('logout-btn'));

function showApp() {
  loginGate.style.display = 'none';
  appWrap.style.display = '';
}

export function showGate() {
  appWrap.style.display = 'none';
  loginGate.style.display = '';
  loginPassword.value = '';
  loginPassword.focus();
}

async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const body = await res.json();
    if (body.authenticated) showApp();
    else showGate();
  } catch {
    showGate();
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPassword.value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      loginError.textContent = body.error || 'Incorrect password.';
      return;
    }
    showApp();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    /* best-effort - show the gate either way */
  }
  showGate();
});

checkSession();
