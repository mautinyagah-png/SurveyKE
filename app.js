// Initialize Supabase Client with your genuine project URL and publishable anon key
const SUPABASE_URL = 'https://hisstfhwiijzzteuhewv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpc3RmaHdpaWp6enRldWhld3YiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcyNDMxMDAwMCwiZXhwIjoyMDM5ODg2MDAwfQ.EXAMPLE_KEY_ANON';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// App State
let currentView = 'home';
let currentUser = null;
let isAdmin = false;
let surveysCache = [];
let selectedDirectoryTopic = 'All';
let activeSurveyId = null;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    await checkAdminStatus();
  }

  updateAuthUI();
  await fetchAndRenderSurveys();

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      await checkAdminStatus();
    } else {
      currentUser = null;
      isAdmin = false;
    }
    updateAuthUI();
  });
});

// Check Admin Privileges
async function checkAdminStatus() {
  if (!currentUser) {
    isAdmin = false;
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc('is_admin');
    if (!error && data === true) {
      isAdmin = true;
    } else {
      const { data: adminRow } = await supabaseClient
        .from('admins')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      isAdmin = !!adminRow || (currentUser.email === 'mautinyagah@gmail.com');
    }
  } catch (e) {
    isAdmin = (currentUser.email === 'mautinyagah@gmail.com');
  }
}

// Navigation Router
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

// Fetch surveys
async function fetchAndRenderSurveys() {
  try {
    const { data, error } = await supabaseClient
      .from('surveys')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (error) throw error;

    surveysCache = (data || []).filter(s => {
      if (!s.survey_url) return false;
      const urlLower = s.survey_url.toLowerCase();
      if (urlLower.includes('example.com') || urlLower.includes('placeholder')) return false;
      return true;
    });

    renderHomeSurveys();
    renderDirectorySurveys();
  } catch (e) {
    console.error('Error fetching surveys:', e);
    surveysCache = [];
    renderHomeSurveys();
    renderDirectorySurveys();
  }
}

// Render Home Featured Surveys
function renderHomeSurveys() {
  const container = document.getElementById('home-surveys-grid');

  if (surveysCache.length === 0) {
    container.innerHTML = `
      <div class="state-box" style="grid-column: 1 / -1;">
        <strong>No active surveys available right now</strong>
        <p>Our research team is preparing new verified public opinion polls. Check back soon or join our WhatsApp channel for instant alerts!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = surveysCache.slice(0, 3).map(s => `
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
  `).join('');
}

// Render Directory Surveys
function renderDirectorySurveys() {
  const container = document.getElementById('directory-surveys-grid');
  let list = surveysCache;
  if (selectedDirectoryTopic !== 'All') {
    list = surveysCache.filter(s => s.category === selectedDirectoryTopic);
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="state-box" style="grid-column: 1 / -1;">
        <strong>No surveys found in this category</strong>
        <p>We will be launching new studies in this category soon.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(s => `
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
  `).join('');
}

function filterDirectoryTopic(topic) {
  selectedDirectoryTopic = topic;
  const chips = document.querySelectorAll('#directory-topic-chips .topic-chip');
  chips.forEach(c => {
    if (c.textContent.trim() === topic || (topic === 'All' && c.textContent.includes('Categories'))) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });
  renderDirectorySurveys();
}

// Render Survey Detail
function renderSurveyDetail(id) {
  const survey = surveysCache.find(s => s.id === id);
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

  let eligibilityHTML = survey.eligibility ? `
    <div class="detail-section">
      <h3>Eligibility Requirements</h3>
      <p class="detail-text">${escapeHtml(survey.eligibility)}</p>
    </div>
  ` : '';

  let instructionsHTML = survey.instructions ? `
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

        <div id="participate-notice" class="notice"></div>

        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-primary" onclick="startExternalSurvey('${survey.id}', '${escapeHtml(survey.survey_url)}')">
            Proceed to External Survey <svg><use href="#i-external"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Start Survey participation
async function startExternalSurvey(surveyId, surveyUrl) {
  if (!currentUser) {
    showToast('Please sign in to participate in surveys.');
    openAuth('signin');
    return;
  }

  if (!surveyUrl || !surveyUrl.startsWith('https://')) {
    showToast('Invalid or insecure survey destination URL.');
    return;
  }

  try {
    await supabaseClient.from('survey_participations').insert([
      { survey_id: surveyId, user_id: currentUser.id, status: 'started', review_status: 'pending' }
    ]);

    showToast('Participation recorded. Redirecting to survey...');
    setTimeout(() => {
      window.open(surveyUrl, '_blank', 'noopener,noreferrer');
    }, 800);
  } catch (e) {
    console.error('Participation exception:', e);
    window.open(surveyUrl, '_blank', 'noopener,noreferrer');
  }
}

// Admin Dashboard
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
  try {
    const { data, error } = await supabaseClient
      .from('surveys')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      wrap.innerHTML = `<p style="font-size:12px; color:var(--muted);">No surveys found in database.</p>`;
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
            ${data.map(s => `
              <tr>
                <td><strong>${escapeHtml(s.title)}</strong><br><small style="color:var(--muted);">${escapeHtml(s.survey_url || '')}</small></td>
                <td>${escapeHtml(s.category || '')}</td>
                <td>${escapeHtml(String(s.estimated_minutes || s.duration || '5'))} mins</td>
                <td><span class="status-chip">${escapeHtml(s.status)}</span></td>
                <td>
                  <button class="btn btn-outline btn-sm" onclick="toggleSurveyStatus('${s.id}', '${s.status === 'published' ? 'closed' : 'published'}')">
                    ${s.status === 'published' ? 'Close' : 'Publish'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<p style="font-size:12px; color:var(--muted);">Error loading admin surveys: ${e.message}</p>`;
  }
}

async function loadAdminParticipationsTable() {
  const wrap = document.getElementById('admin-participations-wrap');
  try {
    const { data, error } = await supabaseClient
      .from('survey_participations')
      .select('id, status, review_status, submitted_at, surveys(title)')
      .order('submitted_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!data || data.length === 0) {
      wrap.innerHTML = `<p style="font-size:12px; color:var(--muted);">No participation records found.</p>`;
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
            ${data.map(p => `
              <tr>
                <td><strong>${escapeHtml(p.surveys ? p.surveys.title : 'Survey')}</strong></td>
                <td>${escapeHtml(p.status || 'started')}</td>
                <td>${new Date(p.submitted_at).toLocaleDateString()}</td>
                <td><span class="status-chip">${escapeHtml(p.review_status || 'pending')}</span></td>
                <td>
                  <button class="btn btn-outline btn-sm" onclick="reviewParticipation('${p.id}', 'approved')">Approve</button>
                  <button class="btn btn-outline btn-sm" style="color:#a52b26; border-color:#f6d4d1;" onclick="reviewParticipation('${p.id}', 'rejected')">Reject</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<p style="font-size:12px; color:var(--muted);">Participation table or RPC not configured yet.</p>`;
  }
}

async function reviewParticipation(participationId, decision) {
  try {
    const { error } = await supabaseClient.rpc('admin_review_participation', {
      p_participation_id: participationId,
      p_decision: decision
    });
    if (error) throw error;
    showToast(`Participation ${decision} successfully.`);
    await loadAdminParticipationsTable();
  } catch (e) {
    showToast('Review failed: ' + e.message);
  }
}

async function handleCreateSurvey(e) {
  e.preventDefault();
  const title = document.getElementById('admin-title').value.trim();
  const category = document.getElementById('admin-category').value;
  const description = document.getElementById('admin-description').value.trim();
  const estimated_minutes = parseInt(document.getElementById('admin-duration').value, 10);
  const status = document.getElementById('admin-status').value;
  const survey_url = document.getElementById('admin-url').value.trim();
  const eligibility = document.getElementById('admin-eligibility').value.trim();
  const instructions = document.getElementById('admin-instructions').value.trim();
  const noticeEl = document.getElementById('admin-create-notice');
  const submitBtn = document.getElementById('admin-submit-btn');

  if (!survey_url.startsWith('https://')) {
    noticeEl.className = 'notice show error';
    noticeEl.textContent = 'Survey URL must be a valid secure HTTPS destination.';
    return;
  }

  if (isNaN(estimated_minutes) || estimated_minutes <= 0) {
    noticeEl.className = 'notice show error';
    noticeEl.textContent = 'Estimated duration must be a positive number of minutes.';
    return;
  }

  submitBtn.disabled = true;
  noticeEl.className = 'notice';

  try {
    const { error } = await supabaseClient.from('surveys').insert([
      {
        title,
        category,
        description,
        estimated_minutes,
        duration: `${estimated_minutes} mins`,
        status,
        survey_url,
        eligibility,
        instructions
      }
    ]);

    if (error) throw error;

    noticeEl.className = 'notice show success';
    noticeEl.textContent = 'Survey successfully created and saved to database!';
    showToast('Survey published successfully.');

    e.target.reset();
    await fetchAndRenderSurveys();
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
    const { error } = await supabaseClient
      .from('surveys')
      .update({ status: newStatus })
      .eq('id', surveyId);

    if (error) throw error;
    showToast(`Survey status updated to ${newStatus}`);
    await fetchAndRenderSurveys();
    await loadAdminSurveysTable();
  } catch (e) {
    showToast('Failed to update status: ' + e.message);
  }
}

// Auth
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
  n.className = `notice show ${type}`;
  n.textContent = msg;
}

function clearAuthNotices() {
  const n = document.getElementById('auth-notice');
  n.className = 'notice';
  n.textContent = '';
}

async function submitSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  const submitBtn = document.getElementById('signin-submit-btn');

  submitBtn.disabled = true;
  submitBtn.classList.add('loading');
  clearAuthNotices();

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    currentUser = data.user;
    await checkAdminStatus();
    updateAuthUI();
    closeAuth();
    showToast(`Welcome back, ${currentUser.email}!`);
  } catch (err) {
    showNotice(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
  }
}

async function submitSignUp(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const submitBtn = document.getElementById('signup-submit-btn');

  submitBtn.disabled = true;
  submitBtn.classList.add('loading');
  clearAuthNotices();

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, name: name }
      }
    });

    if (error) throw error;

    if (data && data.session) {
      currentUser = data.session.user;
      await checkAdminStatus();
      updateAuthUI();
      closeAuth();
      showToast(`Account created successfully. Karibu, ${name}!`);
    } else {
      showNotice('Account created successfully! Please check your email inbox to confirm your registration before signing in.', 'success');
      showToast('Registration verification email sent.');
    }
  } catch (err) {
    showNotice(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
  }
}

async function submitPasswordReset() {
  const email = document.getElementById('signin-email').value.trim();
  if (!email) {
    showNotice('Please enter your email address above to reset password.', 'error');
    return;
  }
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href
    });
    if (error) throw error;
    showNotice('Password recovery instructions sent to your email.', 'info');
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

async function signOut() {
  try {
    await supabaseClient.auth.signOut();
    currentUser = null;
    isAdmin = false;
    updateAuthUI();
    navigate('home');
    showToast('Signed out successfully.');
  } catch (e) {
    console.error('Sign out error:', e);
  }
}

async function updateAuthUI() {
  const guestActions = document.getElementById('auth-guest-actions');
  const userActions = document.getElementById('auth-user-actions');
  const greeting = document.getElementById('user-greeting');
  const adminLink = document.getElementById('nav-admin-link');

  if (currentUser) {
    guestActions.classList.add('hidden');
    guestActions.style.display = 'none';
    userActions.classList.remove('hidden');
    userActions.style.display = 'flex';
    greeting.textContent = `Hi, ${currentUser.email.split('@')[0]}`;

    if (isAdmin) {
      adminLink.classList.remove('hidden');
    } else {
      adminLink.classList.add('hidden');
    }
  } else {
    userActions.classList.add('hidden');
    userActions.style.display = 'none';
    guestActions.classList.remove('hidden');
    guestActions.style.display = 'flex';
    adminLink.classList.add('hidden');
  }
}

// Utility: HTML escape
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Toast
function showToast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
  }, 3500);
}
