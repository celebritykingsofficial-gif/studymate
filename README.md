# StudyMate

StudyMate turns a student's syllabus and past question papers into chapter-wise analysis, an exam-focused study plan, and topic-level revision links. The app includes:

- Supabase email/password authentication, private file storage, Postgres data, and Row Level Security.
- PDF and text extraction in the browser, with OCR for scanned PDFs and images.
- An authenticated Supabase Edge Function that calls the Gemini API without exposing the AI key in the browser.
- Chapter/topic mapping, past-paper frequency, evidence-based priority labels, and question review.
- A customized preparation schedule with notes prompts, targeted YouTube links, and saved completion state.
- A local preview mode when Supabase has not been configured yet. Local preview data stays in that browser and uses text matching rather than AI analysis.

Prediction results are evidence-based study priorities, not guarantees about a future exam. The app intentionally does not show the internal chapter-half classification used while assessing paper-choice patterns.

## 1. Run locally

Install Node.js 20.19+ or 22.12+ and npm, then:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Without Supabase environment values the app runs in local preview mode.

## 2. Connect Supabase

1. Create a Supabase project.
2. In the project settings, copy the **Project URL** and the browser-safe **publishable key** (or legacy anon key).
3. Copy `.env.example` to `.env` and add the values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

4. In Supabase **SQL Editor**, run `supabase/migrations/001_studymate.sql`. This creates the private analysis tables, private `student-files` bucket, and per-user access policies.
5. Install the Supabase CLI, authenticate, link this folder to your project, and deploy both functions:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy analyze-papers
supabase functions deploy generate-notes
```

6. Create a Gemini API key in Google AI Studio, then store it as an Edge Function secret. The secret is used only on the server:

```sh
supabase secrets set GEMINI_API_KEY=YOUR_KEY
```

The function defaults to `gemini-3.8-flash`. To choose another model exposed to your API project, set `GEMINI_MODEL` as a Supabase secret. Model access and free-tier quotas depend on Google's current account and usage limits; Supabase free tier does not itself include an AI model key.

7. In Supabase **Authentication → URL Configuration**, add the local and deployed app URLs to the allowed redirect URLs. Set the Netlify domain as the site URL after deployment.

## 3. Deploy to Netlify

Import the project folder/repository in Netlify. The included `netlify.toml` sets the build command (`npm run build`) and publish directory (`dist`). Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Netlify environment variables, then deploy.

You can also create a production build locally with:

```sh
npm run build
```

## Data and file handling

- Files are extracted in the student's browser, then originals are uploaded to that student's private storage folder when signed in.
- Only the signed-in account can access its own rows and files. The AI function checks the user's session and keeps the Gemini key server-side.
- Each source file is limited to 15 MB and each analysis accepts up to 12 past papers.
- Local preview does not sync to other devices and does not perform semantic AI analysis.
- Configure a suitable privacy notice, account deletion process, and provider quotas before opening the site to a full student cohort.

## Main files

- `src/main.js` — screens, upload flow, Supabase calls, planner, and progress tracking.
- `src/lib/documents.js` — PDF/text extraction and OCR.
- `src/lib/planner.js` — schedule generation and study resource links.
- `supabase/migrations/001_studymate.sql` — tables, storage bucket, and RLS policies.
- `supabase/functions/analyze-papers/index.ts` — authenticated AI paper analysis.

## Human + AI sample papers
Run supabase/migrations/002_sample_papers.sql once after the first migration. Sign up with your creator account. In Supabase Authentication → Users copy your account UUID and run the following in SQL Editor, replacing the placeholder:
```sql
insert into public.paper_creators(user_id) values ('YOUR-ACCOUNT-UUID');
```
Open Human + AI papers, upload numbered page images, enter the exam details and publish. Students can sign in to read and download each page. Publication is immediate. Edit details also allows replacement page images.
