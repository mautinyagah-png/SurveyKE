// ================================================================
// SurveyKE — Chrome-only (localStorage) app logic
// No backend, no Supabase. Everything lives in the browser.
// Clearing site data wipes users, surveys, participations, session.
// ================================================================

const STORE_USERS          = 'surveyke_users';
const STORE_SESSION        = 'surveyke_session';
const STORE_SURVEYS        = 'surveyke_surveys';
const STORE_PARTICIPATIONS = 'surveyke_participations';

const ADMIN_EMAIL = 'mautinyagah@gmail.com';

// Safe fallback URL used by the seed surveys — loads without error.
const DEMO_URL = 'https://docs.google.com/forms/';

let currentUser = null;
let isAdmin = false;
let surveysCache = [];
let selectedDirectoryTopic = 'All';
let activeSurveyId = null;
let currentView = 'home';

// ---------- Storage helpers ----------
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix) {
  prefix = prefix || 'id';
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function hashPassword(pw) {
  try {
    const enc = new TextEncoder().encode(pw + '::surveyke::salt');
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(function(b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  } catch (e) {
    return 'plain::' + btoa(pw);
  }
}

// ---------- Migrate any broken demo URLs already in localStorage ----------
function migrateBrokenSeedUrls() {
  const all = readStore(STORE_SURVEYS, null);
  if (!Array.isArray(all)) return;

  let changed = false;
  all.forEach(function(s) {
    if (s.survey_url && s.survey_url.indexOf('forms.gle/example-survey') !== -1) {
      s.survey_url = DEMO_URL;
      changed = true;
    }
  });

  if (changed) writeStore(STORE_SURVEYS, all);
}

// ---------- Seed surveys on first load ----------
function seedSurveysIfEmpty() {
  const existing = readStore(STORE_SURVEYS, null);
  if (Array.isArray(existing) && existing.length > 0) return;

  const now = Date.now();
  const seeds = [
    {
      id: uid('sur'),
      title: 'Digital ID Public Feedback (Demo)',
      category: 'Public Policy',
      description: 'Share your views on the proposed national digital identity system and how it may impact everyday Kenyans. This is a demo entry — the admin should delete it and add a real survey link.',
      estimated_minutes: 5,
      duration: '5 mins',
      status: 'published',
      survey_url: DEMO_URL,
      eligibility: 'Kenyan residents aged 18+.',
      instructions: 'Answer all questions honestly. Your responses are anonymous.',
      created_at: now - 300000
    },
    {
      id: uid('sur'),
      title: 'Mobile Money Usage Study (Demo)',
      category: 'Finance',
      description: 'Help us understand how Kenyans use mobile money platforms for daily transactions, savings and small business. This is a demo entry — the admin should delete it and add a real survey link.',
      estimated_minutes: 7,
      duration: '7 mins',
      status: 'published',
      survey_url: DEMO_URL,
      eligibility: 'Anyone who has used mobile money in the last 30 days.',
      instructions: 'Respond based on your most recent month of activity.',
      created_at: now - 200000
    },
    {
      id: uid('sur'),
      title: 'Matatu Commuter Experience (Demo)',
      category: 'Transport',
      description: 'Rate your experience with matatus, fares, safety and route coverage in Nairobi and other towns. This is a demo entry — the admin should delete it and add a real survey link.',
      estimated_minutes: 6,
      duration: '6 mins',
      status: 'published',
      survey_url: DEMO_URL,
      eligibility: 'Regular commuters using public transport.',
      instructions: 'Focus on the last 7 days of your commute.',
      created_at: now - 100000
    }
  ];

  writeStore(STORE_SURVEYS, seeds);
}

// ---------- Session ----------
function restoreSession() {
  const session = readStore(STORE_SESSION, null);
  if (session && session.userId) {
    const users = readStore(STORE_USERS, []);
    const user = users.find(function(u) { return u.id === session.userId; });
    if (user) {
      currentUser = { id: user.id, email: user.email, name: user.name || user.email.split('@')[0] };
      isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    } else {
      writeStore(STORE_SESSION, null);
    }
  }
  updateAuthUI();
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', function() {
  migrateBrokenSeedUrls();
  seedSurveysIfEmpty();
  restoreSession();
  fetchAndRenderSurveys();
});

// ---------- Navigation ----------
function navigate(viewName, param) {
  currentView = viewName;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-surveys').classList.add('hidden');
  document.getElementById('view-detail').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');

  if (viewName === 'home') {
    document.getElementById('view-home').classList.remove('hidden');
  } else if (viewName === 'surveys') {
    document.getElementById('view-surveys').classList.remove('hidden');
    renderDirectorySurveys();
  } else if (viewName === 'detail' && param) {
    activeSurveyId = param;
    document.getElementById('view-detail').classList.remove('hidden');
    renderSurveyDetail(param);
  } else if (viewName === 'admin') {
    if (!isAdmin) {
      showToast('Administrator access required.');
      navigate('home');
      return;
    }
    document.getElementById('view-admin').classList.remove('hidden');
    renderAdminDashboard();
  }
}

// ---------- Surveys ----------
function fetchAndRenderSurveys() {
  try {
    const all = readStore(STORE_SURVEYS, []);
    surveysCache = (all || []).filter(function(s) {
      if (s.status !== 'published') return false;
      if (!s.survey_url) return false;
      if (!s.survey_url.startsWith('https://')) return false;
      if (s.survey_url.indexOf('example.com') !== -1) return false;
      if (s.survey_url.indexOf('placeholder') !== -1) return false;
      return true;
    }).sort(function(a, b) {
      return (b.created_at || 0) - (a.created_at || 0);
    });

    renderHomeSurveys();
    renderDirectorySurveys();
  } catch (e) {
    console.error('Error loading surveys:', e);
    surveysCache = [];
    renderHomeSurveys();
    renderDirectorySurveys();
  }
}

function renderHomeSurveys() {
  const container = document.getElementById('home-surveys-grid');

  if (surveysCache.length === 0) {
    container.innerHTML = `
      <div class="state-box" style="grid-column: 1 / -1;">
        <strong>No active surveys available right now</strong>
        <p>Sign in as admin (<strong>${ADMIN_EMAIL}</strong>) to publish your first survey, or check back soon.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = surveysCache.slice(0, 3).map(function(s) {
    return `
      <div class="survey-card compact">
        <div class="card-top">
          <span class="cat-chip">${escapeHtml(s.category || 'General')}</span>
          <span class="status-chip">Active</span>
        </div>
        <div class="mini-icon"><svg><use href="#i-book"/></svg></div>
        <h3>${escapeHtml(s.title)}</h3>
        <p class="clamp">${escapeHtml(s.description || '')}</p>
        <div class="meta-row">
          <span class="meta-chip"><svg><use href="#i-clock"/></svg> ${escapeHtml(s.estimated_minutes || s.duration || '5')} mins</span>
        </div>
        <div class="card-bottom">
          <span class="small-note">Verified Survey</span>
          <button class="card-link" onclick="navigate('detail', '${s.id}')">Participate &rarr;</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderDirectorySurveys() {
  const container = document.getElementById('directory-surveys-grid');
  let list = surveysCache;
  if (selectedDirectoryTopic !== 'All') {
    list = surveysCache.filter(function(s) { return s.category === selectedDirectoryTopic; });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="state-box" style="grid-column: 1 / -1;">
        <strong>No surveys found in this category</strong>
        <p>New studies will appear here once published.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(function(s) {
    return `
      <div class="survey-card compact">
        <div class="card-top">
          <span class="cat-chip">${escapeHtml(s.category || 'General')}</span>
          <span class="status-chip">Active</span>
        </div>
        <div class="mini-icon"><svg><use href="#i-book"/></svg></div>
        <h3>${escapeHtml(s.title)}</h3>
        <p class="clamp">${escapeHtml(s.description || '')}</p>
        <div class="meta-row">
          <span class="meta-chip"><svg><use href="#i-clock"/></svg> ${escapeHtml(s.estimated_minutes || s.duration || '5')} mins</span>
        </div>
        <div class="card-bottom">
          <span class="small-note">Open opportunity</span>
          <button class="card-link" onclick="navigate('detail', '${s.id}')">View Details &rarr;</button>
        </div>
      </div>
    `;
  }).join('');
}

function filterDirectoryTopic(topic) {
  selectedDirectoryTopic = topic;
  const chips = document.querySelectorAll('#directory-topic-chips .topic-chip');
  chips.forEach(function(c) {
    if (c.textContent.trim() === topic || (topic === 'All' && c.textContent.includes('Categories'))) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });
  renderDirectorySurveys();
}

function renderSurveyDetail(id) {
  const survey = surveysCache.find(function(s) { return s.id === id; });
  const container = document.getElementById('survey-detail-content');

  if (!survey) {
    container.innerHTML = `
      <div class="state-box">
        <strong>Survey not found or unavailable</strong>
        <p>This survey may have closed or is no longer accessible.</p>
        <button class="btn btn-primary btn-sm" onclick="navigate('surveys')" style="margin-top:12px;">Back to Surveys</button>
      </div>
    `;
    return;
  }

  const isDemo = survey.survey_url === DEMO_URL;

  const demoNotice = isDemo ? `
    <div class="notice show info" style="margin-bottom: 12px;">
      <strong>Demo survey:</strong> This survey uses a placeholder link. The admin should delete it and create a real survey with a working Google Forms URL.
    </div>
  ` : '';

  const eligibilityHTML = survey.eligibility ? `
    <div class="detail-section">
      <h3>Eligibility Requirements</h3>
      <p class="detail-text">${escapeHtml(survey.eligibility)}</p>
    </div>
  ` : '';

  const instructionsHTML = survey.instructions ? `
    <div class="detail-section">
      <h3>Participation Instructions</h3>
      <p class="detail-text">${escapeHtml(survey.instructions)}</p>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="detail-card">
      <div class="card-top" style="margin-bottom:12px;">
        <span class="cat-chip">${escapeHtml(survey.category || 'General')}</span>
        <span class="status-chip">Active</span>
      </div>
      <div class="mini-icon" style="margin-bottom: 14px;"><svg><use href="#i-book"/></svg></div>
      <h1>${escapeHtml(survey.title)}</h1>

      <div class="meta-row" style="margin-bottom: 16px;">
        <span class="meta-chip"><svg><use href="#i-clock"/></svg> Est. ${escapeHtml(survey.estimated_minutes || survey.duration || '5')} mins</span>
      </div>

      <p class="detail-text">${escapeHtml(survey.description || '')}</p>

      ${eligibilityHTML}
      ${instructionsHTML}

      <div class="participate-box">
        <h3>External Survey Participation</h3>
        <p>This survey is hosted securely on an external research platform. Click below to begin your participation. We will record your session status upon entry.</p>

        ${demoNotice}

        <div id="participate-notice" class="notice"></div>

        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-primary" onclick="startExternalSurvey('${survey.id}')">
            Proceed to External Survey <svg><use href="#i-external"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

async function startExternalSurvey(surveyId) {
  if (!currentUser) {
    showToast('Please sign in to participate in surveys.');
    openAuth('signin');
    return;
  }

  const allSurveys = readStore(STORE_SURVEYS, []);
  const survey = allSurveys.find(function(s) { return s.id === surveyId; });
  if (!survey || !survey.survey_url || !survey.survey_url.startsWith('https://')) {
    showToast('Invalid or unavailable survey.');
    return;
  }

  try {
    const parts = readStore(STORE_PARTICIPATIONS, []);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const alreadyStarted = parts.some(function(p) {
      return p.survey_id === surveyId &&
             p.user_id === currentUser.id &&
             p.status === 'started' &&
             p.started_at > oneDayAgo;
    });

    if (!alreadyStarted) {
      parts.push({
        id: uid('part'),
        survey_id: surveyId,
        user_id: currentUser.id,
        status: 'started',
        review_status: 'pending',
        submitted_at: Date.now(),
        started_at: Date.now()
      });
      writeStore(STORE_PARTICIPATIONS, parts);
    }

    showToast('Participation recorded. Redirecting to survey...');
    setTimeout(function() {
      window.open(survey.survey_url, '_blank', 'noopener,noreferrer');
    }, 700);
  } catch (e) {
    console.error('Participation exception:', e);
    window.open(survey.survey_url, '_blank', 'noopener,noreferrer');
  }
}

// ---------- Admin ----------
async function renderAdminDashboard() {
  const unauthorizedEl = document.getElementById('admin-unauthorized');
  const authorizedEl = document.getElementById('admin-authorized');

  if (!isAdmin) {
    unauthorizedEl.classList.remove('hidden');
    authorizedEl.classList.add('hidden');
    return;
  }

  unauthorizedEl.classList.add('hidden');
  authorizedEl.classList.remove('hidden');
  await loadAdminSurveysTable();
  await loadAdminParticipationsTable();
}

async function loadAdminSurveysTable() {
  const wrap = document.getElementById('admin-surveys-list-wrap');
  const all = readStore(STORE_SURVEYS, []).slice().sort(function(a, b) {
    return (b.created_at || 0) - (a.created_at || 0);
  });

  if (all.length === 0) {
    wrap.innerHTML = '<p style="font-size:12px; color:var(--muted);">No surveys found. Create one above, or click <strong>Reset All Data</strong> to reseed demos.</p>';
    return;
  }

  wrap.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${all.map(function(s) {
            const toggleTo = s.status === 'published' ? 'closed' : 'published';
            const toggleLabel = s.status === 'published' ? 'Close' : 'Publish';
            return `
              <tr>
                <td><strong>${escapeHtml(s.title)}</strong><br><small style="color:var(--muted);">${escapeHtml(s.survey_url || '')}</small></td>
                <td>${escapeHtml(s.category || '')}</td>
                <td>${escapeHtml(String(s.estimated_minutes || s.duration || '5'))} mins</td>
                <td><span class="status-chip">${escapeHtml(s.status)}</span></td>
                <td>
                  <button class="btn btn-outline btn-sm" onclick="toggleSurveyStatus('${s.id}', '${toggleTo}')">${toggleLabel}</button>
                  <button class="btn btn-outline btn-sm" style="color:#a52b26; border-color:#f6d4d1;" onclick="deleteSurvey('${s.id}')">Delete</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadAdminParticipationsTable() {
  const wrap = document.getElementById('admin-participations-wrap');
  const parts = readStore(STORE_PARTICIPATIONS, []).slice().sort(function(a, b) {
    return (b.submitted_at || 0) - (a.submitted_at || 0);
  }).slice(0, 20);
  const allSurveys = readStore(STORE_SURVEYS, []);

  if (parts.length === 0) {
    wrap.innerHTML = '<p style="font-size:12px; color:var(--muted);">No participation records found yet.</p>';
    return;
  }

  wrap.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Survey</th>
            <th>Participant Status</th>
            <th>Submission Date</th>
            <th>Review Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${parts.map(function(p) {
            const survey = allSurveys.find(function(s) { return s.id === p.survey_id; });
            const title = survey ? survey.title : 'Deleted survey';
            const dateStr = p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : '—';
            return `
              <tr>
                <td><strong>${escapeHtml(title)}</strong></td>
                <td>${escapeHtml(p.status || 'started')}</td>
                <td>${dateStr}</td>
                <td><span class="status-chip">${escapeHtml(p.review_status || 'pending')}</span></td>
                <td>
                  <button class="btn btn-outline btn-sm" onclick="reviewParticipation('${p.id}', 'approved')">Approve</button>
                  <button class="btn btn-outline btn-sm" style="color:#a52b26; border-color:#f6d4d1;" onclick="reviewParticipation('${p.id}', 'rejected')">Reject</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function reviewParticipation(participationId, decision) {
  try {
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Invalid decision.');
    }
    const parts = readStore(STORE_PARTICIPATIONS, []);
    const idx = parts.findIndex(function(p) { return p.id === participationId; });
    if (idx === -1) throw new Error('Participation not found.');
    parts[idx].review_status = decision;
    parts[idx].reviewed_at = Date.now();
    writeStore(STORE_PARTICIPATIONS, parts);
    showToast('Participation ' + decision + ' successfully.');
    await loadAdminParticipationsTable();
  } catch (e) {
    showToast('Review failed: ' + e.message);
  }
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

  submitBtn.disabled = true;
  noticeEl.className = 'notice';

  try {
    if (!title || !description) {
      throw new Error('Title and description are required.');
    }
    if (!survey_url.startsWith('https://')) {
      throw new Error('Survey URL must be a valid secure HTTPS destination.');
    }
    if (survey_url.indexOf('forms.gle/example') !== -1) {
      throw new Error('That link is a demo placeholder. Please paste a real Google Forms URL.');
    }
    if (isNaN(estimated_minutes) || estimated_minutes <= 0) {
      throw new Error('Estimated duration must be a positive number of minutes.');
    }

    const all = readStore(STORE_SURVEYS, []);
    all.push({
      id: uid('sur'),
      title: title,
      category: category,
      description: description,
      estimated_minutes: estimated_minutes,
      duration: estimated_minutes + ' mins',
      status: status,
      survey_url: survey_url,
      eligibility: eligibility,
      instructions: instructions,
      created_at: Date.now()
    });
    writeStore(STORE_SURVEYS, all);

    noticeEl.className = 'notice show success';
    noticeEl.textContent = 'Survey successfully created and saved locally!';
    showToast('Survey published successfully.');

    e.target.reset();
    fetchAndRenderSurveys();
    await loadAdminSurveysTable();
  } catch (err) {
    noticeEl.className = 'notice show error';
    noticeEl.textContent = 'Error creating survey: ' + err.message;
  } finally {
    submitBtn.disabled = false;
  }
}

async function toggleSurveyStatus(surveyId, newStatus) {
  try {
    const all = readStore(STORE_SURVEYS, []);
    const idx = all.findIndex(function(s) { return s.id === surveyId; });
    if (idx === -1) throw new Error('Survey not found.');
    all[idx].status = newStatus;
    writeStore(STORE_SURVEYS, all);
    showToast('Survey status updated to ' + newStatus);
    fetchAndRenderSurveys();
    await loadAdminSurveysTable();
  } catch (e) {
    showToast('Failed to update status: ' + e.message);
  }
}

async function deleteSurvey(surveyId) {
  if (!confirm('Delete this survey? This cannot be undone.')) return;
  try {
    let all = readStore(STORE_SURVEYS, []);
    const lenBefore = all.length;
    all = all.filter(function(s) { return s.id !== surveyId; });
    if (all.length === lenBefore) throw new Error('Survey not found.');
    writeStore(STORE_SURVEYS, all);

    let parts = readStore(STORE_PARTICIPATIONS, []);
    parts = parts.filter(function(p) { return p.survey_id !== surveyId; });
    writeStore(STORE_PARTICIPATIONS, parts);

    showToast('Survey deleted.');
    fetchAndRenderSurveys();
    await loadAdminSurveysTable();
    await loadAdminParticipationsTable();
  } catch (e) {
    showToast('Failed to delete: ' + e.message);
  }
}

function resetAllData() {
  if (!confirm('This will delete ALL users, surveys, and participations from this browser. Continue?')) return;
  localStorage.removeItem(STORE_USERS);
  localStorage.removeItem(STORE_SESSION);
  localStorage.removeItem(STORE_SURVEYS);
  localStorage.removeItem(STORE_PARTICIPATIONS);
  showToast('All data cleared. Reloading...');
  setTimeout(function() { location.reload(); }, 700);
}

// ---------- Auth ----------
function openAuth(mode) {
  document.getElementById('auth-overlay').classList.add('open');
  switchAuthMode(mode);
  clearAuthNotices();
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
}

function handleOverlayClick(event) {
  if (event.target === document.getElementById('auth-overlay')) {
    closeAuth();
  }
}

function switchAuthMode(mode) {
  clearAuthNotices();
  const signinForm = document.getElementById('form-signin');
  const signupForm = document.getElementById('form-signup');
  if (mode === 'signin') {
    signinForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
  } else {
    signinForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
  }
}

function showNotice(msg, type) {
  const n = document.getElementById('auth-notice');
  n.className = 'notice show ' + type;
  n.textContent = msg;
}

function clearAuthNotices() {
  const n = document.getElementById('auth-notice');
  n.className = 'notice';
  n.textContent = '';
}

async function submitSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('signin-email').value.trim().toLowerCase();
  const password = document.getElementById('signin-password').value;
  const submitBtn = document.getElementById('signin-submit-btn');

  submitBtn.disabled = true;
  clearAuthNotices();

  try {
    if (!email || !password) {
      throw new Error('Please enter your email and password.');
    }

    const users = readStore(STORE_USERS, []);
    const user = users.find(function(u) { return u.email.toLowerCase() === email; });

    if (!user) {
      throw new Error('No account found with this email. Please register first.');
    }

    const passwordHash = await hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      throw new Error('Incorrect password. Please try again.');
    }

    currentUser = {
      id: user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0]
    };
    isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: user.id });

    updateAuthUI();
    closeAuth();
    showToast('Welcome back, ' + (currentUser.name || currentUser.email) + '!');
    fetchAndRenderSurveys();
    if (currentView === 'admin') navigate('home');
  } catch (err) {
    showNotice(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

async function submitSignUp(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  const submitBtn = document.getElementById('signup-submit-btn');

  submitBtn.disabled = true;
  clearAuthNotices();

  try {
    if (!name || name.length < 2) {
      throw new Error('Please enter your full name.');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    const users = readStore(STORE_USERS, []);
    if (users.some(function(u) { return u.email.toLowerCase() === email; })) {
      throw new Error('An account with this email already exists. Please sign in instead.');
    }

    const passwordHash = await hashPassword(password);
    const newUser = {
      id: uid('user'),
      name: name,
      email: email,
      passwordHash: passwordHash,
      created_at: Date.now()
    };
    users.push(newUser);
    writeStore(STORE_USERS, users);

    currentUser = { id: newUser.id, email: newUser.email, name: newUser.name };
    isAdmin = newUser.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    writeStore(STORE_SESSION, { userId: newUser.id });

    updateAuthUI();
    closeAuth();
    showToast('Account created. Karibu, ' + name + '!');
    fetchAndRenderSurveys();
    if (currentView === 'admin') navigate('home');
  } catch (err) {
    showNotice(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

async function submitPasswordReset() {
  showNotice('Local-only mode: password reset is not available because there is no email server. Please remember your password, or register a new account with a different email.', 'info');
}

async function signOut() {
  writeStore(STORE_SESSION, null);
  currentUser = null;
  isAdmin = false;
  updateAuthUI();
  navigate('home');
  showToast('Signed out successfully.');
}

function updateAuthUI() {
  const guestActions = document.getElementById('auth-guest-actions');
  const userActions = document.getElementById('auth-user-actions');
  const greeting = document.getElementById('user-greeting');
  const adminLink = document.getElementById('nav-admin-link');

  if (currentUser) {
    guestActions.classList.add('hidden');
    guestActions.style.display = 'none';
    userActions.classList.remove('hidden');
    userActions.style.display = 'flex';
    greeting.textContent = 'Hi, ' + (currentUser.name || currentUser.email.split('@')[0]);

    if (isAdmin) adminLink.classList.remove('hidden');
    else adminLink.classList.add('hidden');
  } else {
    userActions.classList.add('hidden');
    userActions.style.display = 'none';
    guestActions.classList.remove('hidden');
    guestActions.style.display = 'flex';
    adminLink.classList.add('hidden');
  }
}

// ---------- Utilities ----------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(function() {
    t.classList.remove('show');
  }, 3500);
}
