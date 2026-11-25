import {mountShelf} from './lib/shelf.js';
import {localAnalyze} from './lib/semantic.js';
import { cloudReady, supabase } from './lib/supabase.js';
import { extractDocument, fileRules } from './lib/documents.js';
import { makePlan, notesForTopic, youtubeSearch } from './lib/planner.js';
import './styles.css';

const app = document.querySelector('#app');
const STORE_KEY = 'studymate-v1';
const today = new Date().toISOString().slice(0, 10);
let state = {
  user: null, view: 'overview', analyses: [], plans: [], activeAnalysis: null,
  activePlan: null, busy: false, selectedSyllabus: [], selectedPapers: [],
  notice: '', noticeKind: 'info', modal: null, authMode: 'login', formValues: {},
};

function readLocal() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ analyses: state.analyses, plans: state.plans }));
}
function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function initials(name = '') { return name.split(/[@\s.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'S'; }
function formatDate(value) { return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'; }
function setNotice(message, kind = 'info') { state.notice = message; state.noticeKind = kind; render(); }
function latestAnalysis() { return state.activeAnalysis || state.analyses[0] || null; }
function subjects() { return [...new Set(state.analyses.map((a) => a.subject).filter(Boolean))]; }

async function start() {
  const local = readLocal();
  state.analyses = local.analyses || [];
  state.plans = local.plans || [];
  if (cloudReady) {
    const { data: { session } } = await supabase.auth.getSession();
    state.user = session?.user || null;
    supabase.auth.onAuthStateChange((_event, sessionNow) => {
      state.user = sessionNow?.user || null;
      state.analyses=[];state.plans=[];state.activeAnalysis=null;state.activePlan=null;render(); if(state.user)setTimeout(loadCloudData,0);
    });
    if (state.user) await loadCloudData();
  }
  render();
}

async function loadCloudData() {
  if (!state.user) return;
  const [analyses, plans] = await Promise.all([
    supabase.from('analyses').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('study_plans').select('*').order('created_at', { ascending: false }).limit(50),
  ]);
  if (!analyses.error) state.analyses = (analyses.data || []).map((row) => ({ ...row.result, id: row.id, subject: row.subject, createdAt: row.created_at, syllabusText: row.syllabus_text }));
  if (!plans.error) state.plans = (plans.data || []).map((row) => ({ ...row.plan, id: row.id, analysisId: row.analysis_id, subject: row.subject, createdAt: row.created_at }));
  state.activeAnalysis = state.analyses[0] || null;
  state.activePlan = state.plans[0] || null;
  render();
}

function navItem(view, icon, label, active) {
  return `<button class="nav-item ${active === view ? 'active' : ''}" data-view="${view}"><span class="nav-icon">${icon}</span><span>${label}</span>${view === 'analyzer' ? '<span class="nav-new">AI</span>' : ''}</button>`;
}

function render() {
  const hasCloud = cloudReady && state.user;
  const userName = state.user?.user_metadata?.full_name || state.user?.email || 'Student';
  const analysis = latestAnalysis();
  const currentPlan = state.activePlan || state.plans[0];
  const completedCount = currentPlan?.allTasks?.filter((t) => t.completed).length || 0;
  const taskCount = currentPlan?.allTasks?.length || 0;
  const pct = taskCount ? Math.round(completedCount / taskCount * 100) : 0;
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#" data-view="overview"><img width="32" height="32" src="/studymate.svg" alt=""><span>studymate<span class="brand-dot">.</span></span></a>
        <div class="workspace-label">YOUR WORKSPACE</div>
        <nav class="nav-list">
          ${navItem('overview', icon('grid'), 'Overview', state.view)}
          ${navItem('analyzer', icon('scan'), 'Paper analyzer', state.view)}
          ${navItem('planner', icon('calendar'), 'Study planner', state.view)}
          ${navItem('materials', icon('book'), 'Study materials', state.view)}
          ${navItem('progress', icon('chart'), 'Progress', state.view)}
        ${navItem('samples', icon('file'), 'Human + AI papers', state.view)}</nav>
        <div class="sidebar-bottom">
          <div class="sidebar-help"><div class="help-icon">✳</div><strong>Small steps add up.</strong><p>Turn what you need to learn into a plan you can follow.</p><button data-view="analyzer" class="text-button">Analyze a paper <span>↗</span></button></div>
          <button class="profile-row" id="auth-action"><span class="avatar">${esc(initials(userName))}</span><span class="profile-copy"><strong>${esc(userName.split('@')[0])}</strong><small>${hasCloud ? 'Cloud account' : 'Local workspace'}</small></span><span class="profile-more">${hasCloud ? '⋯' : '↗'}</span></button>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div class="mobile-brand"><img width="32" height="32" src="/studymate.svg" alt=""> studymate<span class="brand-dot">.</span></div><div class="crumb">Student workspace <span>/</span> ${esc(titleFor(state.view))}</div><div class="top-actions"><span class="status-pill ${hasCloud ? 'secure' : 'local'}"><i></i>${hasCloud ? 'Synced privately' : 'Local preview'}</span><button class="icon-button" aria-label="Help" data-view="analyzer">?</button><button class="avatar top-avatar" id="auth-action-top">${esc(initials(userName))}</button></div></header>
        ${state.notice ? `<div class="toast ${state.noticeKind}" role="status">${esc(state.notice)}<button id="dismiss-notice" aria-label="Dismiss">×</button></div>` : ''}
        <div class="page-wrap">${pageFor(state.view, analysis, currentPlan, pct)}</div>
      </main>
    </div>
    ${state.modal ? renderModal(state.modal) : ''}
  `;
  bind();
}

function titleFor(view) { return ({ overview: 'Overview', analyzer: 'Paper analyzer', planner: 'Study planner', materials: 'Study materials', samples: 'Human + AI papers', progress: 'Progress' })[view] || 'Overview'; }

function pageFor(view, analysis, plan, pct) {
  if(view==='samples') return '<header class="page-intro"><div><h1>Human + AI <span>sample papers</span></h1><p>Practice with exam-format papers prepared by the StudyMate creator.</p></div></header><div id="shelf">'+(state.user?'':cloudReady?'<button class="primary-button" data-modal="auth">Sign in to view papers</button>':'Connect Supabase to access the private paper collection.')+'</div>';
  if (view === 'analyzer') return analyzerPage();
  if (view === 'planner') return plannerPage(plan);
  if (view === 'materials') return materialsPage(analysis);
  if (view === 'progress') return progressPage(plan, pct);
  return overviewPage(analysis, plan, pct);
}

function overviewPage(analysis, plan, pct) {
  const firstName = esc((state.user?.user_metadata?.full_name || state.user?.email || 'there').split(/[ @]/)[0]);
  const recent = state.analyses.slice(0, 3);
  const todays = todayTasks(plan);
  return `<section class="welcome-row"><div><div class="eyebrow">${new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</div><h1>Let’s make this semester <span>count, ${firstName}.</span></h1><p class="lead">A clear view of what to focus on, based on your syllabus and past papers.</p></div><button class="primary-button" data-view="analyzer">${icon('plus')} Analyze papers</button></section>
    ${!cloudReady ? '<div class="setup-callout"><span class="setup-icon">i</span><div><strong>Preview mode is active</strong><p>Uploads and plans work in this browser. Connect Supabase and add the Edge Function key to enable private cloud accounts and AI paper analysis.</p></div><button class="text-button" data-modal="setup">Setup guide ↗</button></div>' : ''}
    <section class="metric-grid">
      <article class="metric-card"><div class="metric-head"><span>Subjects analyzed</span><span class="metric-icon mint">${icon('book')}</span></div><div class="metric-number">${subjects().length.toString().padStart(2, '0')}</div><div class="metric-foot">${state.analyses.length ? `${state.analyses.length} analysis${state.analyses.length === 1 ? '' : 'es'} saved` : 'Start with a syllabus and past papers'}</div></article>
      <article class="metric-card"><div class="metric-head"><span>Topics on your plan</span><span class="metric-icon lavender">${icon('list')}</span></div><div class="metric-number">${taskCountText(plan)}</div><div class="metric-foot">${plan ? `${plan.daysLeft} days to your exam` : 'Create a plan after analysis'}</div></article>
      <article class="metric-card"><div class="metric-head"><span>Plan completed</span><span class="metric-icon peach">${icon('check')}</span></div><div class="metric-number">${pct}<small>%</small></div><div class="metric-foot"><span class="inline-progress"><i style="width:${pct}%"></i></span>${plan ? `${plan.allTasks?.filter((t) => t.completed).length || 0} topics completed` : 'Your progress appears here'}</div></article>
    </section>
    <section class="content-grid">
      <div class="panel focus-panel"><div class="panel-heading"><div><div class="eyebrow">YOUR NEXT STEP</div><h2>Today’s study plan</h2></div><button class="text-button" data-view="planner">View plan <span>↗</span></button></div>
        ${todays.length ? `<div class="task-list">${todays.map((t) => taskRow(t, plan)).join('')}</div>` : `<div class="empty-inline"><div class="empty-art">${icon('calendar')}</div><strong>Your next step starts here</strong><p>Analyze a syllabus and question papers, then build a study plan around your exam date.</p><button class="secondary-button" data-view="analyzer">Open paper analyzer</button></div>`}
      </div>
      <div class="panel trend-panel"><div class="panel-heading"><div><div class="eyebrow">FROM YOUR PAPERS</div><h2>Topics to focus on</h2></div><span class="soft-label">${analysis ? esc(analysis.subject) : 'Waiting for papers'}</span></div>${analysis ? topicBars(analysis, 4) : `<div class="mini-empty"><div class="mini-empty-mark">↗</div><p>Your paper trends will appear after analysis.</p></div>`}</div>
    </section>
    <section class="panel recent-panel"><div class="panel-heading"><div><div class="eyebrow">YOUR LIBRARY</div><h2>Recent analyses</h2></div><button class="text-button" data-view="analyzer">New analysis <span>↗</span></button></div>${recent.length ? `<div class="recent-list">${recent.map((a) => `<button class="recent-item" data-analysis="${esc(a.id)}"><span class="subject-icon">${icon('file')}</span><span class="recent-copy"><strong>${esc(a.subject)}</strong><small>${esc(a.meta?.courseCode || 'Syllabus analysis')} · ${a.chapters?.length || 0} chapters mapped</small></span><span class="recent-date">${formatDate(a.createdAt)}</span><span class="recent-arrow">↗</span></button>`).join('')}</div>` : `<p class="muted empty-recent">No analyses yet. Your first one will show up here.</p>`}</section>`;
}

function taskCountText(plan) { return plan?.allTasks?.length?.toString().padStart(2, '0') || '00'; }

function analyzerPage() {
  return `<section class="page-intro"><div><div class="eyebrow">PAST PAPERS, MADE USEFUL</div><h1>See what your papers <span>are telling you.</span></h1><p class="lead">Add your syllabus and past exam papers. We’ll map every question to its chapter, surface repeat patterns, and help you decide what to study next.</p></div><div class="privacy-note">${icon('lock')} Your uploads stay private to your account</div></section>
    <div class="analyzer-layout"><div class="panel analyzer-form"><div class="step-heading"><span class="step-num">01</span><div><h2>Set up your analysis</h2><p>Tell us what subject and syllabus to use.</p></div></div>
      <form id="analysis-form"><div class="field-grid"><label class="field"><span>Subject name <b>*</b></span><input name="subject" placeholder="e.g. Dynamics of Machinery" required maxlength="100" value="${esc(state.formValues.subject || '')}" /></label><label class="field"><span>Course code</span><input name="courseCode" placeholder="e.g. 22ME504" maxlength="40" value="${esc(state.formValues.courseCode || '')}" /></label><label class="field"><span>University / board</span><input name="university" placeholder="e.g. Anna University" maxlength="100" value="${esc(state.formValues.university || '')}" /></label><label class="field"><span>Syllabus regulation</span><input name="regulation" placeholder="e.g. 2022 regulation" maxlength="50" value="${esc(state.formValues.regulation || '')}" /></label></div>
      <div class="upload-section"><div class="upload-label"><span class="step-num">02</span><div><h2>Add your syllabus</h2><p>Upload the syllabus file for accurate chapter mapping.</p></div></div>${uploadZone('syllabus', 'Syllabus file', 'Upload one syllabus file', false)}</div>
      <div class="upload-section"><div class="upload-label"><span class="step-num">03</span><div><h2>Add past question papers</h2><p>More relevant papers give a stronger view of recurring patterns. Add another batch whenever you like.</p></div></div>${uploadZone('papers', 'Past papers', 'Upload one or more question papers', true)}<p class="file-rules">${fileRules}</p></div>
      <div class="analyzer-actions"><div class="ai-disclaimer">${icon('spark')} Every question is mapped to a chapter and topic. Review the mapped questions below.</div><button class="primary-button large" type="submit" id="analyze-button" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span> Analyzing files…' : `${icon('scan')} Analyze my papers`}</button></div><div class="analysis-progress" id="analysis-progress"></div>
      </form></div><aside class="analyzer-aside"><div class="panel how-panel"><div class="eyebrow">WHAT YOU’LL GET</div><h2>A focused picture, not a guess list.</h2><div class="how-step"><span>1</span><div><strong>Question-by-question mapping</strong><p>Each question is assigned to a chapter, topic, and mark value.</p></div></div><div class="how-step"><span>2</span><div><strong>Repeat-topic graph</strong><p>See which chapters show up more often in the papers you uploaded.</p></div></div><div class="how-step"><span>3</span><div><strong>A plan that fits your time</strong><p>Turn the analysis into a schedule based on your exam date and study hours.</p></div></div><div class="how-foot">Recommendations are based on your uploaded material. They can’t guarantee what a future paper will contain.</div></div><div class="small-tip"><span>✳</span><div><strong>Good to know</strong><p>Use papers from the same syllabus regulation where possible. Scanned files are read with OCR.</p></div></div></aside></div>
    ${latestAnalysis() ? renderAnalysis(latestAnalysis()) : ''}`;
}

function uploadZone(key, title, subtitle, multiple) {
  const selected = key === 'syllabus' ? state.selectedSyllabus : state.selectedPapers;
  return `<label class="upload-zone" for="${key}-input"><input id="${key}-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" ${multiple ? 'multiple' : ''} /><span class="upload-icon">${icon('upload')}</span><span class="upload-copy"><strong>${selected.length ? `${selected.length} file${selected.length === 1 ? '' : 's'} selected` : title}</strong><small>${selected.length ? selected.map((f) => esc(f.name)).join(' · ') : subtitle}</small></span><span class="upload-choose">Browse files</span></label>`;
}

function renderAnalysis(a) {
  return `<section class="panel analysis-result" id="analysis-result"><div class="result-top"><div><div class="eyebrow">ANALYSIS COMPLETE · ${formatDate(a.createdAt || new Date().toISOString())}</div><h2>${esc(a.subject)} <span class="soft-label">${a.source === 'local' ? 'Local preview' : 'Paper analysis'}</span></h2><p>${esc(a.summary || 'Questions mapped against your syllabus and uploaded papers.')}</p></div><button class="primary-button" id="create-plan">${icon('calendar')} Build my study plan</button></div>
    ${a.patterns?.length ? `<div class="pattern-strip">${icon('spark')} <div><strong>Pattern insights</strong><p>${a.patterns.slice(0, 2).map((p) => esc(typeof p === 'string' ? p : p.summary)).join(' · ')}</p></div></div>` : ''}
    <div class="analysis-columns"><div><h3>Most repeated syllabus topics</h3>${topicBars(a, 8)}</div><div><h3>Mapped chapters <span class="muted">${a.chapters?.length || 0}</span></h3><div class="chapter-stack">${(a.chapters || []).map((ch) => `<div class="chapter-line"><span class="chapter-badge">${esc(ch.number || '•')}</span><div><strong>${esc(ch.title)}</strong><small>${ch.questionCount || 0} question${ch.questionCount === 1 ? '' : 's'} · ${esc((ch.topics || []).slice(0, 3).join(', ') || 'Topic mapped')}</small></div><span class="priority-tag ${esc(ch.priority || 'medium')}">${esc(ch.priority || 'medium')} focus</span></div>`).join('') || '<p class="muted">No chapters found in the uploaded syllabus.</p>'}</div></div></div>
    <details class="mapped-questions"><summary>Review mapped questions <span>(${(a.chapters || []).reduce((sum, c) => sum + (c.questions?.length || 0), 0)} mapped · ${a.unmappedQuestions?.length || 0} need review)</span></summary>${(a.chapters || []).flatMap((c) => (c.questions || []).map((q) => `<div class="mapped-q"><span class="q-mark">${esc(q.marks ?? '—')} marks</span><div><strong>${esc(q.topic || c.title)}</strong><p>${esc(q.text)}</p><small>${esc(c.title)} · ${esc(q.paperYear || 'Paper year not detected')}</small></div></div>`)).join('')}${(a.unmappedQuestions || []).map((q) => `<div class="mapped-q unmapped"><span class="q-mark">Needs review</span><div><strong>Could not confidently map this question</strong><p>${esc(q.text)}</p><small>${esc(q.reason || 'Check the extracted question and syllabus wording')} · ${esc(q.paperYear || 'Paper year not detected')}</small></div></div>`).join('') || (!a.chapters?.some((c) => c.questions?.length) ? '<p class="muted">No question text was extracted. Check that the paper is readable and try another upload.</p>' : '')}</details></section>`;
}

function topicBars(analysis, limit = 8) {
  const counts=new Map();
  for(const ch of analysis.chapters||[]) for(const q of ch.questions||[]){
    const label=q.topic; if(!label)continue;
    const group=counts.get(label)||{title:label,papers:new Set(),total:0};
    group.papers.add(q.paperYear||'Unknown source');group.total++;counts.set(label,group);
  }
  const chapters=[...counts.values()].sort((a,b)=>b.papers.size-a.papers.size||b.total-a.total).slice(0,limit).map(g=>({...g,title:g.title+' · '+g.total+' questions',questionCount:g.papers.size}));
  if (!chapters.length) return '<div class="mini-empty"><p>Upload past papers to see the topic frequency graph.</p></div>';
  const max = Math.max(...chapters.map((c) => c.questionCount || 0), 1);
  return `<div class="bar-chart"><small>Distinct papers per topic</small>${chapters.map((c) => `<div class="bar-row"><div class="bar-label" title="${esc(c.title)}">${esc(c.title)}</div><div class="bar-track"><i style="width:${Math.max(5, Math.round((c.questionCount || 0) / max * 100))}%" class="${c.priority === 'high' ? 'hot' : ''}"></i></div><span class="bar-count">${c.questionCount || 0}</span></div>`).join('')}</div>`;
}

function plannerPage(plan) {
  if (!plan) return `<section class="page-intro"><div><div class="eyebrow">YOUR STUDY PLAN</div><h1>A plan built around <span>your semester.</span></h1><p class="lead">First analyze a syllabus and the papers for one subject. Then set your exam date and available study time.</p></div></section><div class="panel empty-state"><div class="empty-art">${icon('calendar')}</div><h2>No study plan yet</h2><p>Your customized planner appears after you analyze a subject.</p><button class="primary-button" data-view="analyzer">Analyze papers</button></div>`;
  const all = plan.allTasks || [];
  const complete = all.filter((t) => t.completed).length;
  return `<section class="page-intro planner-intro"><div><div class="eyebrow">${esc(plan.subject || latestAnalysis()?.subject || 'YOUR SUBJECT')}</div><h1>Your plan, <span>one topic at a time.</span></h1><p class="lead">${plan.daysLeft} days to your exam · ${plan.minutesPerDay} minutes each day</p></div><button class="secondary-button" id="edit-plan">Edit plan details</button></section>
    <div class="plan-summary"><div><div class="eyebrow">PLAN PROGRESS</div><strong>${complete}<small> / ${all.length} topics done</small></strong><div class="progress-track"><i style="width:${all.length ? complete / all.length * 100 : 0}%"></i></div></div><div class="plan-date"><span>EXAM DATE</span><strong>${formatDate(plan.examDate)}</strong></div><div class="plan-date"><span>DAILY STUDY TIME</span><strong>${plan.minutesPerDay} min</strong></div></div>
    <div class="schedule-list">${(plan.schedule || []).map((day, i) => `<section class="schedule-day"><div class="day-date"><span class="day-count">${String(i + 1).padStart(2, '0')}</span><strong>${new Date(`${day.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}</strong><small>${formatDate(day.date)}</small></div><div class="day-tasks">${day.tasks?.length ? day.tasks.map((t) => planTaskCard(t, latestAnalysis())).join('') : '<div class="rest-card">Light revision or rest day</div>'}</div></section>`).join('')}</div>`;
}

function planTaskCard(task, analysis) {
  return `<article class="plan-task ${task.completed ? 'done' : ''}"><button class="task-check ${task.completed ? 'checked' : ''}" data-task="${esc(task.id)}" aria-label="Mark ${task.completed ? 'not done' : 'done'}">${task.completed ? '✓' : ''}</button><div class="plan-task-main"><div class="plan-task-overline">${esc(task.chapter)} · ${task.minutes} MIN</div><h3>${esc(task.topic)}</h3><p>${esc(task.goal)}</p><small>${esc(task.reason || 'From your analysis')}</small></div><div class="task-resources"><button data-notes="${esc(task.topic)}" data-chapter="${esc(task.chapter)}">${icon('note')} Notes</button><a href="${youtubeSearch(task.topic, analysis?.subject || 'university exam', task.chapter)}" target="_blank" rel="noopener noreferrer">${icon('play')} Watch video ↗</a></div></article>`;
}

function taskRow(task, plan) {
  return `<div class="today-task"><button class="task-check ${task.completed ? 'checked' : ''}" data-task="${esc(task.id)}" aria-label="Mark ${task.completed ? 'not done' : 'done'}">${task.completed ? '✓' : ''}</button><div class="today-task-copy"><strong>${esc(task.topic)}</strong><small>${esc(task.chapter)} · ${task.minutes} min</small></div><button class="task-open" data-view="planner">Open <span>↗</span></button></div>`;
}

function todayTasks(plan) {
  if (!plan) return [];
  const date = today;
  const todaySchedule = plan.schedule?.find((d) => d.date === date);
  return todaySchedule?.tasks || plan.allTasks?.filter((t) => !t.completed).slice(0, 3) || [];
}

function materialsPage(analysis) {
  if (!analysis) return `<section class="page-intro"><div><div class="eyebrow">STUDY MATERIALS</div><h1>Useful material for <span>each topic.</span></h1><p class="lead">Your materials are organized from the analysis you upload. Start by mapping your subject.</p></div></section><div class="panel empty-state"><div class="empty-art">${icon('book')}</div><h2>Analyze a subject first</h2><p>We’ll create topic cards with revision notes and targeted video links.</p><button class="primary-button" data-view="analyzer">Open paper analyzer</button></div>`;
  return `<section class="page-intro"><div><div class="eyebrow">${esc(analysis.subject)} · ${analysis.chapters?.length || 0} CHAPTERS</div><h1>Study material, <span>topic by topic.</span></h1><p class="lead">Open revision notes or find a focused video for each topic in your analysis.</p></div><button class="secondary-button" data-view="analyzer">Analyze another subject</button></section>
    <div class="materials-list">${(analysis.chapters || []).flatMap((ch) => (ch.topics?.length ? ch.topics : [ch.title]).map((topic) => `<article class="material-card"><div class="material-symbol">${icon('book')}</div><div class="material-copy"><div class="eyebrow">${esc(ch.title)}</div><h3>${esc(topic)}</h3><p>${(ch.questions || []).filter((q) => q.topic === topic).length ? 'Appeared in your uploaded papers' : 'From your subject syllabus'}</p></div><div class="material-actions"><button class="secondary-button small" data-notes="${esc(topic)}" data-chapter="${esc(ch.title)}">${icon('note')} Get notes</button><a class="video-button" href="${youtubeSearch(topic, analysis.subject, ch.title)}" target="_blank" rel="noopener noreferrer">${icon('play')} Find videos ↗</a></div></article>`)).join('') || '<div class="panel empty-state"><h2>No topics mapped yet</h2><p>Review the extracted files and run the analyzer again.</p></div>'}</div>`;
}

function progressPage(plan, pct) {
  const all = plan?.allTasks || [];
  const done = all.filter((t) => t.completed);
  const left = all.filter((t) => !t.completed);
  return `<section class="page-intro"><div><div class="eyebrow">KEEP MOVING FORWARD</div><h1>Your effort, <span>made visible.</span></h1><p class="lead">Track your planned topics and see how your preparation is progressing.</p></div></section>${plan ? `<div class="progress-hero"><div class="progress-ring" style="--progress:${pct * 3.6}deg"><div><strong>${pct}%</strong><small>complete</small></div></div><div><div class="eyebrow">${esc(plan.subject || latestAnalysis()?.subject || '')}</div><h2>You’ve completed ${done.length} of ${all.length} topics.</h2><p>${left.length ? `${left.length} topics remain on your plan. Keep your pace steady.` : 'Your current plan is complete. Add a new subject or refresh this plan.'}</p></div></div><div class="progress-columns"><div class="panel"><div class="panel-heading"><div><div class="eyebrow">COMPLETED</div><h2>Done and reviewed</h2></div><span class="soft-label">${done.length}</span></div>${done.length ? done.map((t) => `<div class="progress-topic"><span class="done-check">✓</span><div><strong>${esc(t.topic)}</strong><small>${esc(t.chapter)}</small></div></div>`).join('') : '<p class="muted">Completed topics will appear here.</p>'}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">UP NEXT</div><h2>Still to cover</h2></div><span class="soft-label">${left.length}</span></div>${left.slice(0, 7).map((t) => `<div class="progress-topic"><span class="not-done-check"></span><div><strong>${esc(t.topic)}</strong><small>${esc(t.chapter)}</small></div></div>`).join('') || '<p class="muted">Nothing left in this plan.</p>'}</div></div>` : `<div class="panel empty-state"><div class="empty-art">${icon('chart')}</div><h2>Your progress will show here</h2><p>Create your first study plan to start tracking preparation.</p><button class="primary-button" data-view="analyzer">Analyze papers</button></div>`}`;
}

function renderModal(kind) {
  if (kind === 'auth') return `<div class="modal-backdrop" data-close-modal><section class="modal-card auth-card"><button class="modal-close" data-close-modal>×</button><a class="brand modal-brand"><img width="32" height="32" src="/studymate.svg" alt=""><span>studymate<span class="brand-dot">.</span></span></a><div class="eyebrow">YOUR STUDENT WORKSPACE</div><h2>${state.authMode === 'signup' ? 'Create your account' : 'Welcome back'}</h2><p class="muted">Keep your analyses and study plans private and synced.</p><form id="auth-form"><label class="field"><span>Full name</span><input name="name" autocomplete="name" placeholder="Your name" ${state.authMode === 'signup' ? 'required' : 'hidden'} /></label><label class="field"><span>Email address</span><input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label><label class="field"><span>Password</span><input name="password" type="password" required minlength="8" autocomplete="${state.authMode === 'signup' ? 'new-password' : 'current-password'}" placeholder="At least 8 characters" /></label><button class="primary-button full" type="submit">${state.authMode === 'signup' ? 'Create account' : 'Sign in'}</button></form><p class="auth-switch">${state.authMode === 'signup' ? 'Already have an account?' : 'New to StudyMate?'} <button class="text-button" id="auth-switch">${state.authMode === 'signup' ? 'Sign in' : 'Create account'}</button></p></section></div>`;
  if (kind === 'planner') return `<div class="modal-backdrop" data-close-modal><section class="modal-card"><button class="modal-close" data-close-modal>×</button><div class="eyebrow">MAKE IT YOURS</div><h2>Build your study plan</h2><p class="muted">We’ll use your available time and topic priorities to shape a realistic schedule.</p><form id="planner-form"><label class="field"><span>Exam date <b>*</b></span><input name="examDate" type="date" min="${today}" required value="${today}" /></label><label class="field"><span>Study time available each day</span><select name="minutesPerDay"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="90">1 hour 30 minutes</option><option value="120">2 hours</option><option value="180">3 hours</option></select></label><label class="field"><span>Topics you find difficult</span><input name="weakTopics" placeholder="Separate topics with commas" /></label><button class="primary-button full" type="submit">Create my plan ↗</button></form></section></div>`;
  if (kind === 'notes') {
    const { topic, chapter } = state.noteData || {};
    const material = notesForTopic(latestAnalysis() || {}, topic || '', chapter || '');
    const notesContent = state.noteLoading
      ? '<div class="notes-loading"><span class="spinner small-spinner"></span> Preparing topic notes…</div>'
      : state.noteContent
        ? `<pre class="generated-notes">${esc(state.noteContent)}</pre>`
        : `<div class="note-checklist"><strong>Quick revision checklist</strong>${material.checklist.map((item) => `<label><input type="checkbox" /> ${esc(item)}</label>`).join('')}<p class="preview-hint">Connect the AI service to generate full notes for this topic.</p></div>`;
    return `<div class="modal-backdrop" data-close-modal><section class="modal-card notes-card"><button class="modal-close" data-close-modal>×</button><div class="eyebrow">${esc(chapter)}</div><h2>${esc(material.title)}</h2><p class="muted">${esc(material.overview)}</p>${notesContent}${material.questions?.length ? `<div class="notes-question"><strong>Past-paper question for revision</strong><p>${esc(material.questions[0].text)}</p><small>${esc(material.questions[0].marks || '—')} marks · ${esc(material.questions[0].paperYear || 'Year not detected')}</small></div>` : ''}<a class="primary-button full anchor-button" href="${youtubeSearch(topic || '', latestAnalysis()?.subject || '', chapter || '')}" target="_blank" rel="noopener noreferrer">${icon('play')} Find a video explanation ↗</a></section></div>`;
  }
  if (kind === 'setup') return `<div class="modal-backdrop" data-close-modal><section class="modal-card setup-modal"><button class="modal-close" data-close-modal>×</button><div class="eyebrow">ENABLE CLOUD FEATURES</div><h2>Connect your Supabase project</h2><ol><li>Create a free Supabase project and copy its project URL and publishable/anon key.</li><li>Copy <code>.env.example</code> to <code>.env</code> and add those two values.</li><li>Run <code>supabase/migrations/001_studymate.sql</code> in the Supabase SQL editor.</li><li>Deploy <code>supabase/functions/analyze-papers</code> and set the <code>GEMINI_API_KEY</code> secret for AI analysis.</li><li>Build and deploy this Vite app to Netlify.</li></ol><p class="muted">The AI key stays in the Supabase function, never in the browser. Supabase free quotas and Google AI limits apply.</p><button class="secondary-button full" data-close-modal>Got it</button></section></div>`;
  return '';
}

function icon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10M12 7v10"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20M8 7h8"/>',
    chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/>',
    note: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    play: '<path d="m8 5 12 7-12 7z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}

function bind() {
  mountShelf(document.querySelector("#shelf"),state.user);
  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', (event) => { event.preventDefault(); state.view = el.dataset.view; state.notice = ''; render(); window.scrollTo(0, 0); }));
  document.querySelectorAll('[data-modal]').forEach((el) => el.addEventListener('click', () => { state.modal = el.dataset.modal; render(); }));
  document.querySelectorAll('[data-close-modal]').forEach((el) => el.addEventListener('click', (event) => { if (event.target === el || event.target.closest('.modal-close') || event.target.closest('[data-close-modal]:not(.modal-backdrop)')) { state.modal = null; render(); } }));
  document.querySelectorAll('#auth-action, #auth-action-top').forEach((el) => el.addEventListener('click', () => {
    if (!cloudReady) { state.modal = 'setup'; render(); return; }
    if (state.user) { supabase.auth.signOut(); return; }
    state.modal = 'auth'; render();
  }));
  document.querySelector('#dismiss-notice')?.addEventListener('click', () => { state.notice = ''; render(); });
  document.querySelector('#auth-switch')?.addEventListener('click', () => { state.authMode = state.authMode === 'login' ? 'signup' : 'login'; render(); });
  document.querySelector('#auth-form')?.addEventListener('submit', handleAuth);
  document.querySelector('#syllabus-input')?.addEventListener('change', (e) => { state.selectedSyllabus = [...e.target.files].slice(0, 1); render(); });
  document.querySelector('#papers-input')?.addEventListener('change', (e) => { state.selectedPapers = [...state.selectedPapers, ...e.target.files].slice(0, 12); render(); });
  document.querySelector('#analysis-form')?.addEventListener('submit', handleAnalyze);
  document.querySelector('#analysis-form')?.addEventListener('input', (event) => {
    const form = event.currentTarget;
    state.formValues = Object.fromEntries(new FormData(form));
  });
  document.querySelector('#create-plan')?.addEventListener('click', () => { state.modal = 'planner'; render(); });
  document.querySelector('#planner-form')?.addEventListener('submit', handlePlan);
  document.querySelector('#edit-plan')?.addEventListener('click', () => { state.modal = 'planner'; render(); });
  document.querySelectorAll('[data-task]').forEach((el) => el.addEventListener('click', () => toggleTask(el.dataset.task)));
  document.querySelectorAll('[data-notes]').forEach((el) => el.addEventListener('click', () => openNotes(el.dataset.notes, el.dataset.chapter)));
  document.querySelectorAll('[data-analysis]').forEach((el) => el.addEventListener('click', () => { state.activeAnalysis = state.analyses.find((a) => a.id === el.dataset.analysis); state.view = 'analyzer'; render(); }));
}

async function openNotes(topic, chapter) {
  state.noteData = { topic, chapter };
  state.noteContent = '';
  state.noteLoading = Boolean(cloudReady && state.user);
  state.modal = 'notes';
  render();
  if (!cloudReady || !state.user) return;
  const analysis = latestAnalysis();
  const question = analysis?.chapters?.find((item) => item.title === chapter)?.questions?.find((item) => item.topic === topic);
  const { data, error } = await supabase.functions.invoke('generate-notes', {
    body: {
      subject: analysis?.subject || 'University subject',
      chapter, topic,
      regulation: analysis?.meta?.regulation || '',
      syllabusContext: (analysis?.syllabusText || '').slice(0, 7000),
      pastQuestion: question?.text || '',
    },
  });
  state.noteLoading = false;
  if (error) state.noteContent = `Notes could not be generated. ${error.message || 'Check that the generate-notes function is deployed and try again.'}`;
  else state.noteContent = data?.notes || 'The notes service returned an empty response. Please try again.';
  if (state.modal === 'notes') render();
}

async function handleAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email')).trim();
  const password = String(form.get('password'));
  state.busy = true;
  try {
    const result = state.authMode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: String(form.get('name') || '').trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    state.modal = null;
    if (state.authMode === 'signup' && !result.data.session) setNotice('Check your email to confirm your account, then sign in.', 'success');
    else setNotice(state.authMode === 'signup' ? 'Account created. Your workspace is ready.' : 'Welcome back.', 'success');
  } catch (error) { setNotice(error.message || 'Could not sign in. Please try again.', 'error'); }
  finally { state.busy = false; render(); }
}

async function handleAnalyze(event) {
  event.preventDefault();
  if (!state.selectedSyllabus.length || !state.selectedPapers.length) { setNotice('Add one syllabus file and at least one question paper to continue.', 'error'); return; }
  const form = new FormData(event.currentTarget);
  const meta = { courseCode: String(form.get('courseCode') || '').trim(), university: String(form.get('university') || '').trim(), regulation: String(form.get('regulation') || '').trim() };
  const subject = String(form.get('subject') || '').trim();
  state.busy = true; state.notice = ''; render();
  const progress = (message) => { const el = document.querySelector('#analysis-progress'); if (el) el.innerHTML = `<span class="spinner small-spinner"></span>${esc(message)}`; };
  try {
    const syllabusText = await extractDocument(state.selectedSyllabus[0], progress);
    if (!syllabusText.trim()) throw new Error('No readable text found in the syllabus. Try a clearer PDF or image.');
    const paperPayload = [];
    for (const file of state.selectedPapers) {
      const text = await extractDocument(file, progress);
      paperPayload.push({ fileName: file.name, text });
    }
    if (paperPayload.every((paper) => paper.text.trim().length < 40)) throw new Error('No readable question text found. Try a text-based PDF or a clearer scan.');
    progress(cloudReady && state.user ? 'Uploading files privately and analyzing patterns…' : 'Analyzing text in local preview…');
    let result;
    let id = crypto.randomUUID();
    if (cloudReady && state.user) {
      const filePaths = [];
      for (const file of [...state.selectedSyllabus, ...state.selectedPapers]) {
        const path = `${state.user.id}/${id}/${crypto.randomUUID()}-${cleanFileName(file.name)}`;
        const { error } = await supabase.storage.from('student-files').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
        if (error) throw error;
        filePaths.push(path);
      }
      const { data, error } = await supabase.functions.invoke('analyze-papers', { body: { subject, meta, syllabusText, papers: paperPayload } });
      if (error) throw error;
      result = data.analysis;
      const { data: saved, error: saveError } = await supabase.from('analyses').insert({ id, subject, course_code: meta.courseCode, university: meta.university, regulation: meta.regulation, syllabus_text: syllabusText, paper_files: filePaths, result }).select().single();
      if (saveError) throw saveError;
      id = saved.id;
    } else {
      result = await localAnalyze(subject, meta, syllabusText, paperPayload);
      result.source = 'local';
    }
    const analysis = { ...result, id, subject, meta, syllabusText, createdAt: new Date().toISOString() };
    state.analyses = [analysis, ...state.analyses.filter((a) => a.id !== id)];
    state.activeAnalysis = analysis;
    state.selectedSyllabus = []; state.selectedPapers = [];
    if (!cloudReady || !state.user) saveLocal();
    state.formValues = {};
    render();
    document.querySelector('#analysis-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setNotice(friendlyError(error), 'error');
  } finally { state.busy = false; if (document.querySelector('#analyze-button')) render(); }
}

function cleanFileName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100); }

function friendlyError(error) {
  const message = error?.message || 'Something went wrong during analysis.';
  if (message.includes('Failed to fetch') && cloudReady) return 'Could not reach the analysis service. Confirm the Supabase function is deployed and GEMINI_API_KEY is set.';
  if (message.includes('Invalid JWT') || message.includes('401')) return 'Your sign-in session expired. Sign in again and retry.';
  return message;
}

async function handlePlan(event) {
  event.preventDefault();
  const analysis = latestAnalysis();
  if (!analysis) { state.modal = null; state.view = 'analyzer'; render(); return; }
  const form = new FormData(event.currentTarget);
  const input = { examDate: String(form.get('examDate')), minutesPerDay: String(form.get('minutesPerDay')), weakTopics: String(form.get('weakTopics') || '') };
  const planData = makePlan(analysis, input);
  planData.subject = analysis.subject;
  let id = crypto.randomUUID();
  if (cloudReady && state.user) {
    const { data, error } = await supabase.from('study_plans').insert({ id, analysis_id: analysis.id, subject: analysis.subject, exam_date: input.examDate, minutes_per_day: Number(input.minutesPerDay), weak_topics: input.weakTopics.split(',').map((t) => t.trim()).filter(Boolean), plan: planData }).select().single();
    if (error) { setNotice(error.message, 'error'); return; }
    id = data.id;
  }
  const plan = { ...planData, id, analysisId: analysis.id, createdAt: new Date().toISOString() };
  state.plans = [plan, ...state.plans.filter((p) => p.analysisId !== analysis.id)];
  state.activePlan = plan; state.modal = null; state.view = 'planner';
  if (!cloudReady || !state.user) saveLocal();
  render(); window.scrollTo(0, 0);
}

async function toggleTask(taskId) {
  const plan = state.activePlan || state.plans[0];
  if (!plan) return;
  const update = (task) => task.id === taskId ? { ...task, completed: !task.completed } : task;
  plan.allTasks = plan.allTasks.map(update);
  plan.schedule = plan.schedule.map((day) => ({ ...day, tasks: day.tasks.map(update) }));
  if (cloudReady && state.user) {
    const { error } = await supabase.from('study_plans').update({ plan: { ...plan, updatedAt: new Date().toISOString() } }).eq('id', plan.id);
    if (error) { setNotice(`Could not save progress: ${error.message}`, 'error'); return; }
  } else saveLocal();
  render();
}

function bindDragAndDrop() {
  document.querySelectorAll('.upload-zone').forEach((zone) => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('dragging');
      const isSyllabus = zone.htmlFor === 'syllabus-input';
      const accepted = [...e.dataTransfer.files].filter((f) => f.size <= 15 * 1024 * 1024);
      if (isSyllabus) state.selectedSyllabus = accepted.slice(0, 1); else state.selectedPapers = [...state.selectedPapers, ...accepted].slice(0, 12);
      render();
    });
  });
}

const originalBind = bind;
bind = function bindWithDrop() { originalBind(); bindDragAndDrop(); };

start();
