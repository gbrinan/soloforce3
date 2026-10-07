import { supabase } from './supabase';

type Listener = () => void;

// _settled = true once a real userId has been confirmed (cannot be reversed).
// _timedOut = true once the offline-fallback timeout fires — listeners are
// notified immediately but stay registered so a late SSO arrival can upgrade
// the app back to online without a page reload.
let _settled = false;
let _timedOut = false;
let _userId: string | null = null;
const _listeners: Listener[] = [];

export function getUserId() { return _userId; }
export function isOfflineMode() { return supabase === null; }

function notify(userId: string | null) {
  if (_settled) return;

  if (userId === null) {
    // Offline timeout fallback — fire listeners but keep them registered
    // so a late SSO message can upgrade to online.
    _timedOut = true;
    _userId = null;
    _listeners.forEach(cb => cb());
    return;
  }

  // Real userId — settle permanently and clear listeners.
  _settled = true;
  _userId = userId;
  const toCall = [..._listeners];
  _listeners.length = 0;
  toCall.forEach(cb => cb());
}

export function onAuthReady(cb: Listener) {
  if (_settled) { cb(); return; }
  if (_timedOut) cb(); // call immediately with offline state, then also register for SSO upgrade
  _listeners.push(cb);
}

async function init() {
  if (!supabase) { notify(null); return; }

  // Check for existing session
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) { notify(data.session.user.id); return; }

  // Listen for auth state changes (e.g., after SSO sign-in)
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!_settled && session?.user) notify(session.user.id);
  });

  // Fallback to offline after 5s. Listeners are kept alive for SSO upgrade.
  const timeout = setTimeout(() => { if (!_settled) notify(null); }, 5000);

  // Receive SSO id_token from mycrew host
  const handler = async (e: MessageEvent) => {
    if (e.data?.source !== 'mycrew-host' || e.data?.type !== 'auth.token') return;
    const googleIdToken: string | undefined = e.data?.payload?.googleIdToken;
    if (!googleIdToken || !supabase) return;

    clearTimeout(timeout);
    window.removeEventListener('message', handler);

    try {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: googleIdToken,
      });
      notify(error ? null : (data.user?.id ?? null));
    } catch {
      notify(null);
    }
  };

  window.addEventListener('message', handler);
}

// Signal host that mymaps is ready to receive tokens
window.parent.postMessage({ source: 'mycrew-mymaps', type: 'app.ready' }, '*');
init();
