// ================================================================
// SurveyKE — 3-tab admin + question wizard + admin profile fix
// ================================================================

const STORE_USERS          = 'surveyke_users';
const STORE_SESSION        = 'surveyke_session';
const STORE_SURVEYS        = 'surveyke_surveys';
const STORE_PARTICIPATIONS = 'surveyke_participations';
const STORE_RESPONSES      = 'surveyke_responses';
const STORE_THEME          = 'surveyke_theme';
const STORE_NOTIFICATIONS  = 'surveyke_notifications';
const STORE_PENDING_REF    = 'surveyke_pending_ref';

const ADMIN_EMAIL = 'mautinyagah@gmail.com';
const DEMO_URL = 'https://docs.google.com/forms/';

const PLANS = {
  basic:    { key: 'basic',    label: 'Basic',    price: 0,   rank: 0, dailyEarningsCap: 50,  dailySurveyLimit: 3,  withdrawalMin: 2500, icon: 'i-star' },
  silver:   { key: 'silver',   label: 'Silver',   price: 100, rank: 1, dailyEarningsCap: 100, dailySurveyLimit: 5,  withdrawalMin: 1500, icon: 'i-star' },
  gold:     { key: 'gold',     label: 'Gold',     price: 300, rank: 2, dailyEarningsCap: 200, dailySurveyLimit: 8,  withdrawalMin: 1000, icon: 'i-star' },
  platinum: { key: 'platinum', label: 'Platinum', price: 500, rank: 3, dailyEarningsCap: 300, dailySurveyLimit: 10, withdrawalMin: 500,  icon: 'i-crown' }
};

// Reading time per question type (seconds)
const QUESTION_READ_TIME = { mcq: 5, rating: 3, text: 8, paragraph: 12 };

const ANIME_SEEDS = ['Akira', 'Yuki', 'Hana', 'Kai', 'Rin', 'Mei', 'Sora', 'Aoi', 'Ren', 'Nao', 'Hikari', 'Yui'];
const ANIME_URLS = ANIME_SEEDS.map(function(s) { return 'https://api.dicebear.com/9.x/lorelei/svg?seed=' + s; });

let currentUser = null;
let isAdmin = false;
let surveysCache = [];
let selectedDirectoryTopic = 'All';
let currentView = 'home';
let editingAvatar = null;
let editingName = '';
let selectedPlan = null;
let adminSurveyType = 'external';
let adminQuestions = [];
let adminParticipationTab = 'pending';
let adminSection = 'add';

// Wizard
let wizard = {
  active: false,
  survey: null,
  answers: {},
  currentIndex: 0,
  timerInterval: null,
  timeLeft: 0
};

// ---------- Storage ----------
function readStore(key, fallback) {
  try { const raw = localStorage.getItem(key); if (raw === null) return fallback; return JSON.parse(raw); }
  catch (e) { return fallback; }
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

// ---------- Referral ----------
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
  if (navigator.clipboard) { navigator.clipboard.writeText(link).then(function() { showToast('Referral link copied!'); }).catch(function() { fallbackCopy(link); showToast('Referral link copied!'); }); }
  else { fallbackCopy(link); showToast('Referral link copied!'); }
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
  if (navigator.share) { navigator.share({ title: 'SurveyKE', text: text, url: link }).catch(function() {}); }
  else { fallbackCopy(link); showToast('Link copied to share.'); }
}

// ---------- Notifications ----------
function getUnreadNotificationsCount() {
  if (!currentUser || isAdmin) return 0;
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === currentUser.id; });
  if (!user) return 0;
  const readAt = user.notifications_read_at || 0;
  const parts = readStore(STORE_PARTICIPATIONS, []);
  return parts.filter(function(p) {
    if (p.user_id !== currentUser.id) return false;
    if (p.review_status !== 'approved' && p.review_status !== 'rejected') return false;
    return (p.reviewed_at || 0) > readAt;
  }).length;
}
function markNotificationsRead() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  users[idx].notifications_read_at = Date.now();
  writeStore(STORE_USERS, users);
}
function getRecentReviews(limit) {
  if (!currentUser) return [];
  limit = limit || 5;
  const allSurveys = readStore(STORE_SURVEYS, []);
  const parts = readStore(STORE_PARTICIPATIONS, []);
  return parts
    .filter(function(p) { return p.user_id === currentUser.id && (p.review_status === 'approved' || p.review_status === 'rejected'); })
    .sort(function(a, b) { return (b.reviewed_at || 0) - (a.reviewed_at || 0); })
    .slice(0, limit)
    .map(function(p) {
      const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
      return { id: p.id, title: s ? s.title : 'Deleted survey', status: p.review_status, reward: s ? (s.reward || 0) : 0, reviewedAt: p.reviewed_at };
    });
}

// ---------- Daily tracking ----------
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getDailyRecord(user) {
  const today = todayStr();
  if (!user.daily || user.daily.date !== today) user.daily = { date: today, surveyCount: 0, totalRewards: 0 };
  return user.daily;
}
function ensureDailyReset() {
  if (!currentUser) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) return;
  const daily = getDailyRecord(users[idx]);
  users[idx].daily = daily;
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

// ---------- Participation lookup ----------
function getParticipationForSurvey(surveyId) {
  if (!currentUser) return null;
  const parts = readStore(STORE_PARTICIPATIONS, []);
  return parts.find(function(p) { return p.survey_id === surveyId && p.user_id === currentUser.id; });
}

function getSurveyUserState(survey) {
  if (!currentUser || isAdmin) return 'guest';
  const part = getParticipationForSurvey(survey.id);
  if (!part) return 'available';
  const status = part.status || '';
  if (status === 'in_progress') return 'in_progress';
  if (status === 'started') return 'started_external';
  if (status === 'submitted' || part.review_status === 'approved' || part.review_status === 'rejected' || part.review_status === 'reviewed') return 'completed';
  return 'available';
}

function canStartSurvey(survey) {
  if (isAdmin) return { allowed: false, reason: 'Administrators cannot participate in surveys.' };
  if (!currentUser) return { allowed: true };
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === currentUser.id; });
  if (!user) return { allowed: false, reason: 'Please sign in again.' };
  const plan = PLANS[user.tier || 'basic'];
  const daily = getDailyRecord(user);
  const reward = survey.reward || 0;
  if (daily.surveyCount >= plan.dailySurveyLimit) return { allowed: false, reason: "You've reached your daily limit of " + plan.dailySurveyLimit + ' surveys. Come back tomorrow or upgrade your plan.' };
  if (daily.totalRewards + reward > plan.dailyEarningsCap) return { allowed: false, reason: 'This survey would exceed your daily earnings cap of KSh ' + plan.dailyEarningsCap + '. Come back tomorrow or upgrade.' };
  return { allowed: true };
}

// ---------- Migration ----------
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
      if (!u.daily || u.daily.date !== todayStr()) { u.daily = { date: todayStr(), surveyCount: 0, totalRewards: 0 }; changed = true; }
    });
    if (changed) writeStore(STORE_USERS, users);
  }
  if (!Array.isArray(readStore(STORE_RESPONSES, null))) writeStore(STORE_RESPONSES, []);
}

function seedSurveysIfEmpty() {
  const existing = readStore(STORE_SURVEYS, null);
  if (Array.isArray(existing) && existing.length > 0) return;
  const now = Date.now();
  writeStore(STORE_SURVEYS, [
    { id: uid('sur'), title: 'Digital ID Public Feedback', category: 'Public Policy', description: 'Share your views on the proposed national digital identity system and how it may impact everyday Kenyans.', estimated_minutes: 5, duration: '5 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Kenyan residents aged 18+.', instructions: 'Answer all questions honestly.', tier: 'basic', reward: 15, created_at: now - 500000 },
    { id: uid('sur'), title: 'Public Transport Satisfaction', category: 'Transport', description: 'Quick feedback on your recent public transport experience in Kenya.', estimated_minutes: 4, duration: '4 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Commuters.', instructions: 'Focus on your last journey.', tier: 'basic', reward: 20, created_at: now - 400000 },
    { id: uid('sur'), title: 'Mobile Money Usage Study', category: 'Finance', description: 'Help us understand how Kenyans use mobile money platforms for daily transactions.', estimated_minutes: 7, duration: '7 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Anyone who has used mobile money.', instructions: 'Respond based on your most recent month.', tier: 'silver', reward: 30, created_at: now - 300000 },
    { id: uid('sur'), title: 'Consumer Brand Preferences', category: 'Consumer Goods', description: 'Tell us which brands you trust and why for everyday products.', estimated_minutes: 8, duration: '8 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Shoppers aged 18+.', instructions: 'Answer honestly.', tier: 'gold', reward: 55, created_at: now - 200000 },
    { id: uid('sur'), title: 'Health Services Experience', category: 'Health', description: 'Premium study on your healthcare experience at Kenyan clinics and hospitals.', estimated_minutes: 10, duration: '10 mins', status: 'published', type: 'external', survey_url: DEMO_URL, eligibility: 'Adults who visited a clinic in the last year.', instructions: 'Be candid — responses are anonymous.', tier: 'platinum', reward: 100, created_at: now - 100000 }
  ]);
}

function restoreSession() {
  const session = readStore(STORE_SESSION, null);
  if (session && session.userId) {
    const users = readStore(STORE_USERS, []);
    const user = users.find(function(u) { return u.id === session.userId; });
    if (user) {
      currentUser = { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], avatar: user.avatar || null, tier: user.tier || 'basic', referralCode: user.referralCode || ensureReferralCode(user), referrals: user.referrals || [] };
      isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    } else { writeStore(STORE_SESSION, null); }
  }
  updateAuthUI();
}

document.addEventListener('DOMContentLoaded', function() {
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
  refreshNavBadges();
});

// ---------- Navigation ----------
function clearWizardTimer() {
  if (wizard.timerInterval) { clearInterval(wizard.timerInterval); wizard.timerInterval = null; }
}
function exitWizard() {
  clearWizardTimer();
  wizard.active = false;
  navigate('surveys');
}
function navigate(viewName, param) {
  clearWizardTimer();
  currentView = viewName;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  ['view-home','view-surveys','view-detail','view-take-survey','view-wallet','view-profile','view-settings','view-admin'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  if (viewName === 'home') { document.getElementById('view-home').classList.remove('hidden'); updateBottomNav('home'); }
  else if (viewName === 'surveys') { document.getElementById('view-surveys').classList.remove('hidden'); renderSurveysPlanBanner(); renderDirectorySurveys(); updateBottomNav('surveys'); }
  else if (viewName === 'detail' && param) { document.getElementById('view-detail').classList.remove('hidden'); renderSurveyDetail(param); updateBottomNav('surveys'); }
  else if (viewName === 'take-survey' && param) { document.getElementById('view-take-survey').classList.remove('hidden'); startOrResumeWizard(param); updateBottomNav('surveys'); }
  else if (viewName === 'wallet') { document.getElementById('view-wallet').classList.remove('hidden'); renderWallet(); updateBottomNav('wallet'); }
  else if (viewName === 'profile') { document.getElementById('view-profile').classList.remove('hidden'); renderProfile(); updateBottomNav('profile'); }
  else if (viewName === 'settings') { document.getElementById('view-settings').classList.remove('hidden'); renderSettings(); updateBottomNav('profile'); }
  else if (viewName === 'admin') {
    if (!isAdmin) { showToast('Administrator access required.'); navigate('home'); return; }
    document.getElementById('view-admin').classList.remove('hidden');
    renderAdminDashboard(); updateBottomNav(null);
  }
}
function getCurrentTab() {
  if (currentView === 'home') return 'home';
  if (currentView === 'surveys' || currentView === 'detail' || currentView === 'take-survey') return 'surveys';
  if (currentView === 'wallet') return 'wallet';
  if (currentView === 'profile' || currentView === 'settings') return 'profile';
  return null;
}
function refreshNavBadges() { updateBottomNav(getCurrentTab()); }
function updateBottomNav(tab) {
  document.querySelectorAll('.bottom-nav-item').forEach(function(item) {
    if (item.dataset.tab === tab) item.classList.add('active');
    else item.classList.remove('active');
    if (item.dataset.tab === 'profile') {
      const count = getUnreadNotificationsCount();
      let badge = item.querySelector('.nav-badge');
      if (count > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; item.appendChild(badge); }
        badge.textContent = count > 9 ? '9+' : String(count);
      } else if (badge) { badge.remove(); }
    }
  });
}

// ---------- Tier helpers ----------
function getUserTier() { return currentUser ? (currentUser.tier || 'basic') : 'basic'; }
function canAccessSurvey(surveyTier) {
  if (!currentUser) return true;
  return PLANS[getUserTier()].rank >= PLANS[surveyTier || 'basic'].rank;
}
function tierBadgeHTML(tier) {
  tier = tier || 'basic';
  if (!PLANS[tier]) tier = 'basic';
  return '<span class="tier-badge tier-' + tier + '"><svg><use href="#' + PLANS[tier].icon + '"/></svg>' + PLANS[tier].label + '</span>';
}

// ---------- Surveys plan banner ----------
function renderSurveysPlanBanner() {
  const el = document.getElementById('surveys-plan-banner');
  if (!el) return;
  if (isAdmin) {
    el.innerHTML = '<div class="surveys-plan-banner"><div class="surveys-plan-left"><div><strong>Admin view</strong><small>You can browse and manage surveys but cannot participate.</small></div></div><button class="btn btn-outline btn-sm" onclick="navigate(\'admin\')">Admin Dashboard</button></div>';
    return;
  }
  if (!currentUser) {
    el.innerHTML = '<div class="surveys-plan-banner"><div class="surveys-plan-left"><div><strong>You are browsing as a guest</strong><small>Sign in to see your plan, daily limits, and access all surveys.</small></div></div><button class="btn btn-primary btn-sm" onclick="openAuth(\'signin\')">Sign In</button></div>';
    return;
  }
  const tier = getUserTier();
  const plan = PLANS[tier];
  el.innerHTML = '<div class="surveys-plan-banner"><div class="surveys-plan-left"><div><strong>Your plan: ' + plan.label + '</strong><small>Up to KSh ' + plan.dailyEarningsCap + '/day &bull; ' + plan.dailySurveyLimit + ' surveys/day &bull; Withdraw at KSh ' + plan.withdrawalMin.toLocaleString() + '</small></div></div><button class="btn btn-outline btn-sm" onclick="openPlanModal()"><svg style="width:14px;height:14px;"><use href="#i-crown"/></svg>Change Plan</button></div>';
}

// ---------- Surveys ----------
function fetchAndRenderSurveys() {
  try {
    const all = readStore(STORE_SURVEYS, []);
    surveysCache = (all || []).filter(function(s) {
      if (s.status !== 'published') return false;
      if (s.type === 'external' && (!s.survey_url || !s.survey_url.startsWith('https://'))) return false;
      if (s.type === 'external' && s.survey_url.indexOf('example.com') !== -1) return false;
      if (s.type === 'external' && s.survey_url.indexOf('placeholder') !== -1) return false;
      return true;
    }).sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    renderHomeSurveys();
    renderDirectorySurveys();
    renderSurveysPlanBanner();
  } catch (e) {
    console.error(e);
    surveysCache = [];
    renderHomeSurveys();
    renderDirectorySurveys();
  }
}

function surveyCardHTML(s) {
  const tier = s.tier || 'basic';
  const state = getSurveyUserState(s);
  const locked = !isAdmin && currentUser && !canAccessSurvey(tier);
  let linkClass = 'card-link';
  let linkLabel = 'Participate &rarr;';
  if (isAdmin) linkLabel = 'View &rarr;';
  else if (state === 'completed') { linkLabel = 'Completed ✓'; linkClass = 'card-link'; }
  else if (state === 'in_progress') { linkLabel = 'Continue &rarr;'; linkClass = 'card-link'; }
  else if (state === 'started_external') { linkLabel = 'Reopen &rarr;'; linkClass = 'card-link'; }
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
  if (selectedDirectoryTopic !== 'All') list = surveysCache.filter(function(s) { return s.category === selectedDirectoryTopic; });
  if (list.length === 0) { container.innerHTML = '<div class="state-box" style="grid-column:1/-1;"><strong>No surveys found in this category</strong><p>New studies will appear here once published.</p></div>'; return; }
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
  if (!survey) { container.innerHTML = '<div class="state-box"><strong>Survey not found</strong><p>This survey may have closed.</p><button class="btn btn-primary btn-sm" onclick="navigate(\'surveys\')" style="margin-top:12px;">Back</button></div>'; return; }
  const isDemo = survey.survey_url === DEMO_URL && survey.type === 'external';
  const demoNotice = isDemo ? '<div class="notice show info" style="margin-bottom:12px;"><strong>Demo survey:</strong> Placeholder link — admin should add a real one.</div>' : '';
  const elig = survey.eligibility ? '<div class="detail-section"><h3>Eligibility</h3><p class="detail-text">' + escapeHtml(survey.eligibility) + '</p></div>' : '';
  const inst = survey.instructions ? '<div class="detail-section"><h3>Instructions</h3><p class="detail-text">' + escapeHtml(survey.instructions) + '</p></div>' : '';
  const tier = survey.tier || 'basic';
  const isInternal = survey.type === 'internal';
  const qCount = isInternal && Array.isArray(survey.questions) ? survey.questions.length : 0;
  const state = getSurveyUserState(survey);

  let participateHTML;
  if (isAdmin) {
    participateHTML = '<div class="admin-notice"><strong>Admin view</strong><p>Administrators cannot participate in surveys. This view is for management only.</p><button class="btn btn-primary" onclick="navigate(\'admin\')">Manage Surveys</button></div>';
  } else if (!currentUser) {
    participateHTML = '<div class="participate-box"><h3>Take the Survey</h3><p>Sign in to participate. New accounts get the free Basic plan.</p><div class="btn-row"><button class="btn btn-primary" onclick="openAuth(\'signin\')">Sign In</button><button class="btn btn-outline" onclick="openAuth(\'signup\')">Create Account</button></div></div>';
  } else if (!canAccessSurvey(tier)) {
    const neededPlan = PLANS[tier];
    participateHTML = '<div class="upgrade-notice"><h3>' + neededPlan.label + ' plan required</h3><p>This survey is on the ' + neededPlan.label + ' plan. Upgrade to access it.</p><button class="btn btn-primary" onclick="openPlanModal()">View Plans</button></div>';
  } else if (state === 'completed') {
    participateHTML = '<div class="participate-box" style="border-color:var(--green);background:var(--green-soft);"><h3 style="display:flex;align-items:center;gap:8px;"><svg style="width:20px;height:20px;color:var(--green);"><use href="#i-check-circle"/></svg>Survey Completed</h3><p>You have already completed this survey. Thank you for your participation! You cannot retake this survey.</p></div>';
  } else if (state === 'in_progress') {
    participateHTML = '<div class="participate-box"><h3>Continue Your Survey</h3><p>You started this survey but haven\'t finished it. Pick up where you left off.</p>' + demoNotice + '<div class="btn-row"><button class="btn btn-primary" onclick="navigate(\'take-survey\', \'' + survey.id + '\')">Continue Survey <svg><use href="#i-arrow"/></svg></button></div></div>';
  } else if (state === 'started_external') {
    participateHTML = '<div class="participate-box"><h3>Survey In Progress</h3><p>You previously opened this survey. Click below to reopen it. You can only participate once.</p>' + demoNotice + '<div class="btn-row"><button class="btn btn-primary" onclick="reopenExternal(\'' + survey.id + '\')">Reopen Survey <svg><use href="#i-external"/></svg></button></div></div>';
  } else {
    const dailyCheck = canStartSurvey(survey);
    if (!dailyCheck.allowed) {
      participateHTML = '<div class="participate-box" style="border-color: var(--danger); background: var(--danger-bg);"><h3 style="color: var(--danger);">Not available</h3><p>' + escapeHtml(dailyCheck.reason) + '</p><div class="btn-row"><button class="btn btn-outline" onclick="openPlanModal()">Upgrade Plan</button></div></div>';
    } else {
      const btnLabel = isInternal ? 'Start Survey' : 'Proceed to External Survey';
      const btnIcon = isInternal ? '#i-arrow' : '#i-external';
      const typeLine = isInternal ? 'This survey has ' + qCount + ' question' + (qCount === 1 ? '' : 's') + '. Each question has a short timer to ensure thoughtful answers.' : 'This survey is hosted on a trusted external platform. You can only participate once.';
      participateHTML = '<div class="participate-box"><h3>Take the Survey</h3><p>' + typeLine + '</p>' + demoNotice + '<div class="btn-row"><button class="btn btn-primary" onclick="startSurvey(\'' + survey.id + '\')">' + btnLabel + ' <svg><use href="' + btnIcon + '"/></svg></button></div></div>';
    }
  }

  const typeBadge = isInternal ? '<span class="cat-chip" style="background:var(--tier-platinum-bg);color:var(--tier-platinum);">In-App</span>' : '';

  container.innerHTML = '<div class="detail-card"><div class="card-top" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;"><span class="cat-chip">' + escapeHtml(survey.category || 'General') + '</span>' + typeBadge + tierBadgeHTML(tier) + '</div>' +
    '<h1>' + escapeHtml(survey.title) + '</h1>' +
    '<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;"><span class="meta-chip"><svg><use href="#i-clock"/></svg> Est. ' + escapeHtml(survey.estimated_minutes || survey.duration || '5') + ' mins</span><span class="meta-chip"><svg><use href="#i-wallet"/></svg> KSh ' + (survey.reward || 20) + ' reward</span>' + (isInternal ? '<span class="meta-chip"><svg><use href="#i-book"/></svg> ' + qCount + ' questions</span>' : '') + '</div>' +
    '<p class="detail-text">' + escapeHtml(survey.description || '') + '</p>' + elig + inst + participateHTML + '</div>';
}

function startSurvey(surveyId) {
  if (isAdmin) { showToast('Administrators cannot participate in surveys.'); return; }
  if (!currentUser) { showToast('Please sign in to participate.'); openAuth('signin'); return; }
  const allSurveys = readStore(STORE_SURVEYS, []);
  const survey = allSurveys.find(function(s) { return s.id === surveyId; });
  if (!survey) { showToast('Survey not found.'); return; }
  if (!canAccessSurvey(survey.tier || 'basic')) { showToast('Upgrade your plan to access this survey.'); return; }
  const existing = getParticipationForSurvey(surveyId);
  if (existing) {
    if (existing.status === 'in_progress') { navigate('take-survey', surveyId); return; }
    if (existing.status === 'started') { reopenExternal(surveyId); return; }
    showToast('You have already completed this survey.'); return;
  }
  if (survey.type === 'internal') {
    const dailyCheck = canStartSurvey(survey);
    if (!dailyCheck.allowed) { showToast(dailyCheck.reason); return; }
    navigate('take-survey', surveyId);
  } else {
    startExternalSurvey(surveyId);
  }
}

function reopenExternal(surveyId) {
  const surveys = readStore(STORE_SURVEYS, []);
  const survey = surveys.find(function(s) { return s.id === surveyId; });
  if (!survey || !survey.survey_url || !survey.survey_url.startsWith('https://')) { showToast('Invalid survey.'); return; }
  showToast('Reopening external survey...');
  window.open(survey.survey_url, '_blank', 'noopener,noreferrer');
}

function startExternalSurvey(surveyId) {
  if (isAdmin) { showToast('Administrators cannot participate.'); return; }
  if (!currentUser) { showToast('Please sign in.'); openAuth('signin'); return; }
  const allSurveys = readStore(STORE_SURVEYS, []);
  const survey = allSurveys.find(function(s) { return s.id === surveyId; });
  if (!survey || !survey.survey_url || !survey.survey_url.startsWith('https://')) { showToast('Invalid survey.'); return; }
  if (getParticipationForSurvey(surveyId)) { showToast('You already started this survey.'); return; }
  const dailyCheck = canStartSurvey(survey);
  if (!dailyCheck.allowed) { showToast(dailyCheck.reason); return; }
  try {
    const parts = readStore(STORE_PARTICIPATIONS, []);
    parts.push({ id: uid('part'), survey_id: surveyId, user_id: currentUser.id, status: 'started', review_status: 'pending', submitted_at: Date.now(), started_at: Date.now() });
    writeStore(STORE_PARTICIPATIONS, parts);
    recordSurveyStart(survey);
    showToast('Participation recorded. Opening survey...');
    setTimeout(function() { window.open(survey.survey_url, '_blank', 'noopener,noreferrer'); }, 700);
  } catch (e) { console.error(e); window.open(survey.survey_url, '_blank', 'noopener,noreferrer'); }
}

// ---------- Wizard ----------
function startOrResumeWizard(surveyId) {
  if (isAdmin) { showToast('Admins cannot participate.'); navigate('admin'); return; }
  if (!currentUser) { showToast('Please sign in.'); openAuth('signin'); navigate('surveys'); return; }
  const surveys = readStore(STORE_SURVEYS, []);
  const survey = surveys.find(function(s) { return s.id === surveyId; });
  if (!survey || survey.type !== 'internal') { showToast('Survey not available.'); navigate('surveys'); return; }
  if (!canAccessSurvey(survey.tier || 'basic')) { showToast('Upgrade your plan.'); navigate('surveys'); return; }

  const parts = readStore(STORE_PARTICIPATIONS, []);
  let part = parts.find(function(p) { return p.survey_id === surveyId && p.user_id === currentUser.id; });

  if (part && (part.status === 'submitted' || part.review_status === 'approved' || part.review_status === 'rejected' || part.review_status === 'reviewed')) {
    showToast('You have already completed this survey.'); navigate('detail', surveyId); return;
  }

  if (!part) {
    const dailyCheck = canStartSurvey(survey);
    if (!dailyCheck.allowed) { showToast(dailyCheck.reason); navigate('surveys'); return; }
    part = { id: uid('part'), survey_id: surveyId, user_id: currentUser.id, status: 'in_progress', review_status: 'in_progress', answers: {}, wizard_index: 0, started_at: Date.now(), updated_at: Date.now() };
    parts.push(part);
    writeStore(STORE_PARTICIPATIONS, parts);
    recordSurveyStart(survey);
  }

  wizard.active = true;
  wizard.survey = survey;
  wizard.answers = part.answers || {};
  wizard.currentIndex = Math.min(part.wizard_index || 0, (survey.questions || []).length - 1);
  if (wizard.currentIndex < 0) wizard.currentIndex = 0;

  renderWizard();
}

function renderWizard() {
  const container = document.getElementById('take-survey-content');
  const survey = wizard.survey;
  const questions = survey.questions || [];

  if (questions.length === 0) { container.innerHTML = '<div class="state-box"><strong>No questions available</strong></div>'; return; }

  const q = questions[wizard.currentIndex];
  const total = questions.length;
  const current = wizard.currentIndex + 1;
  const pct = (wizard.currentIndex / total) * 100;
  const isLast = wizard.currentIndex === total - 1;

  let answerInputs = '';
  const savedAnswer = wizard.answers[q.id] || '';

  if (q.type === 'mcq') {
    answerInputs = '<div class="wizard-options">' + (q.options || []).map(function(opt) {
      const checked = savedAnswer === opt ? ' checked' : '';
      const selected = savedAnswer === opt ? ' selected' : '';
      return '<label class="wizard-option' + selected + '"><input type="radio" name="wq" value="' + escapeHtml(opt) + '"' + checked + ' onchange="wizardSelectMCQ(this)"><span>' + escapeHtml(opt) + '</span></label>';
    }).join('') + '</div>';
  } else if (q.type === 'rating') {
    answerInputs = '<div class="wizard-rating">';
    for (let n = 1; n <= 5; n++) {
      answerInputs += '<button type="button" class="wizard-rating-btn ' + (String(savedAnswer) === String(n) ? 'selected' : '') + '" onclick="wizardSelectRating(' + n + ')">' + n + '</button>';
    }
    answerInputs += '</div>';
  } else if (q.type === 'text') {
    answerInputs = '<input type="text" class="wizard-text-input" id="wizard-text-input" placeholder="Type your answer..." value="' + escapeHtml(savedAnswer) + '">';
  } else if (q.type === 'paragraph') {
    answerInputs = '<textarea class="wizard-text-input" id="wizard-text-input" placeholder="Type your answer...">' + escapeHtml(savedAnswer) + '</textarea>';
  }

  const readTime = QUESTION_READ_TIME[q.type] || 5;

  container.innerHTML = '<div class="wizard-wrap">' +
    '<div class="wizard-progress">' +
      '<div class="wizard-progress-header"><strong>Question ' + current + ' of ' + total + '</strong><small>' + pct.toFixed(0) + '% complete</small></div>' +
      '<div class="wizard-progress-bar"><div class="wizard-progress-fill" style="width:' + pct + '%"></div></div>' +
    '</div>' +
    '<div class="wizard-card">' +
      '<div class="wizard-question">' +
        '<div class="wizard-q-num">Question ' + current + '</div>' +
        '<p class="wizard-q-text">' + escapeHtml(q.question) + (q.required ? '<span class="req">*</span>' : '') + '</p>' +
        answerInputs +
      '</div>' +
      '<div class="wizard-footer">' +
        '<div class="wizard-timer active" id="wizard-timer">⏱ ' + readTime + 's</div>' +
        '<div class="wizard-actions">' +
          '<button type="button" class="wizard-exit-btn" onclick="exitWizard()">Save &amp; Exit</button>' +
          '<button type="button" class="btn btn-primary" id="wizard-next-btn" disabled onclick="wizardNext()">' + (isLast ? 'Submit Answers ✓' : 'Continue →') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  startWizardTimer(readTime);
}

function startWizardTimer(seconds) {
  clearWizardTimer();
  let remaining = seconds;
  const btn = document.getElementById('wizard-next-btn');
  const timerEl = document.getElementById('wizard-timer');
  btn.disabled = true;
  if (timerEl) { timerEl.textContent = '⏱ ' + remaining + 's'; timerEl.className = 'wizard-timer active'; }
  wizard.timerInterval = setInterval(function() {
    remaining--;
    if (remaining <= 0) {
      clearWizardTimer();
      if (timerEl) { timerEl.textContent = '✓ Ready'; timerEl.className = 'wizard-timer ready'; }
      if (btn) btn.disabled = false;
    } else {
      if (timerEl) timerEl.textContent = '⏱ ' + remaining + 's';
    }
  }, 1000);
}

function wizardSelectMCQ(input) {
  document.querySelectorAll('.wizard-option').forEach(function(el) { el.classList.remove('selected'); });
  const label = input.closest('.wizard-option');
  if (label) label.classList.add('selected');
}
function wizardSelectRating(value) {
  wizard.answers[wizard.survey.questions[wizard.currentIndex].id] = value;
  document.querySelectorAll('.wizard-rating-btn').forEach(function(btn) {
    if (parseInt(btn.textContent, 10) === value) btn.classList.add('selected');
    else btn.classList.remove('selected');
  });
}
function wizardCollectAnswer(q) {
  if (q.type === 'mcq') {
    const checked = document.querySelector('input[name="wq"]:checked');
    return checked ? checked.value : '';
  }
  if (q.type === 'rating') {
    return wizard.answers[q.id] || '';
  }
  const input = document.getElementById('wizard-text-input');
  return input ? input.value.trim() : '';
}

function saveWizardProgress() {
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const idx = parts.findIndex(function(p) { return p.survey_id === wizard.survey.id && p.user_id === currentUser.id; });
  if (idx === -1) return;
  parts[idx].answers = wizard.answers;
  parts[idx].wizard_index = wizard.currentIndex;
  parts[idx].updated_at = Date.now();
  writeStore(STORE_PARTICIPATIONS, parts);
}

function wizardNext() {
  const survey = wizard.survey;
  const questions = survey.questions || [];
  const q = questions[wizard.currentIndex];

  const value = wizardCollectAnswer(q);
  if (q.required && (value === '' || value === null || value === undefined)) {
    showToast('Please answer this question before continuing.');
    return;
  }
  wizard.answers[q.id] = value;
  wizard.currentIndex++;

  if (wizard.currentIndex >= questions.length) {
    saveWizardProgress();
    wizardFinish();
  } else {
    saveWizardProgress();
    renderWizard();
  }
}

function wizardFinish() {
  clearWizardTimer();
  const survey = wizard.survey;

  // Save responses
  const responses = readStore(STORE_RESPONSES, []);
  const existingIdx = responses.findIndex(function(r) { return r.survey_id === survey.id && r.user_id === currentUser.id; });
  if (existingIdx !== -1) {
    responses[existingIdx].answers = wizard.answers;
    responses[existingIdx].submitted_at = Date.now();
  } else {
    responses.push({ id: uid('resp'), survey_id: survey.id, user_id: currentUser.id, answers: wizard.answers, submitted_at: Date.now() });
  }
  writeStore(STORE_RESPONSES, responses);

  // Update participation
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const idx = parts.findIndex(function(p) { return p.survey_id === survey.id && p.user_id === currentUser.id; });
  if (idx !== -1) {
    parts[idx].status = 'submitted';
    parts[idx].review_status = 'pending';
    parts[idx].submitted_at = Date.now();
    parts[idx].answers = wizard.answers;
    parts[idx].wizard_index = (survey.questions || []).length;
    writeStore(STORE_PARTICIPATIONS, parts);
  }

  wizard.active = false;

  const container = document.getElementById('take-survey-content');
  container.innerHTML = '<div class="wizard-wrap"><div class="wizard-card thank-you-card">' +
    '<div class="thank-you-icon"><svg><use href="#i-check-circle"/></svg></div>' +
    '<h2 style="font-family:Manrope,sans-serif;font-size:26px;letter-spacing:-.8px;margin:0 0 10px;color:var(--ink);">Thank you!</h2>' +
    '<p style="color:var(--muted-strong);font-size:14.5px;max-width:400px;margin:0 auto 22px;line-height:1.7;">Your response to <strong>' + escapeHtml(survey.title) + '</strong> has been submitted. The admin will review it shortly.</p>' +
    '<div class="btn-row" style="justify-content:center;"><button class="btn btn-primary" onclick="navigate(\'surveys\')">Browse More Surveys</button><button class="btn btn-outline" onclick="navigate(\'wallet\')">View Wallet</button></div></div></div>';
}

// ---------- Wallet ----------
function renderWallet() {
  if (isAdmin) { renderAdminWallet(); return; }
  const container = document.getElementById('wallet-content');
  if (!currentUser) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg><use href="#i-wallet"/></svg></div><h2>Sign in to view your wallet</h2><p>Track your earnings, daily limits, and withdrawals.</p><button class="btn btn-primary" onclick="openAuth(\'signin\')">Sign In</button></div>';
    return;
  }
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  const tier = stored.tier || 'basic';
  const plan = PLANS[tier];
  const threshold = plan.withdrawalMin;
  const parts = readStore(STORE_PARTICIPATIONS, []).filter(function(p) { return p.user_id === currentUser.id; });
  const allSurveys = readStore(STORE_SURVEYS, []);

  let approvedTotal = 0, pendingTotal = 0;
  const transactions = parts.map(function(p) {
    const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
    const reward = (s && s.reward) ? s.reward : 20;
    let amount = 0;
    let displayStatus = p.review_status || 'pending';
    if (displayStatus === 'reviewed' || displayStatus === 'in_progress') displayStatus = 'pending';
    if (displayStatus === 'approved') { amount = reward; approvedTotal += amount; }
    else if (displayStatus === 'pending') { amount = reward; pendingTotal += amount; }
    return { id: p.id, title: s ? s.title : 'Deleted survey', date: p.submitted_at || p.updated_at, amount: amount, status: displayStatus };
  }).sort(function(a, b) { return b.date - a.date; });

  const daily = getDailyStatus();
  const canWithdraw = approvedTotal >= threshold;
  const progress = Math.min(100, (approvedTotal / threshold) * 100);
  const remaining = Math.max(0, threshold - approvedTotal);
  const surveyPct = daily ? Math.min(100, (daily.surveyCount / daily.surveyLimit) * 100) : 0;
  const earningsPct = daily ? Math.min(100, (daily.totalRewards / daily.earningsCap) * 100) : 0;

  const withdrawBtn = canWithdraw
    ? '<button class="btn btn-light wallet-withdraw-btn" onclick="showToast(\'Payouts launching soon!\')"><svg style="width:16px;height:16px;"><use href="#i-download"/></svg> Withdraw KSh ' + approvedTotal.toLocaleString() + '</button>'
    : '<button class="btn btn-light wallet-withdraw-btn" disabled style="opacity:.65;cursor:not-allowed;"><svg style="width:16px;height:16px;"><use href="#i-lock"/></svg> Withdraw (locked)</button>';

  const progressBox = canWithdraw
    ? '<div class="wallet-progress-box"><div class="wallet-progress-top"><span>Withdrawal unlocked</span><span>✓</span></div><div class="wallet-progress-bar"><div class="wallet-progress-fill" style="width:100%"></div></div><div class="wallet-progress-hint">Withdraw KSh ' + approvedTotal.toLocaleString() + '.</div></div>'
    : '<div class="wallet-progress-box"><div class="wallet-progress-top"><span>Progress to withdrawal</span><span>KSh ' + approvedTotal.toLocaleString() + ' / ' + threshold.toLocaleString() + '</span></div><div class="wallet-progress-bar"><div class="wallet-progress-fill" style="width:' + progress + '%"></div></div><div class="wallet-progress-hint">KSh ' + remaining.toLocaleString() + ' more to unlock. ' + plan.label + ' minimum: KSh ' + threshold.toLocaleString() + '.</div></div>';

  const tierBanner = '<div style="display:flex;justify-content:center;margin-bottom:18px;"><span class="profile-tier-badge tier-' + tier + '"><svg style="width:14px;height:14px;"><use href="#' + plan.icon + '"/></svg>' + plan.label + ' Plan</span></div>';

  const dailyCard = daily ? '<div class="daily-limits-card"><div class="daily-limits-header"><h3>Today\'s Activity</h3><small>Resets at midnight</small></div>' +
    '<div class="daily-limit-row"><div class="daily-limit-labels"><span>Surveys done</span><span>' + daily.surveyCount + ' / ' + daily.surveyLimit + '</span></div><div class="daily-limit-bar"><div class="daily-limit-fill ' + (surveyPct >= 100 ? 'full' : surveyPct >= 66 ? 'warn' : '') + '" style="width:' + surveyPct + '%"></div></div></div>' +
    '<div class="daily-limit-row"><div class="daily-limit-labels"><span>Earned today</span><span>KSh ' + daily.totalRewards + ' / KSh ' + daily.earningsCap + '</span></div><div class="daily-limit-bar"><div class="daily-limit-fill ' + (earningsPct >= 100 ? 'full' : earningsPct >= 66 ? 'warn' : '') + '" style="width:' + earningsPct + '%"></div></div></div>' +
    '</div>' : '';

  const transactionsHTML = transactions.length === 0
    ? '<div class="state-box"><strong>No transactions yet</strong><p>Complete surveys to start earning.</p></div>'
    : '<div class="transaction-list">' + transactions.map(function(t) {
        const iconId = t.status === 'approved' ? 'i-check-circle' : (t.status === 'rejected' ? 'i-x-circle' : 'i-clock');
        const amountHTML = t.status === 'rejected' ? '<div class="transaction-amount rejected">KSh 0</div>' : '<div class="transaction-amount ' + t.status + '">+ KSh ' + t.amount + '</div>';
        return '<div class="transaction-item"><div class="transaction-icon ' + t.status + '"><svg><use href="#' + iconId + '"/></svg></div><div class="transaction-info"><strong>' + escapeHtml(t.title) + '</strong><small>' + new Date(t.date).toLocaleDateString() + ' &bull; ' + escapeHtml(t.status) + '</small></div>' + amountHTML + '</div>';
      }).join('') + '</div>';

  container.innerHTML = '<div class="wallet-header"><h2>Wallet</h2><p>Your survey earnings, in one place.</p></div>' + tierBanner +
    '<div class="wallet-balance-card"><div class="wallet-balance-label">Available Balance</div><div class="wallet-balance-value">KSh ' + approvedTotal.toLocaleString() + '</div><div class="wallet-balance-sub">From ' + transactions.filter(function(t) { return t.status === 'approved'; }).length + ' approved survey' + (transactions.filter(function(t) { return t.status === 'approved'; }).length === 1 ? '' : 's') + '</div>' + progressBox + withdrawBtn + '</div>' +
    dailyCard +
    '<div class="wallet-stats-row"><div class="wallet-stat-tile"><span class="val">KSh ' + approvedTotal.toLocaleString() + '</span><span class="lbl">Approved</span></div><div class="wallet-stat-tile"><span class="val">KSh ' + pendingTotal.toLocaleString() + '</span><span class="lbl">Pending</span></div></div>' +
    '<div class="wallet-transactions"><h3>Recent Activity</h3>' + transactionsHTML + '</div>';
}

function renderAdminWallet() {
  const container = document.getElementById('wallet-content');
  const users = readStore(STORE_USERS, []);
  const participations = readStore(STORE_PARTICIPATIONS, []);
  const allSurveys = readStore(STORE_SURVEYS, []);

  const totalUsers = users.filter(function(u) { return u.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase(); }).length;
  const totalSurveys = allSurveys.length;
  const totalParticipations = participations.length;
  const approvedParts = participations.filter(function(p) { return p.review_status === 'approved'; });
  const totalPaid = approvedParts.reduce(function(sum, p) {
    const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
    return sum + (s ? (s.reward || 0) : 0);
  }, 0);

  const userItems = users
    .filter(function(u) { return u.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase(); })
    .map(function(u) {
      const userParts = participations.filter(function(p) { return p.user_id === u.id; });
      const approved = userParts.filter(function(p) { return p.review_status === 'approved'; });
      const earned = approved.reduce(function(sum, p) {
        const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
        return sum + (s ? (s.reward || 0) : 0);
      }, 0);
      return { user: u, surveysTaken: userParts.length, approvedCount: approved.length, earned: earned };
    })
    .sort(function(a, b) { return b.earned - a.earned; });

  const statsHTML = '<div class="admin-user-stats">' +
    '<div class="admin-stat-tile"><span class="val">' + totalUsers + '</span><span class="lbl">Total Users</span></div>' +
    '<div class="admin-stat-tile"><span class="val">KSh ' + totalPaid.toLocaleString() + '</span><span class="lbl">Total Paid Out</span></div>' +
    '<div class="admin-stat-tile"><span class="val">' + totalSurveys + '</span><span class="lbl">Surveys</span></div>' +
    '<div class="admin-stat-tile"><span class="val">' + totalParticipations + '</span><span class="lbl">Participations</span></div>' +
  '</div>';

  const usersHTML = userItems.length === 0
    ? '<div class="state-box"><strong>No registered users yet</strong><p>Users will appear here once they sign up.</p></div>'
    : '<div class="user-list">' + userItems.map(function(item) {
        const u = item.user;
        const initial = (u.name || u.email || '?').charAt(0).toUpperCase();
        const avatarHTML = u.avatar ? '<img src="' + escapeHtml(u.avatar) + '" alt="">' : escapeHtml(initial);
        const tier = u.tier || 'basic';
        const plan = PLANS[tier];
        const joined = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
        return '<div class="user-item"><div class="user-avatar">' + avatarHTML + '</div><div class="user-info"><strong>' + escapeHtml(u.name || 'User') + '</strong><small>' + escapeHtml(u.email) + '</small><small>' + plan.label + ' &bull; Joined ' + joined + '</small></div><div class="user-stats"><div class="user-stat"><span class="user-stat-val">' + item.surveysTaken + '</span><span class="user-stat-lbl">Surveys</span></div><div class="user-stat"><span class="user-stat-val">KSh ' + item.earned + '</span><span class="user-stat-lbl">Earned</span></div></div></div>';
      }).join('') + '</div>';

  container.innerHTML = '<div class="wallet-header"><h2>Users Overview</h2><p>Platform stats and registered users.</p></div>' + statsHTML + '<div class="wallet-transactions"><h3>Registered Users</h3>' + usersHTML + '</div>';
}

// ---------- Profile ----------
function renderProfile() {
  const container = document.getElementById('profile-content');
  if (!currentUser) {
    container.innerHTML = '<div class="profile-card"><div class="profile-avatar-container guest"><span class="initial">?</span></div><h2>Welcome to SurveyKE</h2><p class="profile-description">Sign in or create an account to start earning. New accounts start on the free Basic plan.</p><div class="profile-actions"><button class="btn btn-primary btn-block" onclick="openAuth(\'signin\')">Sign In</button><button class="btn btn-outline btn-block" onclick="openAuth(\'signup\')">Create Account</button></div><div class="profile-actions"><button class="btn btn-outline btn-block" onclick="navigate(\'settings\')"><svg style="width:16px;height:16px;"><use href="#i-settings"/></svg>Settings</button></div></div>';
    return;
  }

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
  const avatarHTML = avatar ? '<img src="' + escapeHtml(avatar) + '" alt="Avatar">' : '<span class="initial">' + escapeHtml(initial) + '</span>';

  const reviews = getRecentReviews(5);
  const unreadCount = getUnreadNotificationsCount();

  let notificationsHTML = '';
  if (!isAdmin) {
    if (unreadCount > 0) {
      notificationsHTML += '<div class="profile-notif-banner"><svg><use href="#i-zap"/></svg><div><strong>You have ' + unreadCount + ' new ' + (unreadCount === 1 ? 'review' : 'reviews') + '!</strong><small>Your survey submissions have been updated. Check the list below.</small></div></div>';
    }
    notificationsHTML += '<div class="notifications-card">';
    notificationsHTML += '<div class="notifications-header"><strong>Recent Reviews</strong>' + (unreadCount > 0 ? '<span class="new-pill">' + unreadCount + ' new</span>' : '') + '</div>';
    if (reviews.length === 0) {
      notificationsHTML += '<div class="notifications-empty">Your reviews will appear here once an admin approves or rejects your submissions.</div>';
    } else {
      notificationsHTML += '<div class="notification-list">';
      reviews.forEach(function(r) {
        const isApproved = r.status === 'approved';
        const iconId = isApproved ? 'i-check-circle' : 'i-x-circle';
        const dateStr = r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : '—';
        const statusText = isApproved ? ('Approved · +KSh ' + r.reward) : 'Rejected';
        notificationsHTML += '<div class="notification-item notification-' + r.status + '">' +
          '<div class="notification-icon"><svg><use href="#' + iconId + '"/></svg></div>' +
          '<div class="notification-info"><strong>' + escapeHtml(r.title) + '</strong><small>' + statusText + ' &bull; ' + dateStr + '</small></div>' +
        '</div>';
      });
      notificationsHTML += '</div>';
    }
    notificationsHTML += '</div>';
  }

  let tierHTML = '', statsHTML = '', planAction = '', referralHTML = '';
  if (isAdmin) {
    tierHTML = '<div class="admin-badge">🔑 Administrator</div>';
    planAction = '<button class="btn btn-primary btn-block" onclick="navigate(\'admin\')">Admin Dashboard</button>';
  } else {
    tierHTML = '<span class="profile-tier-badge tier-' + tier + '"><svg style="width:14px;height:14px;"><use href="#' + plan.icon + '"/></svg>' + plan.label + '</span>';
    statsHTML = '<div class="profile-stats"><div class="profile-stat"><span class="profile-stat-val">' + parts.length + '</span><span class="profile-stat-label">Surveys taken</span></div><div class="profile-stat"><span class="profile-stat-val">' + approved + '</span><span class="profile-stat-label">Approved</span></div></div>';
    planAction = '<button class="btn btn-outline btn-block" onclick="openPlanModal()"><svg style="width:16px;height:16px;"><use href="#i-crown"/></svg>Change Plan</button>';
    referralHTML = '<div class="referral-card"><div class="referral-header"><svg><use href="#i-gift"/></svg><strong>Referral Programme</strong></div><p class="referral-desc">Invite friends and earn rewards when they join SurveyKE.</p><div class="referral-code-box"><span class="referral-code-label">Your code</span><span class="referral-code-val">' + escapeHtml(code) + '</span></div><div class="referral-stats"><div class="referral-stat"><strong>' + referrals.length + '</strong><small>Friends invited</small></div></div><div class="referral-actions"><button class="btn btn-outline btn-sm" onclick="copyReferralLink()"><svg style="width:14px;height:14px;"><use href="#i-copy"/></svg>Copy Link</button><button class="btn btn-outline btn-sm" onclick="shareReferralLink()"><svg style="width:14px;height:14px;"><use href="#i-share"/></svg>Share</button></div></div>';
  }

  container.innerHTML = '<div class="profile-card">' +
    '<div class="profile-avatar-container">' + avatarHTML + '</div>' +
    '<h2>' + escapeHtml(currentUser.name || 'User') + '</h2>' +
    '<p class="profile-email">' + escapeHtml(currentUser.email) + '</p>' +
    tierHTML + statsHTML + notificationsHTML +
    '<div class="profile-actions"><button class="btn btn-primary btn-block" onclick="openEditProfile()"><svg style="width:16px;height:16px;"><use href="#i-edit"/></svg>Edit Profile</button>' + planAction + '</div>' +
    referralHTML +
    '<div class="profile-actions"><button class="btn btn-outline btn-block" onclick="navigate(\'settings\')"><svg style="width:16px;height:16px;"><use href="#i-settings"/></svg>Settings</button><button class="btn btn-outline btn-block" onclick="signOut()">Sign Out</button></div>' +
    '<div class="danger-zone"><button class="btn btn-outline btn-block danger-btn" onclick="deleteAccount()"><svg style="width:16px;height:16px;"><use href="#i-trash"/></svg>Delete Account</button><p class="danger-note">Permanently delete your account and data from this browser.</p></div>' +
  '</div>';

  if (!isAdmin) markNotificationsRead();
  refreshNavBadges();
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
  document.getElementById('edit-name-input').oninput = function() { editingName = this.value; if (!editingAvatar) updateEditAvatarPreview(); };
}
function closeEditProfile() { document.getElementById('edit-profile-overlay').classList.remove('open'); }
function handleEditProfileOverlayClick(e) { if (e.target.id === 'edit-profile-overlay') closeEditProfile(); }
function renderAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;
  grid.innerHTML = ANIME_URLS.map(function(url) {
    return '<button class="avatar-option ' + (editingAvatar === url ? 'selected' : '') + '" onclick="selectAvatar(\'' + url + '\')"><img src="' + url + '" alt="avatar" loading="lazy"></button>';
  }).join('');
}
function selectAvatar(url) { editingAvatar = url; renderAvatarGrid(); updateEditAvatarPreview(); }
function updateEditAvatarPreview() {
  const preview = document.getElementById('edit-avatar-preview');
  if (!preview) return;
  if (editingAvatar) preview.innerHTML = '<img src="' + escapeHtml(editingAvatar) + '" alt="Preview">';
  else { const initial = (editingName || (currentUser && currentUser.email) || '?').charAt(0).toUpperCase(); preview.innerHTML = '<span class="initial">' + escapeHtml(initial) + '</span>'; }
}
function handleAvatarFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB.'); return; }
  const reader = new FileReader();
  reader.onload = function(ev) { editingAvatar = ev.target.result; renderAvatarGrid(); updateEditAvatarPreview(); };
  reader.readAsDataURL(file);
}
function saveProfileEdits() {
  if (!currentUser) return;
  const newName = document.getElementById('edit-name-input').value.trim();
  if (newName.length < 2) { const n = document.getElementById('edit-profile-notice'); n.className = 'notice show error'; n.textContent = 'Name must be at least 2 characters.'; return; }
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) { showToast('User not found.'); return; }
  users[idx].name = newName;
  users[idx].avatar = editingAvatar;
  writeStore(STORE_USERS, users);
  currentUser.name = newName; currentUser.avatar = editingAvatar;
  closeEditProfile();
  showToast('Profile updated.');
  renderProfile(); updateAuthUI();
}

// ---------- Plan Modal ----------
function openPlanModal() {
  if (isAdmin) { showToast('Admins do not have plans.'); return; }
  if (!currentUser) { showToast('Sign in to change plan.'); openAuth('signin'); return; }
  const users = readStore(STORE_USERS, []);
  const stored = users.find(function(u) { return u.id === currentUser.id; }) || {};
  selectedPlan = stored.tier || 'basic';
  document.getElementById('plan-overlay').classList.add('open');
  document.getElementById('plan-notice').className = 'notice';
  document.querySelectorAll('.plan-card').forEach(function(card) {
    const plan = card.dataset.plan;
    card.classList.remove('selected', 'current');
    if (plan === stored.tier) card.classList.add('current');
    if (plan === selectedPlan) card.classList.add('selected');
    var badge = card.querySelector('.plan-badge-current');
    if (plan === stored.tier && !badge) { const b = document.createElement('div'); b.className = 'plan-badge-current'; b.textContent = 'Current'; card.appendChild(b); }
    else if (plan !== stored.tier && badge) { badge.remove(); }
  });
}
function closePlanModal() { document.getElementById('plan-overlay').classList.remove('open'); }
function handlePlanOverlayClick(e) { if (e.target.id === 'plan-overlay') closePlanModal(); }
function selectPlan(plan) {
  selectedPlan = plan;
  document.querySelectorAll('.plan-card').forEach(function(card) { if (card.dataset.plan === plan) card.classList.add('selected'); else card.classList.remove('selected'); });
}
function confirmPlanChange() {
  if (!currentUser || !selectedPlan) return;
  const users = readStore(STORE_USERS, []);
  const idx = users.findIndex(function(u) { return u.id === currentUser.id; });
  if (idx === -1) { showToast('User not found.'); return; }
  users[idx].tier = selectedPlan;
  writeStore(STORE_USERS, users);
  currentUser.tier = selectedPlan;
  closePlanModal();
  showToast('Plan changed to ' + PLANS[selectedPlan].label + '.');
  if (currentView === 'profile') renderProfile();
  if (currentView === 'wallet') renderWallet();
  if (currentView === 'settings') renderSettings();
  if (currentView === 'surveys') renderSurveysPlanBanner();
  fetchAndRenderSurveys();
}

// ---------- Settings ----------
function renderSettings() {
  const container = document.getElementById('settings-content');
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const notifications = readStore(STORE_NOTIFICATIONS, true);
  const tier = getUserTier();
  const plan = PLANS[tier];
  container.innerHTML = '<div class="settings-container"><div class="settings-header"><h2>Settings</h2><p>Manage your preferences.</p></div>' +
    '<div class="settings-group"><div class="settings-group-title">Appearance</div><div class="settings-item"><div class="settings-item-left"><strong>Theme</strong><small>Choose light or dark mode</small></div><div class="theme-selector"><button class="theme-option ' + (currentTheme === 'light' ? 'active' : '') + '" onclick="setTheme(\'light\')">Light</button><button class="theme-option ' + (currentTheme === 'dark' ? 'active' : '') + '" onclick="setTheme(\'dark\')">Dark</button></div></div></div>' +
    '<div class="settings-group"><div class="settings-group-title">Notifications</div><div class="settings-item"><div class="settings-item-left"><strong>Email Notifications</strong><small>Get notified about new surveys</small></div><button class="toggle-switch ' + (notifications ? 'on' : '') + '" onclick="toggleNotifications()"><span class="toggle-knob"></span></button></div></div>' +
    (currentUser ? '<div class="settings-group"><div class="settings-group-title">Account</div><button class="settings-item settings-item-btn" onclick="navigate(\'profile\')"><div class="settings-item-left"><strong>Profile</strong><small>Edit name, avatar, and more</small></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button>' + (isAdmin ? '' : '<button class="settings-item settings-item-btn" onclick="openPlanModal()"><div class="settings-item-left"><strong>Change Plan</strong><small>Current: ' + plan.label + '</small></div><svg style="width:18px;height:18px;color:var(--muted);"><use href="#i-chevron-right"/></svg></button>') + '</div>' : '') +
    '<div class="settings-group"><div class="settings-group-title">Privacy & Data</div><div class="settings-item"><div class="settings-item-left"><strong>Clear App Data</strong><small>Remove all data from this browser</small></div><button class="btn btn-outline btn-sm" onclick="clearAppData()">Clear</button></div></div>' +
    '<div class="settings-group"><div class="settings-group-title">About</div><div class="settings-item settings-item-static"><div class="settings-item-left"><strong>SurveyKE</strong><small>Version 1.6.0 &bull; Built for Kenya</small></div></div></div>' +
    (currentUser ? '<div class="settings-group"><div class="settings-group-title">Danger Zone</div><div class="settings-item"><div class="settings-item-left"><strong>Delete Account</strong><small>Permanently remove your account</small></div><button class="btn btn-outline btn-sm danger-btn" onclick="deleteAccount()">Delete</button></div></div>' : '') +
  '</div>';
}
function toggleNotifications() { const current = readStore(STORE_NOTIFICATIONS, true); writeStore(STORE_NOTIFICATIONS, !current); renderSettings(); }
function clearAppData() {
  if (!confirm('Clear all app data? This will log you out and reset everything in this browser.')) return;
  localStorage.removeItem(STORE_USERS);
  localStorage.removeItem(STORE_SESSION);
  localStorage.removeItem(STORE_SURVEYS);
  localStorage.removeItem(STORE_PARTICIPATIONS);
  localStorage.removeItem(STORE_RESPONSES);
  localStorage.removeItem(STORE_PENDING_REF);
  localStorage.removeItem(STORE_NOTIFICATIONS);
  location.reload();
}
function deleteAccount() {
  if (!currentUser) return;
  if (!confirm('Delete your account? This will permanently erase your profile, surveys taken, and data.')) return;
  const userId = currentUser.id;
  let users = readStore(STORE_USERS, []);
  users = users.filter(function(u) { return u.id !== userId; });
  users.forEach(function(u) { if (u.referrals && Array.isArray(u.referrals)) u.referrals = u.referrals.filter(function(id) { return id !== userId; }); });
  writeStore(STORE_USERS, users);
  let parts = readStore(STORE_PARTICIPATIONS, []);
  parts = parts.filter(function(p) { return p.user_id !== userId; });
  writeStore(STORE_PARTICIPATIONS, parts);
  let responses = readStore(STORE_RESPONSES, []);
  responses = responses.filter(function(r) { return r.user_id !== userId; });
  writeStore(STORE_RESPONSES, responses);
  writeStore(STORE_SESSION, null);
  currentUser = null; isAdmin = false;
  updateAuthUI();
  navigate('home');
  showToast('Account deleted.');
}

// ---------- Admin sections ----------
function switchAdminSection(section) {
  adminSection = section;
  document.querySelectorAll('.admin-subtab').forEach(function(btn) {
    if (btn.dataset.section === section) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  document.querySelectorAll('.admin-section').forEach(function(sec) {
    if (sec.id === 'admin-section-' + section) sec.classList.remove('hidden');
    else sec.classList.add('hidden');
  });
  if (section === 'manage') loadAdminSurveysTable();
  if (section === 'review') loadAdminParticipationsTable();
}

// ---------- Admin question builder ----------
function setAdminSurveyType(type) {
  adminSurveyType = type;
  document.querySelectorAll('.admin-type-btn').forEach(function(b) { if (b.dataset.type === type) b.classList.add('active'); else b.classList.remove('active'); });
  document.getElementById('admin-external-fields').classList.toggle('hidden', type !== 'external');
  document.getElementById('admin-internal-fields').classList.toggle('hidden', type !== 'internal');
  const urlInput = document.getElementById('admin-url');
  if (urlInput) urlInput.required = (type === 'external');
  if (type === 'internal' && adminQuestions.length === 0) addAdminQuestion();
}
function addAdminQuestion() { adminQuestions.push({ id: uid('q'), type: 'mcq', question: '', options: ['', ''], required: true }); renderAdminQuestions(); }
function removeAdminQuestion(qId) { adminQuestions = adminQuestions.filter(function(q) { return q.id !== qId; }); renderAdminQuestions(); }
function updateAdminQuestion(qId, field, value) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q) q[field] = value; }
function updateAdminQuestionOption(qId, index, value) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q && q.options) q.options[index] = value; }
function addQuestionOption(qId) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q) { q.options.push(''); renderAdminQuestions(); } }
function removeQuestionOption(qId, index) { const q = adminQuestions.find(function(x) { return x.id === qId; }); if (q && q.options.length > 2) { q.options.splice(index, 1); renderAdminQuestions(); } }
function changeQuestionType(qId, newType) {
  const q = adminQuestions.find(function(x) { return x.id === qId; });
  if (!q) return;
  q.type = newType;
  if (newType === 'mcq' && (!q.options || q.options.length < 2)) q.options = ['', ''];
  renderAdminQuestions();
}
function renderAdminQuestions() {
  const wrap = document.getElementById('admin-questions-list');
  if (!wrap) return;
  if (adminQuestions.length === 0) { wrap.innerHTML = '<p style="font-size:12px;color:var(--muted);text-align:center;padding:14px 0;">No questions yet. Click "Add Question" below.</p>'; return; }
  wrap.innerHTML = adminQuestions.map(function(q, idx) {
    let html = '<div class="question-builder"><div class="question-builder-header"><strong>Question ' + (idx + 1) + '</strong><button type="button" class="qb-remove" onclick="removeAdminQuestion(\'' + q.id + '\')">Remove</button></div>';
    html += '<div class="qb-field"><label>Type</label><select onchange="changeQuestionType(\'' + q.id + '\', this.value)"><option value="mcq"' + (q.type === 'mcq' ? ' selected' : '') + '>Multiple Choice</option><option value="text"' + (q.type === 'text' ? ' selected' : '') + '>Short Text</option><option value="paragraph"' + (q.type === 'paragraph' ? ' selected' : '') + '>Paragraph</option><option value="rating"' + (q.type === 'rating' ? ' selected' : '') + '>Rating (1-5)</option></select></div>';
    html += '<div class="qb-field"><label>Question text</label><input type="text" placeholder="e.g. How satisfied are you?" value="' + escapeHtml(q.question) + '" oninput="updateAdminQuestion(\'' + q.id + '\', \'question\', this.value)"></div>';
    if (q.type === 'mcq') {
      html += '<div class="qb-field"><label>Options</label><div class="qb-options-list">';
      q.options.forEach(function(opt, oIdx) {
        html += '<div class="qb-option-row"><input type="text" placeholder="Option ' + (oIdx + 1) + '" value="' + escapeHtml(opt) + '" oninput="updateAdminQuestionOption(\'' + q.id + '\', ' + oIdx + ', this.value)">' + (q.options.length > 2 ? '<button type="button" class="qb-remove-opt" onclick="removeQuestionOption(\'' + q.id + '\', ' + oIdx + ')">×</button>' : '') + '</div>';
      });
      html += '</div><button type="button" class="qb-add-option" onclick="addQuestionOption(\'' + q.id + '\')" style="margin-top:8px;">+ Add Option</button></div>';
    }
    html += '<div class="qb-field"><div class="qb-required-row"><input type="checkbox"' + (q.required ? ' checked' : '') + ' onchange="updateAdminQuestion(\'' + q.id + '\', \'required\', this.checked)"><span>Required</span></div></div>';
    html += '</div>';
    return html;
  }).join('');
}

// ---------- Admin: dashboard ----------
async function renderAdminDashboard() {
  const unauthorizedEl = document.getElementById('admin-unauthorized');
  const authorizedEl = document.getElementById('admin-authorized');
  if (!isAdmin) { unauthorizedEl.classList.remove('hidden'); authorizedEl.classList.add('hidden'); return; }
  unauthorizedEl.classList.add('hidden'); authorizedEl.classList.remove('hidden');
  switchAdminSection(adminSection || 'add');
}

async function loadAdminSurveysTable() {
  const wrap = document.getElementById('admin-surveys-list-wrap');
  const all = readStore(STORE_SURVEYS, []).slice().sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
  if (all.length === 0) { wrap.innerHTML = '<p style="font-size:12.5px; color:var(--muted);">No surveys found.</p>'; return; }
  wrap.innerHTML = '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Title</th><th>Type</th><th>Tier</th><th>Reward</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
    all.map(function(s) {
      const toggleTo = s.status === 'published' ? 'closed' : 'published';
      const toggleLabel = s.status === 'published' ? 'Close' : 'Publish';
      const typeLabel = s.type === 'internal' ? '📝 Internal' : '🔗 External';
      const subline = s.type === 'internal' ? (s.questions ? s.questions.length + ' questions' : '') : (s.survey_url || '');
      return '<tr><td><strong>' + escapeHtml(s.title) + '</strong><br><small style="color:var(--muted);">' + escapeHtml(subline) + '</small></td><td>' + typeLabel + '</td><td>' + tierBadgeHTML(s.tier || 'basic') + '</td><td>KSh ' + (s.reward || 20) + '</td><td><span class="status-chip">' + escapeHtml(s.status) + '</span></td><td><button class="btn btn-outline btn-sm" onclick="toggleSurveyStatus(\'' + s.id + '\', \'' + toggleTo + '\')">' + toggleLabel + '</button> <button class="btn btn-outline btn-sm danger-btn" onclick="deleteSurvey(\'' + s.id + '\')">Delete</button></td></tr>';
    }).join('') + '</tbody></table></div>';
}

async function loadAdminParticipationsTable() {
  const wrap = document.getElementById('admin-participations-wrap');
  const allParts = readStore(STORE_PARTICIPATIONS, []).slice().sort(function(a, b) { return (b.submitted_at || b.updated_at || 0) - (a.submitted_at || a.updated_at || 0); });
  const allSurveys = readStore(STORE_SURVEYS, []);
  const allUsers = readStore(STORE_USERS, []);

  const counts = { pending: 0, reviewed: 0, approved: 0, rejected: 0 };
  allParts.forEach(function(p) {
    const s = p.review_status || 'pending';
    if (counts[s] !== undefined) counts[s]++;
  });

  let html = '<div class="admin-tabs">';
  ['pending', 'reviewed', 'approved', 'rejected'].forEach(function(status) {
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    const active = adminParticipationTab === status ? 'active' : '';
    html += '<button class="admin-tab ' + active + '" onclick="setAdminParticipationTab(\'' + status + '\')">' + label + ' <span class="count">' + counts[status] + '</span></button>';
  });
  html += '</div>';

  const filtered = allParts.filter(function(p) { return (p.review_status || 'pending') === adminParticipationTab; });

  if (filtered.length === 0) {
    html += '<div class="state-box" style="padding:30px 20px;"><strong>No ' + adminParticipationTab + ' participations</strong><p>Nothing to show here yet.</p></div>';
  } else {
    html += '<div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>User</th><th>Survey</th><th>Type</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>' +
      filtered.map(function(p) {
        const s = allSurveys.find(function(x) { return x.id === p.survey_id; });
        const title = s ? s.title : 'Deleted survey';
        const isInternal = s && s.type === 'internal';
        const typeLabel = isInternal ? '📝' : '🔗';
        const dateStr = (p.submitted_at || p.updated_at) ? new Date(p.submitted_at || p.updated_at).toLocaleDateString() : '—';
        const user = allUsers.find(function(u) { return u.id === p.user_id; });
        const userName = user ? (user.name || user.email) : 'Unknown user';
        const userEmail = user ? user.email : '—';
        const actions = renderParticipationActions(p, isInternal);
        return '<tr><td><strong>' + escapeHtml(userName) + '</strong><br><small style="color:var(--muted);">' + escapeHtml(userEmail) + '</small></td><td><strong>' + escapeHtml(title) + '</strong></td><td>' + typeLabel + '</td><td>' + dateStr + '</td><td>' + actions + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  wrap.innerHTML = html;
}

function setAdminParticipationTab(tab) {
  adminParticipationTab = tab;
  loadAdminParticipationsTable();
}

function renderParticipationActions(p, isInternal) {
  const status = p.review_status || 'pending';
  if (status === 'approved' || status === 'rejected') {
    return '<span class="locked-badge"><svg><use href="#i-lock"/></svg>' + status.charAt(0).toUpperCase() + status.slice(1) + '</span>';
  }
  let btns = [];
  if (isInternal) btns.push('<button class="btn btn-outline btn-sm" onclick="viewResponse(\'' + p.id + '\')">View</button>');
  if (status === 'pending') btns.push('<button class="btn btn-outline btn-sm" onclick="markReviewed(\'' + p.id + '\')">Mark Reviewed</button>');
  btns.push('<button class="btn btn-outline btn-sm" onclick="reviewParticipation(\'' + p.id + '\', \'approved\')">Approve</button>');
  btns.push('<button class="btn btn-outline btn-sm danger-btn" onclick="reviewParticipation(\'' + p.id + '\', \'rejected\')">Reject</button>');
  return btns.join(' ');
}

function markReviewed(participationId) {
  try {
    const parts = readStore(STORE_PARTICIPATIONS, []);
    const idx = parts.findIndex(function(p) { return p.id === participationId; });
    if (idx === -1) throw new Error('Participation not found.');
    const p = parts[idx];
    if (p.review_status === 'approved' || p.review_status === 'rejected') throw new Error('Already finalized.');
    p.review_status = 'reviewed';
    p.reviewed_at = Date.now();
    writeStore(STORE_PARTICIPATIONS, parts);
    showToast('Marked as reviewed.');
    loadAdminParticipationsTable();
  } catch (e) { showToast('Failed: ' + e.message); }
}

async function reviewParticipation(participationId, decision) {
  try {
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('Invalid decision.');
    const parts = readStore(STORE_PARTICIPATIONS, []);
    const idx = parts.findIndex(function(p) { return p.id === participationId; });
    if (idx === -1) throw new Error('Participation not found.');
    const current = parts[idx].review_status || 'pending';
    if (current === 'approved' || current === 'rejected') throw new Error('This participation is already finalized.');
    parts[idx].review_status = decision;
    parts[idx].reviewed_at = Date.now();
    writeStore(STORE_PARTICIPATIONS, parts);
    showToast('Participation ' + decision + ' successfully.');
    await loadAdminParticipationsTable();
  } catch (e) { showToast('Review failed: ' + e.message); }
}

function viewResponse(participationId) {
  const parts = readStore(STORE_PARTICIPATIONS, []);
  const part = parts.find(function(p) { return p.id === participationId; });
  if (!part) { showToast('Participation not found.'); return; }
  const surveys = readStore(STORE_SURVEYS, []);
  const survey = surveys.find(function(s) { return s.id === part.survey_id; });
  if (!survey || survey.type !== 'internal') { showToast('This survey is not internal.'); return; }
  const responses = readStore(STORE_RESPONSES, []);
  const response = responses.find(function(r) { return r.survey_id === survey.id && r.user_id === part.user_id; });
  const users = readStore(STORE_USERS, []);
  const user = users.find(function(u) { return u.id === part.user_id; });

  if (part.review_status === 'pending') {
    const partsAll = readStore(STORE_PARTICIPATIONS, []);
    const pIdx = partsAll.findIndex(function(p) { return p.id === participationId; });
    if (pIdx !== -1) { partsAll[pIdx].review_status = 'reviewed'; partsAll[pIdx].reviewed_at = Date.now(); writeStore(STORE_PARTICIPATIONS, partsAll); }
  }

  const content = document.getElementById('response-viewer-content');
  let html = '<h2 style="margin:0 0 6px;font-size:20px;">' + escapeHtml(survey.title) + '</h2>';
  html += '<p style="color:var(--muted);font-size:12px;margin:0 0 16px;">Submitted response</p>';
  html += '<div class="response-user-info"><strong>' + escapeHtml(user ? (user.name || user.email) : 'Unknown user') + '</strong><br>' + escapeHtml(user ? user.email : '') + '<br>Submitted: ' + (part.submitted_at ? new Date(part.submitted_at).toLocaleString() : '—') + '</div>';

  if (!response) {
    html += '<p style="color:var(--muted);text-align:center;padding:20px 0;">No answers found for this participation.</p>';
  } else {
    html += '<div class="response-list">';
    (survey.questions || []).forEach(function(q, i) {
      const answer = response.answers ? response.answers[q.id] : '';
      html += '<div class="response-answer"><div class="response-answer-label">Question ' + (i + 1) + '</div><div class="response-answer-q">' + escapeHtml(q.question) + '</div><div class="response-answer-val">' + escapeHtml(answer || '—') + '</div></div>';
    });
    html += '</div>';
  }

  const isFinalized = part.review_status === 'approved' || part.review_status === 'rejected';
  html += '<div class="modal-actions"><button class="btn btn-outline" onclick="closeResponseViewer()">Close</button>';
  if (!isFinalized) {
    html += '<button class="btn btn-primary" onclick="closeResponseViewer(); reviewParticipation(\'' + part.id + '\', \'approved\')">Approve</button>';
    html += '<button class="btn btn-outline danger-btn" onclick="closeResponseViewer(); reviewParticipation(\'' + part.id + '\', \'rejected\')">Reject</button>';
  }
  html += '</div>';
  content.innerHTML = html;
  document.getElementById('response-viewer-overlay').classList.add('open');
  loadAdminParticipationsTable();
}
function closeResponseViewer() { document.getElementById('response-viewer-overlay').classList.remove('open'); }
function handleResponseViewerOverlayClick(e) { if (e.target.id === 'response-viewer-overlay') closeResponseViewer(); }

async function handleCreateSurvey(e) {
  e.preventDefault();
  const noticeEl = document.getElementById('admin-create-notice');
  const submitBtn = document.getElementById('admin-submit-btn');
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
    if (!title || !description) throw new Error('Title and description are required.');
    if (isNaN(estimated_minutes) || estimated_minutes <= 0) throw new Error('Duration must be a positive number.');
    if (isNaN(reward) || reward <= 0) throw new Error('Reward must be a positive number.');
    if (!PLANS[tier]) throw new Error('Invalid tier.');
    if (adminSurveyType === 'external') {
      if (!survey_url.startsWith('https://')) throw new Error('Survey URL must be HTTPS.');
      if (survey_url.indexOf('forms.gle/example') !== -1) throw new Error('Demo link detected. Use a real URL.');
    } else {
      if (adminQuestions.length === 0) throw new Error('Add at least one question.');
      for (let i = 0; i < adminQuestions.length; i++) {
        const q = adminQuestions[i];
        if (!q.question.trim()) throw new Error('Question ' + (i + 1) + ' is empty.');
        if (q.type === 'mcq') {
          const filled = (q.options || []).filter(function(o) { return o.trim(); });
          if (filled.length < 2) throw new Error('Question ' + (i + 1) + ' needs at least 2 options.');
        }
      }
    }
    const all = readStore(STORE_SURVEYS, []);
    const newSurvey = { id: uid('sur'), title: title, category: category, description: description, estimated_minutes: estimated_minutes, duration: estimated_minutes + ' mins', status: status, tier: tier, reward: reward, eligibility: eligibility, instructions: instructions, type: adminSurveyType, created_at: Date.now() };
    if (adminSurveyType === 'external') { newSurvey.survey_url = survey_url; }
    else { newSurvey.questions = adminQuestions.map(function(q) { return { id: q.id, type: q.type, question: q.question, required: q.required, options: q.type === 'mcq' ? q.options.filter(function(o) { return o.trim(); }) : [] }; }); }
    all.push(newSurvey);
    writeStore(STORE_SURVEYS, all);

    noticeEl.className = 'notice show success'; noticeEl.textContent = 'Survey created successfully!';
    showToast('Survey published.');
    e.target.reset();
    adminQuestions = []; adminSurveyType = 'external';
    setAdminSurveyType('external');
    renderAdminQuestions();
    fetchAndRenderSurveys();
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
    let responses = readStore(STORE_RESPONSES, []);
    responses = responses.filter(function(r) { return r.survey_id !== surveyId; });
    writeStore(STORE_RESPONSES, responses);
    showToast('Survey deleted.');
    fetchAndRenderSurveys(); await loadAdminSurveysTable(); await loadAdminParticipationsTable();
  } catch (e) { showToast('Failed to delete: ' + e.message); }
}

// ---------- Auth ----------
function openAuth(mode) { document.getElementById('auth-overlay').classList.add('open'); switchAuthMode(mode); clearAuthNotices(); }
function closeAuth() { document.getElementById('auth-overlay').classList.remove('open'); }
function handleOverlayClick(event) { if (event.target.id === 'auth-overlay') closeAuth(); }
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
    currentUser = { id: user.id, email: user.email, name: user.name || user.email.split('@')[0], avatar: user.avatar || null, tier: user.tier || 'basic', referralCode: user.referralCode || ensureReferralCode(user), referrals: user.referrals || [] };
    isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: user.id });
    ensureDailyReset();
    updateAuthUI(); closeAuth();
    showToast('Welcome back, ' + (currentUser.name || currentUser.email) + '!');
    fetchAndRenderSurveys();
    if (currentView === 'profile') renderProfile();
    if (currentView === 'wallet') renderWallet();
    if (currentView === 'settings') renderSettings();
    refreshNavBadges();
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
    const newUser = { id: uid('user'), name: name, email: email, passwordHash: passwordHash, avatar: null, tier: 'basic', referralCode: null, referrals: [], daily: { date: todayStr(), surveyCount: 0, totalRewards: 0 }, notifications_read_at: Date.now(), created_at: Date.now() };
    newUser.referralCode = generateReferralCode(newUser.id);
    users.push(newUser);
    writeStore(STORE_USERS, users);

    const pendingRef = localStorage.getItem(STORE_PENDING_REF);
    if (pendingRef) {
      const allUsers = readStore(STORE_USERS, []);
      const referrer = allUsers.find(function(u) { return u.referralCode === pendingRef; });
      if (referrer && referrer.id !== newUser.id) {
        const idx = allUsers.findIndex(function(u) { return u.id === referrer.id; });
        if (idx !== -1) { allUsers[idx].referrals = allUsers[idx].referrals || []; allUsers[idx].referrals.push(newUser.id); writeStore(STORE_USERS, allUsers); }
      }
      localStorage.removeItem(STORE_PENDING_REF);
    }

    currentUser = { id: newUser.id, email: newUser.email, name: newUser.name, avatar: null, tier: 'basic', referralCode: newUser.referralCode, referrals: [] };
    isAdmin = newUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: newUser.id });
    updateAuthUI(); closeAuth();
    showToast('Account created. Karibu, ' + name + '!');
    fetchAndRenderSurveys();
    if (currentView === 'profile') renderProfile();
    if (currentView === 'wallet') renderWallet();
    if (currentView === 'settings') renderSettings();
    refreshNavBadges();
  } catch (err) { showNotice(err.message, 'error'); }
  finally { submitBtn.disabled = false; }
}

async function submitPasswordReset() { showNotice('Local-only mode: password reset is not available. Please remember your password.', 'info'); }

async function signOut() {
  writeStore(STORE_SESSION, null);
  currentUser = null; isAdmin = false;
  updateAuthUI();
  if (currentView === 'profile') renderProfile();
  else if (currentView === 'wallet') renderWallet();
  else if (currentView === 'settings') renderSettings();
  else navigate('home');
  refreshNavBadges();
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
    if (isAdmin) adminLink.classList.remove('hidden'); else adminLink.classList.add('hidden');
  } else {
    userActions.classList.add('hidden'); userActions.style.display = 'none';
    guestActions.classList.remove('hidden'); guestActions.style.display = 'flex';
    adminLink.classList.add('hidden');
  }
}

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
