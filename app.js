// ================================================================
// SurveyKE — v2.1 — All features
// ================================================================

const STORE_USERS          = 'surveyke_users';
const STORE_SESSION        = 'surveyke_session';
const STORE_SURVEYS        = 'surveyke_surveys';
const STORE_PARTICIPATIONS = 'surveyke_participations';
const STORE_RESPONSES      = 'surveyke_responses';
const STORE_THEME          = 'surveyke_theme';
const STORE_NOTIFICATIONS  = 'surveyke_notifications';
const STORE_PENDING_REF    = 'surveyke_pending_ref';
const STORE_WITHDRAWALS    = 'surveyke_withdrawals';
const STORE_PROMOS         = 'surveyke_promos';

const ADMIN_EMAIL = 'mautinyagah@gmail.com';
const DEMO_URL = 'https://docs.google.com/forms/';

const PLANS = {
  basic:    { key: 'basic',    label: 'Basic',    price: 0,   rank: 0, dailyEarningsCap: 50,  dailySurveyLimit: 3,  withdrawalMin: 2500, icon: 'i-star' },
  silver:   { key: 'silver',   label: 'Silver',   price: 100, rank: 1, dailyEarningsCap: 100, dailySurveyLimit: 5,  withdrawalMin: 1500, icon: 'i-star' },
  gold:     { key: 'gold',     label: 'Gold',     price: 300, rank: 2, dailyEarningsCap: 200, dailySurveyLimit: 8,  withdrawalMin: 1000, icon: 'i-star' },
  platinum: { key: 'platinum', label: 'Platinum', price: 500, rank: 3, dailyEarningsCap: 300, dailySurveyLimit: 10, withdrawalMin: 500,  icon: 'i-crown' }
};

const ACHIEVEMENTS = {
  first_approval:  { icon: '🎯', label: 'First Approval' },
  streak_7:        { icon: '🔥', label: '7-Day Streak' },
  surveys_10:      { icon: '📝', label: '10 Surveys' },
  platinum_member: { icon: '💎', label: 'Platinum Member' },
  referrals_3:     { icon: '🤝', label: '3 Referrals' },
  big_earner:      { icon: '💰', label: 'KSh 500 Earned' }
};

const MCQ_CONFIRM_SECONDS = 3;
const TEXT_READ_SECONDS = 6;
const PARAGRAPH_READ_SECONDS = 10;
const RATING_CONFIRM_SECONDS = 2;

const ANIME_SEEDS = ['Akira', 'Yuki', 'Hana', 'Kai', 'Rin', 'Mei', 'Sora', 'Aoi', 'Ren', 'Nao', 'Hikari', 'Yui'];
const ANIME_URLS = ANIME_SEEDS.map(function(s) { return 'https://api.dicebear.com/9.x/lorelei/svg?seed=' + s; });

let currentUser = null;
let isAdmin = false;
let surveysCache = [];
let selectedDirectoryTopic = 'All';
let selectedTierFilter = 'All';
let searchQuery = '';
let currentView = 'home';
let editingAvatar = null;
let editingName = '';
let selectedPlan = null;
let adminSurveyType = 'external';
let adminQuestions = [];
let adminParticipationTab = 'pending';
let adminSection = 'add';
let notifFilter = 'all';
let historyFilter = 'all';
let installPrompt = null;

let wizard = { active: false, survey: null, answers: {}, currentIndex: 0, selectedOption: null, timerInterval: null, locked: false };

// ---------- Storage ----------
function readStore(key, fallback) {
  try { const raw = localStorage.getItem(key); if (raw === null) return fallback; return JSON.parse(raw); }
  catch (e) { return fallback; }
}
function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function uid(prefix) { prefix = prefix || 'id'; return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
async function hashPassword(pw) {
  try {
    const enc = new TextEncoder().encode(pw + '::surveyke::salt');
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  } catch (e) { return 'plain::' + btoa(pw); }
}

// ---------- Boot ----------
function detectBotEnvironment() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return true;
    const testKey = '__surveyke_boot__';
    localStorage.setItem(testKey, '1');
    if (localStorage.getItem(testKey) !== '1') return true;
    localStorage.removeItem(testKey);
    if (!window.crypto) return true;
    return false;
  } catch (e) { return true; }
}
function markBootStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state) el.classList.add(state);
}
async function runBootSequence() {
  const sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  markBootStep('boot-1', 'active'); await sleep(400);
  try { if (localStorage.getItem(STORE_THEME) === null) localStorage.setItem(STORE_THEME, document.documentElement.getAttribute('data-theme') || 'light'); } catch (e) {}
  markBootStep('boot-1', 'done');
  markBootStep('boot-2', 'active'); await sleep(450);
  if (detectBotEnvironment()) { document.getElementById('boot-error').classList.remove('hidden'); document.querySelectorAll('.boot-step').forEach(function(s) { s.style.opacity = '0.3'; }); return; }
  markBootStep('boot-2', 'done');
  markBootStep('boot-3', 'active'); await sleep(400);
  markBootStep('boot-3', 'done');
  await sleep(250);
  finishBoot();
}
function finishBoot() {
  document.body.classList.remove('booting');
  const loader = document.getElementById('app-loading');
  if (loader) loader.style.display = 'none';
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) localStorage.setItem(STORE_PENDING_REF, ref);
  } catch (e) {}
  migrate();
  seedSurveysIfEmpty();
  restoreSession();
  ensureDailyReset();
  fetchAndRenderSurveys();
  updateNotifBadges();
  registerSW();
  setupPWAPrompt();
  checkStreak();
  checkAchievements();
  if (!currentUser && currentView === 'home') {
    setTimeout(function() { if (!currentUser) openAuth('signup'); }, 1200);
  }
}
document.addEventListener('DOMContentLoaded', runBootSequence);

// ---------- Service Worker ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('./sw.js').catch(function() {});
    });
  }
}
function setupPWAPrompt() {
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    installPrompt = e;
    const btn = document.getElementById('install-btn');
    if (btn) btn.classList.remove('hidden');
  });
}
function installPWA() {
  if (!installPrompt) { showToast('App already installed or not available.'); return; }
  installPrompt.prompt();
  installPrompt.userChoice.then(function(result) {
    if (result.outcome === 'accepted') { showToast('Installing...'); const btn = document.getElementById('install-btn'); if (btn) btn.classList.add('hidden'); }
    installPrompt = null;
  });
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

// ---------- Referral ----------
function generateReferralCode(userId) { const clean = (userId || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase(); return 'SK' + (clean || '000000'); }
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
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(function() { showToast('Referral link copied!'); }).catch(function() { fallbackCopy(link); showToast('Referral link copied!'); });
  else { fallbackCopy(link); showToast('Referral link copied!'); }
}
function fallbackCopy(text) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
function shareReferralLink() {
  const link = getReferralLink();
  const text = "Join me on SurveyKE — share your voice and shape Kenya's future!";
  if (navigator.share) navigator.share({ title: 'SurveyKE', text: text, url: link }).catch(function() {});
  else { fallbackCopy(link); showToast('Link copied to share.'); }
}

// ---------- Notifications ----------
function getAllReviews() {
  if (!currentUser) return [];
  const allSurveys = readStore(STORE_SURVEYS, []);
  const parts = readStore(STORE_PARTICIPATIONS, []);
  return parts.filter(function(p) {
    return p.user_id === currentUser.id && (p.review_status === 'approved' || p.review_status === 'rejected' || p.review_status === 'screened_out' || p.status === 'screened_out');
  }).sort(function(a, b) { return (b.reviewed_at || b.submitted_at || 0) - (a.reviewed_at || a.submitted_at || 0); }).map(function(p) {
    const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
    const status = (p.review_status === 'screened_out' || p.status === 'screened_out') ? 'screened_out' : p.review_status;
    return { id: p.id, title: s ? s.title : 'Deleted survey', status: status, reward: s ? (s.reward || 0) : 0, reviewedAt: p.reviewed_at || p.submitted_at };
  });
}
function getUnreadNotificationsCount() {
  if (!currentUser || isAdmin) return 0;
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === currentUser.id; });
  if (!user) return 0;
  const readAt = user.notifications_read_at || 0;
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const withdrawals = readStore(STORE_WITHDRAWALS, []);
  let count = parts.filter(function(p) {
    if (p.user_id !== currentUser.id) return false;
    if (p.review_status !== 'approved' && p.review_status !== 'rejected' && p.review_status !== 'screened_out' && p.status !== 'screened_out') return false;
    return (p.reviewed_at || 0) > readAt;
  }).length;
  count += withdrawals.filter(function(w) { return w.user_id === currentUser.id && (w.status === 'completed' || w.status === 'rejected') && (w.updated_at || 0) > readAt; }).length;
  return count;
}
function markNotificationsRead() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  users[idx].notifications_read_at = Date.now();
  writeStore(STORE_USERS, users);
}
function updateNotifBadges() {
  const count = getUnreadNotificationsCount();
  const headerBadge = document.getElementById('header-bell-badge');
  if (headerBadge) {
    if (count > 0) { headerBadge.textContent = count > 9 ? '9+' : String(count); headerBadge.classList.remove('hidden'); }
    else headerBadge.classList.add('hidden');
  }
  document.querySelectorAll('.bottom-nav-item').forEach(function(item) {
    if (item.dataset.tab === 'notifications') {
      let badge = item.querySelector('.nav-badge');
      if (count > 0) { if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; item.appendChild(badge); } badge.textContent = count > 9 ? '9+' : String(count); }
      else if (badge) badge.remove();
    }
  });
}
function renderNotifications() {
  const container = document.getElementById('notifications-content');
  if (!currentUser) {
    container.innerHTML = '<div class="notif-empty"><div class="notif-empty-icon"><svg><use href="#i-bell"/></svg></div><h3>Sign in to view notifications</h3><p>Approvals and rejections appear here.</p><div class="btn-row" style="justify-content:center;margin-top:20px;"><button class="btn btn-primary" onclick="openAuth(\'signin\')">Sign In</button></div></div>';
    return;
  }
  const all = getAllReviews();
  const withdrawals = readStore(STORE_WITHDRAWALS, []).filter(function(w) { return w.user_id === currentUser.id; }).map(function(w) {
    return { id: w.id, title: 'Withdrawal of KSh ' + w.amount, status: w.status === 'completed' ? 'approved' : (w.status === 'rejected' ? 'rejected' : 'pending'), reward: w.amount, reviewedAt: w.updated_at || w.created_at, isWithdrawal: true };
  });
  const combined = all.concat(withdrawals).sort(function(a, b) { return (b.reviewedAt || 0) - (a.reviewedAt || 0); });

  const counts = { all: combined.length, approved: 0, rejected: 0, screened_out: 0 };
  combined.forEach(function(n) { if (n.status === 'approved') counts.approved++; else if (n.status === 'rejected') counts.rejected++; else if (n.status === 'screened_out') counts.screened_out++; });
  let filtered = notifFilter === 'all' ? combined : combined.filter(function(n) { return n.status === notifFilter; });
  const filters = [{ key: 'all', label: 'All', count: counts.all }, { key: 'approved', label: 'Approved', count: counts.approved }, { key: 'rejected', label: 'Rejected', count: counts.rejected }, { key: 'screened_out', label: 'Screened', count: counts.screened_out }];

  let html = '<div class="notifications-page"><div class="notifications-page-header"><h2>Notifications</h2><p>Reviews, approvals, and updates.</p></div>';
  html += '<div class="notif-filters">' + filters.map(function(f) { return '<button class="notif-filter ' + (notifFilter === f.key ? 'active' : '') + '" onclick="setNotifFilter(\'' + f.key + '\')">' + f.label + ' <span class="count">' + f.count + '</span></button>'; }).join('') + '</div>';
  if (filtered.length === 0) {
    html += '<div class="notif-empty"><div class="notif-empty-icon"><svg><use href="#i-bell"/></svg></div><h3>No notifications</h3><p>Nothing here yet.</p></div>';
  } else {
    html += '<div class="notif-list">';
    filtered.forEach(function(n) {
      const isApproved = n.status === 'approved';
      const isScreened = n.status === 'screened_out';
      const iconId = isApproved ? 'i-check-circle' : (isScreened ? 'i-zap' : 'i-x-circle');
      const statusLabel = isApproved ? 'Approved' : (isScreened ? 'Screened Out' : 'Rejected');
      const dateStr = n.reviewedAt ? new Date(n.reviewedAt).toLocaleString() : '—';
      const rewardLine = isApproved ? (n.isWithdrawal ? 'Withdrawal processed' : 'Reward: +KSh ' + n.reward) : (isScreened ? 'You were screened out' : (n.isWithdrawal ? 'Withdrawal rejected' : 'No reward'));
      html += '<div class="notif-card notif-' + n.status + '"><div class="notif-card-icon"><svg><use href="#' + iconId + '"/></svg></div><div class="notif-card-info"><strong>' + escapeHtml(n.title) + '</strong><small>' + rewardLine + '</small><small style="margin-top:4px;">' + dateStr + '</small><div class="notif-card-status">' + statusLabel + '</div></div></div>';
    });
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
  markNotificationsRead();
  updateNotifBadges();
}
function setNotifFilter(f) { notifFilter = f; renderNotifications(); }

// ---------- Daily / Streak ----------
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function getDailyRecord(user) { if (!user.daily || user.daily.date !== todayStr()) user.daily = { date: todayStr(), surveyCount: 0, totalRewards: 0 }; return user.daily; }
function ensureDailyReset() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  users[idx].daily = getDailyRecord(users[idx]);
  writeStore(STORE_USERS, users);
}
function getDailyStatus() {
  if (!currentUser) return null;
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === currentUser.id; });
  if (!user) return null;
  const daily = getDailyRecord(user);
  const plan = PLANS[user.tier || 'basic'];
  return { date: daily.date, surveyCount: daily.surveyCount, surveyLimit: plan.dailySurveyLimit, totalRewards: daily.totalRewards, earningsCap: plan.dailyEarningsCap };
}
function recordSurveyStart(survey) {
  if (!currentUser || isAdmin) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  const daily = getDailyRecord(users[idx]);
  daily.surveyCount += 1;
  daily.totalRewards += (survey.reward || 0);
  users[idx].daily = daily;
  writeStore(STORE_USERS, users);
}
function checkStreak() {
  if (!currentUser || isAdmin) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  const u = users[idx];
  const today = todayStr();
  const yesterday = yesterdayStr();
  if (!u.streak) u.streak = { days: 0, lastClaim: null };
  if (u.streak.lastClaim === today) return;
  if (u.streak.lastClaim === yesterday) u.streak.days = Math.min((u.streak.days || 0) + 1, 30);
  else u.streak.days = 1;
  u.streak.lastClaim = today;
  const bonus = Math.min(u.streak.days, 7) * 2;
  u.bonuses = u.bonuses || [];
  u.bonuses.push({ id: uid('bon'), amount: bonus, type: 'streak', description: 'Day ' + u.streak.days + ' streak bonus', created_at: Date.now() });
  writeStore(STORE_USERS, users);
  setTimeout(function() { showToast('🔥 Day ' + u.streak.days + ' streak! +KSh ' + bonus + ' bonus credited'); checkAchievements(); }, 800);
}

// ---------- Achievements ----------
function userTotalApprovedEarnings(userId) {
  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === userId && p.review_status === 'approved'; });
  const surveys = readStore(STORE_SURVEYS, []);
  let sum = 0;
  parts.forEach(function(p) {
    const s = surveys.find(function(x) { return x.id === p.survey_id; });
    sum += s ? (s.reward || 0) : 0;
  });
  return sum;
}
function checkAchievements() {
  if (!currentUser || isAdmin) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  const u = users[idx];
  u.achievements = u.achievements || [];
  let newOnes = [];

  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === u.id; });
  const approved = parts.filter(function(p) { return p.review_status === 'approved'; }).length;
  const submitted = parts.filter(function(p) { return p.status === 'submitted' || p.review_status === 'approved' || p.review_status === 'rejected' || p.review_status === 'screened_out' || p.status === 'screened_out'; }).length;

  if (approved >= 1 && !u.achievements.includes('first_approval')) { u.achievements.push('first_approval'); newOnes.push('first_approval'); }
  if ((u.streak && u.streak.days >= 7) && !u.achievements.includes('streak_7')) { u.achievements.push('streak_7'); newOnes.push('streak_7'); }
  if (submitted >= 10 && !u.achievements.includes('surveys_10')) { u.achievements.push('surveys_10'); newOnes.push('surveys_10'); }
  if (u.tier === 'platinum' && !u.achievements.includes('platinum_member')) { u.achievements.push('platinum_member'); newOnes.push('platinum_member'); }
  if ((u.referrals && u.referrals.length >= 3) && !u.achievements.includes('referrals_3')) { u.achievements.push('referrals_3'); newOnes.push('referrals_3'); }
  if (userTotalApprovedEarnings(u.id) >= 500 && !u.achievements.includes('big_earner')) { u.achievements.push('big_earner'); newOnes.push('big_earner'); }

  if (newOnes.length > 0) {
    writeStore(STORE_USERS, users);
    newOnes.forEach(function(a, i) {
      setTimeout(function() { showToast('🎉 Achievement: ' + ACHIEVEMENTS[a].icon + ' ' + ACHIEVEMENTS[a].label); }, i * 800);
    });
  }
}

// ---------- Participation / state ----------
function getParticipationForSurvey(surveyId) {
  if (!currentUser) return null;
  const parts = readStore(STORE_PARTICIPATIONS, []);
  return parts.find(function(p) { return p.survey_id === surveyId && p.user_id === currentUser.id; });
}
function getSurveyUserState(survey) {
  if (!currentUser || isAdmin) return 'guest';
  const part = getParticipationForSurvey(survey.id);
  if (!part) return 'available';
  if (part.review_status === 'screened_out' || part.status === 'screened_out') return 'screened_out';
  if (part.status === 'in_progress') return 'in_progress';
  if (part.status === 'started') return 'started_external';
  if (part.status === 'submitted' || part.review_status === 'approved' || part.review_status === 'rejected' || part.review_status === 'reviewed') return 'completed';
  return 'available';
}
function canStartSurvey(survey) {
  if (isAdmin) return { allowed: false, reason: 'Admins cannot participate.' };
  if (!currentUser) return { allowed: true };
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === currentUser.id; });
  if (!user) return { allowed: false, reason: 'Sign in again.' };
  const plan = PLANS[user.tier || 'basic'];
  const daily = getDailyRecord(user);
  const reward = survey.reward || 0;
  if (daily.surveyCount >= plan.dailySurveyLimit) return { allowed: false, reason: 'Daily limit of ' + plan.dailySurveyLimit + ' surveys reached. Come back tomorrow or upgrade.' };
  if (daily.totalRewards + reward > plan.dailyEarningsCap) return { allowed: false, reason: 'Daily earnings cap of KSh ' + plan.dailyEarningsCap + ' reached. Upgrade or come back tomorrow.' };
  return { allowed: true };
}

// ---------- Migration / seed ----------
function migrate() {
  const all = readStore(STORE_SURVEYS, null);
  if (Array.isArray(all)) {
    let changed = false;
    all.forEach(function(s) {
      if (s.survey_url && s.survey_url.indexOf('forms.gle/example-survey') !== -1) { s.survey_url = DEMO_URL; changed = true; }
      if (s.tier === 'free') { s.tier = 'basic'; changed = true; }
      if (!s.tier || !PLANS[s.tier]) { s.tier = 'basic'; changed = true; }
      if (typeof s.reward !== 'number') { s.reward = 20; changed = true; }
      if (!s.type) { s.type = 'external'; changed = true; }
      if (s.questions && Array.isArray(s.questions)) {
        s.questions.forEach(function(q) {
          if (typeof q.screenOut !== 'boolean') { q.screenOut = false; changed = true; }
          if (!Array.isArray(q.correctOptions)) { q.correctOptions = []; changed = true; }
        });
      }
    });
    if (changed) writeStore(STORE_SURVEYS, all);
  }
  const users = readStore(STORE_USERS, null);
  if (Array.isArray(users)) {
    let changed = false;
    users.forEach(function(u) {
      if (u.tier === 'free') { u.tier = 'basic'; changed = true; }
      if (!u.tier || !PLANS[u.tier]) { u.tier = 'basic'; changed = true; }
      if (!u.referralCode) { u.referralCode = generateReferralCode(u.id); changed = true; }
      if (!Array.isArray(u.referrals)) { u.referrals = []; changed = true; }
      if (!Array.isArray(u.bonuses)) { u.bonuses = []; changed = true; }
      if (!Array.isArray(u.achievements)) { u.achievements = []; changed = true; }
      if (!Array.isArray(u.logins)) { u.logins = []; changed = true; }
      if (!u.daily || u.daily.date !== todayStr()) { u.daily = { date: todayStr(), surveyCount: 0, totalRewards: 0 }; changed = true; }
      if (!u.username) {
        const base = (u.name || u.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 15);
        u.username = base || 'user' + Math.floor(Math.random() * 9999);
        changed = true;
      }
    });
    if (changed) writeStore(STORE_USERS, users);
  }
  if (!Array.isArray(readStore(STORE_RESPONSES, null))) writeStore(STORE_RESPONSES, []);
  if (!Array.isArray(readStore(STORE_WITHDRAWALS, null))) writeStore(STORE_WITHDRAWALS, []);
  if (!Array.isArray(readStore(STORE_PROMOS, null))) writeStore(STORE_PROMOS, []);
}
function seedSurveysIfEmpty() {
  const existing = readStore(STORE_SURVEYS, null);
  if (Array.isArray(existing) && existing.length > 0) return;
  const now = Date.now();
  writeStore(STORE_SURVEYS, [
    { id: uid('sur'), title: 'Digital ID Public Feedback', category: 'Public Policy', description: 'Share your views on the proposed national digital identity system.', estimated_minutes: 5, duration: '5 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Kenyan residents 18+.', instructions: 'Answer all questions honestly.', tier: 'basic', reward: 15, created_at: now - 500000 },
    { id: uid('sur'), title: 'Public Transport Satisfaction', category: 'Transport', description: 'Quick feedback on your recent public transport experience.', estimated_minutes: 4, duration: '4 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Commuters.', instructions: 'Focus on your last journey.', tier: 'basic', reward: 20, created_at: now - 400000 },
    { id: uid('sur'), title: 'Mobile Money Usage Study', category: 'Finance', description: 'Help us understand how Kenyans use mobile money platforms.', estimated_minutes: 7, duration: '7 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Mobile money users.', instructions: 'Based on recent activity.', tier: 'silver', reward: 30, created_at: now - 300000 },
    { id: uid('sur'), title: 'Consumer Brand Preferences', category: 'Consumer Goods', description: 'Tell us which brands you trust and why.', estimated_minutes: 8, duration: '8 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Shoppers 18+.', instructions: 'Answer honestly.', tier: 'gold', reward: 55, created_at: now - 200000 },
    { id: uid('sur'), title: 'Health Services Experience', category: 'Health', description: 'Premium study on your healthcare experience.', estimated_minutes: 10, duration: '10 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Adults with recent clinic visit.', instructions: 'Responses are anonymous.', tier: 'platinum', reward: 100, created_at: now - 100000 }
  ]);
}
function restoreSession() {
  const session = readStore(STORE_SESSION, null);
  if (session && session.userId) {
    const users = readStore(STORE_USERS, []);
    const user = users.find(function(u) { return u.id === session.userId; });
    if (user) {
      currentUser = { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], username: user.username || user.email.split('@')[0], avatar: user.avatar || null, tier: user.tier || 'basic', referralCode: user.referralCode || ensureReferralCode(user), referrals: user.referrals || [] };
      isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    } else writeStore(STORE_SESSION, null);
  }
  updateAuthUI();
}

// ---------- Navigation ----------
function clearWizardTimer() { if (wizard.timerInterval) { clearInterval(wizard.timerInterval); wizard.timerInterval = null; } }
function exitWizard() { clearWizardTimer(); wizard.active = false; navigate('surveys'); }
function navigate(viewName, param) {
  clearWizardTimer();
  currentView = viewName;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  ['view-home','view-surveys','view-detail','view-take-survey','view-wallet','view-history','view-notifications','view-profile','view-settings','view-static','view-admin'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  if (viewName === 'home') { document.getElementById('view-home').classList.remove('hidden'); renderSurveyOfDay(); renderHomeSurveys(); updateBottomNav('home'); }
  else if (viewName === 'surveys') { document.getElementById('view-surveys').classList.remove('hidden'); renderSurveysPlanBanner(); renderTierBanners(); renderDirectorySurveys(); updateBottomNav('surveys'); }
  else if (viewName === 'detail' && param) { document.getElementById('view-detail').classList.remove('hidden'); renderSurveyDetail(param); updateBottomNav('surveys'); }
  else if (viewName === 'take-survey' && param) { document.getElementById('view-take-survey').classList.remove('hidden'); startOrResumeWizard(param); updateBottomNav('surveys'); }
  else if (viewName === 'wallet') { document.getElementById('view-wallet').classList.remove('hidden'); renderWallet(); updateBottomNav('wallet'); }
  else if (viewName === 'history') { document.getElementById('view-history').classList.remove('hidden'); renderHistory(); updateBottomNav('profile'); }
  else if (viewName === 'notifications') { document.getElementById('view-notifications').classList.remove('hidden'); renderNotifications(); updateBottomNav('notifications'); }
  else if (viewName === 'profile') { document.getElementById('view-profile').classList.remove('hidden'); renderProfile(); updateBottomNav('profile'); }
  else if (viewName === 'settings') { document.getElementById('view-settings').classList.remove('hidden'); renderSettings(); updateBottomNav('profile'); }
  else if (viewName === 'static' && param) { document.getElementById('view-static').classList.remove('hidden'); renderStaticPage(param); updateBottomNav(null); }
  else if (viewName === 'admin') {
    if (!isAdmin) { showToast('Admin only.'); navigate('home'); return; }
    document.getElementById('view-admin').classList.remove('hidden');
    renderAdminDashboard(); updateBottomNav(null);
  }
}
function getCurrentTab() {
  if (currentView === 'home') return 'home';
  if (currentView === 'surveys' || currentView === 'detail' || currentView === 'take-survey') return 'surveys';
  if (currentView === 'wallet') return 'wallet';
  if (currentView === 'notifications') return 'notifications';
  if (currentView === 'profile' || currentView === 'settings' || currentView === 'history') return 'profile';
  return null;
}
function updateBottomNav(tab) {
  document.querySelectorAll('.bottom-nav-item').forEach(function(item) {
    if (item.dataset.tab === tab) item.classList.add('active'); else item.classList.remove('active');
  });
  updateNotifBadges();
}

// ---------- Tier helpers ----------
function getUserTier() { return currentUser ? (currentUser.tier || 'basic') : 'basic'; }
function canAccessSurvey(tier) { if (!currentUser) return true; return PLANS[getUserTier()].rank >= PLANS[tier || 'basic'].rank; }
function tierBadgeHTML(tier) {
  tier = tier || 'basic';
  if (!PLANS[tier]) tier = 'basic';
  return '<span class="tier-badge tier-' + tier + '"><svg><use href="#' + PLANS[tier].icon + '"/></svg>' + PLANS[tier].label + '</span>';
}

// ---------- Surveys ----------
function renderSurveysPlanBanner() {
  const el = document.getElementById('surveys-plan-banner');
  if (!el) return;
  if (isAdmin) { el.innerHTML = '<div class="surveys-plan-banner"><div class="surveys-plan-left"><div><strong>Admin view</strong><small>Browse and manage surveys.</small></div></div><button class="btn btn-outline btn-sm" onclick="navigate(\'admin\')">Admin Dashboard</button></div>'; return; }
  if (!currentUser) { el.innerHTML = '<div class="surveys-plan-banner"><div class="surveys-plan-left"><div><strong>Guest browsing</strong><small>Sign in to see your plan and participate.</small></div></div><button class="btn btn-primary btn-sm" onclick="openAuth(\'signin\')">Sign In</button></div>'; return; }
  const tier = getUserTier();
  const plan = PLANS[tier];
  el.innerHTML = '<div class="surveys-plan-banner"><div class="surveys-plan-left"><div><strong>Your plan: ' + plan.label + '</strong><small>Up to KSh ' + plan.dailyEarningsCap + '/day &bull; ' + plan.dailySurveyLimit + ' surveys/day &bull; Withdraw at KSh ' + plan.withdrawalMin.toLocaleString() + '</small></div></div><button class="btn btn-outline btn-sm" onclick="openPlanModal()"><svg style="width:14px;height:14px;"><use href="#i-crown"/></svg>Change Plan</button></div>';
}
function renderTierBanners() {
  const el = document.getElementById('surveys-tier-banners');
  if (!el) return;
  const tiers = ['basic', 'silver', 'gold', 'platinum'];
  const userRank = currentUser ? PLANS[getUserTier()].rank : -1;
  let html = '';
  tiers.forEach(function(t) {
    const plan = PLANS[t];
    const count = surveysCache.filter(function(s) { return (s.tier || 'basic') === t; }).length;
    const isActive = selectedTierFilter === t;
    const isLocked = userRank >= 0 && PLANS[t].rank > userRank;
    html += '<div class="tier-banner tier-' + t + (isActive ? ' active' : '') + (isLocked ? ' locked-banner' : '') + '" onclick="filterByTier(\'' + t + '\')">' +
      (isLocked ? '<span class="lock-mini">🔒</span>' : '') +
      '<strong>' + plan.label + '</strong>' +
      '<small>' + count + ' survey' + (count === 1 ? '' : 's') + '</small>' +
    '</div>';
  });
  html += '<div class="tier-banner' + (selectedTierFilter === 'All' ? ' active' : '') + '" onclick="filterByTier(\'All\')"><strong>All Plans</strong><small>' + surveysCache.length + ' total</small></div>';
  el.innerHTML = html;
}
function filterByTier(tier) {
  selectedTierFilter = tier;
  renderTierBanners();
  renderDirectorySurveys();
}
function onSurveySearch(val) {
  searchQuery = val.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) { if (searchQuery.length > 0) clearBtn.classList.remove('hidden'); else clearBtn.classList.add('hidden'); }
  renderDirectorySurveys();
}
function clearSurveySearch() {
  searchQuery = '';
  const inp = document.getElementById('surveys-search');
  if (inp) inp.value = '';
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderDirectorySurveys();
}
function fetchAndRenderSurveys() {
  try {
    const all = readStore(STORE_SURVEYS, []);
    surveysCache = (all || []).filter(function(s) {
      if (s.status !== 'published') return false;
      if (s.type === 'external' && (!s.survey_url || !s.survey_url.startsWith('https://'))) return false;
      if (s.type === 'external' && s.survey_url.indexOf('example.com') !== -1) return false;
      return true;
    }).sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    renderSurveyOfDay();
    renderHomeSurveys();
    renderDirectorySurveys();
    renderSurveysPlanBanner();
    if (currentView === 'surveys') renderTierBanners();
  } catch (e) { console.error(e); surveysCache = []; }
}
function getSurveyOfDay() {
  if (surveysCache.length === 0) return null;
  const today = todayStr();
  let hash = 0;
  for (let i = 0; i < today.length; i++) hash = ((hash << 5) - hash) + today.charCodeAt(i);
  hash = Math.abs(hash);
  return surveysCache[hash % surveysCache.length];
}
function renderSurveyOfDay() {
  const container = document.getElementById('survey-of-day-container');
  if (!container) return;
  const s = getSurveyOfDay();
  if (!s) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="survey-of-day">' +
    '<div class="sod-badge"><svg><use href="#i-star"/></svg>Survey of the Day</div>' +
    '<h3>' + escapeHtml(s.title) + '</h3>' +
    '<div class="sod-meta"><span>⏱ ' + escapeHtml(s.estimated_minutes || s.duration || '5') + ' mins</span><span>💰 KSh ' + (s.reward || 20) + ' reward</span><span>' + tierBadgeHTML(s.tier || 'basic') + '</span></div>' +
    '<p>' + escapeHtml(s.description || '') + '</p>' +
    '<div class="sod-actions"><button class="btn btn-light" onclick="navigate(\'detail\', \'' + s.id + '\')">Participate <svg><use href="#i-arrow"/></svg></button><button class="btn btn-light" style="background:rgba(255,255,255,.15);color:#fff;" onclick="navigate(\'surveys\')">See All Surveys</button></div>' +
  '</div>';
}
function surveyCardHTML(s) {
  const tier = s.tier || 'basic';
  const state = getSurveyUserState(s);
  const locked = !isAdmin && currentUser && !canAccessSurvey(tier);
  let linkClass = 'card-link';
  let linkLabel = 'Participate &rarr;';
  if (isAdmin) linkLabel = 'View &rarr;';
  else if (state === 'completed') linkLabel = 'Completed ✓';
  else if (state === 'screened_out') { linkLabel = 'Screened out'; linkClass = 'card-link locked'; }
  else if (state === 'in_progress') linkLabel = 'Continue &rarr;';
  else if (state === 'started_external') linkLabel = 'Reopen &rarr;';
  else if (locked) { linkClass = 'card-link locked'; linkLabel = 'Upgrade &rarr;'; }
  return '<div class="survey-card ' + (locked ? 'locked' : '') + '">' +
    '<div class="card-top"><span class="cat-chip">' + escapeHtml(s.category || 'General') + '</span>' + tierBadgeHTML(tier) + '</div>' +
    '<h3>' + escapeHtml(s.title) + '</h3>' +
    '<p class="clamp">' + escapeHtml(s.description || '') + '</p>' +
    '<div class="card-bottom"><span class="meta-chip"><svg><use href="#i-clock"/></svg> ' + escapeHtml(s.estimated_minutes || s.duration || '5') + ' mins &bull; KSh ' + (s.reward || 20) + '</span><button class="' + linkClass + '" onclick="navigate(\'detail\', \'' + s.id + '\')">' + linkLabel + '</button></div>' +
  '</div>';
}
function renderHomeSurveys() {
  const container = document.getElementById('home-surveys-grid');
  if (surveysCache.length === 0) { container.innerHTML = '<div class="state-box" style="grid-column:1/-1;"><strong>No active surveys right now</strong><p>Check back soon.</p></div>'; return; }
  container.innerHTML = surveysCache.slice(0, 3).map(surveyCardHTML).join('');
}
function renderDirectorySurveys() {
  const container = document.getElementById('directory-surveys-grid');
  let list = surveysCache;
  if (selectedTierFilter !== 'All') list = list.filter(function(s) { return (s.tier || 'basic') === selectedTierFilter; });
  if (selectedDirectoryTopic !== 'All') list = list.filter(function(s) { return s.category === selectedDirectoryTopic; });
  if (searchQuery) list = list.filter(function(s) {
    return (s.title || '').toLowerCase().indexOf(searchQuery) !== -1 || (s.description || '').toLowerCase().indexOf(searchQuery) !== -1 || (s.category || '').toLowerCase().indexOf(searchQuery) !== -1;
  });
  if (list.length === 0) {
    let emptyMsg = 'No surveys match. ';
    if (searchQuery) emptyMsg = 'No results for "<strong>' + escapeHtml(searchQuery) + '</strong>". Try a different keyword.';
    else if (selectedTierFilter !== 'All') emptyMsg = 'No ' + PLANS[selectedTierFilter].label + ' surveys yet. Try <button class="card-link" onclick="filterByTier(\'All\'); filterDirectoryTopic(\'All\')">browse all</button>.';
    else emptyMsg = 'No surveys in this category. Try <button class="card-link" onclick="filterDirectoryTopic(\'All\')">All categories</button> or search.';
    container.innerHTML = '<div class="state-box" style="grid-column:1/-1;"><strong>No surveys found</strong><p>' + emptyMsg + '</p></div>';
    return;
  }
  container.innerHTML = list.map(surveyCardHTML).join('');
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
  if (!survey) { container.innerHTML = '<div class="state-box"><strong>Survey not found</strong><button class="btn btn-primary btn-sm" onclick="navigate(\'surveys\')" style="margin-top:12px;">Back</button></div>'; return; }
  const isDemo = survey.survey_url === DEMO_URL && survey.type === 'external';
  const demoNotice = isDemo ? '<div class="notice show info" style="margin-bottom:12px;"><strong>Demo survey:</strong> Placeholder link.</div>' : '';
  const elig = survey.eligibility ? '<div class="detail-section"><h3>Eligibility</h3><p class="detail-text">' + escapeHtml(survey.eligibility) + '</p></div>' : '';
  const inst = survey.instructions ? '<div class="detail-section"><h3>Instructions</h3><p class="detail-text">' + escapeHtml(survey.instructions) + '</p></div>' : '';
  const tier = survey.tier || 'basic';
  const isInternal = survey.type === 'internal';
  const qCount = isInternal && Array.isArray(survey.questions) ? survey.questions.length : 0;
  const state = getSurveyUserState(survey);

  let participateHTML;
  if (isAdmin) participateHTML = '<div class="admin-notice"><strong>Admin view</strong><p>Admins cannot participate.</p><button class="btn btn-primary" onclick="navigate(\'admin\')">Manage Surveys</button></div>';
  else if (!currentUser) participateHTML = '<div class="participate-box"><h3>Take the Survey</h3><p>Sign in to participate.</p><div class="btn-row"><button class="btn btn-primary" onclick="openAuth(\'signin\')">Sign In</button><button class="btn btn-outline" onclick="openAuth(\'signup\')">Create Account</button></div></div>';
  else if (!canAccessSurvey(tier)) participateHTML = '<div class="upgrade-notice"><h3>' + PLANS[tier].label + ' plan required</h3><p>Upgrade to access this survey.</p><button class="btn btn-primary" onclick="openPlanModal()">View Plans</button></div>';
  else if (state === 'screened_out') participateHTML = '<div class="participate-box" style="border-color:var(--amber-border);background:var(--amber-bg);"><h3 style="color:var(--amber);">Screened out</h3><p>You were screened out. Cannot retake.</p></div>';
  else if (state === 'completed') participateHTML = '<div class="participate-box" style="border-color:var(--green);background:var(--green-soft);"><h3 style="display:flex;align-items:center;gap:8px;"><svg style="width:20px;height:20px;color:var(--green);"><use href="#i-check-circle"/></svg>Survey Completed</h3><p>You already completed this survey.</p></div>';
  else if (state === 'in_progress') participateHTML = '<div class="participate-box"><h3>Continue Your Survey</h3><p>You started this survey.</p>' + demoNotice + '<div class="btn-row"><button class="btn btn-primary" onclick="navigate(\'take-survey\', \'' + survey.id + '\')">Continue Survey <svg><use href="#i-arrow"/></svg></button></div></div>';
  else if (state === 'started_external') participateHTML = '<div class="participate-box"><h3>Survey In Progress</h3><p>You opened this survey before.</p>' + demoNotice + '<div class="btn-row"><button class="btn btn-primary" onclick="reopenExternal(\'' + survey.id + '\')">Reopen <svg><use href="#i-external"/></svg></button></div></div>';
  else {
    const dc = canStartSurvey(survey);
    if (!dc.allowed) participateHTML = '<div class="participate-box" style="border-color:var(--danger);background:var(--danger-bg);"><h3 style="color:var(--danger);">Not available</h3><p>' + escapeHtml(dc.reason) + '</p><div class="btn-row"><button class="btn btn-outline" onclick="openPlanModal()">Upgrade Plan</button></div></div>';
    else {
      const btnLabel = isInternal ? 'Start Survey' : 'Proceed to External Survey';
      const btnIcon = isInternal ? '#i-arrow' : '#i-external';
      const typeLine = isInternal ? 'This survey has ' + qCount + ' question' + (qCount === 1 ? '' : 's') + '. Some answers may screen you out.' : 'Survey is hosted externally.';
      participateHTML = '<div class="participate-box"><h3>Take the Survey</h3><p>' + typeLine + '</p>' + demoNotice + '<div class="btn-row"><button class="btn btn-primary" onclick="startSurvey(\'' + survey.id + '\')">' + btnLabel + ' <svg><use href="' + btnIcon + '"/></svg></button></div></div>';
    }
  }
  const typeBadge = isInternal ? '<span class="cat-chip" style="background:var(--tier-platinum-bg);color:var(--tier-platinum);">In-App</span>' : '';
  const related = surveysCache.filter(function(s) { return s.category === survey.category && s.id !== survey.id; }).slice(0, 3);
  const relatedHTML = related.length > 0 ? '<div class="detail-section" style="margin-top:32px;"><h3>Similar Surveys</h3><div class="survey-grid" style="margin-top:12px;">' + related.map(surveyCardHTML).join('') + '</div></div>' : '';

  container.innerHTML = '<div class="detail-card"><div class="card-top" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;"><span class="cat-chip">' + escapeHtml(survey.category || 'General') + '</span>' + typeBadge + tierBadgeHTML(tier) + '</div>' +
    '<h1>' + escapeHtml(survey.title) + '</h1>' +
    '<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;"><span class="meta-chip"><svg><use href="#i-clock"/></svg> Est. ' + escapeHtml(survey.estimated_minutes || survey.duration || '5') + ' mins</span><span class="meta-chip"><svg><use href="#i-wallet"/></svg> KSh ' + (survey.reward || 20) + ' reward</span>' + (isInternal ? '<span class="meta-chip"><svg><use href="#i-book"/></svg> ' + qCount + ' questions</span>' : '') + '</div>' +
    '<p class="detail-text">' + escapeHtml(survey.description || '') + '</p>' + elig + inst + participateHTML + '</div>' + relatedHTML;
}
function startSurvey(surveyId) {
  if (isAdmin) { showToast('Admins cannot participate.'); return; }
  if (!currentUser) { showToast('Sign in.'); openAuth('signin'); return; }
  const allSurveys = readStore(STORE_SURVEYS, []);
  const survey = allSurveys.find(function(s) { return s.id === surveyId; });
  if (!survey) return;
  if (!canAccessSurvey(survey.tier || 'basic')) { showToast('Upgrade to access.'); return; }
  const existing = getParticipationForSurvey(surveyId);
  if (existing) {
    if (existing.status === 'in_progress') { navigate('take-survey', surveyId); return; }
    if (existing.status === 'started') { reopenExternal(surveyId); return; }
    showToast('You cannot retake this survey.'); return;
  }
  if (survey.type === 'internal') {
    const dc = canStartSurvey(survey);
    if (!dc.allowed) { showToast(dc.reason); return; }
    navigate('take-survey', surveyId);
  } else startExternalSurvey(surveyId);
}
function reopenExternal(surveyId) {
  const s = readStore(STORE_SURVEYS, []).find(function(x) { return x.id === surveyId; });
  if (!s || !s.survey_url) return;
  showToast('Reopening...'); window.open(s.survey_url, '_blank', 'noopener,noreferrer');
}
function startExternalSurvey(surveyId) {
  if (isAdmin) return;
  if (!currentUser) { openAuth('signin'); return; }
  const survey = readStore(STORE_SURVEYS, []).find(function(s) { return s.id === surveyId; });
  if (!survey || !survey.survey_url) return;
  if (getParticipationForSurvey(surveyId)) { showToast('Already started.'); return; }
  const dc = canStartSurvey(survey);
  if (!dc.allowed) { showToast(dc.reason); return; }
  try {
    const parts = readStore(STORE_PARTICIPATIONS, []);
    parts.push({ id: uid('part'), survey_id: surveyId, user_id: currentUser.id, status: 'started', review_status: 'pending', submitted_at: Date.now(), started_at: Date.now() });
    writeStore(STORE_PARTICIPATIONS, parts);
    recordSurveyStart(survey);
    showToast('Opening...');
    setTimeout(function() { window.open(survey.survey_url, '_blank', 'noopener,noreferrer'); }, 700);
  } catch (e) { window.open(survey.survey_url, '_blank', 'noopener,noreferrer'); }
}

// ---------- Wizard (same as v2.0) ----------
function startOrResumeWizard(surveyId) {
  if (isAdmin) { showToast('Admins cannot participate.'); navigate('admin'); return; }
  if (!currentUser) { openAuth('signin'); navigate('surveys'); return; }
  const survey = readStore(STORE_SURVEYS, []).find(function(s) { return s.id === surveyId; });
  if (!survey || survey.type !== 'internal') { navigate('surveys'); return; }
  if (!canAccessSurvey(survey.tier || 'basic')) { showToast('Upgrade to access.'); navigate('surveys'); return; }
  const parts = readStore(STORE_PARTICIPATIONS, []);
  let part = parts.find(function(p) { return p.survey_id === surveyId && p.user_id === currentUser.id; });
  if (part && (part.status === 'submitted' || part.review_status === 'approved' || part.review_status === 'rejected' || part.review_status === 'reviewed' || part.review_status === 'screened_out' || part.status === 'screened_out')) { showToast('Cannot retake.'); navigate('detail', surveyId); return; }
  if (!part) {
    const dc = canStartSurvey(survey);
    if (!dc.allowed) { showToast(dc.reason); navigate('surveys'); return; }
    part = { id: uid('part'), survey_id: surveyId, user_id: currentUser.id, status: 'in_progress', review_status: 'in_progress', answers: {}, wizard_index: 0, started_at: Date.now(), updated_at: Date.now() };
    parts.push(part); writeStore(STORE_PARTICIPATIONS, parts);
    recordSurveyStart(survey);
  }
  wizard = { active: true, survey: survey, answers: part.answers || {}, currentIndex: Math.min(part.wizard_index || 0, (survey.questions || []).length - 1), selectedOption: null, timerInterval: null, locked: false };
  if (wizard.currentIndex < 0) wizard.currentIndex = 0;
  renderWizard();
}
function renderWizard() {
  const container = document.getElementById('take-survey-content');
  const survey = wizard.survey;
  const questions = survey.questions || [];
  if (questions.length === 0) { container.innerHTML = '<div class="state-box"><strong>No questions</strong></div>'; return; }
  const q = questions[wizard.currentIndex];
  const total = questions.length;
  const current = wizard.currentIndex + 1;
  const isLast = wizard.currentIndex === total - 1;
  const isFirst = wizard.currentIndex === 0;
  const saved = wizard.answers[q.id];
  let inputs = '', typeLabel = '';
  if (q.type === 'mcq') {
    typeLabel = 'Multiple Choice';
    wizard.selectedOption = (saved !== undefined && saved !== '') ? saved : null;
    wizard.locked = false;
    inputs = '<div class="wizard-options-vertical">' + (q.options || []).map(function(opt, idx) {
      const letter = String.fromCharCode(65 + idx);
      const sel = wizard.selectedOption === opt ? ' selected' : '';
      return '<button type="button" class="wizard-option-btn' + sel + '" data-value="' + escapeHtml(opt) + '" onclick="wizardPickOption(this)"><span class="wizard-opt-bullet">' + letter + '</span><span class="wizard-opt-label">' + escapeHtml(opt) + '</span><span class="wizard-opt-check">✓</span></button>';
    }).join('') + '</div>';
  } else if (q.type === 'rating') {
    typeLabel = 'Rating';
    wizard.selectedOption = (saved !== undefined && saved !== '') ? saved : null;
    wizard.locked = false;
    const labels = { 1: 'Very Poor', 2: 'Poor', 3: 'Average', 4: 'Good', 5: 'Excellent' };
    inputs = '<div class="wizard-rating-vertical">';
    for (let n = 1; n <= 5; n++) {
      const sel = String(wizard.selectedOption) === String(n) ? ' selected' : '';
      const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
      inputs += '<button type="button" class="wizard-rating-btn' + sel + '" onclick="wizardPickRating(' + n + ')"><span class="wizard-rating-num">' + n + '</span><span>' + labels[n] + '</span><span class="wizard-rating-stars">' + stars + '</span></button>';
    }
    inputs += '</div>';
  } else if (q.type === 'text') {
    typeLabel = 'Short Text';
    inputs = '<input type="text" class="wizard-text-input" id="wizard-text-input" placeholder="Type your answer..." value="' + escapeHtml(saved || '') + '" autocomplete="off">';
  } else if (q.type === 'paragraph') {
    typeLabel = 'Paragraph';
    inputs = '<textarea class="wizard-text-input" id="wizard-text-input" placeholder="Type your answer...">' + escapeHtml(saved || '') + '</textarea>';
  }
  container.innerHTML = '<div class="wizard-shell"><div class="wizard-float-pill" id="wizard-float-pill"><span class="wfp-qnum"><svg><use href="#i-book"/></svg> Q' + current + '/' + total + '</span><span class="wfp-timer ready" id="wfp-timer"><span class="wfp-dot"></span> <span id="wfp-timer-text">Ready</span></span></div><div class="wizard-card"><div class="wizard-q-header"><span class="wizard-q-num">Question ' + current + '</span><span class="wizard-q-type">' + typeLabel + '</span></div><p class="wizard-q-text">' + escapeHtml(q.question) + (q.required ? '<span class="req">*</span>' : '') + '</p>' + inputs + '<div class="wizard-footer"><button type="button" class="wizard-prev-btn" ' + (isFirst ? 'disabled' : '') + ' onclick="wizardPrev()">← Previous</button><button type="button" class="wizard-next-btn" id="wizard-next-btn" disabled onclick="wizardNext()">' + (isLast ? 'Submit ✓' : 'Continue →') + '</button></div></div></div>';
  const ti = document.getElementById('wizard-text-input');
  if (ti) { blockPaste(ti); ti.addEventListener('input', updateNextBtnState); }
  if (q.type === 'mcq' || q.type === 'rating') { if (wizard.selectedOption !== null) wizardStartConfirmTimer(q, wizard.selectedOption); }
  else wizardStartReadingTimer(q);
  updateNextBtnState();
}
function blockPaste(el) {
  el.addEventListener('paste', function(e) { e.preventDefault(); showToast('Pasting disabled — type your answer.'); });
  el.addEventListener('drop', function(e) { e.preventDefault(); });
  el.addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && ['v','V','x','X'].includes(e.key)) { e.preventDefault(); showToast('Copy/paste disabled.'); } });
  el.addEventListener('copy', function(e) { e.preventDefault(); });
  el.addEventListener('cut', function(e) { e.preventDefault(); });
}
function wizardStartConfirmTimer(q, val) {
  clearWizardTimer(); wizard.locked = false;
  let remaining = q.type === 'rating' ? RATING_CONFIRM_SECONDS : MCQ_CONFIRM_SECONDS;
  updateFloatTimer(remaining, 'counting'); updateNextBtnState();
  wizard.timerInterval = setInterval(function() { remaining--; if (remaining <= 0) { clearWizardTimer(); wizard.locked = true; updateFloatTimer(0, 'ready'); updateNextBtnState(); } else updateFloatTimer(remaining, 'counting'); }, 1000);
}
function wizardStartReadingTimer(q) {
  clearWizardTimer(); wizard.locked = false;
  let remaining = q.type === 'paragraph' ? PARAGRAPH_READ_SECONDS : TEXT_READ_SECONDS;
  updateFloatTimer(remaining, 'counting'); updateNextBtnState();
  wizard.timerInterval = setInterval(function() { remaining--; if (remaining <= 0) { clearWizardTimer(); wizard.locked = true; updateFloatTimer(0, 'ready'); updateNextBtnState(); } else updateFloatTimer(remaining, 'counting'); }, 1000);
}
function updateFloatTimer(s, mode) {
  const pill = document.getElementById('wizard-float-pill'); const el = document.getElementById('wfp-timer'); const txt = document.getElementById('wfp-timer-text');
  if (!el || !txt) return;
  if (mode === 'counting') { el.className = 'wfp-timer counting'; txt.textContent = s + 's'; if (pill) { pill.classList.remove('pulse'); void pill.offsetWidth; pill.classList.add('pulse'); } }
  else { el.className = 'wfp-timer ready'; txt.textContent = 'Ready'; }
}
function wizardPickOption(btn) {
  if (wizard.locked) return;
  document.querySelectorAll('.wizard-option-btn').forEach(function(b) { b.classList.remove('selected'); });
  btn.classList.add('selected'); wizard.selectedOption = btn.dataset.value;
  wizardStartConfirmTimer(wizard.survey.questions[wizard.currentIndex], wizard.selectedOption);
}
function wizardPickRating(v) {
  if (wizard.locked) return;
  document.querySelectorAll('.wizard-rating-btn').forEach(function(b) { b.classList.remove('selected'); });
  const btns = document.querySelectorAll('.wizard-rating-btn'); if (btns[v-1]) btns[v-1].classList.add('selected');
  wizard.selectedOption = v;
  wizardStartConfirmTimer(wizard.survey.questions[wizard.currentIndex], v);
}
function updateNextBtnState() {
  const btn = document.getElementById('wizard-next-btn'); if (!btn) return;
  const q = wizard.survey.questions[wizard.currentIndex];
  let hasAnswer = false;
  if (q.type === 'mcq' || q.type === 'rating') hasAnswer = wizard.selectedOption !== null && wizard.selectedOption !== undefined && wizard.selectedOption !== '';
  else { const inp = document.getElementById('wizard-text-input'); hasAnswer = inp ? (inp.value.trim().length > 0 || !q.required) : false; }
  btn.disabled = !(wizard.locked && hasAnswer);
}
function saveWizardProgress() {
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const idx = parts.findIndex(function(p) { return p.survey_id === wizard.survey.id && p.user_id === currentUser.id; });
  if (idx === -1) return;
  parts[idx].answers = wizard.answers; parts[idx].wizard_index = wizard.currentIndex; parts[idx].updated_at = Date.now();
  writeStore(STORE_PARTICIPATIONS, parts);
  showAutosave();
}
function showAutosave() {
  let el = document.querySelector('.autosave-indicator');
  if (!el) { el = document.createElement('div'); el.className = 'autosave-indicator'; el.textContent = '✓ Auto-saved'; document.body.appendChild(el); }
  el.classList.add('show');
  clearTimeout(window.__autosaveTimeout);
  window.__autosaveTimeout = setTimeout(function() { el.classList.remove('show'); }, 1500);
}
function wizardPrev() {
  if (wizard.currentIndex === 0) return;
  const q = wizard.survey.questions[wizard.currentIndex];
  if (q.type === 'mcq' || q.type === 'rating') { if (wizard.selectedOption !== null) wizard.answers[q.id] = wizard.selectedOption; }
  else { const inp = document.getElementById('wizard-text-input'); if (inp) wizard.answers[q.id] = inp.value.trim(); }
  saveWizardProgress(); wizard.currentIndex--; wizard.selectedOption = null; wizard.locked = false; clearWizardTimer(); renderWizard();
}
function wizardNext() {
  const q = wizard.survey.questions[wizard.currentIndex];
  if (q.type === 'mcq' || q.type === 'rating') wizard.answers[q.id] = wizard.selectedOption;
  else { const inp = document.getElementById('wizard-text-input'); wizard.answers[q.id] = inp ? inp.value.trim() : ''; }
  if (q.required && (wizard.answers[q.id] === '' || wizard.answers[q.id] === null || wizard.answers[q.id] === undefined)) { showToast('Please answer this question.'); return; }
  saveWizardProgress();
  if (q.type === 'mcq' && q.screenOut) {
    const btn = document.getElementById('wizard-next-btn'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>Checking...'; }
    setTimeout(function() {
      const correct = q.correctOptions || []; const selIdx = (q.options || []).indexOf(wizard.answers[q.id]);
      if (correct.indexOf(selIdx) === -1) wizardScreenOut(q);
      else advanceWizard();
    }, 900);
  } else advanceWizard();
}
function advanceWizard() {
  wizard.currentIndex++; wizard.selectedOption = null; wizard.locked = false;
  if (wizard.currentIndex >= wizard.survey.questions.length) wizardFinish();
  else renderWizard();
}
function wizardScreenOut() {
  clearWizardTimer(); wizard.active = false;
  const survey = wizard.survey;
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const idx = parts.findIndex(function(p) { return p.survey_id === survey.id && p.user_id === currentUser.id; });
  if (idx !== -1) { parts[idx].status = 'screened_out'; parts[idx].review_status = 'screened_out'; parts[idx].screened_out_at = Date.now(); parts[idx].submitted_at = Date.now(); writeStore(STORE_PARTICIPATIONS, parts); }
  const container = document.getElementById('take-survey-content');
  container.innerHTML = '<div class="wizard-shell"><div class="wizard-card screenout-screen"><div class="screenout-icon"><svg><use href="#i-x-circle"/></svg></div><h2>Screened Out</h2><p>Your answer didn\'t meet the criteria. You cannot proceed with this survey.</p><p style="font-size:12.5px;">You can still take other surveys.</p><div class="btn-row" style="justify-content:center;"><button class="btn btn-primary" onclick="navigate(\'surveys\')">Browse Other Surveys</button></div></div></div>';
}
function wizardFinish() {
  clearWizardTimer();
  const survey = wizard.survey;
  const responses = readStore(STORE_RESPONSES, []);
  const exIdx = responses.findIndex(function(r) { return r.survey_id === survey.id && r.user_id === currentUser.id; });
  if (exIdx !== -1) { responses[exIdx].answers = wizard.answers; responses[exIdx].submitted_at = Date.now(); }
  else responses.push({ id: uid('resp'), survey_id: survey.id, user_id: currentUser.id, answers: wizard.answers, submitted_at: Date.now() });
  writeStore(STORE_RESPONSES, responses);
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const idx = parts.findIndex(function(p) { return p.survey_id === survey.id && p.user_id === currentUser.id; });
  if (idx !== -1) { parts[idx].status = 'submitted'; parts[idx].review_status = 'pending'; parts[idx].submitted_at = Date.now(); parts[idx].answers = wizard.answers; parts[idx].wizard_index = (survey.questions || []).length; writeStore(STORE_PARTICIPATIONS, parts); }
  wizard.active = false;
  try { if (window.confetti) confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } }); } catch (e) {}
  const container = document.getElementById('take-survey-content');
  container.innerHTML = '<div class="wizard-shell"><div class="wizard-card thank-you-card"><div class="thank-you-icon"><svg><use href="#i-check-circle"/></svg></div><h2 style="font-family:Manrope,sans-serif;font-size:26px;letter-spacing:-.8px;margin:0 0 10px;color:var(--ink);">🎉 Submitted!</h2><p style="color:var(--muted-strong);font-size:14.5px;max-width:400px;margin:0 auto 22px;line-height:1.7;">Your response to <strong>' + escapeHtml(survey.title) + '</strong> is submitted. Admin will review it soon.</p><div class="btn-row" style="justify-content:center;"><button class="btn btn-primary" onclick="navigate(\'surveys\')">More Surveys</button><button class="btn btn-outline" onclick="navigate(\'wallet\')">View Wallet</button></div></div></div>';
  setTimeout(checkAchievements, 500);
}

// ---------- Wallet ----------
function getUserBalance(userId) {
  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === userId && p.review_status === 'approved'; });
  const surveys = readStore(STORE_SURVEYS, []);
  let earned = 0;
  parts.forEach(function(p) { const s = surveys.find(function(x) { return x.id === p.survey_id; }); if (s) earned += (s.reward || 0); });
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === userId; });
  const bonuses = (user && user.bonuses) ? user.bonuses.reduce(function(s, b) { return s + (b.amount || 0); }, 0) : 0;
  const withdrawals = readStore(STORE_WITHDRAWALS, []).filter(function(w) { return w.user_id === userId && (w.status === 'completed' || w.status === 'processing' || w.status === 'pending'); });
  const withdrawn = withdrawals.reduce(function(s, w) { return s + (w.amount || 0); }, 0);
  return { earned: earned, bonuses: bonuses, withdrawn: withdrawn, available: earned + bonuses - withdrawn };
}
function renderWallet() {
  if (isAdmin) { renderAdminWallet(); return; }
  const container = document.getElementById('wallet-content');
  if (!currentUser) { container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg><use href="#i-wallet"/></svg></div><h2>Sign in to view wallet</h2><button class="btn btn-primary" onclick="openAuth(\'signin\')">Sign In</button></div>'; return; }
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  const tier = stored.tier || 'basic'; const plan = PLANS[tier];
  const balance = getUserBalance(currentUser.id);
  const pending = (function() {
    const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id && (p.review_status === 'pending' || p.review_status === 'reviewed' || p.review_status === 'in_progress'); });
    const surveys = readStore(STORE_SURVEYS, []);
    let sum = 0; parts.forEach(function(p) { const s = surveys.find(function(x) { return x.id === p.survey_id; }); if (s) sum += (s.reward || 0); });
    return sum;
  })();
  const threshold = plan.withdrawalMin;
  const canWithdraw = balance.available >= threshold;
  const progress = Math.min(100, (balance.available / threshold) * 100);
  const remaining = Math.max(0, threshold - balance.available);
  const daily = getDailyStatus();
  const surveyPct = daily ? Math.min(100, (daily.surveyCount / daily.surveyLimit) * 100) : 0;
  const earningsPct = daily ? Math.min(100, (daily.totalRewards / daily.earningsCap) * 100) : 0;

  // Weekly challenge
  const weekStart = (function() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); })();
  const weekParts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id && (p.submitted_at || 0) >= new Date(weekStart).getTime(); });
  const weekCount = weekParts.length;
  const weekGoal = 5;
  const weekPct = Math.min(100, (weekCount / weekGoal) * 100);

  const streak = stored.streak || { days: 0 };
  const streakHTML = streak.days > 0 ? '<div class="streak-display"><div class="streak-icon">🔥</div><div class="streak-info"><strong>Day ' + streak.days + ' Streak</strong><small>Keep it going! +KSh ' + Math.min(streak.days, 7) * 2 + ' daily bonus</small></div></div>' : '';

  const weeklyHTML = '<div class="weekly-challenge"><div class="weekly-challenge-header"><h3>🏆 Weekly Challenge</h3><span class="reward">+KSh 100</span></div><p>Complete 5 surveys this week to earn a KSh 100 bonus</p><div class="weekly-progress"><div class="weekly-progress-fill" style="width:' + weekPct + '%"></div></div><div class="weekly-progress-label"><span>' + weekCount + ' / ' + weekGoal + ' surveys</span><span>' + weekPct.toFixed(0) + '%</span></div></div>';

  const withdrawals = readStore(STORE_WITHDRAWALS, []).filter(function(w) { return w.user_id === currentUser.id; }).sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
  const withdrawalsHTML = withdrawals.length > 0 ? '<div class="wallet-transactions" style="margin-top:20px;"><h3>Withdrawal History</h3><div class="transaction-list">' + withdrawals.slice(0, 10).map(function(w) {
    return '<div class="transaction-item"><div class="transaction-icon ' + (w.status === 'completed' ? 'approved' : (w.status === 'rejected' ? 'rejected' : 'pending')) + '"><svg><use href="' + (w.status === 'completed' ? '#i-check-circle' : (w.status === 'rejected' ? '#i-x-circle' : '#i-clock')) + '"/></svg></div><div class="transaction-info"><strong>Withdrawal to ' + escapeHtml(w.phone) + '</strong><small>' + new Date(w.created_at).toLocaleDateString() + ' &bull; ' + w.status + '</small></div><div class="transaction-amount ' + (w.status === 'completed' ? 'approved' : (w.status === 'rejected' ? 'rejected' : 'pending')) + '">KSh ' + w.amount + '</div></div>';
  }).join('') + '</div></div>' : '';

  const txs = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id; }).map(function(p) {
    const s = readStore(STORE_SURVEYS, []).find(function(x) { return x.id === p.survey_id; });
    const reward = s ? (s.reward || 20) : 20;
    let st = p.review_status || 'pending';
    if (st === 'reviewed' || st === 'in_progress') st = 'pending';
    if (p.review_status === 'screened_out' || p.status === 'screened_out') st = 'rejected';
    return { id: p.id, title: s ? s.title : 'Deleted', date: p.submitted_at || p.updated_at, amount: st === 'approved' ? reward : (st === 'pending' ? reward : 0), status: st };
  }).sort(function(a, b) { return b.date - a.date; });

  const txHTML = txs.length === 0 ? '<div class="state-box"><strong>No transactions yet</strong></div>' : '<div class="transaction-list">' + txs.map(function(t) {
    const ic = t.status === 'approved' ? 'i-check-circle' : (t.status === 'rejected' ? 'i-x-circle' : 'i-clock');
    const am = t.status === 'rejected' ? '<div class="transaction-amount rejected">KSh 0</div>' : '<div class="transaction-amount ' + t.status + '">+ KSh ' + t.amount + '</div>';
    return '<div class="transaction-item"><div class="transaction-icon ' + t.status + '"><svg><use href="#' + ic + '"/></svg></div><div class="transaction-info"><strong>' + escapeHtml(t.title) + '</strong><small>' + new Date(t.date).toLocaleDateString() + ' &bull; ' + t.status + '</small></div>' + am + '</div>';
  }).join('') + '</div>';

  container.innerHTML = '<div class="wallet-header"><h2>Wallet</h2><p>Your earnings, all in one place.</p></div>' +
    '<div style="display:flex;justify-content:center;margin-bottom:18px;"><span class="profile-tier-badge tier-' + tier + '"><svg style="width:14px;height:14px;"><use href="#' + plan.icon + '"/></svg>' + plan.label + '</span></div>' +
    streakHTML + weeklyHTML +
    '<div class="wallet-balance-card"><div class="wallet-balance-label">Available Balance</div><div class="wallet-balance-value">KSh ' + balance.available.toLocaleString() + '</div><div class="wallet-balance-sub">' + (balance.bonuses > 0 ? 'Includes KSh ' + balance.bonuses + ' in bonuses' : 'From approved surveys + bonuses') + '</div>' +
      '<div class="wallet-progress-box"><div class="wallet-progress-top"><span>Withdrawal progress</span><span>KSh ' + balance.available.toLocaleString() + ' / ' + threshold.toLocaleString() + '</span></div><div class="wallet-progress-bar"><div class="wallet-progress-fill" style="width:' + progress + '%"></div></div><div class="wallet-progress-hint">' + (canWithdraw ? '✓ Unlocked — tap Withdraw to proceed' : 'KSh ' + remaining.toLocaleString() + ' more to unlock') + '</div></div>' +
      (canWithdraw ? '<button class="btn btn-light wallet-withdraw-btn" onclick="openWithdrawalModal()"><svg style="width:16px;height:16px;"><use href="#i-download"/></svg>Withdraw KSh ' + balance.available.toLocaleString() + '</button>' : '<button class="btn btn-light wallet-withdraw-btn" disabled style="opacity:.65;"><svg style="width:16px;height:16px;"><use href="#i-lock"/></svg>Withdraw (locked)</button>') +
    '</div>' +
    (daily ? '<div class="daily-limits-card"><div class="daily-limits-header"><h3>Today\'s Activity</h3><small>Resets midnight</small></div><div class="daily-limit-row"><div class="daily-limit-labels"><span>Surveys done</span><span>' + daily.surveyCount + ' / ' + daily.surveyLimit + '</span></div><div class="daily-limit-bar"><div class="daily-limit-fill ' + (surveyPct >= 100 ? 'full' : surveyPct >= 66 ? 'warn' : '') + '" style="width:' + surveyPct + '%"></div></div></div><div class="daily-limit-row"><div class="daily-limit-labels"><span>Earned today</span><span>KSh ' + daily.totalRewards + ' / KSh ' + daily.earningsCap + '</span></div><div class="daily-limit-bar"><div class="daily-limit-fill ' + (earningsPct >= 100 ? 'full' : earningsPct >= 66 ? 'warn' : '') + '" style="width:' + earningsPct + '%"></div></div></div></div>' : '') +
    '<div class="wallet-stats-row"><div class="wallet-stat-tile"><span class="val">KSh ' + balance.available.toLocaleString() + '</span><span class="lbl">Available</span></div><div class="wallet-stat-tile"><span class="val">KSh ' + pending.toLocaleString() + '</span><span class="lbl">Pending review</span></div></div>' +
    '<div class="wallet-transactions"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;"><h3 style="margin:0;">Recent Activity</h3><button class="btn btn-outline btn-sm" onclick="navigate(\'history\')">View History →</button></div>' + txHTML + '</div>' +
    '<div style="margin-top:20px;"><div class="promo-redeem-row"><input type="text" id="promo-input" placeholder="Enter promo code" maxlength="15"><button class="btn btn-primary" onclick="redeemPromo()">Redeem</button></div></div>' +
    withdrawalsHTML;
}
function openWithdrawalModal() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const u = users.find(function(x) { return x.id === currentUser.id; });
  const plan = PLANS[u.tier || 'basic'];
  const balance = getUserBalance(currentUser.id);
  document.getElementById('withdraw-phone').value = u.phone || '';
  document.getElementById('withdraw-amount').value = '';
  const hint = document.getElementById('withdraw-hint');
  if (hint) hint.innerHTML = 'Available: <strong>KSh ' + balance.available.toLocaleString() + '</strong> &bull; Minimum: <strong>KSh ' + plan.withdrawalMin.toLocaleString() + '</strong>';
  document.getElementById('withdraw-notice').className = 'notice';
  document.getElementById('withdrawal-overlay').classList.add('open');
}
function closeWithdrawalModal() { document.getElementById('withdrawal-overlay').classList.remove('open'); }
function handleWithdrawalOverlayClick(e) { if (e.target.id === 'withdrawal-overlay') closeWithdrawalModal(); }
function submitWithdrawal() {
  const phone = document.getElementById('withdraw-phone').value.trim();
  const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
  const noticeEl = document.getElementById('withdraw-notice');
  try {
    if (!/^0[17]\d{8}$/.test(phone.replace(/\s/g, ''))) throw new Error('Enter a valid M-Pesa number (07XX or 01XX).');
    const users = readStore(STORE_USERS, []);
    const uIdx = users.findIndex(function(x) { return x.id === currentUser.id; });
    const plan = PLANS[users[uIdx].tier || 'basic'];
    const balance = getUserBalance(currentUser.id);
    if (isNaN(amount) || amount <= 0) throw new Error('Enter a valid amount.');
    if (amount > balance.available) throw new Error('Amount exceeds available balance.');
    if (amount < plan.withdrawalMin) throw new Error('Minimum withdrawal is KSh ' + plan.withdrawalMin.toLocaleString() + ' on ' + plan.label + ' plan.');
    const withdrawals = readStore(STORE_WITHDRAWALS, []);
    withdrawals.push({ id: uid('wd'), user_id: currentUser.id, phone: phone, amount: amount, status: 'pending', created_at: Date.now(), updated_at: Date.now() });
    writeStore(STORE_WITHDRAWALS, withdrawals);
    users[uIdx].phone = phone;
    writeStore(STORE_USERS, users);
    closeWithdrawalModal();
    showToast('Withdrawal request submitted! Admin will process it.');
    renderWallet();
  } catch (e) { noticeEl.className = 'notice show error'; noticeEl.textContent = e.message; }
}
function redeemPromo() {
  const inp = document.getElementById('promo-input');
  if (!inp) return;
  const code = inp.value.trim().toUpperCase();
  if (!code) { showToast('Enter a code'); return; }
  const promos = readStore(STORE_PROMOS, []);
  const promo = promos.find(function(p) { return p.code === code; });
  if (!promo) { showToast('Invalid code'); return; }
  if ((promo.uses || []).includes(currentUser.id)) { showToast('You already redeemed this.'); return; }
  if (promo.maxUses && (promo.uses || []).length >= promo.maxUses) { showToast('Code expired.'); return; }
  promo.uses = promo.uses || [];
  promo.uses.push(currentUser.id);
  writeStore(STORE_PROMOS, promos);
  const users = readStore(STORE_USERS, []);
  const uIdx = users.findIndex(function(x) { return x.id === currentUser.id; });
  users[uIdx].bonuses = users[uIdx].bonuses || [];
  users[uIdx].bonuses.push({ id: uid('bon'), amount: promo.amount, type: 'promo', description: 'Promo: ' + code, created_at: Date.now() });
  writeStore(STORE_USERS, users);
  inp.value = '';
  showToast('🎉 KSh ' + promo.amount + ' credited!');
  renderWallet();
}

// ---------- History ----------
function renderHistory() {
  const container = document.getElementById('history-content');
  if (!currentUser) { container.innerHTML = '<div class="notif-empty"><div class="notif-empty-icon"><svg><use href="#i-list"/></svg></div><h3>Sign in to view history</h3><button class="btn btn-primary" onclick="openAuth(\'signin\')" style="margin-top:16px;">Sign In</button></div>'; return; }
  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id; });
  const surveys = readStore(STORE_SURVEYS, []);
  const mapped = parts.map(function(p) {
    const s = surveys.find(function(x) { return x.id === p.survey_id; });
    let status = p.review_status || 'pending';
    if (p.status === 'screened_out' || p.review_status === 'screened_out') status = 'screened_out';
    else if (p.status === 'in_progress') status = 'in_progress';
    else if (p.status === 'started') status = 'in_progress';
    else if (p.review_status === 'reviewed') status = 'pending';
    const qTotal = s && s.questions ? s.questions.length : 0;
    const qDone = p.wizard_index || 0;
    return { id: p.id, survey: s, title: s ? s.title : 'Deleted', status: status, reward: s ? (s.reward || 0) : 0, date: p.submitted_at || p.updated_at || p.started_at, progress: qTotal > 0 ? Math.round((qDone / qTotal) * 100) : 100, qTotal: qTotal, surveyId: p.survey_id };
  }).sort(function(a, b) { return (b.date || 0) - (a.date || 0); });

  const counts = { all: mapped.length, in_progress: 0, pending: 0, approved: 0, rejected: 0, screened_out: 0 };
  mapped.forEach(function(m) { if (counts[m.status] !== undefined) counts[m.status]++; });
  let filtered = historyFilter === 'all' ? mapped : mapped.filter(function(m) { return m.status === historyFilter; });

  let html = '<div class="history-page"><div class="history-header"><h2>Survey History</h2><p>Every survey you\'ve taken or started</p></div>';
  html += '<div class="history-filters"><button class="history-filter ' + (historyFilter === 'all' ? 'active' : '') + '" onclick="setHistoryFilter(\'all\')">All <span class="count">' + counts.all + '</span></button><button class="history-filter ' + (historyFilter === 'in_progress' ? 'active' : '') + '" onclick="setHistoryFilter(\'in_progress\')">In Progress <span class="count">' + counts.in_progress + '</span></button><button class="history-filter ' + (historyFilter === 'pending' ? 'active' : '') + '" onclick="setHistoryFilter(\'pending\')">Submitted <span class="count">' + counts.pending + '</span></button><button class="history-filter ' + (historyFilter === 'approved' ? 'active' : '') + '" onclick="setHistoryFilter(\'approved\')">Approved <span class="count">' + counts.approved + '</span></button><button class="history-filter ' + (historyFilter === 'rejected' ? 'active' : '') + '" onclick="setHistoryFilter(\'rejected\')">Rejected <span class="count">' + counts.rejected + '</span></button><button class="history-filter ' + (historyFilter === 'screened_out' ? 'active' : '') + '" onclick="setHistoryFilter(\'screened_out\')">Screened <span class="count">' + counts.screened_out + '</span></button></div>';

  if (filtered.length === 0) html += '<div class="state-box"><strong>Nothing here</strong><p>No surveys matching this filter.</p></div>';
  else {
    html += '<div class="history-list">';
    filtered.forEach(function(m) {
      const statusLabels = { in_progress: 'In Progress', pending: 'Under Review', approved: 'Approved', rejected: 'Rejected', screened_out: 'Screened Out' };
      const statusLabel = statusLabels[m.status] || m.status;
      const dateStr = m.date ? new Date(m.date).toLocaleDateString() : '—';
      let actionBtn = '';
      if (m.status === 'in_progress') actionBtn = '<button class="btn btn-primary btn-sm" onclick="navigate(\'take-survey\', \'' + m.surveyId + '\')">Continue →</button>';
      else actionBtn = '<button class="btn btn-outline btn-sm" onclick="navigate(\'detail\', \'' + m.surveyId + '\')">View</button>';
      html += '<div class="history-item"><div class="history-item-top"><strong>' + escapeHtml(m.title) + '</strong><span class="history-status ' + m.status + '">' + statusLabel + '</span></div>' +
        '<div class="history-item-meta"><span><strong>KSh ' + m.reward + '</strong> reward</span><span>' + dateStr + '</span>' + (m.qTotal > 0 && m.status === 'in_progress' ? '<span>' + Math.round((m.progress/100)*m.qTotal) + ' / ' + m.qTotal + ' questions</span>' : '') + '</div>' +
        (m.status === 'in_progress' && m.qTotal > 0 ? '<div class="history-progress"><div class="history-progress-fill" style="width:' + m.progress + '%"></div></div>' : '') +
        '<div class="history-actions">' + actionBtn + '</div>' +
      '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}
function setHistoryFilter(f) { historyFilter = f; renderHistory(); }

// ---------- Profile ----------
function renderProfile() {
  const container = document.getElementById('profile-content');
  if (!currentUser) { container.innerHTML = '<div class="profile-card"><div class="profile-avatar-container guest"><span class="initial">?</span></div><h2>Welcome to SurveyKE</h2><p class="profile-description">Sign in or create an account to start earning.</p><div class="profile-actions"><button class="btn btn-primary btn-block" onclick="openAuth(\'signin\')">Sign In</button><button class="btn btn-outline btn-block" onclick="openAuth(\'signup\')">Create Account</button></div></div>'; return; }
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  const avatar = stored.avatar || null;
  const referrals = stored.referrals || [];
  const code = stored.referralCode || ensureReferralCode(stored);
  const tier = stored.tier || 'basic';
  const plan = PLANS[tier];
  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id; });
  const approved = parts.filter(function(p) { return p.review_status === 'approved'; }).length;
  const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
  const avatarHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" alt="">' : '<span class="initial">' + escapeHtml(initial) + '</span>';
  const unreadCount = getUnreadNotificationsCount();
  const achievements = stored.achievements || [];
  const streakDays = stored.streak ? stored.streak.days : 0;

  const notifLink = '<button class="profile-notif-link" onclick="navigate(\'notifications\')"><span class="profile-notif-link-left"><svg><use href="#i-bell"/></svg><span>Notifications</span></span>' + (unreadCount > 0 ? '<span class="badge">' + unreadCount + '</span>' : '<svg style="width:16px;height:16px;color:var(--muted);"><use href="#i-chevron-right"/></svg>') + '</button>';
  const histLink = '<button class="profile-notif-link" onclick="navigate(\'history\')"><span class="profile-notif-link-left"><svg><use href="#i-list"/></svg><span>Survey History</span></span><svg style="width:16px;height:16px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button>';

  const achievementsHTML = '<div class="user-detail-section"><h4>🏆 Achievements (' + achievements.length + '/' + Object.keys(ACHIEVEMENTS).length + ')</h4><div class="achievements-grid">' + Object.keys(ACHIEVEMENTS).map(function(key) {
    const a = ACHIEVEMENTS[key]; const unlocked = achievements.includes(key);
    return '<div class="achievement-chip ' + (unlocked ? 'unlocked' : '') + '"><span class="achievement-icon">' + a.icon + '</span><span class="achievement-name">' + a.label + '</span></div>';
  }).join('') + '</div></div>';

  const streakHTML = streakDays > 0 ? '<div class="streak-display"><div class="streak-icon">🔥</div><div class="streak-info"><strong>Day ' + streakDays + ' streak</strong><small>Daily bonus credited</small></div></div>' : '';

  let tierHTML = '', statsHTML = '', planAction = '', referralHTML = '';
  if (isAdmin) { tierHTML = '<div class="admin-badge">🔑 Administrator</div>'; planAction = '<button class="btn btn-primary btn-block" onclick="navigate(\'admin\')">Admin Dashboard</button>'; }
  else {
    tierHTML = '<span class="profile-tier-badge tier-' + tier + '"><svg style="width:14px;height:14px;"><use href="#' + plan.icon + '"/></svg>' + plan.label + '</span>';
    statsHTML = '<div class="profile-stats"><div class="profile-stat"><span class="profile-stat-val">' + parts.length + '</span><span class="profile-stat-label">Surveys taken</span></div><div class="profile-stat"><span class="profile-stat-val">' + approved + '</span><span class="profile-stat-label">Approved</span></div></div>';
    planAction = '<button class="btn btn-outline btn-block" onclick="openPlanModal()"><svg style="width:16px;height:16px;"><use href="#i-crown"/></svg>Change Plan</button>';
    referralHTML = '<div class="referral-card"><div class="referral-header"><svg><use href="#i-gift"/></svg><strong>Referral Programme</strong></div><p class="referral-desc">Invite friends — earn KSh 20 when their first survey is approved.</p><div class="referral-code-box"><span class="referral-code-label">Your code</span><span class="referral-code-val">' + escapeHtml(code) + '</span></div><div class="referral-stats"><div class="referral-stat"><strong>' + referrals.length + '</strong><small>Friends invited</small></div></div><div class="referral-actions"><button class="btn btn-outline btn-sm" onclick="copyReferralLink()"><svg style="width:14px;height:14px;"><use href="#i-copy"/></svg>Copy Link</button><button class="btn btn-outline btn-sm" onclick="shareReferralLink()"><svg style="width:14px;height:14px;"><use href="#i-share"/></svg>Share</button></div></div>';
  }

  container.innerHTML = '<div class="profile-card"><div class="profile-avatar-container">' + avatarHTML + '</div><h2>' + escapeHtml(currentUser.name || 'User') + '</h2><p class="profile-email">@' + escapeHtml(currentUser.username || 'user') + ' &bull; ' + escapeHtml(currentUser.email) + '</p>' + tierHTML + statsHTML + streakHTML + notifLink + histLink + achievementsHTML + '<div class="profile-actions"><button class="btn btn-primary btn-block" onclick="openEditProfile()"><svg style="width:16px;height:16px;"><use href="#i-edit"/></svg>Edit Profile</button>' + planAction + '</div>' + referralHTML + '<div class="profile-actions"><button class="btn btn-outline btn-block" onclick="navigate(\'settings\')"><svg style="width:16px;height:16px;"><use href="#i-settings"/></svg>Settings</button><button class="btn btn-outline btn-block" onclick="signOut()">Sign Out</button></div><div class="danger-zone"><button class="btn btn-outline btn-block danger-btn" onclick="deleteAccount()"><svg style="width:16px;height:16px;"><use href="#i-trash"/></svg>Delete Account</button></div></div>';
  updateNotifBadges();
}
function openEditProfile() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  editingAvatar = stored.avatar || null; editingName = stored.name || currentUser.name || '';
  document.getElementById('edit-name-input').value = editingName;
  document.getElementById('edit-profile-overlay').classList.add('open');
  document.getElementById('edit-profile-notice').className = 'notice';
  renderAvatarGrid(); updateEditAvatarPreview();
  document.getElementById('edit-name-input').oninput = function() { editingName = this.value; if (!editingAvatar) updateEditAvatarPreview(); };
}
function closeEditProfile() { document.getElementById('edit-profile-overlay').classList.remove('open'); }
function handleEditProfileOverlayClick(e) { if (e.target.id === 'edit-profile-overlay') closeEditProfile(); }
function renderAvatarGrid() { const grid = document.getElementById('avatar-grid'); if (!grid) return; grid.innerHTML = ANIME_URLS.map(function(url) { return '<button class="avatar-option ' + (editingAvatar === url ? 'selected' : '') + '" onclick="selectAvatar(\'' + url + '\')"><img src="' + url + '" alt="" loading="lazy"></button>'; }).join(''); }
function selectAvatar(url) { editingAvatar = url; renderAvatarGrid(); updateEditAvatarPreview(); }
function updateEditAvatarPreview() { const p = document.getElementById('edit-avatar-preview'); if (!p) return; if (editingAvatar) p.innerHTML = '<img src="' + escapeHtml(editingAvatar) + '" alt="">'; else { const i = (editingName || (currentUser && currentUser.email) || '?').charAt(0).toUpperCase(); p.innerHTML = '<span class="initial">' + escapeHtml(i) + '</span>'; } }
function handleAvatarFileChange(e) { const f = e.target.files[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) { showToast('Max 2MB'); return; } const r = new FileReader(); r.onload = function(ev) { editingAvatar = ev.target.result; renderAvatarGrid(); updateEditAvatarPreview(); }; r.readAsDataURL(f); }
function saveProfileEdits() {
  if (!currentUser) return;
  const n = document.getElementById('edit-name-input').value.trim();
  if (n.length < 2) { const notice = document.getElementById('edit-profile-notice'); notice.className = 'notice show error'; notice.textContent = 'Name must be 2+ chars.'; return; }
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  users[idx].name = n; users[idx].avatar = editingAvatar;
  writeStore(STORE_USERS, users);
  currentUser.name = n; currentUser.avatar = editingAvatar;
  closeEditProfile(); showToast('Saved'); renderProfile(); updateAuthUI();
}

// Plan modal
function openPlanModal() { if (isAdmin || !currentUser) return; const users = readStore(STORE_USERS, []); const s = users.find(function(u) { return u.id === currentUser.id; }) || {}; selectedPlan = s.tier || 'basic'; document.getElementById('plan-overlay').classList.add('open'); document.getElementById('plan-notice').className = 'notice'; document.querySelectorAll('.plan-card').forEach(function(c) { const p = c.dataset.plan; c.classList.remove('selected','current'); if (p === s.tier) c.classList.add('current'); if (p === selectedPlan) c.classList.add('selected'); var b = c.querySelector('.plan-badge-current'); if (p === s.tier && !b) { const nb = document.createElement('div'); nb.className = 'plan-badge-current'; nb.textContent = 'Current'; c.appendChild(nb); } else if (p !== s.tier && b) b.remove(); }); }
function closePlanModal() { document.getElementById('plan-overlay').classList.remove('open'); }
function handlePlanOverlayClick(e) { if (e.target.id === 'plan-overlay') closePlanModal(); }
function selectPlan(p) { selectedPlan = p; document.querySelectorAll('.plan-card').forEach(function(c) { c.classList.toggle('selected', c.dataset.plan === p); }); }
function confirmPlanChange() {
  if (!currentUser || !selectedPlan) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  users[idx].tier = selectedPlan; writeStore(STORE_USERS, users); currentUser.tier = selectedPlan;
  closePlanModal(); showToast('Plan: ' + PLANS[selectedPlan].label);
  if (currentView === 'profile') renderProfile();
  if (currentView === 'wallet') renderWallet();
  if (currentView === 'settings') renderSettings();
  fetchAndRenderSurveys(); checkAchievements();
}

// Settings
function renderSettings() {
  const container = document.getElementById('settings-content');
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const notifs = readStore(STORE_NOTIFICATIONS, true);
  const tier = getUserTier(); const plan = PLANS[tier];
  const users = readStore(STORE_USERS, []);
  const stored = currentUser ? users.find(function(u) { return u.id === currentUser.id; }) : null;
  const logins = stored ? (stored.logins || []) : [];
  const loginsHTML = logins.length > 0 ? '<div class="settings-group"><div class="settings-group-title">Login History (last 5)</div><div style="background:var(--card);border:1px solid var(--line-strong);border-radius:14px;padding:8px 16px;">' + logins.slice(-5).reverse().map(function(l) { return '<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);"><strong style="color:var(--ink);">' + new Date(l.time).toLocaleString() + '</strong><br>' + escapeHtml((l.ua || 'Unknown').slice(0, 80)) + '</div>'; }).join('') + '</div></div>' : '';
  container.innerHTML = '<div class="settings-container"><div class="settings-header"><h2>Settings</h2><p>Manage your preferences</p></div>' +
    '<div class="settings-group"><div class="settings-group-title">Appearance</div><div class="settings-item"><div class="settings-item-left"><strong>Theme</strong><small>Light or dark mode</small></div><div class="theme-selector"><button class="theme-option ' + (theme === 'light' ? 'active' : '') + '" onclick="setTheme(\'light\')">Light</button><button class="theme-option ' + (theme === 'dark' ? 'active' : '') + '" onclick="setTheme(\'dark\')">Dark</button></div></div></div>' +
    '<div class="settings-group"><div class="settings-group-title">Notifications</div><div class="settings-item"><div class="settings-item-left"><strong>Email Notifications</strong><small>Get notified</small></div><button class="toggle-switch ' + (notifs ? 'on' : '') + '" onclick="toggleNotifications()"><span class="toggle-knob"></span></button></div></div>' +
    (currentUser ? '<div class="settings-group"><div class="settings-group-title">Account</div><button class="settings-item settings-item-btn" onclick="navigate(\'profile\')"><div class="settings-item-left"><strong>Profile</strong><small>Edit name and avatar</small></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button><button class="settings-item settings-item-btn" onclick="openPasswordModal()"><div class="settings-item-left"><strong>Change Password</strong><small>Update your password</small></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button>' + (isAdmin ? '' : '<button class="settings-item settings-item-btn" onclick="openPlanModal()"><div class="settings-item-left"><strong>Change Plan</strong><small>Current: ' + plan.label + '</small></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button>') + '</div>' : '') +
    loginsHTML +
    '<div class="settings-group"><div class="settings-group-title">Privacy & Data</div><div class="settings-item"><div class="settings-item-left"><strong>Clear App Data</strong><small>Remove everything</small></div><button class="btn btn-outline btn-sm" onclick="clearAppData()">Clear</button></div></div>' +
    '<div class="settings-group"><div class="settings-group-title">About</div><div class="settings-item settings-item-static"><div class="settings-item-left"><strong>SurveyKE</strong><small>v2.1 &bull; Built for Kenya</small></div></div><button class="settings-item settings-item-btn" onclick="navigate(\'static\',\'terms\')"><div class="settings-item-left"><strong>Terms of Service</strong></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button><button class="settings-item settings-item-btn" onclick="navigate(\'static\',\'privacy\')"><div class="settings-item-left"><strong>Privacy Policy</strong></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button><button class="settings-item settings-item-btn" onclick="navigate(\'static\',\'faq\')"><div class="settings-item-left"><strong>FAQ</strong><small>Common questions</small></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button></div>' +
    (currentUser ? '<div class="settings-group"><div class="settings-group-title">Danger Zone</div><div class="settings-item"><div class="settings-item-left"><strong>Delete Account</strong><small>Permanently remove account</small></div><button class="btn btn-outline btn-sm danger-btn" onclick="deleteAccount()">Delete</button></div></div>' : '') +
  '</div>';
}
function toggleNotifications() { const cur = readStore(STORE_NOTIFICATIONS, true); writeStore(STORE_NOTIFICATIONS, !cur); renderSettings(); }
function clearAppData() { if (!confirm('Clear all app data? You will be logged out.')) return; [STORE_USERS, STORE_SESSION, STORE_SURVEYS, STORE_PARTICIPATIONS, STORE_RESPONSES, STORE_PENDING_REF, STORE_NOTIFICATIONS, STORE_WITHDRAWALS, STORE_PROMOS].forEach(function(k) { localStorage.removeItem(k); }); location.reload(); }
function deleteAccount() { if (!currentUser) return; if (!confirm('Delete your account permanently?')) return; const id = currentUser.id; let users = readStore(STORE_USERS, []); users = users.filter(function(u) { return u.id !== id; }); users.forEach(function(u) { if (u.referrals) u.referrals = u.referrals.filter(function(x) { return x !== id; }); }); writeStore(STORE_USERS, users); let p = readStore(STORE_PARTICIPATIONS, []); p = p.filter(function(x) { return x.user_id !== id; }); writeStore(STORE_PARTICIPATIONS, p); let r = readStore(STORE_RESPONSES, []); r = r.filter(function(x) { return x.user_id !== id; }); writeStore(STORE_RESPONSES, r); let w = readStore(STORE_WITHDRAWALS, []); w = w.filter(function(x) { return x.user_id !== id; }); writeStore(STORE_WITHDRAWALS, w); writeStore(STORE_SESSION, null); currentUser = null; isAdmin = false; updateAuthUI(); navigate('home'); showToast('Account deleted.'); }
function openPasswordModal() { document.getElementById('password-overlay').classList.add('open'); document.getElementById('old-password').value = ''; document.getElementById('new-password').value = ''; document.getElementById('password-notice').className = 'notice'; }
function closePasswordModal() { document.getElementById('password-overlay').classList.remove('open'); }
function handlePasswordOverlayClick(e) { if (e.target.id === 'password-overlay') closePasswordModal(); }
async function changePassword() {
  const oldPw = document.getElementById('old-password').value;
  const newPw = document.getElementById('new-password').value;
  const notice = document.getElementById('password-notice');
  try {
    if (!currentUser) throw new Error('Not signed in');
    if (newPw.length < 6) throw new Error('New password must be 6+ chars');
    const users = readStore(STORE_USERS, []);
    const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
    const oldHash = await hashPassword(oldPw);
    if (users[idx].passwordHash !== oldHash) throw new Error('Current password incorrect');
    users[idx].passwordHash = await hashPassword(newPw);
    writeStore(STORE_USERS, users);
    closePasswordModal(); showToast('Password updated!');
  } catch (e) { notice.className = 'notice show error'; notice.textContent = e.message; }
}

// ---------- Static pages ----------
const STATIC_PAGES = {
  faq: {
    title: 'Frequently Asked Questions',
    html: '<div class="faq-item"><div class="faq-question" onclick="toggleFaq(this)">When do I get paid?<svg class="chevron" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="6 9 12 15 18 9"/></svg></div><div class="faq-answer">Approved surveys appear in your wallet immediately. Withdrawals process within 24-48 hours to your M-Pesa. Minimum withdrawal depends on your plan.</div></div>' +
      '<div class="faq-item"><div class="faq-question" onclick="toggleFaq(this)">Why was I rejected?<svg class="chevron" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="6 9 12 15 18 9"/></svg></div><div class="faq-answer">Surveys get rejected if answers are inconsistent, duplicated, or clearly rushed. Admins review submissions manually.</div></div>' +
      '<div class="faq-item"><div class="faq-question" onclick="toggleFaq(this)">What is screening out?<svg class="chevron" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="6 9 12 15 18 9"/></svg></div><div class="faq-answer">Some surveys have qualifying questions. If your answer doesn\'t match the target audience, you\'re screened out. No reward is given but you can take other surveys.</div></div>' +
      '<div class="faq-item"><div class="faq-question" onclick="toggleFaq(this)">How do tiers work?<svg class="chevron" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="6 9 12 15 18 9"/></svg></div><div class="faq-answer">Basic is free but limited to 3 surveys/day and KSh 50/day cap. Silver unlocks more, Gold even more, Platinum gives full access with a KSh 300/day cap and KSh 500 withdrawal minimum.</div></div>' +
      '<div class="faq-item"><div class="faq-question" onclick="toggleFaq(this)">What is my referral code for?<svg class="chevron" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="6 9 12 15 18 9"/></svg></div><div class="faq-answer">Share your code. When a friend signs up and their first survey is approved, you earn KSh 20 bonus automatically.</div></div>' +
      '<div class="faq-item"><div class="faq-question" onclick="toggleFaq(this)">Is my data safe?<svg class="chevron" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="6 9 12 15 18 9"/></svg></div><div class="faq-answer">Yes — all data is stored locally in your browser. Nothing is sent to any server. Clearing browser data will reset your account.</div></div>'
  },
  terms: {
    title: 'Terms of Service',
    html: '<p>Last updated: ' + new Date().toLocaleDateString() + '</p>' +
      '<h2>1. Acceptance</h2><p>By using SurveyKE, you agree to these terms. If you do not agree, do not use the service.</p>' +
      '<h2>2. Eligibility</h2><p>You must be at least 18 years old and a resident of Kenya to participate.</p>' +
      '<h2>3. Account</h2><p>You are responsible for maintaining your password. One account per person. Multiple accounts may result in termination.</p>' +
      '<h2>4. Survey Participation</h2><p>You agree to answer surveys honestly. Deliberately false, rushed, or bot-like responses may result in rejection or account suspension.</p>' +
      '<h2>5. Rewards</h2><p>Rewards are credited after admin approval of your survey submission. Screening out is not eligible for rewards.</p>' +
      '<h2>6. Withdrawals</h2><p>Withdrawal minimums vary by plan. Requests are processed within 24-48 hours to your M-Pesa number.</p>' +
      '<h2>7. Prohibited</h2><p>You may not: use bots, submit fabricated data, attempt to hack, or abuse the referral programme.</p>' +
      '<h2>8. Changes</h2><p>We may update these terms at any time. Continued use means acceptance.</p>' +
      '<h2>9. Contact</h2><p>Questions: facelessdime@gmail.com</p>'
  },
  privacy: {
    title: 'Privacy Policy',
    html: '<p>Last updated: ' + new Date().toLocaleDateString() + '</p>' +
      '<h2>1. Data We Store</h2><p>Your account data (name, username, email, hashed password, avatar) and survey answers are stored <strong>locally in your browser</strong> using localStorage.</p>' +
      '<h2>2. What We Do NOT Do</h2><p>We do not send your data to any server. We do not track you. We do not use cookies for advertising. We do not sell your data.</p>' +
      '<h2>3. Data Retention</h2><p>Your data remains on your device until you delete your account or clear your browser data.</p>' +
      '<h2>4. Your Rights</h2><p>You can view, edit, or delete all your data at any time through Settings → Delete Account.</p>' +
      '<h2>5. Security</h2><p>Passwords are hashed with SHA-256 before storage. However, no system is 100% secure — use a strong unique password.</p>' +
      '<h2>6. Contact</h2><p>Data questions: facelessdime@gmail.com</p>'
  }
};
function renderStaticPage(page) {
  const container = document.getElementById('static-content');
  const content = STATIC_PAGES[page];
  if (!content) { container.innerHTML = '<div class="state-box"><strong>Page not found</strong></div>'; return; }
  container.innerHTML = '<div class="static-page"><a href="#" class="back-link" onclick="navigate(\'home\'); return false;"><svg><use href="#i-arrow"/></svg> Back</a><h1>' + content.title + '</h1>' + content.html + '</div>';
}
function toggleFaq(el) { el.parentElement.classList.toggle('open'); }

// ---------- Admin ----------
function switchAdminSection(section) {
  adminSection = section;
  document.querySelectorAll('.admin-subtab').forEach(function(btn) { if (btn.dataset.section === section) btn.classList.add('active'); else btn.classList.remove('active'); });
  document.querySelectorAll('.admin-section').forEach(function(sec) { if (sec.id === 'admin-section-' + section) sec.classList.remove('hidden'); else sec.classList.add('hidden'); });
  if (section === 'manage') loadAdminSurveysTable();
  if (section === 'review') loadAdminParticipationsTable();
  if (section === 'withdrawals') loadAdminWithdrawals();
  if (section === 'promos') loadAdminPromos();
}
function setAdminSurveyType(type) { adminSurveyType = type; document.querySelectorAll('.admin-type-btn').forEach(function(b) { if (b.dataset.type === type) b.classList.add('active'); else b.classList.remove('active'); }); document.getElementById('admin-external-fields').classList.toggle('hidden', type !== 'external'); document.getElementById('admin-internal-fields').classList.toggle('hidden', type !== 'internal'); const ui = document.getElementById('admin-url'); if (ui) ui.required = (type === 'external'); if (type === 'internal' && adminQuestions.length === 0) addAdminQuestion(); }
function addAdminQuestion() { adminQuestions.push({ id: uid('q'), type: 'mcq', question: '', options: ['', ''], required: true, screenOut: false, correctOptions: [] }); renderAdminQuestions(); }
function removeAdminQuestion(qId) { adminQuestions = adminQuestions.filter(function(q) { return q.id !== qId; }); renderAdminQuestions(); }
function updateAdminQuestion(qId, f, v) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q) q[f] = v; }
function updateAdminQuestionOption(qId, i, v) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q && q.options) q.options[i] = v; }
function addQuestionOption(qId) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q) { q.options.push(''); renderAdminQuestions(); } }
function removeQuestionOption(qId, i) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q && q.options.length > 2) { q.options.splice(i, 1); q.correctOptions = q.correctOptions.filter(function(x) { return x !== i; }).map(function(x) { return x > i ? x - 1 : x; }); renderAdminQuestions(); } }
function changeQuestionType(qId, t) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (!q) return; q.type = t; if (t === 'mcq' && (!q.options || q.options.length < 2)) q.options = ['', '']; if (t !== 'mcq') { q.screenOut = false; q.correctOptions = []; } renderAdminQuestions(); }
function toggleAdminScreenOut(qId, c) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q) { q.screenOut = c; if (!c) q.correctOptions = []; renderAdminQuestions(); } }
function toggleCorrectOption(qId, i) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (!q) return; q.correctOptions = q.correctOptions || []; const idx = q.correctOptions.indexOf(i); if (idx === -1) q.correctOptions.push(i); else q.correctOptions.splice(idx, 1); renderAdminQuestions(); }
function renderAdminQuestions() {
  const wrap = document.getElementById('admin-questions-list'); if (!wrap) return;
  if (adminQuestions.length === 0) { wrap.innerHTML = '<p style="font-size:12px;color:var(--muted);text-align:center;padding:14px 0;">No questions yet.</p>'; return; }
  wrap.innerHTML = adminQuestions.map(function(q, idx) {
    let h = '<div class="question-builder"><div class="question-builder-header"><strong>Question ' + (idx + 1) + '</strong><button type="button" class="qb-remove" onclick="removeAdminQuestion(\'' + q.id + '\')">Remove</button></div>';
    h += '<div class="qb-field"><label>Type</label><select onchange="changeQuestionType(\'' + q.id + '\', this.value)"><option value="mcq"' + (q.type === 'mcq' ? ' selected' : '') + '>Multiple Choice</option><option value="text"' + (q.type === 'text' ? ' selected' : '') + '>Short Text</option><option value="paragraph"' + (q.type === 'paragraph' ? ' selected' : '') + '>Paragraph</option><option value="rating"' + (q.type === 'rating' ? ' selected' : '') + '>Rating</option></select></div>';
    h += '<div class="qb-field"><label>Question</label><input type="text" placeholder="Question text" value="' + escapeHtml(q.question) + '" oninput="updateAdminQuestion(\'' + q.id + '\', \'question\', this.value)"></div>';
    if (q.type === 'mcq') {
      h += '<div class="qb-screenout-toggle"><input type="checkbox"' + (q.screenOut ? ' checked' : '') + ' onchange="toggleAdminScreenOut(\'' + q.id + '\', this.checked)"><label>Screen-out<small>Wrong answers kick user out</small></label></div>';
      h += '<div class="qb-field"><label>Options' + (q.screenOut ? ' — ✓ correct' : '') + '</label><div class="qb-options-list">';
      q.options.forEach(function(opt, oIdx) {
        const c = (q.correctOptions || []).indexOf(oIdx) !== -1;
        h += '<div class="qb-option-row">';
        if (q.screenOut) h += '<label class="qb-opt-correct-label"><input type="checkbox"' + (c ? ' checked' : '') + ' onchange="toggleCorrectOption(\'' + q.id + '\', ' + oIdx + ')">✓</label>';
        h += '<input type="text" placeholder="Option ' + (oIdx + 1) + '" value="' + escapeHtml(opt) + '" oninput="updateAdminQuestionOption(\'' + q.id + '\', ' + oIdx + ', this.value)">';
        if (q.options.length > 2) h += '<button type="button" class="qb-remove-opt" onclick="removeQuestionOption(\'' + q.id + '\', ' + oIdx + ')">×</button>';
        h += '</div>';
      });
      h += '</div><button type="button" class="qb-add-option" onclick="addQuestionOption(\'' + q.id + '\')" style="margin-top:8px;">+ Add Option</button></div>';
    }
    h += '<div class="qb-field"><div class="qb-required-row"><input type="checkbox"' + (q.required ? ' checked' : '') + ' onchange="updateAdminQuestion(\'' + q.id + '\', \'required\', this.checked)"><span>Required</span></div></div></div>';
    return h;
  }).join('');
}
async function renderAdminDashboard() {
  const u = document.getElementById('admin-unauthorized'); const a = document.getElementById('admin-authorized');
  if (!isAdmin) { u.classList.remove('hidden'); a.classList.add('hidden'); return; }
  u.classList.add('hidden'); a.classList.remove('hidden');
  switchAdminSection(adminSection || 'add');
}
async function loadAdminSurveysTable() {
  const wrap = document.getElementById('admin-surveys-list-wrap');
  const all = readStore(STORE_SURVEYS, []).slice().sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
  if (all.length === 0) { wrap.innerHTML = '<p style="font-size:12.5px;color:var(--muted);">No surveys found.</p>'; return; }
  wrap.innerHTML = '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Title</th><th>Type</th><th>Tier</th><th>Reward</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + all.map(function(s) {
    const tt = s.status === 'published' ? 'closed' : 'published';
    const isPub = s.status === 'published';
    const typeLabel = s.type === 'internal' ? '📝' : '🔗';
    const subline = s.type === 'internal' ? (s.questions ? s.questions.length + ' questions' : '') : (s.survey_url || '');
    const cls = isPub ? 'admin-act-close' : 'admin-act-publish';
    const icon = isPub ? 'i-lock' : 'i-check-circle';
    return '<tr><td><strong>' + escapeHtml(s.title) + '</strong><br><small style="color:var(--muted);">' + escapeHtml(subline) + '</small></td><td>' + typeLabel + '</td><td>' + tierBadgeHTML(s.tier) + '</td><td>KSh ' + (s.reward || 20) + '</td><td><span class="status-chip">' + escapeHtml(s.status) + '</span></td><td><button class="admin-act-btn ' + cls + '" onclick="toggleSurveyStatus(\'' + s.id + '\', \'' + tt + '\')"><svg><use href="#' + icon + '"/></svg>' + (isPub ? 'Close' : 'Publish') + '</button><button class="admin-act-btn admin-act-delete" onclick="deleteSurvey(\'' + s.id + '\')"><svg><use href="#i-trash"/></svg>Delete</button></td></tr>';
  }).join('') + '</tbody></table></div>';
}
async function loadAdminParticipationsTable() {
  const wrap = document.getElementById('admin-participations-wrap');
  const allParts = readStore(STORE_PARTICIPATIONS, []).slice().sort(function(a, b) { return (b.submitted_at || b.updated_at || 0) - (a.submitted_at || a.updated_at || 0); });
  const allSurveys = readStore(STORE_SURVEYS, []); const allUsers = readStore(STORE_USERS, []);
  const counts = { pending: 0, reviewed: 0, approved: 0, rejected: 0 };
  allParts.forEach(function(p) { const s = p.review_status || 'pending'; if (counts[s] !== undefined) counts[s]++; if (s === 'screened_out') counts.rejected++; });
  let html = '<div class="admin-tabs">';
  ['pending', 'reviewed', 'approved', 'rejected'].forEach(function(st) {
    const lbl = st.charAt(0).toUpperCase() + st.slice(1);
    html += '<button class="admin-tab ' + (adminParticipationTab === st ? 'active' : '') + '" onclick="setAdminParticipationTab(\'' + st + '\')">' + lbl + ' <span class="count">' + counts[st] + '</span></button>';
  });
  html += '</div>';
  let filtered = adminParticipationTab === 'rejected' ? allParts.filter(function(p) { return p.review_status === 'rejected' || p.review_status === 'screened_out' || p.status === 'screened_out'; }) : allParts.filter(function(p) { return (p.review_status || 'pending') === adminParticipationTab; });
  if (filtered.length === 0) html += '<div class="state-box" style="padding:30px 20px;"><strong>No ' + adminParticipationTab + ' participations</strong></div>';
  else {
    html += '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>User</th><th>Survey</th><th>Type</th><th>Date</th><th>Actions</th></tr></thead><tbody>';
    filtered.forEach(function(p) {
      const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
      const user = allUsers.find(function(u) { return u.id === p.user_id; });
      const un = user ? (user.name || user.email) : 'Unknown';
      const ue = user ? ('@' + (user.username || '') + ' · ' + user.email) : '—';
      const typeLbl = s && s.type === 'internal' ? '📝' : '🔗';
      const dateStr = (p.submitted_at || p.updated_at) ? new Date(p.submitted_at || p.updated_at).toLocaleDateString() : '—';
      const actions = renderParticipationActions(p, s && s.type === 'internal');
      html += '<tr><td><a href="#" onclick="viewAdminUser(\'' + (user ? user.id : '') + '\'); return false;" style="color:var(--green-dark);font-weight:700;text-decoration:underline;">' + escapeHtml(un) + '</a><br><small style="color:var(--muted);">' + escapeHtml(ue) + '</small></td><td><strong>' + escapeHtml(s ? s.title : 'Deleted') + '</strong></td><td>' + typeLbl + '</td><td>' + dateStr + '</td><td>' + actions + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  wrap.innerHTML = html;
}
function setAdminParticipationTab(t) { adminParticipationTab = t; loadAdminParticipationsTable(); }
function renderParticipationActions(p, isInternal) {
  const st = p.review_status || 'pending';
  const isScreened = st === 'screened_out' || p.status === 'screened_out';
  if (st === 'approved' || st === 'rejected' || isScreened) return '<span class="locked-badge"><svg><use href="#i-lock"/></svg>' + (isScreened ? 'Screened Out' : (st.charAt(0).toUpperCase() + st.slice(1))) + '</span>';
  let btns = [];
  if (isInternal) btns.push('<button class="admin-act-btn admin-act-view" onclick="viewResponse(\'' + p.id + '\')"><svg><use href="#i-book"/></svg>View</button>');
  if (st === 'pending') btns.push('<button class="admin-act-btn admin-act-review" onclick="markReviewed(\'' + p.id + '\')"><svg><use href="#i-check"/></svg>Review</button>');
  btns.push('<button class="admin-act-btn admin-act-approve" onclick="reviewParticipation(\'' + p.id + '\', \'approved\')"><svg><use href="#i-check-circle"/></svg>Approve</button>');
  btns.push('<button class="admin-act-btn admin-act-delete" onclick="reviewParticipation(\'' + p.id + '\', \'rejected\')"><svg><use href="#i-x-circle"/></svg>Reject</button>');
  return btns.join('');
}
function markReviewed(id) { try { const parts = readStore(STORE_PARTICIPATIONS, []); const i = parts.findIndex(function(p) { return p.id === id; }); if (i === -1) throw new Error('Not found'); const p = parts[i]; if (p.review_status === 'approved' || p.review_status === 'rejected' || p.review_status === 'screened_out') throw new Error('Finalized'); p.review_status = 'reviewed'; p.reviewed_at = Date.now(); writeStore(STORE_PARTICIPATIONS, parts); showToast('Reviewed'); loadAdminParticipationsTable(); } catch (e) { showToast(e.message); } }
async function reviewParticipation(id, decision) {
  try {
    const parts = readStore(STORE_PARTICIPATIONS, []); const i = parts.findIndex(function(p) { return p.id === id; });
    if (i === -1) throw new Error('Not found');
    const st = parts[i].review_status || 'pending';
    if (st === 'approved' || st === 'rejected' || st === 'screened_out') throw new Error('Already finalized');
    parts[i].review_status = decision; parts[i].reviewed_at = Date.now();
    writeStore(STORE_PARTICIPATIONS, parts);

    // Referral bonus — if this is the user's FIRST approved participation
    if (decision === 'approved') {
      const userId = parts[i].user_id;
      const userApproved = parts.filter(function(p) { return p.user_id === userId && p.review_status === 'approved'; });
      if (userApproved.length === 1) {
        const users = readStore(STORE_USERS, []);
        const approveUser = users.find(function(u) { return u.id === userId; });
        if (approveUser && approveUser.referred_by) {
          const rIdx = users.findIndex(function(u) { return (u.referralCode || '').toUpperCase() === approveUser.referred_by; });
          if (rIdx !== -1) {
            users[rIdx].bonuses = users[rIdx].bonuses || [];
            users[rIdx].bonuses.push({ id: uid('bon'), amount: 20, type: 'referral', description: 'Referral bonus: @' + approveUser.username, created_at: Date.now() });
            writeStore(STORE_USERS, users);
          }
        }
      }
    }
    showToast(decision);
    await loadAdminParticipationsTable();
  } catch (e) { showToast(e.message); }
}
function viewResponse(id) {
  const parts = readStore(STORE_PARTICIPATIONS, []); const part = parts.find(function(p) { return p.id === id; });
  if (!part) return;
  const surveys = readStore(STORE_SURVEYS, []); const survey = surveys.find(function(s) { return s.id === part.survey_id; });
  if (!survey || survey.type !== 'internal') return;
  const responses = readStore(STORE_RESPONSES, []); const response = responses.find(function(r) { return r.survey_id === survey.id && r.user_id === part.user_id; });
  const users = readStore(STORE_USERS, []); const user = users.find(function(u) { return u.id === part.user_id; });
  if (part.review_status === 'pending') { part.review_status = 'reviewed'; part.reviewed_at = Date.now(); const all = readStore(STORE_PARTICIPATIONS, []); const ix = all.findIndex(function(p) { return p.id === id; }); if (ix !== -1) { all[ix].review_status = 'reviewed'; all[ix].reviewed_at = part.reviewed_at; writeStore(STORE_PARTICIPATIONS, all); } }
  const c = document.getElementById('response-viewer-content');
  let h = '<h2 style="margin:0 0 6px;font-size:20px;">' + escapeHtml(survey.title) + '</h2>';
  h += '<div class="response-user-info"><strong>' + escapeHtml(user ? (user.name || user.email) : 'Unknown') + '</strong><br>' + (user && user.username ? '@' + escapeHtml(user.username) + '<br>' : '') + escapeHtml(user ? user.email : '') + '</div>';
  if (!response) h += '<p style="color:var(--muted);text-align:center;">No answers.</p>';
  else { h += '<div class="response-list">'; (survey.questions || []).forEach(function(q, i) { const ans = response.answers ? response.answers[q.id] : ''; h += '<div class="response-answer"><div class="response-answer-label">Q' + (i + 1) + '</div><div class="response-answer-q">' + escapeHtml(q.question) + '</div><div class="response-answer-val">' + escapeHtml(String(ans) || '—') + '</div></div>'; }); h += '</div>'; }
  const fin = part.review_status === 'approved' || part.review_status === 'rejected' || part.review_status === 'screened_out';
  h += '<div class="modal-actions"><button class="btn btn-outline" onclick="closeResponseViewer()">Close</button>';
  if (!fin) { h += '<button class="btn btn-primary" onclick="closeResponseViewer(); reviewParticipation(\'' + part.id + '\', \'approved\')">Approve</button><button class="btn btn-outline danger-btn" onclick="closeResponseViewer(); reviewParticipation(\'' + part.id + '\', \'rejected\')">Reject</button>'; }
  h += '</div>';
  c.innerHTML = h;
  document.getElementById('response-viewer-overlay').classList.add('open');
  loadAdminParticipationsTable();
}
function closeResponseViewer() { document.getElementById('response-viewer-overlay').classList.remove('open'); }
function handleResponseViewerOverlayClick(e) { if (e.target.id === 'response-viewer-overlay') closeResponseViewer(); }

// Admin user detail
function viewAdminUser(userId) {
  if (!isAdmin || !userId) return;
  const users = readStore(STORE_USERS, []); const user = users.find(function(u) { return u.id === userId; });
  if (!user) { showToast('User not found'); return; }
  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === userId; });
  const surveys = readStore(STORE_SURVEYS, []);
  const withdrawals = readStore(STORE_WITHDRAWALS, []).filter(function(w) { return w.user_id === userId; });
  const balance = getUserBalance(userId);
  const pendingWithdrawals = withdrawals.filter(function(w) { return w.status === 'pending' || w.status === 'processing'; }).reduce(function(s, w) { return s + w.amount; }, 0);
  const approvedCount = parts.filter(function(p) { return p.review_status === 'approved'; }).length;
  const initial = (user.name || user.email || '?').charAt(0).toUpperCase();
  const avatarHTML = user.avatar ? '<img src="' + escapeHtml(user.avatar) + '">' : escapeHtml(initial);
  const c = document.getElementById('admin-user-content');
  let h = '<div class="user-detail-header"><div class="user-detail-avatar">' + avatarHTML + '</div><div class="user-detail-info"><h3>' + escapeHtml(user.name || 'User') + '</h3><p>@' + escapeHtml(user.username || 'user') + ' &bull; ' + escapeHtml(user.email) + '</p><p style="margin-top:4px;">Tier: <strong>' + PLANS[user.tier || 'basic'].label + '</strong> &bull; Referral: <strong>' + escapeHtml(user.referralCode || '—') + '</strong></p></div></div>';
  h += '<div class="user-detail-stats"><div class="user-detail-stat"><span class="user-detail-stat-val">' + parts.length + '</span><span class="user-detail-stat-lbl">Surveys</span></div><div class="user-detail-stat"><span class="user-detail-stat-val">' + approvedCount + '</span><span class="user-detail-stat-lbl">Approved</span></div><div class="user-detail-stat"><span class="user-detail-stat-val">KSh ' + balance.available.toLocaleString() + '</span><span class="user-detail-stat-lbl">Available</span></div></div>';
  h += '<div class="user-detail-section"><h4>Financial</h4><div class="user-detail-row"><span>Total earned (approved)</span><span>KSh ' + balance.earned.toLocaleString() + '</span></div><div class="user-detail-row"><span>Bonuses</span><span>KSh ' + balance.bonuses.toLocaleString() + '</span></div><div class="user-detail-row"><span>Withdrawn (all time)</span><span>KSh ' + balance.withdrawn.toLocaleString() + '</span></div><div class="user-detail-row"><span>Pending withdrawals</span><span>KSh ' + pendingWithdrawals.toLocaleString() + '</span></div></div>';
  if (parts.length > 0) {
    h += '<div class="user-detail-section"><h4>Recent Participations (' + parts.length + ')</h4>';
    parts.sort(function(a, b) { return (b.submitted_at || 0) - (a.submitted_at || 0); }).slice(0, 10).forEach(function(p) {
      const s = surveys.find(function(x) { return x.id === p.survey_id; });
      h += '<div class="user-detail-part"><span><strong>' + escapeHtml(s ? s.title : 'Deleted') + '</strong></span><span class="user-detail-part-status history-status ' + (p.review_status || 'pending') + '">' + (p.review_status || 'pending') + '</span></div>';
    });
    h += '</div>';
  }
  if (user.referrals && user.referrals.length > 0) {
    h += '<div class="user-detail-section"><h4>Referrals (' + user.referrals.length + ')</h4>';
    user.referrals.forEach(function(rid) { const r = users.find(function(x) { return x.id === rid; }); if (r) h += '<div class="user-detail-part"><span>@' + escapeHtml(r.username) + '</span><span style="color:var(--muted);font-size:11px;">' + escapeHtml(r.email) + '</span></div>'; });
    h += '</div>';
  }
  if (user.achievements && user.achievements.length > 0) {
    h += '<div class="user-detail-section"><h4>Achievements</h4><div style="display:flex;gap:6px;flex-wrap:wrap;">' + user.achievements.map(function(k) { const a = ACHIEVEMENTS[k]; return a ? '<span class="achievement-chip unlocked" style="padding:6px 10px;font-size:11px;"><span class="achievement-icon" style="font-size:14px;">' + a.icon + '</span>' + a.label + '</span>' : ''; }).join('') + '</div></div>';
  }
  h += '<div class="modal-actions"><button class="btn btn-outline" onclick="closeAdminUserModal()">Close</button></div>';
  c.innerHTML = h;
  document.getElementById('admin-user-overlay').classList.add('open');
}
function closeAdminUserModal() { document.getElementById('admin-user-overlay').classList.remove('open'); }
function handleAdminUserOverlayClick(e) { if (e.target.id === 'admin-user-overlay') closeAdminUserModal(); }

async function handleCreateSurvey(e) {
  e.preventDefault();
  const noticeEl = document.getElementById('admin-create-notice'); const submitBtn = document.getElementById('admin-submit-btn');
  const title = document.getElementById('admin-title').value.trim();
  const category = document.getElementById('admin-category').value;
  const description = document.getElementById('admin-description').value.trim();
  const estimated_minutes = parseInt(document.getElementById('admin-duration').value, 10);
  const reward = parseInt(document.getElementById('admin-reward').value, 10);
  const tier = document.getElementById('admin-tier').value;
  const status = document.getElementById('admin-status').value;
  const eligibility = document.getElementById('admin-eligibility').value.trim();
  const instructions = document.getElementById('admin-instructions').value.trim();
  const survey_url = adminSurveyType === 'external' ? document.getElementById('admin-url').value.trim() : '';
  submitBtn.disabled = true; noticeEl.className = 'notice';
  try {
    if (!title || !description) throw new Error('Title and description required');
    if (isNaN(estimated_minutes) || estimated_minutes <= 0) throw new Error('Invalid duration');
    if (isNaN(reward) || reward <= 0) throw new Error('Invalid reward');
    if (!PLANS[tier]) throw new Error('Invalid tier');
    if (adminSurveyType === 'external') {
      if (!survey_url.startsWith('https://')) throw new Error('URL must be HTTPS');
      if (survey_url.indexOf('forms.gle/example') !== -1) throw new Error('Demo link detected');
    } else {
      if (adminQuestions.length === 0) throw new Error('Add a question');
      for (let i = 0; i < adminQuestions.length; i++) {
        const q = adminQuestions[i];
        if (!q.question.trim()) throw new Error('Q' + (i + 1) + ' empty');
        if (q.type === 'mcq') {
          const f = (q.options || []).filter(function(o) { return o.trim(); });
          if (f.length < 2) throw new Error('Q' + (i + 1) + ' needs 2+ options');
          if (q.screenOut && (!q.correctOptions || q.correctOptions.length === 0)) throw new Error('Q' + (i + 1) + ' screen-out needs correct answer');
        }
      }
    }
    const all = readStore(STORE_SURVEYS, []);
    const ns = { id: uid('sur'), title: title, category: category, description: description, estimated_minutes: estimated_minutes, duration: estimated_minutes + ' mins', status: status, tier: tier, reward: reward, eligibility: eligibility, instructions: instructions, type: adminSurveyType, created_at: Date.now() };
    if (adminSurveyType === 'external') ns.survey_url = survey_url;
    else ns.questions = adminQuestions.map(function(q) { const m = { id: q.id, type: q.type, question: q.question, required: q.required }; if (q.type === 'mcq') { m.options = q.options.filter(function(o) { return o.trim(); }); m.screenOut = !!q.screenOut; m.correctOptions = q.screenOut ? (q.correctOptions || []) : []; } else m.options = []; return m; });
    all.push(ns); writeStore(STORE_SURVEYS, all);
    noticeEl.className = 'notice show success'; noticeEl.textContent = 'Survey created!';
    showToast('Published'); e.target.reset(); adminQuestions = []; adminSurveyType = 'external'; setAdminSurveyType('external'); renderAdminQuestions();
    fetchAndRenderSurveys();
  } catch (err) { noticeEl.className = 'notice show error'; noticeEl.textContent = 'Error: ' + err.message; }
  finally { submitBtn.disabled = false; }
}
async function toggleSurveyStatus(id, ns) { try { const all = readStore(STORE_SURVEYS, []); const i = all.findIndex(function(s) { return s.id === id; }); if (i === -1) throw new Error('Not found'); all[i].status = ns; writeStore(STORE_SURVEYS, all); showToast('Status: ' + ns); fetchAndRenderSurveys(); await loadAdminSurveysTable(); } catch (e) { showToast(e.message); } }
async function deleteSurvey(id) {
  if (!confirm('Delete this survey? This cannot be undone.')) return;
  try {
    let all = readStore(STORE_SURVEYS, []); all = all.filter(function(s) { return s.id !== id; }); writeStore(STORE_SURVEYS, all);
    let p = readStore(STORE_PARTICIPATIONS, []); p = p.filter(function(x) { return x.survey_id !== id; }); writeStore(STORE_PARTICIPATIONS, p);
    let r = readStore(STORE_RESPONSES, []); r = r.filter(function(x) { return x.survey_id !== id; }); writeStore(STORE_RESPONSES, r);
    showToast('Deleted'); fetchAndRenderSurveys(); await loadAdminSurveysTable(); await loadAdminParticipationsTable();
  } catch (e) { showToast(e.message); }
}
function exportCSV() {
  const parts = readStore(STORE_PARTICIPATIONS, []); const surveys = readStore(STORE_SURVEYS, []); const users = readStore(STORE_USERS, []);
  const rows = [['ID', 'User', 'Username', 'Email', 'Survey', 'Status', 'Review', 'Reward', 'Submitted']];
  parts.forEach(function(p) {
    const u = users.find(function(x) { return x.id === p.user_id; }); const s = surveys.find(function(x) { return x.id === p.survey_id; });
    rows.push([p.id, u ? (u.name || '') : '', u ? '@' + (u.username || '') : '', u ? u.email : '', s ? s.title : 'Deleted', p.status || '', p.review_status || '', s ? (s.reward || 0) : 0, p.submitted_at ? new Date(p.submitted_at).toISOString() : '']);
  });
  const csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'surveyke-participations-' + todayStr() + '.csv'; a.click();
}

// Admin withdrawals
function loadAdminWithdrawals() {
  const wrap = document.getElementById('admin-withdrawals-wrap');
  if (!wrap) return;
  const all = readStore(STORE_WITHDRAWALS, []).slice().sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
  if (all.length === 0) { wrap.innerHTML = '<div class="state-box"><strong>No withdrawal requests yet</strong></div>'; return; }
  const users = readStore(STORE_USERS, []);
  wrap.innerHTML = all.map(function(w) {
    const u = users.find(function(x) { return x.id === w.user_id; });
    const un = u ? (u.name || u.email) : 'Unknown';
    const ue = u ? (u.email || '') : '';
    const date = new Date(w.created_at).toLocaleString();
    let actions = '';
    if (w.status === 'pending') actions = '<button class="admin-act-btn admin-act-review" onclick="updateWithdrawal(\'' + w.id + '\', \'processing\')">Mark Processing</button><button class="admin-act-btn admin-act-delete" onclick="updateWithdrawal(\'' + w.id + '\', \'rejected\')">Reject</button>';
    else if (w.status === 'processing') actions = '<button class="admin-act-btn admin-act-approve" onclick="updateWithdrawal(\'' + w.id + '\', \'completed\')">Mark Completed</button>';
    else actions = '<span class="withdrawal-status ' + w.status + '">' + w.status + '</span>';
    return '<div class="withdrawal-row"><div class="withdrawal-row-main"><strong>@' + escapeHtml(u ? (u.username || '') : '') + ' — KSh ' + w.amount + '</strong><small>' + escapeHtml(un) + ' &bull; ' + escapeHtml(ue) + ' &bull; M-Pesa: ' + escapeHtml(w.phone) + ' &bull; ' + date + '</small></div><div class="withdrawal-row-actions">' + actions + '</div></div>';
  }).join('');
}
function updateWithdrawal(id, newStatus) {
  try {
    const all = readStore(STORE_WITHDRAWALS, []); const i = all.findIndex(function(w) { return w.id === id; });
    if (i === -1) throw new Error('Not found');
    all[i].status = newStatus; all[i].updated_at = Date.now();
    writeStore(STORE_WITHDRAWALS, all);
    showToast('Withdrawal ' + newStatus);
    loadAdminWithdrawals();
    if (newStatus === 'completed' && window.confetti) confetti({ particleCount: 80, spread: 60 });
  } catch (e) { showToast(e.message); }
}

// Admin promos
function loadAdminPromos() {
  const list = document.getElementById('admin-promos-list');
  if (!list) return;
  const promos = readStore(STORE_PROMOS, []);
  if (promos.length === 0) { list.innerHTML = '<div class="state-box"><strong>No promos yet</strong><p>Create one to get started.</p></div>'; return; }
  list.innerHTML = promos.slice().reverse().map(function(p) {
    return '<div class="promo-item"><div><strong>' + escapeHtml(p.code) + '</strong> <small>— KSh ' + p.amount + ' &bull; ' + (p.uses || []).length + '/' + (p.maxUses || '∞') + ' used</small></div><button class="admin-act-btn admin-act-delete" onclick="deletePromo(\'' + p.code + '\')">Delete</button></div>';
  }).join('');
}
function createPromo() {
  const code = document.getElementById('promo-code-input').value.trim().toUpperCase();
  const amount = parseInt(document.getElementById('promo-amount-input').value, 10);
  const maxUses = parseInt(document.getElementById('promo-maxuses-input').value, 10) || 100;
  if (!code || code.length < 3) { showToast('Code must be 3+ chars'); return; }
  if (isNaN(amount) || amount <= 0 || amount > 1000) { showToast('Amount must be 1-1000'); return; }
  const promos = readStore(STORE_PROMOS, []);
  if (promos.some(function(p) { return p.code === code; })) { showToast('Code exists'); return; }
  promos.push({ code: code, amount: amount, maxUses: maxUses, uses: [], created_at: Date.now() });
  writeStore(STORE_PROMOS, promos);
  document.getElementById('promo-code-input').value = '';
  document.getElementById('promo-amount-input').value = '';
  showToast('Promo created: ' + code); loadAdminPromos();
}
function deletePromo(code) {
  if (!confirm('Delete promo ' + code + '?')) return;
  const promos = readStore(STORE_PROMOS, []).filter(function(p) { return p.code !== code; });
  writeStore(STORE_PROMOS, promos); loadAdminPromos(); showToast('Deleted');
}

// Admin wallet
function renderAdminWallet() {
  const container = document.getElementById('wallet-content');
  const users = readStore(STORE_USERS, []); const parts = readStore(STORE_PARTICIPATIONS, []); const surveys = readStore(STORE_SURVEYS, []); const withdrawals = readStore(STORE_WITHDRAWALS, []);
  const realUsers = users.filter(function(u) { return u.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase(); });
  const completedW = withdrawals.filter(function(w) { return w.status === 'completed'; });
  const pendingW = withdrawals.filter(function(w) { return w.status === 'pending' || w.status === 'processing'; });
  const paidOut = completedW.reduce(function(s, w) { return s + w.amount; }, 0);
  const pendingPayout = pendingW.reduce(function(s, w) { return s + w.amount; }, 0);

  const userItems = realUsers.map(function(u) {
    const uparts = parts.filter(function(p) { return p.user_id === u.id; });
    const balance = getUserBalance(u.id);
    const userWithdrawn = withdrawals.filter(function(w) { return w.user_id === u.id; });
    const userPaid = userWithdrawn.filter(function(w) { return w.status === 'completed'; }).reduce(function(s, w) { return s + w.amount; }, 0);
    const userPending = userWithdrawn.filter(function(w) { return w.status === 'pending' || w.status === 'processing'; }).reduce(function(s, w) { return s + w.amount; }, 0);
    return { user: u, balance: balance, userPaid: userPaid, userPending: userPending, surveys: uparts.length };
  }).sort(function(a, b) { return b.balance.available - a.balance.available; });

  const statsHTML = '<div class="admin-user-stats"><div class="admin-stat-tile"><span class="val">' + realUsers.length + '</span><span class="lbl">Total Users</span></div><div class="admin-stat-tile"><span class="val">KSh ' + paidOut.toLocaleString() + '</span><span class="lbl">Total Paid Out</span></div><div class="admin-stat-tile"><span class="val">KSh ' + pendingPayout.toLocaleString() + '</span><span class="lbl">Pending Payout</span></div><div class="admin-stat-tile"><span class="val">' + parts.length + '</span><span class="lbl">Participations</span></div></div>';

  const pendingSection = pendingW.length > 0 ? '<div class="admin-wallet-section"><h3>⏳ Pending Withdrawals <span class="badge-count">' + pendingW.length + '</span></h3><div class="user-list">' + pendingW.map(function(w) {
    const u = users.find(function(x) { return x.id === w.user_id; });
    return '<div class="user-item"><div class="user-info"><strong>@' + escapeHtml(u ? (u.username || '') : '') + ' — KSh ' + w.amount + '</strong><small>' + escapeHtml(u ? u.email : '') + ' &bull; M-Pesa: ' + escapeHtml(w.phone) + '</small><small style="color:var(--amber);">' + w.status + ' &bull; ' + new Date(w.created_at).toLocaleDateString() + '</small></div><div class="user-stats"><div class="user-stat"><span class="user-stat-val">' + w.amount + '</span><span class="user-stat-lbl">Amount</span></div></div></div>';
  }).join('') + '</div></div>' : '';

  const paidSection = completedW.length > 0 ? '<div class="admin-wallet-section"><h3>✅ Completed Withdrawals <span class="badge-count">' + completedW.length + '</span></h3><div class="user-list">' + completedW.slice(0, 10).map(function(w) {
    const u = users.find(function(x) { return x.id === w.user_id; });
    return '<div class="user-item"><div class="user-info"><strong>@' + escapeHtml(u ? (u.username || '') : '') + ' — KSh ' + w.amount + '</strong><small>' + escapeHtml(u ? u.email : '') + ' &bull; M-Pesa: ' + escapeHtml(w.phone) + '</small><small style="color:var(--green);">Completed ' + new Date(w.updated_at).toLocaleDateString() + '</small></div></div>';
  }).join('') + '</div></div>' : '';

  const usersHTML = userItems.length === 0 ? '<div class="state-box"><strong>No users yet</strong></div>' : '<div class="user-list">' + userItems.map(function(item) {
    const u = item.user;
    const initial = (u.name || u.email || '?').charAt(0).toUpperCase();
    const avHTML = u.avatar ? '<img src="' + escapeHtml(u.avatar) + '">' : escapeHtml(initial);
    return '<div class="user-item" style="cursor:pointer;" onclick="viewAdminUser(\'' + u.id + '\')"><div class="user-avatar">' + avHTML + '</div><div class="user-info"><strong>' + escapeHtml(u.name || 'User') + '</strong><small>@' + escapeHtml(u.username || '') + ' &bull; ' + escapeHtml(u.email) + '</small><small>' + PLANS[u.tier || 'basic'].label + '</small></div><div class="user-stat-split"><div><span class="label">Paid</span><span class="val">KSh ' + item.userPaid + '</span></div><div><span class="label">Pending</span><span class="val pending">KSh ' + item.userPending + '</span></div></div></div>';
  }).join('') + '</div>';

  container.innerHTML = '<div class="wallet-header"><h2>Users Overview</h2><p>Platform stats and user financials</p></div>' + statsHTML + pendingSection + paidSection + '<div class="admin-wallet-section"><h3>👥 All Users</h3>' + usersHTML + '</div>';
}

// ---------- Auth ----------
function openAuth(mode) { document.getElementById('auth-overlay').classList.add('open'); switchAuthMode(mode); clearAuthNotices(); }
function closeAuth() { document.getElementById('auth-overlay').classList.remove('open'); }
function handleOverlayClick(e) { if (e.target.id === 'auth-overlay') closeAuth(); }
function switchAuthMode(mode) { clearAuthNotices(); const si = document.getElementById('form-signin'); const su = document.getElementById('form-signup'); if (mode === 'signin') { si.classList.remove('hidden'); su.classList.add('hidden'); } else { si.classList.add('hidden'); su.classList.remove('hidden'); } }
function showNotice(msg, t) { const n = document.getElementById('auth-notice'); n.className = 'notice show ' + t; n.textContent = msg; }
function clearAuthNotices() { const n = document.getElementById('auth-notice'); n.className = 'notice'; n.textContent = ''; }
function findUserByEmailOrUsername(input) {
  const lower = input.toLowerCase();
  return readStore(STORE_USERS, []).find(function(u) { return u.email.toLowerCase() === lower || (u.username || '').toLowerCase() === lower; });
}
async function submitSignIn(e) {
  e.preventDefault();
  const id = document.getElementById('signin-email').value.trim(); const pw = document.getElementById('signin-password').value;
  const btn = document.getElementById('signin-submit-btn'); btn.disabled = true; clearAuthNotices();
  try {
    if (!id || !pw) throw new Error('Enter credentials');
    const user = findUserByEmailOrUsername(id);
    if (!user) throw new Error('No account found');
    const hash = await hashPassword(pw);
    if (user.passwordHash !== hash) throw new Error('Wrong password');
    currentUser = { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], username: user.username || user.email.split('@')[0], avatar: user.avatar || null, tier: user.tier || 'basic', referralCode: user.referralCode || ensureReferralCode(user), referrals: user.referrals || [] };
    isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: user.id });
    // Track login
    const users = readStore(STORE_USERS, []); const idx = users.findIndex(function(u) { return u.id === user.id; });
    if (idx !== -1) { users[idx].logins = users[idx].logins || []; users[idx].logins.push({ time: Date.now(), ua: navigator.userAgent }); if (users[idx].logins.length > 20) users[idx].logins = users[idx].logins.slice(-20); writeStore(STORE_USERS, users); }
    ensureDailyReset(); updateAuthUI(); closeAuth();
    showToast('Welcome back, @' + currentUser.username + '!');
    fetchAndRenderSurveys(); checkStreak(); checkAchievements();
    if (currentView === 'profile') renderProfile();
    if (currentView === 'wallet') renderWallet();
    updateNotifBadges();
  } catch (err) { showNotice(err.message, 'error'); }
  finally { btn.disabled = false; }
}
async function submitSignUp(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const username = document.getElementById('signup-username').value.trim().toLowerCase();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const pw = document.getElementById('signup-password').value;
  const refCode = document.getElementById('signup-referral').value.trim().toUpperCase();
  const rules = document.getElementById('signup-rules').checked;
  const btn = document.getElementById('signup-submit-btn'); btn.disabled = true; clearAuthNotices();
  try {
    if (!name || name.length < 2) throw new Error('Enter your official name');
    if (!username || username.length < 3 || username.length > 20) throw new Error('Username 3-20 chars');
    if (!/^[a-z0-9_]+$/.test(username)) throw new Error('Username: lowercase letters, numbers, underscore only');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email required');
    if (!pw || pw.length < 6) throw new Error('Password 6+ chars');
    if (!rules) throw new Error('You must agree to Terms and Privacy');
    const users = readStore(STORE_USERS, []);
    if (users.some(function(u) { return u.email.toLowerCase() === email; })) throw new Error('Email already registered');
    if (users.some(function(u) { return (u.username || '').toLowerCase() === username; })) throw new Error('Username taken');
    let referrer = null;
    if (refCode) { referrer = users.find(function(u) { return (u.referralCode || '').toUpperCase() === refCode; }); if (!referrer) throw new Error('Invalid referral code'); }
    const hash = await hashPassword(pw);
    const nu = { id: uid('user'), name: name, username: username, email: email, passwordHash: hash, avatar: null, tier: 'basic', referralCode: null, referrals: [], bonuses: [], achievements: [], logins: [{ time: Date.now(), ua: navigator.userAgent }], referred_by: referrer ? referrer.referralCode : null, daily: { date: todayStr(), surveyCount: 0, totalRewards: 0 }, notifications_read_at: Date.now(), created_at: Date.now(), agreedToRules: true };
    nu.referralCode = generateReferralCode(nu.id);
    users.push(nu); writeStore(STORE_USERS, users);
    if (referrer) { const idx = users.findIndex(function(u) { return u.id === referrer.id; }); if (idx !== -1) { users[idx].referrals = users[idx].referrals || []; users[idx].referrals.push(nu.id); writeStore(STORE_USERS, users); } }
    localStorage.removeItem(STORE_PENDING_REF);
    currentUser = { id: nu.id, email: nu.email, name: nu.name, username: nu.username, avatar: null, tier: 'basic', referralCode: nu.referralCode, referrals: [] };
    isAdmin = nu.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: nu.id });
    updateAuthUI(); closeAuth();
    showToast('Welcome @' + username + '!');
    fetchAndRenderSurveys(); checkStreak(); checkAchievements(); updateNotifBadges();
    if (currentView === 'profile') renderProfile();
    if (currentView === 'wallet') renderWallet();
  } catch (err) { showNotice(err.message, 'error'); }
  finally { btn.disabled = false; }
}
async function submitPasswordReset() { showNotice('Local-only mode: password reset not available. Remember your password.', 'info'); }
async function signOut() {
  writeStore(STORE_SESSION, null); currentUser = null; isAdmin = false;
  updateAuthUI();
  if (currentView === 'profile') renderProfile();
  else if (currentView === 'wallet') renderWallet();
  else if (currentView === 'notifications') renderNotifications();
  else if (currentView === 'settings') renderSettings();
  else navigate('home');
  updateNotifBadges(); showToast('Signed out');
}
function updateAuthUI() {
  const g = document.getElementById('auth-guest-actions'); const u = document.getElementById('auth-user-actions'); const gr = document.getElementById('user-greeting'); const al = document.getElementById('nav-admin-link');
  if (currentUser) { g.classList.add('hidden'); g.style.display = 'none'; u.classList.remove('hidden'); u.style.display = 'flex'; gr.textContent = 'Hi, @' + (currentUser.username || currentUser.name || ''); if (isAdmin) al.classList.remove('hidden'); else al.classList.add('hidden'); }
  else { u.classList.add('hidden'); u.style.display = 'none'; g.classList.remove('hidden'); g.style.display = 'flex'; al.classList.add('hidden'); }
}

// ---------- Keyboard shortcuts ----------
document.addEventListener('keydown', function(e) {
  if (!wizard.active) return;
  const q = wizard.survey.questions[wizard.currentIndex];
  if (!q) return;
  if (q.type === 'mcq') {
    if (e.key >= '1' && e.key <= '9') { const idx = parseInt(e.key) - 1; const btns = document.querySelectorAll('.wizard-option-btn'); if (btns[idx] && !wizard.locked) btns[idx].click(); }
    const letters = 'abcdefghij'; const li = letters.indexOf(e.key.toLowerCase());
    if (li !== -1 && li < (q.options || []).length) { const btns = document.querySelectorAll('.wizard-option-btn'); if (btns[li] && !wizard.locked) btns[li].click(); }
  }
  if (e.key === 'Enter' && !e.shiftKey) { const btn = document.getElementById('wizard-next-btn'); if (btn && !btn.disabled) { e.preventDefault(); btn.click(); } }
  if (e.key === 'ArrowLeft') { const prev = document.querySelector('.wizard-prev-btn'); if (prev && !prev.disabled) prev.click(); }
});

function escapeHtml(str) { if (!str) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(function() { t.classList.remove('show'); }, 3500); }
