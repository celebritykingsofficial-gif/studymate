const dayMs = 86400000;

export function makePlan(analysis, input) {
  const examDate = new Date(`${input.examDate}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const daysLeft = Math.max(1, Math.ceil((examDate - today) / dayMs));
  const minutesPerDay = Math.max(15, Number(input.minutesPerDay) || 60);
  const weak = new Set((input.weakTopics || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const chapters = (analysis.chapters || []).map((ch) => ({ ...ch, weight: scoreChapter(ch, weak) }))
    .sort((a, b) => b.weight - a.weight);
  const tasks = [];
  chapters.forEach((ch) => {
    const topics = ch.topics?.length ? ch.topics : [ch.title];
    topics.forEach((topic) => {
      tasks.push({
        id: crypto.randomUUID(), chapter: ch.title, topic,
        goal: `Review notes and solve one ${ch.sampleMarks || 8}-mark question`,
        minutes: Math.max(25, Math.round((minutesPerDay * 0.7) / Math.max(1, topics.length))),
        completed: false, priority: ch.priority || 'medium',
        reason: ch.reason || 'Included in your syllabus analysis',
      });
    });
  });
  if (!tasks.length) tasks.push({ id: crypto.randomUUID(), chapter: 'Your syllabus', topic: 'Review the highest-priority topics', goal: 'Read notes and solve one past-paper question', minutes: 45, completed: false, priority: 'high', reason: 'Start with topics repeated in your uploaded papers' });
  const scheduleLength = Math.max(1, Math.min(daysLeft, tasks.length));
  const schedule = Array.from({ length: scheduleLength }, (_, i) => ({
    date: new Date(today.getTime() + i * dayMs).toISOString().slice(0, 10),
    tasks: [], minutes: 0,
  }));
  tasks.forEach((task, i) => {
    let dayIndex = schedule.findIndex((day) => day.minutes + task.minutes <= minutesPerDay);
    if (dayIndex < 0) dayIndex = Math.min(i, schedule.length - 1);
    schedule[dayIndex].tasks.push(task);
    schedule[dayIndex].minutes += task.minutes;
  });
  return { examDate: input.examDate, minutesPerDay, daysLeft, schedule: schedule.filter((day) => day.tasks.length), allTasks: tasks, createdAt: new Date().toISOString() };
}

function scoreChapter(ch, weak) {
  const isWeak = weak.size && [ch.title, ...(ch.topics || [])].some((label) => weak.has(label.toLowerCase()));
  return (ch.questionCount || 0) * 3 + (ch.priority === 'high' ? 8 : ch.priority === 'medium' ? 4 : 0) + (isWeak ? 10 : 0);
}

export function youtubeSearch(topic, subject, chapter) {
  const q = `${subject} ${topic} ${chapter || ''} university exam solved explanation`.replace(/\s+/g, ' ').trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export function notesForTopic(analysis, topic, chapter) {
  const match = analysis.chapters?.find((c) => c.title === chapter);
  const questions = (match?.questions || []).filter((q) => q.topic === topic);
  return {
    title: topic,
    chapter,
    overview: `Revise the core idea of ${topic} from ${chapter}. Use your class notes and textbook for the exact notation used in your course.`,
    checklist: ['Write the key definition or governing equation from memory.', 'Review one worked example step by step.', 'Attempt a past-paper question without looking at the solution.', 'Check units, assumptions, and the final answer.'],
    questions,
  };
}
