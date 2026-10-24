// ================================================================
// SurveyKE — Chrome-only (localStorage) app with wallet, settings,
// profile avatars, referral programme, and delete account
// ================================================================

const STORE_USERS          = 'surveyke_users';
const STORE_SESSION        = 'surveyke_session';
const STORE_SURVEYS        = 'surveyke_surveys';
const STORE_PARTICIPATIONS = 'surveyke_participations';
const STORE_THEME          = 'surveyke_theme';
const STORE_NOTIFICATIONS  = 'surveyke_notifications';
const STORE_PENDING_REF    = 'surveyke_pending_ref';

const ADMIN_EMAIL = 'mautinyagah@gmail.com';
const DEMO_URL = 'https://docs.google.com/forms/';
const REWARD_APPROVED = 50;
const REWARD_PENDING  = 20;

const ANIME_SEEDS = ['Akira', 'Yuki', 'Hana', 'Kai', 'Rin', 'Mei', 'Sora', 'Aoi', 'Ren', 'Nao', 'Hikari', 'Yui'];
const ANIME_URLS = ANIME_SEEDS.map(function(s) { return 'https://api.dicebear.com/9.x/lorelei/svg?seed=' + s; });

let currentUser = null;
let isAdmin = false;
let surveysCache = [];
let selectedDirectoryTopic = 'All';
let activeSurveyId = null;
let currentView = 'home';
let editingAvatar = null;
let editingName = '';

// ---------- Storage ----------
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function uid(prefix) {
  prefix = prefix || 'id';
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
async function hashPassword(pw) {
  try {
    const enc = new TextEncoder().encode(pw + '::surveyke::salt');
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  } catch (e) { return 'plain::' + btoa(pw); }
}

// ---------- Theme ----------
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORE_THEME, theme); } catch (e) {}
  if (currentView === 'settings') renderSettings();
}

// ---------- Referral helpers ----------
function generateReferralCode(userId) {
  const clean = (userId || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return 'SK' + (clean || '000000');
}
function ensureReferralCode(user) {
  if (!user || !user.id) return 'SK000000';
  if (user.referralCode) return user.referralCode;
  const code = generateReferralCode(user.id);
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === user.id; });
  if (idx !== -1) { users[idx].referralCode = code; writeStore(STORE_USERS, users); }
  return code;
}
function getReferralLink() {
  if (!currentUser) return '';
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; });
  const code = stored ? (stored.referralCode || ensureReferralCode(stored)) : '';
  return window.location.origin + window.location.pathname + '?ref=' + code;
}
function copyReferralLink() {
  const link = getReferralLink();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(function() { showToast('Referral link copied!'); })
      .catch(function() { fallbackCopy(link); showToast('Referral link copied!'); });
  } else { fallbackCopy(link); showToast('Referral link copied!'); }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}
function shareReferralLink() {
  const link = getReferralLink();
  const text = "Join me on SurveyKE — share your voice and shape Kenya's future!";
  if (navigator.share) {
    navigator.share({ title: 'SurveyKE', text: text, url: link }).catch(function() {});
  } else { fallbackCopy(link); showToast('Link copied to share.'); }
}

// ---------- Seed + migrate ----------
function migrateBrokenSeedUrls() {
  const all = readStore(STORE_SURVEYS, null);
  if (!Array.isArray(all)) return;
  let changed = false;
  all.forEach(function(s) {
    if (s.survey_url && s.survey_url.indexOf('forms.gle/example-survey') !== -1) {
      s.survey_url = DEMO_URL; changed = true;
    }
  });
  if (changed) writeStore(STORE_SURVEYS, all);
}
function seedSurveysIfEmpty() {
  const existing = readStore(STORE_SURVEYS, null);
  if (Array.isArray(existing) && existing.length > 0) return;
  const now = Date.now();
  writeStore(STORE_SURVEYS, [
    { id: uid('sur'), title: 'Digital ID Public Feedback', category: 'Public Policy', description: 'Share your views on the proposed national digital identity system and how it may impact everyday Kenyans.', estimated_minutes: 5, duration: '5 mins', status: 'published', survey_url: DEMO_URL, eligibility: 'Kenyan residents aged 18+.', instructions: 'Answer all questions honestly. Responses are anonymous.', created_at: now - 300000 },
    { id: uid('sur'), title: 'Mobile Money Usage Study', category: 'Finance', description: 'Help us understand how Kenyans use mobile money platforms for daily transactions, savings, and small business.', estimated_minutes: 7, duration: '7 mins', status: 'published', survey_url: DEMO_URL, eligibility: 'Anyone who has used mobile money in the last 30 days.', instructions: 'Respond based on your most recent month of activity.', created_at: now - 200000 },
    { id: uid('sur'), title: 'Matatu Commuter Experience', category: 'Transport', description: 'Rate your experience with matatus, fares, safety, and route coverage in Nairobi and other towns.', estimated_minutes: 6, duration: '6 mins', status: 'published', survey_url: DEMO_URL, eligibility: 'Regular commuters using public transport.', instructions: 'Focus on the last 7 days of your commute.', created_at: now - 100000 }
  ]);
}

// ---------- Session ----------
function restoreSession() {
  const session = readStore(STORE_SESSION, null);
  if (session && session.userId) {
    const users = readStore(STORE_USERS, []);
    const user = users.find(function(u) { return u.id === session.userId; });
    if (user) {
      currentUser = {
        id: user.id, email: user.email,
        name: user.name || user.email.split('@')[0],
        avatar: user.avatar || null,
        referralCode: user.referralCode || ensureReferralCode(user),
        referrals: user.referrals || []
      };
      isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    } else { writeStore(STORE_SESSION, null); }
  }
  updateAuthUI();
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', function() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) localStorage.setItem(STORE_PENDING_REF, ref);
  } catch (e) {}

  migrateBrokenSeedUrls();
  seedSurveysIfEmpty();
  restoreSession();
  fetchAndRenderSurveys();
});

// ---------- Navigation ----------
function navigate(viewName, param) {
  currentView = viewName;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  ['view-home','view-surveys','view-detail','view-wallet','view-profile','view-settings','view-admin'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  if (viewName === 'home') {
    document.getElementById('view-home').classList.remove('hidden');
    updateBottomNav('home');
  } else if (viewName === 'surveys') {
    document.getElementById('view-surveys').classList.remove('hidden');
    renderDirectorySurveys();
    updateBottomNav('surveys');
  } else if (viewName === 'detail' && param) {
    activeSurveyId = param;
    document.getElementById('view-detail').classList.remove('hidden');
    renderSurveyDetail(param);
    updateBottomNav('surveys');
  } else if (viewName === 'wallet') {
    document.getElementById('view-wallet').classList.remove('hidden');
    renderWallet();
    updateBottomNav('wallet');
  } else if (viewName === 'profile') {
    document.getElementById('view-profile').classList.remove('hidden');
    renderProfile();
    updateBottomNav('profile');
  } else if (viewName === 'settings') {
    document.getElementById('view-settings').classList.remove('hidden');
    renderSettings();
    updateBottomNav('profile');
  } else if (viewName === 'admin') {
    if (!isAdmin) { showToast('Administrator access required.'); navigate('home'); return; }
    document.getElementById('view-admin').classList.remove('hidden');
    renderAdminDashboard();
    updateBottomNav(null);
  }
}
function updateBottomNav(tab) {
  document.querySelectorAll('.bottom-nav-item').forEach(function(item) {
    if (item.dataset.tab === tab) item.classList.add('active');
    else item.classList.remove('active');
  });
}

// ---------- Surveys ----------
function fetchAndRenderSurveys() {
  try {
    const all = readStore(STORE_SURVEYS, []);
    surveysCache = (all || []).filter(function(s) {
      if (s.status !== 'published') return false;
      if (!s.survey_url || !s.survey_url.startsWith('https://')) return false;
      if (s.survey_url.indexOf('example.com') !== -1) return false;
      if (s.survey_url.indexOf('placeholder') !== -1) return false;
      return true;
    }).sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    renderHomeSurveys();
    renderDirectorySurveys();
  } catch (e) {
    console.error(e);
    surveysCache = [];
    renderHomeSurveys();
    renderDirectorySurveys();
  }
}
function renderHomeSurveys() {
  const container = document.getElementById('home-surveys-grid');
  if (surveysCache.length === 0) {
    container.innerHTML = '<div class="state-box" style="grid-column:1/-1;"><strong>No active surveys right now</strong><p>Check back soon — new surveys are added regularly.</p></div>';
    return;
  }
  container.innerHTML = surveysCache.slice(0, 3).map(function(s) {
    return '<div class="survey-card"><div class="card-top"><span class="cat-chip">' + escapeHtml(s.category || 'General') + '</span><span class="status-chip">Active</span></div><h3>' + escapeHtml(s.title) + '</h3><p class="clamp">' + escapeHtml(s.description || '') + '</p><div class="card-bottom"><span class="meta-chip"><svg><use href="#i-clock"/></svg> ' + escapeHtml(s.estimated_minutes || s.duration || '5') + ' mins</span><button class="card-link" onclick="navigate(\'detail\', \'' + s.id + '\')">Participate &rarr;</button></div></div>';
  }).join('');
}
function renderDirectorySurveys() {
  const container = document.getElementById('directory-surveys-grid');
  let list = surveysCache;
  if (selectedDirectoryTopic !== 'All') list = surveysCache.filter(function(s) { return s.category === selectedDirectoryTopic; });
  if (list.length === 0) {
    container.innerHTML = '<div class="state-box" style="grid-column:1/-1;"><strong>No surveys found in this category</strong><p>New studies will appear here once published.</p></div>';
    return;
  }
  container.innerHTML = list.map(function(s) {
    return '<div class="survey-card"><div class="card-top"><span class="cat-chip">' + escapeHtml(s.category || 'General') + '</span><span class="status-chip">Active</span></div><h3>' + escapeHtml(s.title) + '</h3><p class="clamp">' + escapeHtml(s.description || '') + '</p><div class="card-bottom"><span class="meta-chip"><svg><use href="#i-clock"/></svg> ' + escapeHtml(s.estimated_minutes || s.duration || '5') + ' mins</span><button class="card-link" onclick="navigate(\'detail\', \'' + s.id + '\')">View Details &rarr;</button></div></div>';
  }).join('');
}
function filterDirectoryTopic(topic) {
  selectedDirectoryTopic = topic;
  document.querySelectorAll('#directory-topic-chips .topic-chip').forEach(function(c) {
    if (c.textContent.trim() === topic || (topic === 'All' && c.textContent.includes('All'))) c.classList.add('active');
    else c.classList.remove('active');
  });
  renderDirectorySurveys();
}
function renderSurveyDetail(id) {
  const survey = surveysCache.find(function(s) { return s.id === id; });
  const container = document.getElementById('survey-detail-content');
  if (!survey) {
    container.innerHTML = '<div class="state-box"><strong>Survey not found</strong><p>This survey may have closed.</p><button class="btn btn-primary btn-sm" onclick="navigate(\'surveys\')" style="margin-top:12px;">Back to Surveys</button></div>';
    return;
  }
  const isDemo = survey.survey_url === DEMO_URL;
  const demoNotice = isDemo ? '<div class="notice show info" style="margin-bottom:12px;"><strong>Demo survey:</strong> Placeholder link — admin should add a real one.</div>' : '';
  const elig = survey.eligibility ? '<div class="detail-section"><h3>Eligibility</h3><p class="detail-text">' + escapeHtml(survey.eligibility) + '</p></div>' : '';
  const inst = survey.instructions ? '<div class="detail-section"><h3>Instructions</h3><p class="detail-text">' + escapeHtml(survey.instructions) + '</p></div>' : '';

  container.innerHTML = '<div class="detail-card"><div class="card-top" style="margin-bottom:14px;"><span class="cat-chip">' + escapeHtml(survey.category || 'General') + '</span><span class="status-chip">Active</span></div><h1>' + escapeHtml(survey.title) + '</h1><div style="display:flex;gap:8px;margin-bottom:18px;"><span class="meta-chip"><svg><use href="#i-clock"/></svg> Est. ' + escapeHtml(survey.estimated_minutes || survey.duration || '5') + ' mins</span></div><p class="detail-text">' + escapeHtml(survey.description || '') + '</p>' + elig + inst + '<div class="participate-box"><h3>Take the Survey</h3><p>This survey is hosted on a trusted external platform. Click below to begin — your participation will be tracked.</p>' + demoNotice + '<div id="participate-notice" class="notice"></div><div class="btn-row"><button class="btn btn-primary" onclick="startExternalSurvey(\'' + survey.id + '\')">Proceed to Survey <svg><use href="#i-external"/></svg></button></div></div></div>';
}
async function startExternalSurvey(surveyId) {
  if (!currentUser) { showToast('Please sign in to participate.'); openAuth('signin'); return; }
  const allSurveys = readStore(STORE_SURVEYS, []);
  const survey = allSurveys.find(function(s) { return s.id === surveyId; });
  if (!survey || !survey.survey_url || !survey.survey_url.startsWith('https://')) { showToast('Invalid survey.'); return; }
  try {
    const parts = readStore(STORE_PARTICIPATIONS, []);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const started = parts.some(function(p) {
      return p.survey_id === surveyId && p.user_id === currentUser.id && p.status === 'started' && p.started_at > oneDayAgo;
    });
    if (!started) {
      parts.push({ id: uid('part'), survey_id: surveyId, user_id: currentUser.id, status: 'started', review_status: 'pending', submitted_at: Date.now(), started_at: Date.now() });
      writeStore(STORE_PARTICIPATIONS, parts);
    }
    showToast('Participation recorded. Redirecting...');
    setTimeout(function() { window.open(survey.survey_url, '_blank', 'noopener,noreferrer'); }, 700);
  } catch (e) {
    console.error(e);
    window.open(survey.survey_url, '_blank', 'noopener,noreferrer');
  }
}

// ---------- Wallet ----------
function renderWallet() {
  const container = document.getElementById('wallet-content');

  if (!currentUser) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg><use href="#i-wallet"/></svg></div><h2>Sign in to view your wallet</h2><p>Track your earnings, transactions, and withdrawals all in one place.</p><button class="btn btn-primary" onclick="openAuth(\'signin\')">Sign In</button></div>';
    return;
  }

  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id; });
  const allSurveys = readStore(STORE_SURVEYS, []);

  let balance = 0;
  parts.forEach(function(p) {
    balance += (p.review_status === 'approved') ? REWARD_APPROVED : REWARD_PENDING;
  });

  const transactions = parts.map(function(p) {
    const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
    return { id: p.id, title: s ? s.title : 'Deleted survey', date: p.submitted_at, amount: (p.review_status === 'approved' ? REWARD_APPROVED : REWARD_PENDING), status: p.review_status || 'pending' };
  }).sort(function(a, b) { return b.date - a.date; });

  container.innerHTML = `
    <div class="wallet-header">
      <h2>Wallet</h2>
      <p>Your survey earnings, in one place.</p>
    </div>
    <div class="wallet-balance-card">
      <div class="wallet-balance-label">Available Balance</div>
      <div class="wallet-balance-value">KSh ${balance.toLocaleString()}</div>
      <div class="wallet-balance-sub">From ${parts.length} survey${parts.length === 1 ? '' : 's'}</div>
      <button class="btn btn-light wallet-withdraw-btn" onclick="showToast('Payouts coming soon. Keep participating!')">
        <svg style="width:16px;height:16px;"><use href="#i-download"/></svg>
        Withdraw
      </button>
    </div>
    <div class="wallet-info-banner">
      <svg><use href="#i-shield"/></svg>
      <p>This is a preview. Real cash payouts will be enabled once verification is complete.</p>
    </div>
    <div class="wallet-transactions">
      <h3>Recent Activity</h3>
      ${transactions.length === 0 ? '<div class="state-box"><strong>No transactions yet</strong><p>Complete surveys to start earning.</p></div>' : `
        <div class="transaction-list">
          ${transactions.map(function(t) {
            return '<div class="transaction-item"><div class="transaction-icon ' + (t.status === 'approved' ? 'approved' : 'pending') + '"><svg><use href="#i-check-circle"/></svg></div><div class="transaction-info"><strong>' + escapeHtml(t.title) + '</strong><small>' + new Date(t.date).toLocaleDateString() + ' &bull; ' + escapeHtml(t.status) + '</small></div><div class="transaction-amount">+ KSh ' + t.amount + '</div></div>';
          }).join('')}
        </div>
      `}
    </div>
  `;
}

// ---------- Profile ----------
function renderProfile() {
  const container = document.getElementById('profile-content');

  if (!currentUser) {
    container.innerHTML = '<div class="profile-card"><div class="profile-avatar-container guest"><span class="initial">?</span></div><h2>Welcome to SurveyKE</h2><p class="profile-description">Sign in or create an account to participate in surveys, track responses, and earn rewards.</p><div class="profile-actions"><button class="btn btn-primary btn-block" onclick="openAuth(\'signin\')">Sign In</button><button class="btn btn-outline btn-block" onclick="openAuth(\'signup\')">Create Account</button></div><div class="profile-actions" style="margin-top: 4px;"><button class="btn btn-outline btn-block" onclick="navigate(\'settings\')"><svg style="width:16px;height:16px;"><use href="#i-settings"/></svg>Settings</button></div></div>';
    return;
  }

  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  const avatar = stored.avatar || null;
  const referrals = stored.referrals || [];
  const code = stored.referralCode || ensureReferralCode(stored);

  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id; });
  const approved = parts.filter(function(p) { return p.review_status === 'approved'; }).length;

  const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
  const avatarHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" alt="Avatar">' : '<span class="initial">' + escapeHtml(initial) + '</span>';

  container.innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar-container">${avatarHTML}</div>
      <h2>${escapeHtml(currentUser.name || 'User')}</h2>
      <p class="profile-email">${escapeHtml(currentUser.email)}</p>
      <div class="profile-stats">
        <div class="profile-stat"><span class="profile-stat-val">${parts.length}</span><span class="profile-stat-label">Surveys taken</span></div>
        <div class="profile-stat"><span class="profile-stat-val">${approved}</span><span class="profile-stat-label">Approved</span></div>
      </div>
      <div class="profile-actions">
        <button class="btn btn-primary btn-block" onclick="openEditProfile()"><svg style="width:16px;height:16px;"><use href="#i-edit"/></svg>Edit Profile</button>
      </div>
      <div class="referral-card">
        <div class="referral-header"><svg><use href="#i-gift"/></svg><strong>Referral Programme</strong></div>
        <p class="referral-desc">Invite friends and earn rewards when they join SurveyKE.</p>
        <div class="referral-code-box">
          <span class="referral-code-label">Your code</span>
          <span class="referral-code-val">${escapeHtml(code)}</span>
        </div>
        <div class="referral-stats">
          <div class="referral-stat"><strong>${referrals.length}</strong><small>Friends invited</small></div>
        </div>
        <div class="referral-actions">
          <button class="btn btn-outline btn-sm" onclick="copyReferralLink()"><svg style="width:14px;height:14px;"><use href="#i-copy"/></svg>Copy Link</button>
          <button class="btn btn-outline btn-sm" onclick="shareReferralLink()"><svg style="width:14px;height:14px;"><use href="#i-share"/></svg>Share</button>
        </div>
      </div>
      <div class="profile-actions">
        ${isAdmin ? '<button class="btn btn-primary btn-block" onclick="navigate(\'admin\')">Admin Dashboard</button>' : ''}
        <button class="btn btn-outline btn-block" onclick="navigate(\'settings\')"><svg style="width:16px;height:16px;"><use href="#i-settings"/></svg>Settings</button>
        <button class="btn btn-outline btn-block" onclick="signOut()">Sign Out</button>
      </div>
      <div class="danger-zone">
        <button class="btn btn-outline btn-block danger-btn" onclick="deleteAccount()"><svg style="width:16px;height:16px;"><use href="#i-trash"/></svg>Delete Account</button>
        <p class="danger-note">Permanently delete your account and all associated data from this browser.</p>
      </div>
    </div>
  `;
}

// ---------- Edit Profile ----------
function openEditProfile() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  editingAvatar = stored.avatar || null;
  editingName = stored.name || currentUser.name || '';
  document.getElementById('edit-name-input').value = editingName;
  document.getElementById('edit-profile-overlay').classList.add('open');
  document.getElementById('edit-profile-notice').className = 'notice';
  renderAvatarGrid();
  updateEditAvatarPreview();
  document.getElementById('edit-name-input').oninput = function() {
    editingName = this.value;
    if (!editingAvatar) updateEditAvatarPreview();
  };
}
function closeEditProfile() { document.getElementById('edit-profile-overlay').classList.remove('open'); }
function handleEditProfileOverlayClick(e) { if (e.target.id === 'edit-profile-overlay') closeEditProfile(); }
function renderAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;
  grid.innerHTML = ANIME_URLS.map(function(url) {
    const isSelected = editingAvatar === url;
    return '<button class="avatar-option ' + (isSelected ? 'selected' : '') + '" onclick="selectAvatar(\'' + url + '\')"><img src="' + url + '" alt="avatar" loading="lazy"></button>';
  }).join('');
}
function selectAvatar(url) { editingAvatar = url; renderAvatarGrid(); updateEditAvatarPreview(); }
function updateEditAvatarPreview() {
  const preview = document.getElementById('edit-avatar-preview');
  if (!preview) return;
  if (editingAvatar) {
    preview.innerHTML = '<img src="' + escapeHtml(editingAvatar) + '" alt="Preview">';
  } else {
    const initial = (editingName || (currentUser && currentUser.email) || '?').charAt(0).toUpperCase();
    preview.innerHTML = '<span class="initial">' + escapeHtml(initial) + '</span>';
  }
}
function handleAvatarFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB.'); return; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    editingAvatar = ev.target.result;
    renderAvatarGrid();
    updateEditAvatarPreview();
  };
  reader.readAsDataURL(file);
}
function saveProfileEdits() {
  if (!currentUser) return;
  const newName = document.getElementById('edit-name-input').value.trim();
  if (newName.length < 2) {
    const n = document.getElementById('edit-profile-notice');
    n.className = 'notice show error';
    n.textContent = 'Name must be at least 2 characters.';
    return;
  }
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) { showToast('User not found.'); return; }
  users[idx].name = newName;
  users[idx].avatar = editingAvatar;
  writeStore(STORE_USERS, users);
  currentUser.name = newName;
  currentUser.avatar = editingAvatar;
  closeEditProfile();
  showToast('Profile updated.');
  renderProfile();
  updateAuthUI();
}

// ---------- Settings ----------
function renderSettings() {
  const container = document.getElementById('settings-content');
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const notifications = readStore(STORE_NOTIFICATIONS, true);

  container.innerHTML = `
    <div class="settings-container">
      <div class="settings-header"><h2>Settings</h2><p>Manage your preferences.</p></div>

      <div class="settings-group">
        <div class="settings-group-title">Appearance</div>
        <div class="settings-item">
          <div class="settings-item-left"><strong>Theme</strong><small>Choose light or dark mode</small></div>
          <div class="theme-selector">
            <button class="theme-option ${currentTheme === 'light' ? 'active' : ''}" onclick="setTheme('light')">Light</button>
            <button class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" onclick="setTheme('dark')">Dark</button>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Notifications</div>
        <div class="settings-item">
          <div class="settings-item-left"><strong>Email Notifications</strong><small>Get notified about new surveys</small></div>
          <button class="toggle-switch ${notifications ? 'on' : ''}" onclick="toggleNotifications()"><span class="toggle-knob"></span></button>
        </div>
      </div>

      ${currentUser ? `
      <div class="settings-group">
        <div class="settings-group-title">Account</div>
        <button class="settings-item settings-item-btn" onclick="navigate('profile')">
          <div class="settings-item-left"><strong>Profile</strong><small>Edit name, avatar, and more</small></div>
          <svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg>
        </button>
      </div>
      ` : ''}

      <div class="settings-group">
        <div class="settings-group-title">Privacy & Data</div>
        <div class="settings-item">
          <div class="settings-item-left"><strong>Clear App Data</strong><small>Remove all your data from this browser</small></div>
          <button class="btn btn-outline btn-sm" onclick="clearAppData()">Clear</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">About</div>
        <div class="settings-item settings-item-static">
          <div class="settings-item-left"><strong>SurveyKE</strong><small>Version 1.0.0 &bull; Built for Kenya</small></div>
        </div>
        <div class="settings-item settings-item-static">
          <div class="settings-item-left"><strong>Privacy Policy</strong><small>All data stays on your device</small></div>
        </div>
        <div class="settings-item settings-item-static">
          <div class="settings-item-left"><strong>Terms of Service</strong><small>Local-only, no data leaves your browser</small></div>
        </div>
      </div>

      ${currentUser ? `
      <div class="settings-group">
        <div class="settings-group-title">Danger Zone</div>
        <div class="settings-item">
          <div class="settings-item-left"><strong>Delete Account</strong><small>Permanently remove your account</small></div>
          <button class="btn btn-outline btn-sm danger-btn" onclick="deleteAccount()">Delete</button>
        </div>
      </div>
      ` : ''}
    </div>
  `;
}
function toggleNotifications() {
  const current = readStore(STORE_NOTIFICATIONS, true);
  writeStore(STORE_NOTIFICATIONS, !current);
  renderSettings();
}
function clearAppData() {
  if (!confirm('Clear all app data? This will log you out and reset everything in this browser.')) return;
  localStorage.removeItem(STORE_USERS);
  localStorage.removeItem(STORE_SESSION);
  localStorage.removeItem(STORE_SURVEYS);
  localStorage.removeItem(STORE_PARTICIPATIONS);
  localStorage.removeItem(STORE_PENDING_REF);
  localStorage.removeItem(STORE_NOTIFICATIONS);
  location.reload();
}

// ---------- Delete Account ----------
function deleteAccount() {
  if (!currentUser) return;
  if (!confirm('Delete your account? This will permanently erase your profile, surveys taken, and referral data from this browser. This cannot be undone.')) return;
  const userId = currentUser.id;

  let users = readStore(STORE_USERS, []);
  users = users.filter(function(u) { return u.id !== userId; });
  users.forEach(function(u) {
    if (u.referrals && Array.isArray(u.referrals)) u.referrals = u.referrals.filter(function(id) { return id !== userId; });
  });
  writeStore(STORE_USERS, users);

  let parts = readStore(STORE_PARTICIPATIONS, []);
  parts = parts.filter(function(p) { return p.user_id !== userId; });
  writeStore(STORE_PARTICIPATIONS, parts);

  writeStore(STORE_SESSION, null);
  currentUser = null;
  isAdmin = false;
  updateAuthUI();
  navigate('home');
  showToast('Account deleted.');
}

// ---------- Admin ----------
async function renderAdminDashboard() {
  const unauthorizedEl = document.getElementById('admin-unauthorized');
  const authorizedEl = document.getElementById('admin-authorized');
  if (!isAdmin) { unauthorizedEl.classList.remove('hidden'); authorizedEl.classList.add('hidden'); return; }
  unauthorizedEl.classList.add('hidden'); authorizedEl.classList.remove('hidden');
  await loadAdminSurveysTable();
  await loadAdminParticipationsTable();
}
async function loadAdminSurveysTable() {
  const wrap = document.getElementById('admin-surveys-list-wrap');
  const all = readStore(STORE_SURVEYS, []).slice().sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
  if (all.length === 0) { wrap.innerHTML = '<p style="font-size:12.5px; color:var(--muted);">No surveys found.</p>'; return; }
  wrap.innerHTML = '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Title</th><th>Category</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
    all.map(function(s) {
      const toggleTo = s.status === 'published' ? 'closed' : 'published';
      const toggleLabel = s.status === 'published' ? 'Close' : 'Publish';
      return '<tr><td><strong>' + escapeHtml(s.title) + '</strong><br><small style="color:var(--muted);">' + escapeHtml(s.survey_url || '') + '</small></td><td>' + escapeHtml(s.category || '') + '</td><td>' + escapeHtml(String(s.estimated_minutes || s.duration || '5')) + ' mins</td><td><span class="status-chip">' + escapeHtml(s.status) + '</span></td><td><button class="btn btn-outline btn-sm" onclick="toggleSurveyStatus(\'' + s.id + '\', \'' + toggleTo + '\')">' + toggleLabel + '</button> <button class="btn btn-outline btn-sm danger-btn" onclick="deleteSurvey(\'' + s.id + '\')">Delete</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}
async function loadAdminParticipationsTable() {
  const wrap = document.getElementById('admin-participations-wrap');
  const parts = readStore(STORE_PARTICIPATIONS, []).slice().sort(function(a, b) { return (b.submitted_at || 0) - (a.submitted_at || 0); }).slice(0, 20);
  const allSurveys = readStore(STORE_SURVEYS, []);
  if (parts.length === 0) { wrap.innerHTML = '<p style="font-size:12.5px; color:var(--muted);">No participation records yet.</p>'; return; }
  wrap.innerHTML = '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Survey</th><th>Status</th><th>Date</th><th>Review</th><th>Actions</th></tr></thead><tbody>' +
    parts.map(function(p) {
      const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
      const title = s ? s.title : 'Deleted survey';
      const dateStr = p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : '—';
      return '<tr><td><strong>' + escapeHtml(title) + '</strong></td><td>' + escapeHtml(p.status || 'started') + '</td><td>' + dateStr + '</td><td><span class="status-chip">' + escapeHtml(p.review_status || 'pending') + '</span></td><td><button class="btn btn-outline btn-sm" onclick="reviewParticipation(\'' + p.id + '\', \'approved\')">Approve</button> <button class="btn btn-outline btn-sm danger-btn" onclick="reviewParticipation(\'' + p.id + '\', \'rejected\')">Reject</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}
async function reviewParticipation(participationId, decision) {
  try {
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('Invalid decision.');
    const parts = readStore(STORE_PARTICIPATIONS, []);
    const idx = parts.findIndex(function(p) { return p.id === participationId; });
    if (idx === -1) throw new Error('Participation not found.');
    parts[idx].review_status = decision;
    parts[idx].reviewed_at = Date.now();
    writeStore(STORE_PARTICIPATIONS, parts);
    showToast('Participation ' + decision + ' successfully.');
    await loadAdminParticipationsTable();
  } catch (e) { showToast('Review failed: ' + e.message); }
}
async function handleCreateSurvey(e) {
  e.preventDefault();
  const noticeEl = document.getElementById('admin-create-notice');
  const submitBtn = document.getElementById('admin-submit-btn');
  const title = document.getElementById('admin-title').value.trim();
  const category = document.getElementById('admin-category').value;
  const description = document.getElementById('admin-description').value.trim();
  const estimated_minutes = parseInt(document.getElementById('admin-duration').value, 10);
  const status = document.getElementById('admin-status').value;
  const survey_url = document.getElementById('admin-url').value.trim();
  const eligibility = document.getElementById('admin-eligibility').value.trim();
  const instructions = document.getElementById('admin-instructions').value.trim();
  submitBtn.disabled = true; noticeEl.className = 'notice';
  try {
    if (!title || !description) throw new Error('Title and description are required.');
    if (!survey_url.startsWith('https://')) throw new Error('Survey URL must be HTTPS.');
    if (survey_url.indexOf('forms.gle/example') !== -1) throw new Error('Demo link detected. Use a real Google Forms URL.');
    if (isNaN(estimated_minutes) || estimated_minutes <= 0) throw new Error('Duration must be a positive number.');
    const all = readStore(STORE_SURVEYS, []);
    all.push({ id: uid('sur'), title: title, category: category, description: description, estimated_minutes: estimated_minutes, duration: estimated_minutes + ' mins', status: status, survey_url: survey_url, eligibility: eligibility, instructions: instructions, created_at: Date.now() });
    writeStore(STORE_SURVEYS, all);
    noticeEl.className = 'notice show success'; noticeEl.textContent = 'Survey created successfully!';
    showToast('Survey published.');
    e.target.reset(); fetchAndRenderSurveys(); await loadAdminSurveysTable();
  } catch (err) {
    noticeEl.className = 'notice show error'; noticeEl.textContent = 'Error: ' + err.message;
  } finally { submitBtn.disabled = false; }
}
async function toggleSurveyStatus(surveyId, newStatus) {
  try {
    const all = readStore(STORE_SURVEYS, []);
    const idx = all.findIndex(function(s) { return s.id === surveyId; });
    if (idx === -1) throw new Error('Survey not found.');
    all[idx].status = newStatus;
    writeStore(STORE_SURVEYS, all);
    showToast('Survey status updated to ' + newStatus);
    fetchAndRenderSurveys(); await loadAdminSurveysTable();
  } catch (e) { showToast('Failed: ' + e.message); }
}
async function deleteSurvey(surveyId) {
  if (!confirm('Delete this survey? This cannot be undone.')) return;
  try {
    let all = readStore(STORE_SURVEYS, []);
    const before = all.length;
    all = all.filter(function(s) { return s.id !== surveyId; });
    if (all.length === before) throw new Error('Survey not found.');
    writeStore(STORE_SURVEYS, all);
    let parts = readStore(STORE_PARTICIPATIONS, []);
    parts = parts.filter(function(p) { return p.survey_id !== surveyId; });
    writeStore(STORE_PARTICIPATIONS, parts);
    showToast('Survey deleted.');
    fetchAndRenderSurveys(); await loadAdminSurveysTable(); await loadAdminParticipationsTable();
  } catch (e) { showToast('Failed to delete: ' + e.message); }
}

// ---------- Auth ----------
function openAuth(mode) { document.getElementById('auth-overlay').classList.add('open'); switchAuthMode(mode); clearAuthNotices(); }
function closeAuth() { document.getElementById('auth-overlay').classList.remove('open'); }
function handleOverlayClick(event) { if (event.target === document.getElementById('auth-overlay')) closeAuth(); }
function switchAuthMode(mode) {
  clearAuthNotices();
  const signinForm = document.getElementById('form-signin');
  const signupForm = document.getElementById('form-signup');
  if (mode === 'signin') { signinForm.classList.remove('hidden'); signupForm.classList.add('hidden'); }
  else { signinForm.classList.add('hidden'); signupForm.classList.remove('hidden'); }
}
function showNotice(msg, type) { const n = document.getElementById('auth-notice'); n.className = 'notice show ' + type; n.textContent = msg; }
function clearAuthNotices() { const n = document.getElementById('auth-notice'); n.className = 'notice'; n.textContent = ''; }

async function submitSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('signin-email').value.trim().toLowerCase();
  const password = document.getElementById('signin-password').value;
  const submitBtn = document.getElementById('signin-submit-btn');
  submitBtn.disabled = true; clearAuthNotices();
  try {
    if (!email || !password) throw new Error('Please enter your email and password.');
    const users = readStore(STORE_USERS, []);
    const user = users.find(function(u) { return u.email.toLowerCase() === email; });
    if (!user) throw new Error('No account found. Please register first.');
    const passwordHash = await hashPassword(password);
    if (user.passwordHash !== passwordHash) throw new Error('Incorrect password.');
    currentUser = { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], avatar: user.avatar || null, referralCode: user.referralCode || ensureReferralCode(user), referrals: user.referrals || [] };
    isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: user.id });
    updateAuthUI(); closeAuth();
    showToast('Welcome back, ' + (currentUser.name || currentUser.email) + '!');
    fetchAndRenderSurveys();
    if (currentView === 'profile') renderProfile();
    if (currentView === 'wallet') renderWallet();
    if (currentView === 'settings') renderSettings();
  } catch (err) { showNotice(err.message, 'error'); }
  finally { submitBtn.disabled = false; }
}

async function submitSignUp(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  const submitBtn = document.getElementById('signup-submit-btn');
  submitBtn.disabled = true; clearAuthNotices();
  try {
    if (!name || name.length < 2) throw new Error('Please enter your full name.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email.');
    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');
    const users = readStore(STORE_USERS, []);
    if (users.some(function(u) { return u.email.toLowerCase() === email; })) throw new Error('Account with this email already exists. Sign in instead.');
    const passwordHash = await hashPassword(password);
    const newUser = { id: uid('user'), name: name, email: email, passwordHash: passwordHash, avatar: null, referralCode: null, referrals: [], created_at: Date.now() };
    newUser.referralCode = generateReferralCode(newUser.id);
    users.push(newUser);
    writeStore(STORE_USERS, users);

    // Track referral
    const pendingRef = localStorage.getItem(STORE_PENDING_REF);
    if (pendingRef) {
      const allUsers = readStore(STORE_USERS, []);
      const referrer = allUsers.find(function(u) { return u.referralCode === pendingRef; });
      if (referrer && referrer.id !== newUser.id) {
        const idx = allUsers.findIndex(function(u) { return u.id === referrer.id; });
        if (idx !== -1) {
          allUsers[idx].referrals = allUsers[idx].referrals || [];
          allUsers[idx].referrals.push(newUser.id);
          writeStore(STORE_USERS, allUsers);
        }
      }
      localStorage.removeItem(STORE_PENDING_REF);
    }

    currentUser = { id: newUser.id, email: newUser.email, name: newUser.name, avatar: null, referralCode: newUser.referralCode, referrals: [] };
    isAdmin = newUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: newUser.id });
    updateAuthUI(); closeAuth();
    showToast('Account created. Karibu, ' + name + '!');
    fetchAndRenderSurveys();
    if (currentView === 'profile') renderProfile();
    if (currentView === 'wallet') renderWallet();
    if (currentView === 'settings') renderSettings();
  } catch (err) { showNotice(err.message, 'error'); }
  finally { submitBtn.disabled = false; }
}

async function submitPasswordReset() { showNotice('Local-only mode: password reset is not available. Please remember your password, or register with a different email.', 'info'); }

async function signOut() {
  writeStore(STORE_SESSION, null);
  currentUser = null; isAdmin = false;
  updateAuthUI();
  if (currentView === 'profile') renderProfile();
  else if (currentView === 'wallet') renderWallet();
  else if (currentView === 'settings') renderSettings();
  else navigate('home');
  showToast('Signed out.');
}

function updateAuthUI() {
  const guestActions = document.getElementById('auth-guest-actions');
  const userActions = document.getElementById('auth-user-actions');
  const greeting = document.getElementById('user-greeting');
  const adminLink = document.getElementById('nav-admin-link');
  if (currentUser) {
    guestActions.classList.add('hidden'); guestActions.style.display = 'none';
    userActions.classList.remove('hidden'); userActions.style.display = 'flex';
    greeting.textContent = 'Hi, ' + (currentUser.name || currentUser.email.split('@')[0]);
    if (isAdmin) adminLink.classList.remove('hidden');
    else adminLink.classList.add('hidden');
  } else {
    userActions.classList.add('hidden'); userActions.style.display = 'none';
    guestActions.classList.remove('hidden'); guestActions.style.display = 'flex';
    adminLink.classList.add('hidden');
  }
}

// ---------- Utilities ----------
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function showToast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 3500);
}
