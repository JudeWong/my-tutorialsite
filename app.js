const PAPERS_KEY = "tixi_papers_v1";
const ASSIGNMENTS_KEY = "tixi_assignments_v1";

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let papers = readStoredArray(PAPERS_KEY);
let assignments = readStoredArray(ASSIGNMENTS_KEY);
let questions = [];

const TOPIC_EN = Object.freeze({
  "综合试卷": "General Paper",
  "程序设计": "Programming",
  "数据库": "Database",
  "电脑网络": "Computer Networks",
  "硬件": "Hardware"
});

papers = papers.map((paper, index) => ({
  id: paper.id || `paper-${paper.createdAt || Date.now()}-${index}`,
  title: paper.title || paper.fileName || "Untitled Paper",
  titleEn: paper.titleEn || paper.title || paper.fileName || "Untitled Paper",
  year: String(paper.year || new Date().getFullYear()),
  topic: paper.topic || "综合试卷",
  topicEn: paper.topicEn || TOPIC_EN[paper.topic] || "General Paper",
  count: Number(paper.count) || 0,
  status: paper.status || "待校对",
  statusEn: paper.statusEn || "Needs review",
  fileName: paper.fileName || "",
  fileSize: Number(paper.fileSize) || 0,
  createdAt: paper.createdAt || new Date().toISOString()
}));

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let role = "teacher";
let currentQuestion = 0;
let activeAssignmentIndex = 0;
const answers = Array(questions.length).fill(null);
let selectedOption = null;
let pendingUploadFile = null;
let toastTimer;
let codeTimer;
let activeStudent = null;
const SUPERADMIN_EMAIL = "wsl@chms3.edu.my";
const PASSWORD_KEY = "tixi_superadmin_password";
const STUDENTS_KEY = "tixi_students";
const CLASSES_KEY = "tixi_classes";
const LANGUAGE_KEY = "tixi_language_v2";
const LEVEL_TARGETS = [2, 5, 8];
let currentLanguage = "en";
let lastAIQuestion = "";
let aiReplyTimer;
let aiConversation = [];
let activeWorkspaceView = null;
let activePaperFilter = "全部";
const originalTextNodes = new WeakMap();
const UI_EN = Object.freeze({
  "语言": "Language",
  "系统愿景": "Vision",
  "核心功能": "Features",
  "开始学习": "Start Learning",
  "下载 Android APK": "Download Android APK",
  "开始学习 →": "Start Learning →",
  "解析": "Explanations",
  "进度": "Progress",
  "问答": "Chat",
  "STEP 01 — 分析条件": "STEP 01 — Analyse the conditions",
  "STEP 02 — 排除错误": "STEP 02 — Eliminate wrong answers",
  "STEP 03 — 理解答案": "STEP 03 — Understand the answer",
  "Superadmin 初始密码：": "Initial Superadmin password: ",
  "，登入后可修改。": ". You can change it after signing in.",
  "AI助理": "AI Assistant",
  "修改 Superadmin 密码 →": "Change Superadmin Password →",
  "0 个班级": "0 classes",
  "第": "Question",
  "中等": "Intermediate",
  "你的私人AI助理": "Your Personal AI Assistant",
  "你的私人": "Your Personal",
  "AI 助理": "AI Assistant",
  "为独中电脑科打造的智能学习伙伴。": "An intelligent learning partner built for independent-school computer science.",
  "整理历届考题、即时解释答案，并陪伴每一位学生持续进步。": "Organize past papers, explain answers instantly, and help every student improve.",
  "改变学生理解": "Transform how students",
  "电脑科学的方式": "understand computer science",
  "AI 不只是给出答案。它能把复杂概念拆成清楚步骤、指出常见错误，并根据每位学生的学习进度提供更适合的练习。": "AI does more than provide answers. It breaks down complex ideas, identifies common mistakes, and recommends practice for every learner.",
  "进入学习系统": "Enter Learning System",
  "一个系统，连接老师、学生与 AI": "One system connecting teachers, students, and AI",
  "历届考题智能整理": "Intelligent Past-Paper Organization",
  "老师上传 PDF 或试卷图片后，系统协助整理年份、题型、知识点与答案解析，让旧试卷成为可重复使用的互动学习资源。": "Upload PDFs or paper images and turn them into reusable interactive questions, topics, and explanations.",
  "作答、解释与常见错误": "Answers, Explanations, and Common Mistakes",
  "学生完成题目后立即获得逐步解释，不只知道答案，更能理解为什么答错以及下次应该注意什么。": "Students receive step-by-step explanations and learn why an answer was wrong and what to notice next time.",
  "通用 AI 与学习成长": "General AI and Learning Growth",
  "学生可以向通用 AI 提问，也能透过完成作业与查看学习数据，持续建立自己的学习节奏。": "Ask general AI anything and build a steady learning rhythm through assignments and progress insights.",
  "不同的学生，": "Different learners need",
  "需要不同的学习路径。": "different learning paths.",
  "系统记录每一次练习与错误，把数据转化成老师看得懂、学生用得上的学习建议。": "Every practice attempt becomes useful guidance that teachers understand and students can act on.",
  "现在开始": "Start Now",
  "学习系统": "Learning System",
  "关键数字": "Key Numbers",
  "老师与学生端": "Teacher and student portals",
  "学习成长阶段": "Learning growth stages",
  "通用 AI 对话": "General AI conversations",
  "随时随地学习": "Learn anytime, anywhere",
  "AI 智能整理": "AI Organization",
  "从试卷自动辨识题目、选项与知识点。": "Recognize questions, choices, and topics from papers.",
  "即时讲解": "Instant Explanations",
  "作答后立即显示解析和常见错误。": "Show explanations and common mistakes after every answer.",
  "个人化学习": "Personalized Learning",
  "依照每位学生的弱项推荐练习。": "Recommend practice based on each student's weak areas.",
  "跨设备使用": "Cross-Device Access",
  "电脑、平板和手机都能流畅学习。": "Learn smoothly on computers, tablets, and phones.",
  "为独中电脑科打造 · 老师与学生的智能学习平台": "Built for independent-school computer science · An intelligent platform for teachers and students",
  "← 返回首页": "← Back to Home",
  "登入学习空间": "Sign In to Your Learning Space",
  "选择身份以继续使用你的私人 AI 助理。": "Choose your role to continue with your personal AI assistant.",
  "老师登入": "Teacher Sign In",
  "学生登入": "Student Sign In",
  "电邮账号": "Email",
  "密码": "Password",
  "登入老师端": "Enter Teacher Portal",
  "已有账号": "Existing Account",
  "注册新账号": "Create Account",
  "中文姓名": "Chinese Name",
  "例如：林家豪": "For example: Lim Jia Hao",
  "例如：高二理信": "For example: Senior 2 Science A",
  "班级": "Class",
  "入学年份": "Enrollment Year",
  "登入学生端": "Enter Student Portal",
  "老师验证码": "Teacher Verification Code",
  "验证码由老师端产生，每小时自动更换。": "The teacher portal generates a new code every hour.",
  "注册并开始学习": "Register and Start Learning",
  "私人AI助理": "Personal AI Assistant",
  "电脑科学习系统": "Computer Science Learning System",
  "总览": "Overview",
  "历届题库": "Past Papers",
  "班级进度": "Class Progress",
  "学习分析": "Learning Analytics",
  "需要协助？": "Need Help?",
  "查看上传与出题指南": "View upload and question guides",
  "老师端": "Teacher Portal",
  "学生端": "Student Portal",
  "登出": "Log Out",
  "上传历届考题": "Upload Past Papers",
  "题库总题数": "Questions in Library",
  "学生完成率": "Student Completion",
  "平均正确率": "Average Accuracy",
  "活跃学生": "Active Students",
  "最近整理的考题": "Recently Organized Papers",
  "查看全部": "View All",
  "全部": "All",
  "程序设计": "Programming",
  "数据库": "Database",
  "网络": "Networking",
  "硬件": "Hardware",
  "学生注册验证码": "Student Registration Code",
  "每小时自动更换，用于学生注册。": "Changes hourly and is required for student registration.",
  "复制": "Copy",
  "重新生成": "Regenerate",
  "你": "You",
  "本小时内有效": "Valid for this hour",
  "修改 Superadmin 密码": "Change Superadmin Password",
  "管理学生班级": "Manage Student Classes",
  "新增班级": "Add Class",
  "班级表现": "Class Performance",
  "快捷操作": "Quick Actions",
  "上传试卷": "Upload Paper",
  "建立练习": "Create Practice",
  "邀请学生": "Invite Students",
  "导出报告": "Export Report",
  "继续上次练习": "Continue Practice",
  "连续学习": "Learning Streak",
  "答题正确率": "Answer Accuracy",
  "完成题数": "Questions Completed",
  "班级排名": "Class Rank",
  "本阶段完成": "Completed This Stage",
  "累计正确率": "Overall Accuracy",
  "完成第一份练习": "Complete the first practice",
  "掌握程序设计": "Master programming",
  "继续解锁学习成就": "Keep unlocking learning achievements",
  "✓ 完成第一份练习": "✓ Complete the first practice",
  "✦ 掌握程序设计": "✦ Master programming",
  "→ 继续解锁学习成就": "→ Keep unlocking learning achievements",
  "生成式": "Generative",
  "你的 AI 对话助理": "Your AI Chat Assistant",
  "像 ChatGPT 与 Gemini 一样，以连续对话协助学习、创作和解决问题。": "A conversational assistant for learning, creating, and solving problems—similar to ChatGPT and Gemini.",
  "新对话": "New Chat",
  "模型": "Model",
  "在线": "Online",
  "你好！我是你的生成式 AI 助理。你可以连续提问、要求我解释、改写、比较或产生新点子。": "Hi! I'm your generative AI assistant. Ask follow-up questions, request explanations, rewrites, comparisons, or new ideas.",
  "Python 循环": "Python Loops",
  "温习计划": "Study Plan",
  "认识 AI": "Understanding AI",
  "AI 可能会出错，请检查重要信息。": "AI can make mistakes. Check important information.",
  "我的学习成长": "My Learning Growth",
  "完成练习、累积能力，持续看见自己的进步。": "Complete practice, build skills, and keep seeing your progress.",
  "下一等级": "Next Level",
  "注册即可使用": "Available at registration",
  "点击装备": "Equip",
  "已装备 · 点击卸下": "Equipped · Click to remove",
  "恢复基础": "Reset Outfit",
  "使用中": "In Use",
  "老师布置的练习": "Teacher Assignments",
  "本周目标": "Weekly Goal",
  "只差一步！完成一份练习即可达标。": "Almost there! Complete one more practice to reach your goal.",
  "请输入密码": "Enter password",
  "请输入真实中文姓名": "Enter your real Chinese name",
  "6 位数验证码": "6-digit verification code",
  "输入消息，按 Enter 发送……": "Message AI and press Enter to send…",
  "任何问题都可以问我……": "Ask me anything…",
  "2026 学年 · 高中电脑科": "2026 Academic Year · Senior Computer Science",
  "早上好，Teacher Jude": "Good morning, Teacher Jude",
  "今天也一起把复杂的知识，变成学生看得懂的答案。": "Let's turn complex knowledge into answers students can understand.",
  "把验证码交给学生完成注册，有效期至本小时结束。": "Give this code to students for registration. It remains valid until the end of the hour.",
  "自动更换倒数": "Refresh countdown",
  "学生班级列表": "Student Class List",
  "＋ 添加": "+ Add",
  "此列表会同步到学生登入与注册页面。": "This list is synced with student sign-in and registration.",
  "PDF / 图片": "PDF / Image",
  "从题库选题": "Select from library",
  "分享班级码": "Share class code",
  "学习数据": "Learning data",
  "星期二 · 继续保持学习节奏": "Tuesday · Keep up your learning rhythm",
  "嗨，": "Hi, ",
  "！准备好挑战了吗？": "! Ready for a challenge?",
  "← 返回总览": "← Back to Overview",
  "此模块已预留，正式系统可在这里连接后端资料库与账号权限。": "This module is reserved for the production database and account permissions.",
  "← 退出练习": "← Exit Practice",
  "第 ": "Question ",
  "上一题": "Previous",
  "提交答案": "Submit Answer",
  "下一题 →": "Next →",
  "答题进度": "Question Progress",
  "已作答": "Answered",
  "未作答": "Unanswered",
  "慢慢来，想清楚再回答。": "Take your time and think it through.",
  "提交后会显示完整解析。": "A full explanation appears after submission.",
  "题库": "Library",
  "班级": "Class",
  "分析": "Analytics",
  "上传历届考题": "Upload Past Papers",
  "系统会自动辨识题目、选项与年份，上传后仍可人工校对。": "The system recognizes questions, choices, and years automatically. You can review them after upload.",
  "拖放试卷到这里，或点击选择文件": "Drop papers here or click to choose files",
  "支持 PDF、JPG、PNG；每个文件不超过 25MB": "Supports PDF, JPG, and PNG up to 25MB each",
  "考试年份": "Exam Year",
  "主要分类": "Main Category",
  "综合试卷": "General Paper",
  "电脑网络": "Computer Networking",
  "取消": "Cancel",
  "开始整理": "Start Processing",
  "修改密码": "Change Password",
  "为 Superadmin 设置新密码。修改后请使用新密码登入。": "Set a new Superadmin password. Use the new password next time you sign in.",
  "目前密码": "Current Password",
  "新密码": "New Password",
  "确认新密码": "Confirm New Password",
  "储存新密码": "Save New Password"
  ,"暂无班级": "No Classes"
  ,"尚未建立班级": "No Classes Yet"
  ,"请先在上方添加班级。": "Add a class above to get started."
  ,"学生": "Student"
  ,"老师尚未布置练习。": "No assignments have been assigned yet."
  ,"已完成账号注册": "Account registered"
  ,"学习后将解锁更多成就": "More achievements will appear as you learn"
  ,"本周尚未设置练习目标。": "No weekly goal has been assigned."
  ,"/ 0 份": "/ 0 assignments"
  ,"互动练习": "Interactive Practice"
  ,"题": "questions"
  ,"编辑试卷": "Edit Paper"
  ,"修改试卷名称、年份、分类与整理状态，储存后会立即更新题库。": "Update the paper title, year, category, and status. Changes are saved immediately."
  ,"试卷名称": "Paper Title"
  ,"整理状态": "Status"
  ,"待校对": "Needs Review"
  ,"已整理": "Organized"
  ,"储存修改": "Save Changes"
  ,"解析": "Explanations"
  ,"进度": "Progress"
  ,"问答": "Q&A"
  ,"STEP 01 — 分析条件": "STEP 01 — Analyze conditions"
  ,"STEP 02 — 排除错误": "STEP 02 — Eliminate errors"
  ,"STEP 03 — 理解答案": "STEP 03 — Understand the answer"
  ,"开始学习 →": "Start Learning →"
  ,"AI助理": "AI Assistant"
  ,"Teacher Jude": "Teacher Jude"
  ,"综合试卷": "General Paper"
  ,"编辑 →": "Edit →"
  ,"修改 Superadmin 密码 →": "Change Superadmin Password →"
  ,"开始练习": "Start Practice"
  ,"查看解析": "View Explanation"
  ,"一": "Mon"
  ,"二": "Tue"
  ,"三": "Wed"
  ,"四": "Thu"
  ,"五": "Fri"
  ,"六": "Sat"
  ,"日": "Sun"
  ,"中等": "Intermediate"
});

function applyLanguage(language = "zh", { persist = true } = {}) {
  currentLanguage = language === "en" ? "en" : "zh";
  document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-Hans";
  if (persist) localStorage.setItem(LANGUAGE_KEY, currentLanguage);
  $$(".language-select").forEach((select) => { select.value = currentLanguage; });

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style")) continue;
    if (!originalTextNodes.has(node)) {
      const value = node.nodeValue || "";
      const trimmed = value.trim();
      if (!trimmed) continue;
      originalTextNodes.set(node, {
        source: trimmed,
        leading: value.match(/^\s*/)?.[0] || "",
        trailing: value.match(/\s*$/)?.[0] || ""
      });
    }
    const original = originalTextNodes.get(node);
    node.nodeValue = `${original.leading}${currentLanguage === "en" ? UI_EN[original.source] || original.source : original.source}${original.trailing}`;
  }

  $$('[placeholder]').forEach((element) => {
    if (!element.dataset.placeholderZh) element.dataset.placeholderZh = element.getAttribute("placeholder") || "";
    const source = element.dataset.placeholderZh;
    element.setAttribute("placeholder", currentLanguage === "en" ? UI_EN[source] || source : source);
  });
  document.title = currentLanguage === "en"
    ? "Your Personal AI Assistant · Computer Science Learning Platform"
    : "你的私人AI助理 · 电脑科互动学习平台";
}

function refreshLanguage() {
  if (currentLanguage === "en") applyLanguage("en", { persist: false });
}

function getTeacherPassword() {
  return localStorage.getItem(PASSWORD_KEY) || "0000";
}

function getStudents() {
  try {
    return JSON.parse(localStorage.getItem(STUDENTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function getClasses() {
  try {
    const stored = JSON.parse(localStorage.getItem(CLASSES_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function savePapers() {
  localStorage.setItem(PAPERS_KEY, JSON.stringify(papers));
}

function saveAssignments() {
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
}

function saveClasses(classes) {
  localStorage.setItem(CLASSES_KEY, JSON.stringify(classes));
  renderClassOptions();
  renderTeacherClasses();
  renderTeacherMetrics();
  renderClassPerformance();
}

function getHourKey(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()].join("-");
}

function getHourlyCode(date = new Date()) {
  const seed = `${SUPERADMIN_EMAIL}-${getHourKey(date)}`;
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String(100000 + ((hash >>> 0) % 900000));
}

function populateYears() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, index) => currentYear - index);
  const options = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  $("#student-login-year").innerHTML = options;
  $("#register-year").innerHTML = options;
  $("#upload-year").innerHTML = options;
  $("#edit-paper-year").innerHTML = options;
}

function renderClassOptions() {
  const classes = getClasses();
  const options = classes.length
    ? classes.map((className) => `<option value="${escapeHTML(className)}">${escapeHTML(className)}</option>`).join("")
    : `<option value="" disabled selected>${localized("No classes available", "暂无班级")}</option>`;
  $("#student-login-class").innerHTML = options;
  $("#register-class").innerHTML = options;
}

function renderTeacherClasses() {
  const classes = getClasses();
  $("#class-count").textContent = localized(`${classes.length} classes`, `${classes.length} 个班级`);
  $("#class-list").innerHTML = classes.map((className) => `<span class="class-chip">${escapeHTML(className)}<button type="button" data-remove-class="${escapeHTML(className)}" aria-label="${localized(`Remove ${className}`, `移除 ${className}`)}">×</button></span>`).join("");
  refreshLanguage();
}

function renderTeacherMetrics() {
  const questionCount = papers.reduce((total, paper) => total + (Number(paper.count) || 0), 0);
  const completedAssignments = assignments.filter((assignment) => assignment.done).length;
  const completionRate = assignments.length ? Math.round((completedAssignments / assignments.length) * 100) : 0;
  const students = getStudents();
  const classes = getClasses();
  $("#teacher-question-count").textContent = questionCount.toLocaleString();
  $("#teacher-paper-count").textContent = localized(`${papers.length} papers uploaded`, `${papers.length} 份试卷已上传`);
  $("#teacher-completion-rate").innerHTML = `${completionRate}<sup>%</sup>`;
  $("#teacher-completion-note").textContent = localized(`${completedAssignments} of ${assignments.length} assignments completed`, `${completedAssignments} / ${assignments.length} 份练习已完成`);
  $("#teacher-accuracy").textContent = "—";
  $("#teacher-accuracy-note").textContent = localized("No graded results yet", "尚无评分记录");
  $("#teacher-student-count").textContent = students.length;
  $("#teacher-class-count").textContent = localized(`${classes.length} classes`, `${classes.length} 个班级`);
}

function renderClassPerformance() {
  const classes = getClasses();
  const select = $("#performance-class-select");
  if (!select) return;
  select.innerHTML = classes.length
    ? classes.map((className) => `<option value="${escapeHTML(className)}">${escapeHTML(className)}</option>`).join("")
    : `<option value="">${localized("No classes", "暂无班级")}</option>`;
  select.disabled = !classes.length;
  $("#performance-empty").innerHTML = classes.length
    ? `<strong>${localized("No performance data yet", "尚无学习表现数据")}</strong><p>${localized("Results will appear after students complete graded assignments.", "学生完成评分练习后，成绩会显示在这里。")}</p>`
    : `<strong>${localized("No classes yet", "尚未建立班级")}</strong><p>${localized("Add a class above to begin collecting learning data.", "请先在上方添加班级。")}</p>`;
}

function showPublicScreen(screen) {
  $("#landing-page").classList.toggle("screen-hidden", screen !== "landing");
  $("#auth-screen").classList.toggle("screen-hidden", screen !== "auth");
  $("#learning-app").classList.add("screen-hidden");
  document.body.classList.remove("app-active");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openAuth() {
  showPublicScreen("auth");
  $("#teacher-password").focus();
}

function updateAccountUI() {
  const isTeacher = role === "teacher";
  const displayName = isTeacher ? "Teacher Jude" : activeStudent?.name || localized("Student", "学生");
  const avatarText = isTeacher ? "J" : displayName.slice(-1);
  $("#account-role").textContent = isTeacher ? localized("Teacher Portal · Superadmin", "老师端 · Superadmin") : `${activeStudent?.className || localized("Student Portal", "学生端")} · ${localized("Student", "学生")}`;
  $("#account-button").textContent = avatarText;
  $("#sidebar-avatar").textContent = avatarText;
  $("#sidebar-name").textContent = displayName;
  $("#sidebar-role").textContent = isTeacher ? "Superadmin" : `${activeStudent?.className} · ${activeStudent?.year}`;
  if (!isTeacher) $("#student-greeting-name").textContent = displayName.replace(/^[^·]*·/, "").slice(-2);
  refreshLanguage();
}

function enterApp(nextRole, student = null) {
  role = nextRole;
  activeStudent = student;
  $("#landing-page").classList.add("screen-hidden");
  $("#auth-screen").classList.add("screen-hidden");
  $("#learning-app").classList.remove("screen-hidden");
  document.body.classList.add("app-active");
  updateAccountUI();
  setRole(nextRole);
  if (nextRole === "teacher") startCodeTimer();
  else clearInterval(codeTimer);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function updateVerificationCode() {
  $("#verification-code").textContent = getHourlyCode();
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  const remaining = Math.max(0, nextHour - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  $("#code-countdown").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startCodeTimer() {
  clearInterval(codeTimer);
  updateVerificationCode();
  codeTimer = setInterval(updateVerificationCode, 1000);
}

function renderPapers(filter = "全部") {
  activePaperFilter = filter;
  const topicFilter = filter === "网络" ? "电脑网络" : filter;
  const visible = filter === "全部" ? papers : papers.filter((p) => p.topic === topicFilter || (filter === "硬件" && p.topic === "综合试卷"));
  $("#paper-list").innerHTML = visible.map((paper) => `
    <article class="paper-row">
      <div class="paper-year">${paper.year}</div>
      <div class="paper-info"><strong>${escapeHTML(currentLanguage === "en" ? paper.titleEn : paper.title)}</strong><small>${paper.count} ${localized("questions", "道题目")} · ${escapeHTML(currentLanguage === "en" ? paper.statusEn : paper.status)}</small></div>
      <div class="paper-meta"><span>${escapeHTML(currentLanguage === "en" ? paper.topicEn : paper.topic)}</span><button data-paper-id="${escapeHTML(paper.id)}">${localized("Edit Paper →", "编辑试卷 →")}</button></div>
    </article>`).join("") || `<div class="data-empty"><strong>${localized("No papers uploaded", "尚未上传试卷")}</strong><p>${localized("Upload a PDF or image to create your first paper record.", "上传 PDF 或图片即可建立第一份试卷记录。")}</p><button type="button" data-empty-upload>${localized("Upload Past Paper", "上传历届试卷")}</button></div>`;
  renderTeacherMetrics();
  refreshLanguage();
}

function renderAssignments() {
  $("#assignment-list").innerHTML = assignments.length ? assignments.map((item, index) => `
    <article class="assignment ${item.done ? "done" : ""}">
      <div class="paper-year">${item.icon}</div>
      <div><strong>${escapeHTML(currentLanguage === "en" ? item.titleEn : item.title)}</strong><small>${escapeHTML(currentLanguage === "en" ? item.detailEn : item.detail)}</small></div>
      <button data-assignment="${index}">${escapeHTML(currentLanguage === "en" ? item.actionEn : item.action)}</button>
    </article>`).join("") : `<div class="data-empty"><strong>${localized("No assignments yet", "尚未布置练习")}</strong><p>${localized("Assignments created by the teacher will appear here.", "老师建立练习后会显示在这里。")}</p></div>`;
  updateStudentProgress();
  renderTeacherMetrics();
  refreshLanguage();
}

function updateStudentProgress() {
  const progressText = $("#student-completed-count");
  if (!progressText) return;
  const completed = assignments.filter((assignment) => assignment.done).length;
  const nextTarget = LEVEL_TARGETS.find((target) => target > completed) || LEVEL_TARGETS[LEVEL_TARGETS.length - 1];
  const previousTarget = [...LEVEL_TARGETS].reverse().find((target) => target <= completed) || 0;
  const percentage = completed >= LEVEL_TARGETS[LEVEL_TARGETS.length - 1] ? 100 : Math.min(100, ((completed - previousTarget) / (nextTarget - previousTarget)) * 100);
  progressText.textContent = currentLanguage === "en" ? `${completed} / ${nextTarget} assignments` : `${completed} / ${nextTarget} 份作业`;
  $("#student-progress-bar").style.width = `${percentage}%`;
  const level = Math.max(1, LEVEL_TARGETS.filter((target) => completed >= target).length + 1);
  $(".student-progress-card .level-chip").textContent = `LV. ${level}`;
  $("#student-level-number").textContent = level;
  $("#student-accuracy").textContent = "—";
  $("#student-progress-accuracy").textContent = "—";
  $("#student-streak").textContent = localized("0 days", "0 天");
  $("#student-question-count").textContent = "0";
  $("#student-rank").textContent = "—";
  $("#student-weekly-count").textContent = completed;
  $("#student-weekly-total").textContent = `/ ${assignments.length}`;
  $("#student-hero-summary").textContent = assignments.length
    ? localized(`${completed} of ${assignments.length} assignments completed.`, `已完成 ${completed} / ${assignments.length} 份练习。`)
    : localized("No assignments have been assigned yet.", "老师尚未布置练习。 ");
  $("#continue-quiz").disabled = !assignments.length || !questions.length;
  $("#student-achievements").innerHTML = `<span>✓ ${localized("Account registered", "已完成账号注册")}</span>${completed ? `<span>✓ ${localized(`${completed} assignments completed`, `已完成 ${completed} 份练习`)}</span>` : ""}<span>→ ${localized("More achievements will appear as you learn", "学习后将解锁更多成就")}</span>`;
  $("#weekly-goal-note").textContent = assignments.length
    ? localized("Complete the assigned practice to build your progress.", "完成老师布置的练习以累积进度。")
    : localized("No weekly goal has been assigned.", "本周尚未设置练习目标。 ");
}

function getAIAnswer(question) {
  const normalized = question.toLowerCase();
  const model = $("#ai-model-select")?.value || "general";
  if (/(python|循环|for|列表|result)/i.test(normalized)) {
    return localized(
      "For this kind of Python question, trace the variables one iteration at a time: note each value of n, check whether the condition is true, and record how result changes. With n > 4, only 6 and 8 are included, so the total is 14.",
      "这类 Python 题可以逐次追踪变量：先写出每一次循环的 n，再判断条件是否成立，最后记录 result 的变化。以 n > 4 为例，6 和 8 会被选中，所以总和是 14。"
    );
  }
  if (/(sql|select|insert|数据库|资料表)/i.test(normalized)) {
    return localized(
      "SELECT retrieves data, INSERT creates records, UPDATE changes them, and DELETE removes them. You can remember these as CRUD: Create, Read, Update, and Delete.",
      "SELECT 用于读取资料，INSERT 用于新增记录；UPDATE 修改，DELETE 删除。学习时可以把它们记成 CRUD：Create、Read、Update、Delete。"
    );
  }
  if (/(ip|网络|子网|遮罩|192)/i.test(normalized)) {
    return localized(
      "/24 means the first 24 bits identify the network. For 192.168.1.20/24, an address on the same subnet must begin with 192.168.1. Check the mask first, then compare the network portion.",
      "/24 表示前 24 位是网络部分。以 192.168.1.20/24 为例，同一子网的地址必须以 192.168.1 开头。判断时先看遮罩，再比较网络部分。"
    );
  }
  if (/(硬件|cpu|记忆体|ram|储存)/i.test(normalized)) {
    return localized(
      "A simple distinction is: the CPU performs calculations, RAM temporarily holds active data, and an SSD or hard drive stores data long term. Tell me which components you would like to compare.",
      "可以先这样区分：CPU 负责运算，RAM 暂存正在使用的资料，SSD 或硬盘负责长期保存资料。你也可以告诉我具体想比较哪两个硬件。"
    );
  }
  if (/(温习|复习|计划|时间表|考试|study|revision|exam|schedule)/i.test(normalized)) {
    return localized(
      "Try a 45-minute focus block followed by a 10-minute break: review concepts for 10 minutes, practise for 25 minutes, then correct your work for 10 minutes. Choose two topics today and record every mistake.",
      "可以采用 45 分钟专注＋10 分钟休息：先用 10 分钟复习概念，25 分钟做题，最后 10 分钟订正。今天先选两个主题，每个主题完成一轮，并把错题记进清单。"
    );
  }
  if (/(人工智能|ai|机器学习|生成式|machine learning|generative)/i.test(normalized)) {
    return localized(
      "Artificial intelligence enables computers to perform tasks that normally require human intelligence, such as understanding language, recognising images, and making predictions. Generative AI creates new text, images, or code from learned patterns, but people should still verify its output.",
      "人工智能是让电脑执行通常需要人类智能的任务，例如理解文字、辨识图像和作出预测。生成式 AI 更进一步，会根据学习到的模式创造文字、图片或程式码，但仍需要人类检查准确性。"
    );
  }
  if (/(作文|写作|文章|演讲|摘要|essay|writing|speech|summary)/i.test(normalized)) {
    return localized(
      "I can help you plan it. First identify the topic and audience, then organise it as: opening idea, two or three key points, examples, and a concluding action. Send me the exact prompt and I can draft an outline.",
      "我可以协助构思。建议先确定主题和读者，再用“开场观点 → 两到三个重点 → 例子 → 总结行动”组织内容。把题目发给我，我可以继续帮你拟大纲。"
    );
  }
  if (/(数学|方程|几何|百分比|概率|math|equation|geometry|percentage|probability)/i.test(normalized)) {
    return localized(
      "For a mathematics problem, list the known information and the goal first, choose the relevant formula, and substitute values step by step. Send the full question and what you have tried; I will explain the reasoning rather than only giving the final answer.",
      "数学题最重要的是先列出已知条件和目标，再选择公式并逐步代入。请把完整题目与已尝试的步骤发给我，我会逐步解释，而不是只给最终答案。"
    );
  }
  if (/(科学|物理|化学|生物|science|physics|chemistry|biology)/i.test(normalized)) {
    return localized(
      "I can explain a science concept through three layers: the phenomenon, the principle, and an example. Tell me the specific topic—such as force, energy, acids and bases, or cells—and I will explain it at a student-friendly level.",
      "我可以用“现象、原理、例子”三个层次说明科学概念。请告诉我具体主题，例如力、能量、酸碱或细胞，我会用适合学生的方式解释。"
    );
  }
  if (/(翻译|translate|translation|英文|马来文|日文)/i.test(normalized)) {
    return localized(
      "Yes. Send the complete text and target language. I can adapt the tone for formal, everyday, or student use and explain important vocabulary.",
      "可以，请把要翻译的完整内容和目标语言告诉我。我也能根据正式、日常或学生程度调整语气，并解释重要词汇。"
    );
  }
  if (/(历史|地理|国家|文化|人物|history|geography|country|culture)/i.test(normalized)) {
    return localized(
      "I can explain this through background, key events, effects, and examples. Tell me the country, person, or period you want to learn about and I will organise it into a clear answer.",
      "我可以从背景、关键事件、影响与例子几个部分说明这个主题。若你告诉我想了解的国家、人物或时期，我会整理成清楚易读的答案。"
    );
  }
  if (/(故事|创意|点子|设计|取名|story|creative|idea|design|name)/i.test(normalized)) {
    return localized(
      "Certainly. I can propose several creative directions and expand the one you prefer. Tell me the purpose, audience, and desired mood, and I will provide ideas you can use immediately.",
      "当然可以。我可以提供多个创意方向，并依照你想要的风格继续扩写。告诉我用途、对象和希望呈现的感觉，我会给你一组可直接使用的点子。"
    );
  }
  if (model === "study") {
    return localized(
      `We can organise “${question}” into four learning steps: identify the core concept, study a concrete example, apply it, and summarise it in your own words. Tell me your year level or the part you find most confusing and I will guide you step by step.`,
      `我们可以把「${question}」整理成四个学习步骤：先确认核心概念，再看一个具体例子，接着尝试应用，最后用自己的话总结。告诉我你的年级或目前最不明白的部分，我会继续逐步引导。`
    );
  }
  if (model === "creative") {
    return localized(
      `For “${question}”, I can begin with three directions: practical and direct, bold and innovative, or light and playful. Choose one and I will expand it into complete content.`,
      `针对「${question}」，我可以先提供三个不同方向：一个实用直接、一个大胆创新、一个轻松有趣。你可以选择喜欢的方向，我再继续扩写成完整内容。`
    );
  }
  return localized(
    `I can help with “${question}” through its definition, key ideas, examples, and practical applications. To make the answer more useful, add the angle you are interested in, the context, or your preferred answer length.`,
    `关于「${question}」，我可以从定义、重点、例子和实际应用几个方向协助你。为了给出最准确而完整的回答，你也可以补充想了解的角度、使用情境或希望的答案长度。`
  );
}

function appendChatMessage(type, message, { typing = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${type === "user" ? "user-message" : "ai-message"}${typing ? " typing-message" : ""}`;
  const avatar = document.createElement("span");
  avatar.textContent = type === "user" ? localized("You", "你") : "AI";
  const body = document.createElement("div");
  body.className = "message-body";
  const text = document.createElement("p");
  if (typing) {
    text.className = "typing-dots";
    text.innerHTML = "<i></i><i></i><i></i>";
  } else {
    text.textContent = message;
  }
  body.appendChild(text);
  if (type === "ai" && !typing) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = `<button type="button" data-copy-message>复制</button><button type="button" data-regenerate>重新生成</button>`;
    body.appendChild(actions);
  }
  wrapper.append(avatar, body);
  $("#ai-chat-log").appendChild(wrapper);
  $("#ai-chat-log").scrollTop = $("#ai-chat-log").scrollHeight;
  refreshLanguage();
  return wrapper;
}

async function askAI(question, { repeatUser = true } = {}) {
  const trimmed = question.trim();
  if (!trimmed) return;
  lastAIQuestion = trimmed;
  clearTimeout(aiReplyTimer);
  if (repeatUser) {
    appendChatMessage("user", trimmed);
    aiConversation.push({ role: "user", content: trimmed });
  } else if (aiConversation.at(-1)?.role === "assistant") {
    aiConversation.pop();
  }
  const typingMessage = appendChatMessage("ai", "", { typing: true });
  const submitButton = $("#ai-question-form button[type='submit']");
  submitButton.disabled = true;
  try {
    const configuredEndpoint = globalThis.PERSONAL_AI_CONFIG?.aiEndpoint?.trim();
    const response = await fetch(configuredEndpoint || "./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: trimmed,
        messages: aiConversation.slice(-12),
        mode: $("#ai-model-select")?.value || "general",
        language: currentLanguage
      })
    });
    if (!response.ok) throw new Error(`AI endpoint returned ${response.status}`);
    const data = await response.json();
    if (!data.reply || typeof data.reply !== "string") throw new Error("AI response was empty");
    typingMessage.remove();
    aiConversation.push({ role: "assistant", content: data.reply });
    appendChatMessage("ai", data.reply);
    const status = $("#ai-connection-status");
    if (status) {
      status.classList.remove("offline");
      status.innerHTML = `<i></i> ${localized("Online · Gemini", "在线 · Gemini")}`;
    }
  } catch (error) {
    typingMessage.remove();
    const fallback = getAIAnswer(trimmed);
    aiConversation.push({ role: "assistant", content: fallback });
    appendChatMessage("ai", fallback);
    const status = $("#ai-connection-status");
    if (status) {
      status.classList.add("offline");
      status.innerHTML = `<i></i> ${localized("Offline Demo", "离线示范")}`;
    }
    console.info("Using the offline AI demo response", error);
  } finally {
    submitButton.disabled = false;
    $("#ai-question-input").focus();
  }
}

function resetAIChat() {
  clearTimeout(aiReplyTimer);
  lastAIQuestion = "";
  aiConversation = [];
  $("#ai-chat-log").innerHTML = "";
  appendChatMessage("ai", localized(
    "Hello! I am your generative AI assistant. Ask me anything, request an explanation, rewrite text, compare ideas, or create something new.",
    "你好！我是你的生成式 AI 助理。你可以连续提问、要求我解释、改写、比较或产生新点子。"
  ));
  $("#ai-question-form button[type='submit']").disabled = false;
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast p").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}

function localized(english, chinese) {
  return currentLanguage === "en" ? english : chinese;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function renderWorkspaceView(name) {
  activeWorkspaceView = name;
  const title = $("#placeholder-title");
  const description = $("#workspace-description");
  const content = $("#workspace-content");
  const action = $("#workspace-primary-action");
  action.hidden = false;
  action.dataset.action = "";

  if (name === "library") {
    title.textContent = localized("Past Paper Library", "历届题库");
    description.textContent = role === "teacher"
      ? localized("Review imported papers, edit their metadata, or add a new paper.", "查看已导入试卷、编辑资料，或继续上传新试卷。")
      : localized("Choose a practice set and start an interactive exercise.", "选择练习套题并开始互动式作答。 ");
    action.textContent = role === "teacher" ? localized("＋ Upload Paper", "＋ 上传试卷") : localized("Start Practice →", "开始练习 →");
    action.dataset.action = role === "teacher" ? "upload" : "start-practice";
    content.innerHTML = role === "teacher" ? `
      <section class="panel workspace-panel">
        <div class="workspace-summary"><strong>${papers.length}</strong><span>${localized("papers uploaded", "份试卷已上传")}</span></div>
        <div class="workspace-table" role="table">
          ${papers.length ? papers.map((paper) => `<article role="row"><span class="workspace-year">${escapeHTML(paper.year)}</span><div><strong>${escapeHTML(currentLanguage === "en" ? paper.titleEn : paper.title)}</strong><small>${escapeHTML(currentLanguage === "en" ? paper.topicEn : paper.topic)} · ${paper.count} ${localized("questions", "题")}</small></div><span class="status-pill">${escapeHTML(currentLanguage === "en" ? paper.statusEn : paper.status)}</span><button type="button" data-workspace-paper-id="${escapeHTML(paper.id)}">${localized("Edit Paper", "编辑试卷")}</button></article>`).join("") : `<div class="data-empty"><strong>${localized("No papers uploaded", "尚未上传试卷")}</strong><p>${localized("Use Upload Paper to add your first past-year paper.", "点击上传试卷以新增第一份历届考题。")}</p></div>`}
        </div>
      </section>` : `
      <div class="practice-grid">
        ${assignments.length ? assignments.map((item, index) => `<article class="panel practice-card"><span>${escapeHTML(item.icon)}</span><small>${item.done ? localized("COMPLETED", "已完成") : localized("READY", "可开始")}</small><h2>${escapeHTML(currentLanguage === "en" ? item.titleEn : item.title)}</h2><p>${escapeHTML(currentLanguage === "en" ? item.detailEn : item.detail)}</p><button type="button" data-start-assignment="${index}">${item.done ? localized("Review Answers", "查看解析") : localized("Start Practice", "开始练习")}</button></article>`).join("") : `<div class="data-empty"><strong>${localized("No assignments yet", "尚未布置练习")}</strong><p>${localized("Teacher assignments will appear here.", "老师建立练习后会显示在这里。")}</p></div>`}
      </div>`;
  } else if (name === "classes") {
    title.textContent = role === "teacher" ? localized("Class Progress", "班级进度") : localized("My Progress", "我的进度");
    description.textContent = role === "teacher"
      ? localized("View registered students and the classes available for registration.", "查看已注册学生及可供注册的班级。")
      : localized("Track completed assignments and your current learning level.", "追踪已完成作业与目前学习等级。 ");
    if (role === "teacher") {
      const students = getStudents();
      action.textContent = localized("＋ Add Class", "＋ 添加班级");
      action.dataset.action = "dashboard-classes";
      const completedAssignments = assignments.filter((item) => item.done).length;
      const completionRate = assignments.length ? Math.round((completedAssignments / assignments.length) * 100) : 0;
      content.innerHTML = `
        <div class="workspace-metrics"><article><strong>${getClasses().length}</strong><span>${localized("Active classes", "启用班级")}</span></article><article><strong>${students.length}</strong><span>${localized("Registered students", "已注册学生")}</span></article><article><strong>${completionRate}%</strong><span>${localized("Completion rate", "完成率")}</span></article></div>
        <section class="panel workspace-panel"><h2>${localized("Student Roster", "学生名册")}</h2>${students.length ? `<div class="workspace-table">${students.map((student) => `<article><span class="student-initial">${escapeHTML(student.name?.slice(-1) || "S")}</span><div><strong>${escapeHTML(student.name)}</strong><small>${escapeHTML(student.className)} · ${escapeHTML(student.year)}</small></div><span class="status-pill">${localized("Active", "活跃")}</span></article>`).join("")}</div>` : `<div class="workspace-empty"><strong>${localized("No students registered yet", "暂时没有学生注册")}</strong><p>${localized("Share the hourly verification code with students to get started.", "把每小时验证码交给学生即可开始注册。")}</p></div>`}</section>`;
    } else {
      const completed = assignments.filter((item) => item.done).length;
      const level = Math.max(1, LEVEL_TARGETS.filter((target) => completed >= target).length + 1);
      action.textContent = localized("Continue Learning →", "继续学习 →");
      action.dataset.action = "start-practice";
      content.innerHTML = `<div class="workspace-metrics"><article><strong>LV. ${level}</strong><span>${localized("Current level", "目前等级")}</span></article><article><strong>${completed}/${assignments.length}</strong><span>${localized("Assignments completed", "已完成作业")}</span></article><article><strong>—</strong><span>${localized("Answer accuracy", "答题正确率")}</span></article></div><section class="panel workspace-panel"><h2>${localized("Learning Milestones", "学习里程碑")}</h2><div class="milestone-list"><span class="done">✓ ${localized("Registered an account", "完成账号注册")}</span>${completed ? `<span class="done">✓ ${localized(`${completed} assignments completed`, `完成 ${completed} 份练习`)}</span>` : ""}<span>${localized("Complete assignments to unlock more milestones", "完成练习以解锁更多里程碑")}</span></div></section>`;
    }
  } else {
    title.textContent = role === "teacher" ? localized("Learning Analytics", "学习分析") : localized("Learning Report", "学习报告");
    description.textContent = role === "teacher"
      ? localized("Use classroom data to identify strengths and topics that need support.", "根据班级数据掌握强项与需要加强的知识点。")
      : localized("Review your performance and choose what to practise next.", "查看学习表现，并选择下一步要加强的内容。 ");
    action.textContent = role === "teacher" ? localized("Download CSV", "下载 CSV") : localized("Practise Weak Topics", "练习弱项");
    action.dataset.action = role === "teacher" ? "export" : "start-practice";
    content.innerHTML = `<div class="workspace-metrics"><article><strong>—</strong><span>${localized("Average accuracy", "平均正确率")}</span></article><article><strong>${role === "teacher" ? getStudents().length : 0}</strong><span>${role === "teacher" ? localized("Registered students", "已注册学生") : localized("Questions completed", "完成题数")}</span></article><article><strong>${role === "teacher" ? assignments.length : 0}</strong><span>${role === "teacher" ? localized("Assignments", "练习套题") : localized("Day streak", "连续学习天数")}</span></article></div><section class="panel workspace-panel"><h2>${localized("Topic Performance", "知识点表现")}</h2><div class="data-empty"><strong>${localized("No graded data yet", "尚无评分数据")}</strong><p>${localized("Topic analytics will appear after students answer graded questions.", "学生完成评分题目后，知识点分析会显示在这里。")}</p></div></section>`;
  }
}

function downloadReport() {
  const rows = [
    ["Metric", "Value"], ["Questions in library", papers.reduce((sum, paper) => sum + paper.count, 0)],
    ["Registered students", getStudents().length], ["Classes", getClasses().length], ["Average accuracy", "N/A"]
  ];
  const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "personal-ai-learning-report.csv";
  link.click();
  URL.revokeObjectURL(url);
  showToast(localized("Report downloaded", "报告已下载"));
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  if (name === "dashboard") {
    $(`#${role}-view`).classList.add("active");
  } else if (name === "quiz") {
    $("#quiz-view").classList.add("active");
  } else {
    renderWorkspaceView(name);
    $("#placeholder-view").classList.add("active");
  }
  $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setRole(nextRole) {
  role = nextRole;
  showView("dashboard");
  updateNavigationLabels();
}

function updateNavigationLabels() {
  $$(".nav-item span:last-child").forEach((span, index) => {
    if (role === "student") span.textContent = currentLanguage === "en"
      ? ["Learning Home", "Practice Library", "My Progress", "Learning Report"][index]
      : ["学习首页", "练习题库", "我的进度", "学习报告"][index];
    else span.textContent = currentLanguage === "en"
      ? ["Overview", "Past Paper Library", "Class Progress", "Learning Analytics"][index]
      : ["总览", "历届题库", "班级进度", "学习分析"][index];
  });
}

function openUpload() {
  pendingUploadFile = null;
  $("#file-input").value = "";
  $("#file-preview").innerHTML = "";
  $("#process-upload").disabled = true;
  $("#upload-dialog").showModal();
}

function loadFiles(files) {
  if (!files.length) return;
  const file = files[0];
  const accepted = /\.(pdf|png|jpe?g)$/i.test(file.name);
  if (!accepted) {
    pendingUploadFile = null;
    $("#file-preview").innerHTML = `<p class="form-error">${localized("Choose a PDF, JPG, or PNG file.", "请选择 PDF、JPG 或 PNG 文件。")}</p>`;
    $("#process-upload").disabled = true;
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    pendingUploadFile = null;
    $("#file-preview").innerHTML = `<p class="form-error">${localized("The selected file exceeds 25 MB.", "所选文件超过 25MB。")}</p>`;
    $("#process-upload").disabled = true;
    return;
  }
  pendingUploadFile = file;
  $("#file-preview").innerHTML = `<div class="file-pill"><span>▤ ${escapeHTML(file.name)}</span><span>${(file.size / 1024 / 1024).toFixed(1)} MB</span></div>`;
  $("#process-upload").disabled = false;
}

function openPaperEditor(paperId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) {
    showToast(localized("Paper not found", "找不到这份试卷"));
    return;
  }
  $("#edit-paper-id").value = paper.id;
  $("#edit-paper-title").value = paper.title;
  $("#edit-paper-year").value = paper.year;
  $("#edit-paper-topic").value = paper.topic;
  $("#edit-paper-status").value = paper.status;
  $("#edit-paper-file").textContent = paper.fileName
    ? `${paper.fileName} · ${(paper.fileSize / 1024 / 1024).toFixed(1)} MB`
    : localized("No source filename recorded", "没有记录来源文件名");
  $("#edit-paper-dialog").showModal();
}

function startQuiz(index = 0) {
  if (!assignments.length || !questions.length) {
    showToast(localized("No interactive questions are available yet.", "目前还没有可作答的互动题目。"));
    return;
  }
  activeAssignmentIndex = Math.max(0, Math.min(index, assignments.length - 1));
  currentQuestion = 0;
  renderQuestion();
  showView("quiz");
}

function renderQuestion() {
  const question = questions[currentQuestion];
  if (!question) {
    showView("dashboard");
    showToast(localized("No interactive questions are available yet.", "目前还没有可作答的互动题目。"));
    return;
  }
  const topic = {
    "程序设计": localized("Programming", "程序设计"),
    "数据库": localized("Database", "数据库"),
    "电脑网络": localized("Computer Networks", "电脑网络")
  }[question.topic] || question.topic;
  const level = question.level === "中等" ? localized("Intermediate", "中等") : localized("Basic", "基础");
  const options = currentLanguage === "en" ? question.optionsEn : question.options;
  selectedOption = answers[currentQuestion];
  $("#current-number").textContent = currentQuestion + 1;
  $("#question-total").textContent = questions.length;
  $("#quiz-progress-bar").style.width = `${((currentQuestion + 1) / questions.length) * 100}%`;
  $("#question-topic").textContent = topic;
  $("#question-level").textContent = level;
  $("#question-title").textContent = currentLanguage === "en" ? question.titleEn : question.title;
  $("#code-block code").textContent = question.code;
  $("#code-block").style.display = question.code ? "block" : "none";
  $("#quiz-options").innerHTML = options.map((option, index) => `
    <button class="option ${selectedOption === index ? "selected" : ""}" data-option="${index}">
      <span class="letter">${String.fromCharCode(65 + index)}</span><span>${option}</span>
    </button>`).join("");
  $("#answer-feedback").className = "answer-feedback";
  $("#answer-feedback").innerHTML = "";
  $("#submit-answer").classList.remove("hidden");
  $("#submit-answer").disabled = selectedOption === null;
  $("#next-question").classList.add("hidden");
  $("#previous-question").disabled = currentQuestion === 0;
  renderQuestionMap();
  refreshLanguage();
}

function renderQuestionMap() {
  $("#question-dots").innerHTML = questions.map((_, index) => `<button data-jump="${index}" class="${index === currentQuestion ? "current" : ""} ${answers[index] !== null ? "answered" : ""}">${index + 1}</button>`).join("");
}

function submitAnswer() {
  if (selectedOption === null) return;
  const question = questions[currentQuestion];
  if (!question) return;
  answers[currentQuestion] = selectedOption;
  $$(".option").forEach((option, index) => {
    option.disabled = true;
    option.classList.remove("selected");
    if (index === question.correct) option.classList.add("correct");
    if (index === selectedOption && index !== question.correct) option.classList.add("wrong");
  });
  const isCorrect = selectedOption === question.correct;
  const explanation = currentLanguage === "en" ? question.explanationEn : question.explanation;
  const mistake = currentLanguage === "en" ? question.mistakeEn : question.mistake.replace("常见错误：", "");
  $("#answer-feedback").innerHTML = `<h3>${isCorrect ? localized("Correct!", "回答正确！") : localized("Take another look", "再留意一下")}</h3><div>${explanation}</div><div class="mistake"><strong>${localized("Common mistake:", "易错提醒：")}</strong> ${mistake}</div>`;
  $("#answer-feedback").classList.add("show");
  $("#submit-answer").classList.add("hidden");
  $("#next-question").classList.remove("hidden");
  $("#next-question").textContent = currentQuestion === questions.length - 1 ? localized("Finish Practice ✓", "完成练习 ✓") : localized("Next Question →", "下一题 →");
  renderQuestionMap();
  refreshLanguage();
}

renderPapers();
renderAssignments();
populateYears();
renderClassOptions();
renderTeacherClasses();
applyLanguage(localStorage.getItem(LANGUAGE_KEY) || "en", { persist: false });
renderTeacherMetrics();
renderClassPerformance();
updateStudentProgress();

$$(".language-select").forEach((select) => select.addEventListener("change", (event) => {
  applyLanguage(event.target.value);
  renderPapers(activePaperFilter);
  renderAssignments();
  renderTeacherClasses();
  renderTeacherMetrics();
  renderClassPerformance();
  updateAccountUI();
  updateNavigationLabels();
  updateStudentProgress();
  if ($("#quiz-view").classList.contains("active")) renderQuestion();
  if ($("#student-view").classList.contains("active") && !lastAIQuestion) resetAIChat();
  if (activeWorkspaceView) renderWorkspaceView(activeWorkspaceView);
}));

if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("PWA service worker registration failed", error));
  });
}

if (globalThis.Capacitor?.isNativePlatform?.()) {
  $(".download-apk")?.classList.add("screen-hidden");
}

$("#start-learning").addEventListener("click", openAuth);
$("#nav-start").addEventListener("click", openAuth);
$("#vision-start").addEventListener("click", openAuth);
$("#highlight-start").addEventListener("click", openAuth);
$("#footer-start").addEventListener("click", openAuth);
$("#auth-back").addEventListener("click", () => showPublicScreen("landing"));
$$('.dark-brand').forEach((brand) => brand.addEventListener("click", (event) => {
  event.preventDefault();
  showPublicScreen("landing");
}));

$$('[data-auth-role]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-auth-role]').forEach((item) => item.classList.toggle("active", item === button));
  const isTeacher = button.dataset.authRole === "teacher";
  $("#teacher-login-form").classList.toggle("screen-hidden", !isTeacher);
  $("#student-auth").classList.toggle("screen-hidden", isTeacher);
  $("#teacher-login-error").textContent = "";
  $("#student-login-error").textContent = "";
  $("#student-register-error").textContent = "";
}));

$$('[data-student-mode]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-student-mode]').forEach((item) => item.classList.toggle("active", item === button));
  const isLogin = button.dataset.studentMode === "login";
  $("#student-login-form").classList.toggle("screen-hidden", !isLogin);
  $("#student-register-form").classList.toggle("screen-hidden", isLogin);
}));

$("#teacher-login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = $("#teacher-email").value.trim().toLowerCase();
  const password = $("#teacher-password").value;
  if (email !== SUPERADMIN_EMAIL || password !== getTeacherPassword()) {
    $("#teacher-login-error").textContent = localized("The email or password is incorrect.", "账号或密码不正确，请重新检查。");
    return;
  }
  $("#teacher-login-error").textContent = "";
  enterApp("teacher");
  showToast(localized("Welcome back, Teacher Jude", "欢迎回来，Teacher Jude"));
});

$("#student-register-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#register-name").value.trim();
  const className = $("#register-class").value.trim();
  const year = $("#register-year").value;
  const code = $("#register-code").value.trim();
  const error = $("#student-register-error");
  if (!/^[\u3400-\u9fff·]{2,12}$/.test(name)) {
    error.textContent = localized("Enter a Chinese name containing 2 to 12 characters.", "请输入 2 至 12 个字的中文姓名。");
    return;
  }
  if (className.length < 2) {
    error.textContent = localized("Select a complete class name.", "请输入完整班级名称。");
    return;
  }
  if (code !== getHourlyCode()) {
    error.textContent = localized("The verification code is incorrect or expired. Ask your teacher for the current code.", "验证码不正确或已过期，请向老师索取本小时验证码。");
    return;
  }
  const students = getStudents();
  if (students.some((student) => student.name === name && student.className === className && student.year === year)) {
    error.textContent = localized("This student account already exists. Switch to Existing Account to sign in.", "此学生账号已注册，请切换至“已有账号”登入。");
    return;
  }
  const student = { name, className, year, createdAt: new Date().toISOString() };
  students.push(student);
  localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
  renderTeacherMetrics();
  error.textContent = "";
  enterApp("student", student);
  showToast(localized("Registration successful. Welcome!", "注册成功，欢迎开始学习"));
});

$("#student-login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#student-login-name").value.trim();
  const className = $("#student-login-class").value.trim();
  const year = $("#student-login-year").value;
  const student = getStudents().find((item) => item.name === name && item.className === className && item.year === year);
  if (!student) {
    $("#student-login-error").textContent = localized("Student account not found. Check the details or register first.", "找不到这个学生账号，请检查资料或先完成注册。");
    return;
  }
  $("#student-login-error").textContent = "";
  enterApp("student", student);
  showToast(`${localized("Welcome back", "欢迎回来")}，${student.name}`);
});

function openPasswordDialog() {
  if (role !== "teacher") {
    showToast(`${activeStudent?.name || localized("Student", "学生")} · ${activeStudent?.className || ""}`);
    return;
  }
  $("#password-error").textContent = "";
  $("#password-form").reset();
  $("#password-dialog").showModal();
}

$("#open-password").addEventListener("click", openPasswordDialog);
$("#account-button").addEventListener("click", openPasswordDialog);
$("#sidebar-account").addEventListener("click", openPasswordDialog);
$("#close-password").addEventListener("click", () => $("#password-dialog").close());
$("#cancel-password").addEventListener("click", () => $("#password-dialog").close());
$("#password-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const current = $("#current-password").value;
  const next = $("#new-password").value;
  const confirmation = $("#confirm-password").value;
  const error = $("#password-error");
  if (current !== getTeacherPassword()) {
    error.textContent = localized("The current password is incorrect.", "目前密码不正确。");
    return;
  }
  if (next.length < 4) {
    error.textContent = localized("The new password must contain at least 4 characters.", "新密码至少需要 4 个字符。");
    return;
  }
  if (next !== confirmation) {
    error.textContent = localized("The new passwords do not match.", "两次输入的新密码不一致。");
    return;
  }
  localStorage.setItem(PASSWORD_KEY, next);
  $("#password-dialog").close();
  showToast(localized("Password updated. Use the new password next time.", "密码已更新，下次登入请使用新密码"));
});

$("#copy-code").addEventListener("click", async () => {
  const code = getHourlyCode();
  try {
    await navigator.clipboard.writeText(code);
    showToast(`${localized("Verification code", "验证码")} ${code} ${localized("copied", "已复制")}`);
  } catch {
    showToast(`${localized("Current verification code", "本小时验证码")}：${code}`);
  }
});

$("#logout-button").addEventListener("click", () => {
  clearInterval(codeTimer);
  activeStudent = null;
  $("#teacher-password").value = "";
  showPublicScreen("landing");
});

$("#class-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#new-class-name");
  const className = input.value.trim();
  if (!/^[\u3400-\u9fffA-Za-z0-9（）()·\-\s]{2,20}$/.test(className)) {
    showToast(localized("Enter a valid class name", "请输入正确的班级名称"));
    return;
  }
  const classes = getClasses();
  if (classes.includes(className)) {
    showToast(localized("This class is already in the list", "这个班级已经在列表中"));
    return;
  }
  classes.push(className);
  saveClasses(classes);
  input.value = "";
  showToast(`${className} ${localized("was added to the registration list", "已加入学生注册列表")}`);
});

$("#class-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-class]");
  if (!button) return;
  const classes = getClasses().filter((className) => className !== button.dataset.removeClass);
  saveClasses(classes);
  showToast(`${button.dataset.removeClass} ${localized("was removed", "已从列表移除")}`);
});

$("#ai-question-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#ai-question-input");
  askAI(input.value);
  input.value = "";
  input.style.height = "auto";
});

$("#ai-question-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#ai-question-form").requestSubmit();
  }
});

$("#ai-question-input").addEventListener("input", (event) => {
  event.currentTarget.style.height = "auto";
  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 130)}px`;
});

$("#new-ai-chat").addEventListener("click", resetAIChat);
$("#ai-model-select").addEventListener("change", (event) => {
  const label = event.currentTarget.options[event.currentTarget.selectedIndex].textContent;
  showToast(`${label} ${localized("enabled", "已启用")}`);
});

$("#ai-chat-log").addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-message]");
  if (copyButton) {
    const message = copyButton.closest(".message-body")?.querySelector("p")?.textContent || "";
    try {
      await navigator.clipboard.writeText(message);
      showToast(localized("Response copied", "回答已复制"));
    } catch {
      showToast(localized("Unable to copy. Select the text manually.", "无法复制，请手动选择文字"));
    }
    return;
  }
  if (event.target.closest("[data-regenerate]") && lastAIQuestion) askAI(lastAIQuestion, { repeatUser: false });
});

$(".suggested-prompts").addEventListener("click", (event) => {
  const button = event.target.closest("[data-prompt]");
  if (button) askAI(button.dataset.prompt);
});

$$('[data-view]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$$('[data-view-link]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewLink)));
$("#back-dashboard").addEventListener("click", () => showView("dashboard"));
$("#open-upload").addEventListener("click", openUpload);
$("#quick-upload").addEventListener("click", openUpload);
$("#mobile-add").addEventListener("click", () => role === "teacher" ? openUpload() : startQuiz());
$("#file-input").addEventListener("change", (event) => loadFiles(event.target.files));
$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
$("#dropzone").addEventListener("drop", (event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); loadFiles(event.dataTransfer.files); });
$("#process-upload").addEventListener("click", (event) => {
  event.preventDefault();
  if (!pendingUploadFile) {
    showToast(localized("Choose a paper file first.", "请先选择试卷文件。"));
    return;
  }
  const year = $("#upload-year").value;
  const topic = $("#upload-topic").value;
  const title = pendingUploadFile.name.replace(/\.[^.]+$/, "").trim() || `${year} Computer Science Paper`;
  const now = new Date();
  papers.unshift({
    id: `paper-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    year,
    title,
    titleEn: title,
    topic,
    topicEn: TOPIC_EN[topic] || topic,
    count: 0,
    status: "待校对",
    statusEn: "Needs review",
    fileName: pendingUploadFile.name,
    fileSize: pendingUploadFile.size,
    createdAt: now.toISOString()
  });
  savePapers();
  renderPapers();
  if (activeWorkspaceView === "library") renderWorkspaceView("library");
  $("#upload-dialog").close();
  showToast(localized("Paper uploaded and saved. You can now edit its details.", "试卷已上传并储存，现在可以编辑试卷资料。"));
  pendingUploadFile = null;
  $("#file-input").value = "";
  $("#file-preview").innerHTML = "";
  $("#process-upload").disabled = true;
});

$("#close-edit-paper").addEventListener("click", () => $("#edit-paper-dialog").close());
$("#cancel-edit-paper").addEventListener("click", () => $("#edit-paper-dialog").close());
$("#edit-paper-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const paper = papers.find((item) => item.id === $("#edit-paper-id").value);
  const title = $("#edit-paper-title").value.trim();
  if (!paper || !title) {
    $("#edit-paper-error").textContent = localized("Enter a paper title.", "请输入试卷名称。 ");
    return;
  }
  paper.title = title;
  paper.titleEn = title;
  paper.year = $("#edit-paper-year").value;
  paper.topic = $("#edit-paper-topic").value;
  paper.topicEn = TOPIC_EN[paper.topic] || paper.topic;
  paper.status = $("#edit-paper-status").value;
  paper.statusEn = paper.status === "已整理" ? "Organized" : "Needs review";
  savePapers();
  renderPapers(activePaperFilter);
  if (activeWorkspaceView === "library") renderWorkspaceView("library");
  $("#edit-paper-error").textContent = "";
  $("#edit-paper-dialog").close();
  showToast(localized("Paper details saved.", "试卷资料已储存。"));
});

$(".filters").addEventListener("click", (event) => {
  const button = event.target.closest(".filter");
  if (!button) return;
  $$(".filter").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  renderPapers(button.dataset.filter || "全部");
});

$("#paper-list").addEventListener("click", (event) => {
  if (event.target.closest("[data-empty-upload]")) {
    openUpload();
    return;
  }
  const button = event.target.closest("[data-paper-id]");
  if (button) openPaperEditor(button.dataset.paperId);
});
$("#create-set").addEventListener("click", () => {
  assignments.unshift({ id: `assignment-${Date.now()}`, icon: "＋", title: "老师新建练习", titleEn: "New Teacher Practice", detail: "0 题 · 草稿", detailEn: "0 questions · Draft", action: "开始编辑", actionEn: "Start Editing", done: false });
  saveAssignments();
  renderAssignments();
  showToast(localized("A new draft practice was created", "已建立新的空白练习"));
});
$("#invite-students").addEventListener("click", () => {
  const code = getHourlyCode();
  navigator.clipboard?.writeText(code).catch(() => {});
  showToast(`${localized("Student verification code", "学生注册验证码")} ${code} ${localized("copied", "已复制")}`);
});
$("#export-report").addEventListener("click", downloadReport);
$("#notification-button").addEventListener("click", () => showToast(localized("No new notifications", "目前没有新通知")));
$("#workspace-primary-action").addEventListener("click", (event) => {
  const action = event.currentTarget.dataset.action;
  if (action === "upload") openUpload();
  else if (action === "start-practice") startQuiz(0);
  else if (action === "export") downloadReport();
  else if (action === "dashboard-classes") {
    showView("dashboard");
    $("#new-class-name")?.focus();
  }
});
$("#workspace-content").addEventListener("click", (event) => {
  const paperButton = event.target.closest("[data-workspace-paper-id]");
  if (paperButton) {
    openPaperEditor(paperButton.dataset.workspacePaperId);
    return;
  }
  const assignmentButton = event.target.closest("[data-start-assignment]");
  if (assignmentButton) {
    const index = Number(assignmentButton.dataset.startAssignment);
    assignments[index]?.done ? showToast(localized("No saved answer review is available yet.", "目前没有已储存的答题解析。")) : startQuiz(index);
  }
});
$("#assignment-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-assignment]");
  if (!button) return;
  const index = Number(button.dataset.assignment);
  assignments[index]?.done ? showToast(localized("No saved answer review is available yet.", "目前没有已储存的答题解析。")) : startQuiz(index);
});
$("#continue-quiz").addEventListener("click", () => startQuiz(0));
$("#exit-quiz").addEventListener("click", () => showView("dashboard"));
$("#quiz-options").addEventListener("click", (event) => {
  const option = event.target.closest(".option");
  if (!option || option.disabled) return;
  selectedOption = Number(option.dataset.option);
  $$(".option").forEach((item) => item.classList.remove("selected"));
  option.classList.add("selected");
  $("#submit-answer").disabled = false;
});
$("#submit-answer").addEventListener("click", submitAnswer);
$("#next-question").addEventListener("click", () => {
  if (currentQuestion === questions.length - 1) {
    const assignment = assignments[activeAssignmentIndex];
    if (!assignment) return;
    assignment.done = true;
    assignment.action = "查看解析";
    assignment.actionEn = "Review Answers";
    assignment.detail = `${questions.length} 题 · 已完成`;
    assignment.detailEn = `${questions.length} questions · Completed`;
    saveAssignments();
    renderAssignments();
    showView("dashboard");
    showToast(localized(
      `Practice complete: ${answers.filter((answer, index) => answer === questions[index].correct).length} of ${questions.length} correct.`,
      `练习完成，答对 ${answers.filter((answer, index) => answer === questions[index].correct).length} / ${questions.length} 题。`
    ));
  } else {
    currentQuestion += 1;
    renderQuestion();
  }
});
$("#previous-question").addEventListener("click", () => { if (currentQuestion > 0) { currentQuestion -= 1; renderQuestion(); } });
$("#question-dots").addEventListener("click", (event) => { const button = event.target.closest("[data-jump]"); if (button) { currentQuestion = Number(button.dataset.jump); renderQuestion(); } });

window.addEventListener("keydown", (event) => {
  if ($("#quiz-view").classList.contains("active") && /^[1-4]$/.test(event.key)) {
    const button = $(`[data-option="${Number(event.key) - 1}"]`);
    if (button && !button.disabled) button.click();
  }
});

const revealTargets = $$(".landing-vision .lined-copy, .vision-model, .services-intro, .service-row, .highlight-card, .landing-numbers > *, .advantage-strip article, .landing-footer > *");
revealTargets.forEach((element) => element.classList.add("reveal-on-scroll"));
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.16, rootMargin: "0px 0px -6%" });
  revealTargets.forEach((element) => revealObserver.observe(element));
} else {
  revealTargets.forEach((element) => element.classList.add("is-visible"));
}
