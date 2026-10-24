# SurveyKE — Your Voice Matters 🇰🇪

A lightweight, mobile-friendly survey directory and participation tracker for Kenyan public opinion polls. Users browse verified surveys, sign in, and participate on external research platforms while SurveyKE records their participation status. Admins manage surveys and review participation from a built-in dashboard.

Built with **vanilla HTML, CSS, and JavaScript** — no build tools, no frameworks, no bundler. Just three files and a Supabase project.

---

## 📁 Project Structure

```
SurveyKE/
├── index.html      # All markup, views, modals, and inline SVG icons
├── styles.css      # All styling, variables, responsive rules
├── app.js          # All app logic: Supabase, auth, routing, admin
└── README.md       # You are here
```

> Flat structure on purpose — open one file, change one thing, commit. No folders to dig through.

---

## ✨ Features

- **Home view** — hero, "How It Works" card, stats band, featured surveys, commitment banner, contact cards.
- **Survey directory** — filterable by category (Public Policy, Technology, Finance, Consumer Goods, Transport, Health, Other).
- **Survey detail view** — eligibility, instructions, and a "Proceed to External Survey" flow.
- **Authentication** — email/password sign up, sign in, sign out, and password reset via Supabase Auth.
- **Participation tracking** — records a `started` row in `survey_participations` before opening the external survey in a new tab.
- **Admin dashboard** — create surveys, publish/close surveys, and approve/reject participation records.
- **Role-based access** — admin link only appears for authorized users.
- **Toast notifications** and inline notices for feedback.
- **Fully responsive** — mobile, tablet, and desktop layouts.

---

## 🚀 Quick Start (GitHub only)

1. Create a new repository on GitHub.
2. Upload the three files: `index.html`, `styles.css`, `app.js`.
3. Go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to `Deploy from a branch`.
5. Choose branch `main` and folder `/ (root)`.
6. Save. Your site will be live at:
   ```
   https://<your-username>.github.io/<repo-name>/
   ```

No build step. No npm. No CI. Push and it deploys.

---

## 🧪 Running Locally

Because the app fetches from Supabase and uses `file://`-unsafe features, serve it over HTTP:

```bash
# Python 3
python -m http.server 8080

# or Node
npx serve .
```

Then open `http://localhost:8080`.

---

## 🗄️ Supabase Setup

The app expects a Supabase project with the following configuration. This is the next phase — GitHub Pages will work as a static shell first, then connect to Supabase.

### 1. Configure credentials

Open `app.js` and replace the placeholder values near the top:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-REAL-ANON-KEY';
```

> ⚠️ The committed anon key is a placeholder (`...EXAMPLE_KEY_ANON`). Replace it with the real publishable anon key from **Supabase Dashboard → Project Settings → API**. Never put your `service_role` key in frontend code.

### 2. Required tables

**`surveys`**

| Column              | Type        | Notes                              |
| ------------------- | ----------- | ---------------------------------- |
| `id`                | uuid        | Primary key, default `gen_random_uuid()` |
| `title`             | text        |                                    |
| `category`          | text        |                                    |
| `description`       | text        |                                    |
| `estimated_minutes` | int4        |                                    |
| `duration`          | text        | e.g. `"5 mins"`                    |
| `status`            | text        | `published` / `draft` / `closed`   |
| `survey_url`        | text        | Must start with `https://`         |
| `eligibility`       | text        | Nullable                           |
| `instructions`      | text        | Nullable                           |
| `created_at`        | timestamptz | Default `now()`                    |

**`survey_participations`**

| Column          | Type        | Notes                                |
| --------------- | ----------- | ------------------------------------ |
| `id`            | uuid        | Primary key                          |
| `survey_id`     | uuid        | FK → `surveys.id`                    |
| `user_id`       | uuid        | FK → `auth.users.id`                 |
| `status`        | text        | e.g. `started`                       |
| `review_status` | text        | `pending` / `approved` / `rejected`  |
| `submitted_at`  | timestamptz | Default `now()`                      |

**`admins`**

| Column    | Type | Notes               |
| --------- | ---- | ------------------- |
| `user_id` | uuid | FK → `auth.users.id` |

### 3. RPC functions

The app calls two RPCs:

- `public.is_admin()` → returns `boolean` for the current user.
- `public.admin_review_participation(p_participation_id uuid, p_decision text)` → updates `review_status`.

Example SQL:

```sql
create or replace function public.is_admin()
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid()
  );
$$;

create or replace function public.admin_review_participation(
  p_participation_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision';
  end if;

  update public.survey_participations
  set review_status = p_decision
  where id = p_participation_id;
end;
$$;
```

### 4. Row Level Security (suggested)

- `surveys`: public `SELECT` only where `status = 'published'`; inserts/updates restricted to admins.
- `survey_participations`: users can `INSERT` their own rows; admins can `SELECT`/`UPDATE` all.
- `admins`: no public access.

### 5. Auth settings

- Enable **Email/Password** under **Authentication → Providers**.
- Add your GitHub Pages URL to **Authentication → URL Configuration → Redirect URLs** so password resets work:
  ```
  https://<your-username>.github.io/<repo-name>/
  ```

---

## 🧭 App Views

| View       | Trigger                               | What it shows                                  |
| ---------- | ------------------------------------- | ---------------------------------------------- |
| `home`     | Default load / logo click             | Hero, stats, featured surveys, contact         |
| `surveys`  | "Explore Active Surveys" / nav link   | Full directory with category filters           |
| `detail`   | "Participate" / "View Details"        | Single survey with participation button        |
| `admin`    | Admin nav link (admins only)          | Create surveys, manage surveys, review participation |

Routing is handled in `app.js` via `navigate(viewName, param)` — it toggles `.hidden` on view containers.

---

## 🛠️ Editing Cheat Sheet

| I want to change…                | Edit file       | Look for…                                      |
| -------------------------------- | --------------- | ---------------------------------------------- |
| Colors, fonts, spacing           | `styles.css`    | `:root` CSS variables                          |
| Hero text / headings             | `index.html`    | `#view-home`, `<h1>`, `.hero-copy`             |
| Contact details / social links   | `index.html`    | `#contact`, `.contact-grid`, `<footer>`        |
| Survey categories / filter chips | `index.html`    | `#directory-topic-chips`                       |
| Supabase URL and anon key        | `app.js`        | `SUPABASE_URL`, `SUPABASE_ANON_KEY`            |
| Admin email fallback             | `app.js`        | `currentUser.email === 'mautinyagah@gmail.com'` |
| Survey card markup               | `app.js`        | `renderHomeSurveys()`, `renderDirectorySurveys()` |
| Survey detail markup             | `app.js`        | `renderSurveyDetail()`                         |
| Admin form fields                | `index.html`    | `#admin-survey-form`                           |

---

## 🧰 Tech Stack

| Layer       | Choice                                    |
| ----------- | ----------------------------------------- |
| Markup      | HTML5, inline SVG symbol library          |
| Styling     | Plain CSS with custom properties          |
| Logic       | Vanilla JavaScript (ES2017+)              |
| Backend     | Supabase (Auth, Postgres, RPC)            |
| Fonts       | Google Fonts — DM Sans, Manrope           |
| Icons       | Inline SVG sprite in `index.html`         |
| Hosting     | GitHub Pages                              |

---

## 🐛 Known Limitations

- The Supabase anon key in `app.js` is a **placeholder** — sign-in, surveys, and admin actions will not work until you replace it.
- Survey URLs must start with `https://`; the app rejects insecure or placeholder links.
- No email confirmation redirect page is bundled — Supabase's default confirmation flow is used.
- Contact form is mailto/WhatsApp/Telegram/Discord links only; no server-side form handler.

---

## 🗺️ Roadmap

- [ ] Move credentials out of `app.js` (config file or environment-based injection)
- [ ] Add a dedicated password-reset landing view
- [ ] Pagination or infinite scroll for the survey directory
- [ ] Participation history for signed-in users
- [ ] Admin analytics (participation counts per survey)
- [ ] Automated Supabase schema migration scripts

---

## 📄 License

Private / internal use — no license specified yet. Add one before public distribution.

---

## 🙌 Credits

Built for Kenya. Maintained by the SurveyKE team.
Questions? Reach out at **facelessdime@gmail.com** or via WhatsApp: **+254 705 559494**.
```
