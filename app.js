const PAPERS_KEY = "tixi_papers_v1";
const ASSIGNMENTS_KEY = "tixi_assignments_v1";
const QUESTIONS_KEY = "tixi_questions_v1";
const NOTES_KEY = "tixi_teacher_notes_v1";
const SESSION_KEY = "tixi_session_v1";
const QUIZ_PROGRESS_KEY = "tixi_quiz_progress_v1";
const QUIZ_REVIEW_KEY = "tixi_quiz_reviews_v1";
const Cloud = globalThis.personalAICloud;

function createRecordId(prefix = "record") {
  return Cloud?.enabled && crypto?.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
let questionBank = readStoredArray(QUESTIONS_KEY);
let teacherNotes = readStoredArray(NOTES_KEY);
let questions = [];

const TOPIC_EN = Object.freeze({
  "综合试卷": "General Paper",
  "程序设计": "Programming",
  "数据库": "Database",
  "电脑网络": "Computer Networks",
  "硬件": "Hardware"
});
const TOPIC_ZH = Object.freeze({
  "General Paper": "综合试卷",
  "Programming": "程序设计",
  "Database": "数据库",
  "Computer Networks": "电脑网络",
  "Computer Networking": "电脑网络",
  "Networking": "电脑网络",
  "Hardware": "硬件"
});
const LEVEL_ZH = Object.freeze({ Basic: "基础", Intermediate: "中等", Advanced: "进阶" });
const MAIN_CATEGORIES = Object.freeze(["高一", "高二", "高三", "初中"]);
const MAIN_CATEGORY_EN = Object.freeze({ "高一": "Senior 1", "高二": "Senior 2", "高三": "Senior 3", "初中": "Junior Secondary" });
const SUBJECTS = Object.freeze(["高中资讯科技", "初中电脑与资讯工艺"]);
const SUBJECT_EN = Object.freeze({ "高中资讯科技": "Senior Information Technology", "初中电脑与资讯工艺": "Junior Computer and Information Technology" });

function normalizeMainCategory(value, subject = "") {
  const category = String(value || "").trim();
  if (MAIN_CATEGORIES.includes(category)) return category;
  return subject === "初中电脑与资讯工艺" ? "初中" : "高一";
}

function normalizeSubject(value, mainCategory = "") {
  const subject = String(value || "").trim();
  if (SUBJECTS.includes(subject)) return subject;
  return mainCategory === "初中" ? "初中电脑与资讯工艺" : "高中资讯科技";
}

function normalizePaperRecord(paper) {
  const storedSubject = paper.subject || (SUBJECTS.includes(paper.topicEn) ? paper.topicEn : "");
  const mainCategory = normalizeMainCategory(paper.mainCategory || paper.topic, storedSubject);
  const subject = normalizeSubject(storedSubject, mainCategory);
  return {
    ...paper,
    id: paper.id || createRecordId("paper"),
    title: paper.title || paper.fileName || "Untitled Paper",
    titleEn: paper.titleEn || paper.title || paper.fileName || "Untitled Paper",
    year: String(paper.year || new Date().getFullYear()),
    mainCategory,
    mainCategoryEn: MAIN_CATEGORY_EN[mainCategory],
    subject,
    subjectEn: SUBJECT_EN[subject],
    topic: mainCategory,
    topicEn: MAIN_CATEGORY_EN[mainCategory],
    count: Number(paper.count) || 0,
    status: paper.status || "待校对",
    statusEn: paper.statusEn || "Needs review",
    fileName: paper.fileName || "",
    fileSize: Number(paper.fileSize) || 0,
    materialType: paper.materialType === "teaching-material" ? "teaching-material" : "past-paper",
    requestedQuestionCount: Number(paper.requestedQuestionCount) || 0,
    createdAt: paper.createdAt || new Date().toISOString()
  };
}

papers = papers.map(normalizePaperRecord);

teacherNotes = teacherNotes
  .filter((note) => note && typeof note === "object" && String(note.title || "").trim() && String(note.content || "").trim())
  .map((note, index) => ({
    id: String(note.id || createRecordId("note")),
    title: String(note.title || "").trim(),
    content: String(note.content || "").trim(),
    createdAt: note.createdAt || new Date().toISOString(),
    updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
  }))
  .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

questionBank = questionBank.filter((question) => {
  if (!question || typeof question.title !== "string") return false;
  if (question.type === "fill") return Boolean(String(question.correctAnswer || "").trim());
  return Array.isArray(question.options) && question.options.length >= 2;
}).map((question, index) => {
  const type = question.type === "fill" ? "fill" : "mcq";
  const options = type === "mcq" && Array.isArray(question.options) ? question.options : [];
  const correctAnswer = type === "fill" ? String(question.correctAnswer || "").trim() : "";
  const acceptedAnswers = type === "fill"
    ? [...new Set([correctAnswer, ...(Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [])].map((answer) => String(answer).trim()).filter(Boolean))]
    : [];
  return {
    ...question,
    type,
    id: question.id || createRecordId("question"),
    paperId: question.paperId || "",
    topic: TOPIC_ZH[question.topic] || question.topic || "综合试卷",
    level: LEVEL_ZH[question.level] || question.level || "中等",
    titleEn: question.titleEn || question.title,
    options,
    optionsEn: type === "mcq" && Array.isArray(question.optionsEn) ? question.optionsEn : options,
    correctAnswer,
    acceptedAnswers,
    explanationEn: question.explanationEn || question.explanation || "",
    mistakeEn: question.mistakeEn || question.mistake || "",
    correct: type === "mcq" ? Math.max(0, Math.min(Number(question.correct) || 0, options.length - 1)) : 0
  };
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let role = "teacher";
let currentQuestion = 0;
let activeAssignmentIndex = 0;
let activeQuizStudentKey = "";
let answers = [];
let draftAnswers = [];
let selectedOption = null;
let isQuizReviewMode = false;
let activeQuizResultData = null;
let pendingUploadFile = null;
let pendingUploadVisuals = [];
let toastTimer;
let codeTimer;
let activeStudent = null;
const SUPERADMIN_EMAIL = "wsl@chms3.edu.my";
const PASSWORD_KEY = "tixi_superadmin_password";
const STUDENTS_KEY = "tixi_students";
const CLASSES_KEY = "tixi_classes";
const LANGUAGE_KEY = "tixi_language_v2";
const GEMINI_KEY = "tixi_gemini_api_key";
const GEMINI_MODEL_KEY = "tixi_gemini_model";
const GEMINI_KEY_STATUS_KEY = "tixi_gemini_key_status";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
const LEVEL_TARGETS = [2, 5, 8];
let currentLanguage = "en";
let lastAIQuestion = "";
let aiReplyTimer;
let aiConversation = [];
let activeWorkspaceView = null;
let activePaperFilter = "全部";
let activeLibraryCategoryFilter = "全部";
let isGeneratingQuestions = false;
let resumeUploadAfterAISetup = false;
let cloudProfile = null;
let cloudStudents = [];
let cloudClasses = [];
let cloudSubmissions = [];
let cloudDataLoaded = false;
let cloudRegistrationCode = "";
let cloudRegistrationCodeExpiresAt = "";
let cloudChatThreadId = "";
let lastCloudSyncErrorAt = 0;
let lastCloudSyncError = null;
let cloudSyncQueue = Promise.resolve();
let quizStartedAt = "";
let quizCloudProgressTimer = null;
let stopProgressRealtime = null;
let teacherProgressPollTimer = null;
let progressRefreshTimer = null;
let progressRefreshInFlight = false;
const openTeacherAssignmentProgressIds = new Set();
let pendingQuestionImageData = "";
let pendingQuestionImagePath = "";
let pendingQuestionImageAlt = "题目图表";
const loadedScripts = new Map();
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
  "从试卷与讲义辨识重点并自动生成题目。": "Identify key points in papers and handouts, then generate questions automatically.",
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
  "查看学习报告": "View Learning Report",
  "查看完整分析": "View Full Analytics",
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
  "科系": "Subject",
  "高一": "Senior 1",
  "高二": "Senior 2",
  "高三": "Senior 3",
  "初中": "Junior Secondary",
  "高中资讯科技": "Senior Information Technology",
  "初中电脑与资讯工艺": "Junior Computer and Information Technology",
  "发布给班级": "Assign to Classes",
  "可同时选择多个班级；只有获分配的班级能在学生端看到并回答此资料。": "Select multiple classes. Only assigned classes can see and answer this material.",
  "所有班级": "All Classes",
  "授权班级": "Authorized Classes",
  "尚未授权": "Not Assigned",
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
  ,"整理试卷、讲义与笔记，自动生成题目并即时解释答案。": "Organize papers, handouts, and notes, generate questions automatically, and explain answers instantly."
  ,"学习资料智能整理": "Intelligent Learning-Material Organization"
  ,"老师上传试卷、讲义、笔记或图片后，系统会读取内容、整理重点并生成互动题目，让任何教学资料都能成为练习。": "Upload papers, handouts, notes, or images. The system reads the content, organizes key points, and generates interactive questions."
  ,"学习资料": "Learning Materials"
  ,"上传学习资料": "Upload Learning Material"
  ,"最近整理的学习资料": "Recently Organized Materials"
  ,"PDF / Word / 图片": "PDF / Word / Image"
  ,"学习资料题库": "Learning Materials"
  ,"上传学习资料并生成题目": "Upload Material and Generate Questions"
  ,"可上传历届试卷、讲义或笔记。系统会读取内容、整理重点，并自动建立互动题目。": "Upload past papers, handouts, or notes. The system reads the content, organizes key points, and creates interactive questions."
  ,"拖放试卷或讲义到这里，或点击选择文件": "Drop a paper or handout here, or click to choose a file"
  ,"支持 PDF、Word、PowerPoint、图片与文字档；文件不超过 25MB": "Supports PDF, Word, PowerPoint, images, and text files up to 25MB"
  ,"准备读取资料": "Ready to read material"
  ,"1. 读取文件": "1. Read File"
  ,"2. 辨识内容": "2. Extract Content"
  ,"3. 生成题目": "3. Generate Questions"
  ,"4. 储存练习": "4. Save Practice"
  ,"开始生成题目": "Generate Questions"
  ,"编辑学习资料": "Edit Learning Material"
  ,"修改资料名称、年份、分类与整理状态，储存后会立即更新题库。": "Update the material title, year, category, and status. Changes are saved immediately."
  ,"资料名称": "Material Title"
  ,"资料年份": "Material Year"
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
  ,"自行出题": "Create a Question"
  ,"选择题或填充题": "MCQ or fill-in question"
  ,"建立互动题目": "Create an Interactive Question"
  ,"自行建立选择题或填充题。储存后会立即加入学生练习。": "Create an MCQ or fill-in question. It will be added to student practice immediately."
  ,"题型": "Question Type"
  ,"选择题": "Multiple Choice"
  ,"填充题": "Fill in the Answer"
  ,"加入学习资料（可选）": "Add to Learning Material (Optional)"
  ,"独立出题": "Standalone Question"
  ,"题目分类": "Topic"
  ,"难度": "Difficulty"
  ,"基础": "Basic"
  ,"进阶": "Advanced"
  ,"题目": "Question"
  ,"请输入完整题目": "Enter the complete question"
  ,"程序代码（可选）": "Code Snippet (Optional)"
  ,"选项 A": "Option A"
  ,"选项 B": "Option B"
  ,"选项 C": "Option C"
  ,"选项 D": "Option D"
  ,"正确选项": "Correct Option"
  ,"正确答案": "Correct Answer"
  ,"学生必须输入的答案": "The answer students should enter"
  ,"其他可接受答案（用逗号分隔，可选）": "Other Accepted Answers (Comma-Separated, Optional)"
  ,"例如：CPU, 中央处理器": "For example: CPU, Central Processing Unit"
  ,"答案解析": "Answer Explanation"
  ,"说明为什么这是正确答案": "Explain why this is the correct answer"
  ,"常见错误（可选）": "Common Mistake (Optional)"
  ,"指出学生容易混淆的概念": "Describe a concept students often confuse"
  ,"储存并发布": "Save and Publish"
  ,"请输入答案": "Enter Your Answer"
  ,"输入答案后提交；英文答案不区分大小写。": "Enter your answer and submit. English answers are not case-sensitive."
  ,"自动生成统考风格选择题，不会产生填充题。": "Generates UEC-style multiple-choice questions only; no fill-in questions are created automatically."
  ,"Gemini AI 设置": "Gemini AI Settings"
  ,"尚未连接": "Not Connected"
  ,"已连接": "Connected"
  ,"等待验证": "Ready to Test"
  ,"需要更新": "Needs Update"
  ,"由 Gemini AI 阅读并理解资料后生成统考风格选择题，不使用本机拼接题目。": "Gemini AI reads and understands the material before creating UEC-style MCQs. Rule-based local questions are not used."
  ,"查看与编辑题目": "View and Edit Questions"
  ,"编辑已生成题目": "Edit Generated Questions"
  ,"选择一题修改题干、选项、正确答案、解析或常见错误。": "Choose a question to edit its stem, options, correct answer, explanation, or common mistake."
  ,"返回资料": "Back to Material"
  ,"编辑题目": "Edit Question"
  ,"编辑互动题目": "Edit Interactive Question"
  ,"修改后会立即更新学生练习中的这道题目。": "Changes immediately update this question in student practice."
  ,"储存题目修改": "Save Question Changes"
  ,"AI 题目生成设置": "AI Question Generation Settings"
  ,"GitHub Pages 没有 AI 后端。请输入自己的 Gemini API Key，让浏览器直接调用 Gemini；密钥只储存在这台装置的浏览器，不会写入网站代码库。": "GitHub Pages has no AI backend. Enter your Gemini API key so this browser can call Gemini directly. The key is stored only in this browser on this device and is never committed to the website repository."
  ,"Gemini API Key": "Gemini API Key"
  ,"输入 Google AI Studio API Key": "Enter your Google AI Studio API key"
  ,"Gemini 模型": "Gemini Model"
  ,"取得 Gemini API Key": "Get a Gemini API Key"
  ,"取得 Gemini API Key →": "Get a Gemini API Key →"
  ,"储存 AI 设置": "Save AI Settings"
  ,"储存并更换 API Key": "Save and Replace API Key"
  ,"清除密钥": "Clear Key"
  ,"更换 API Key": "Change API Key"
  ,"AI 已设置，上传资料时会由 Gemini 理解内容并生成题目。": "AI is configured. Gemini will understand uploaded content and generate the questions."
  ,"设置密码": "Set Password"
  ,"确认密码": "Confirm Password"
  ,"至少 6 个字符": "At least 6 characters"
  ,"再次输入密码": "Enter the password again"
  ,"资料类型": "Material Type"
  ,"历届试卷（辨识全部题目）": "Past Paper (Extract All Questions)"
  ,"讲义或教学资料": "Handout or Teaching Material"
  ,"生成题数": "Number of Questions"
  ,"10 题": "10 Questions"
  ,"15 题": "15 Questions"
  ,"20 题": "20 Questions"
  ,"25 题": "25 Questions"
  ,"30 题": "30 Questions"
  ,"40 题": "40 Questions"
  ,"50 题": "50 Questions"
  ,"系统会辨识试卷里的所有完整题目，并依原顺序生成。": "The system will identify every complete question in the paper and generate them in the original order."
  ,"删除资料": "Delete Material"
  ,"管理学生账号": "Manage Student Account"
  ,"修改学生资料、停用账号，或为学生重设登入密码。": "Edit student details, disable the account, or reset the student's sign-in password."
  ,"账号状态": "Account Status"
  ,"启用": "Active"
  ,"停用": "Disabled"
  ,"重设密码": "Reset Password"
  ,"留空则保留目前密码": "Leave blank to keep the current password"
  ,"删除账号": "Delete Account"
  ,"储存账号修改": "Save Account Changes"
  ,"放大查看": "Enlarge"
  ,"复制验证码": "Copy Code"
  ,"教师笔记": "Teacher Notes"
  ,"老师笔记": "Teacher Notes"
  ,"笔记": "Notes"
  ,"查看老师发布的重点、提醒与学习补充。": "Read key points, reminders, and learning supplements published by your teacher."
  ,"查看全部笔记": "View All Notes"
  ,"新增笔记": "New Note"
  ,"编辑笔记": "Edit Note"
  ,"发布后学生即可在学生端查看。": "Students can read this note immediately after it is published."
  ,"笔记标题": "Note Title"
  ,"笔记内容": "Note Content"
  ,"请输入清楚的笔记标题": "Enter a clear note title"
  ,"输入重点、说明、提醒或补充资料……": "Write key points, explanations, reminders, or supplementary material…"
  ,"发布笔记": "Publish Note"
  ,"关闭 AI 对话": "Close AI Chat"
  ,"问 AI": "Ask AI"
  ,"随时提问": "Ask anything"
  ,"生成式 AI 设置": "Generative AI Settings"
  ,"这个连接同时用于学生的通用 AI 对话与老师的 AI 题目生成。GitHub Pages 没有 AI 后端时，可输入 Gemini API Key 直接连接；密钥只储存在这台装置的浏览器。": "This connection powers both students' general AI chat and teachers' AI question generation. When GitHub Pages has no AI backend, enter a Gemini API key for a direct connection; the key is stored only in this browser."
  ,"模式": "Mode"
  ,"你好！我是你的生成式 AI 助理。你可以问我任何问题，也可以要求解释、写作、计算、翻译或编程协助。": "Hi! I'm your generative AI assistant. Ask me anything or request help with explanations, writing, calculations, translation, or programming."
  ,"老师尚未发布笔记": "No teacher notes yet"
  ,"老师发布笔记后会显示在这里。": "Notes published by your teacher will appear here."
  ,"PRACTICE COMPLETE": "PRACTICE COMPLETE"
  ,"练习完成！": "Practice complete!"
  ,"你答对了": "You answered"
  ,"题。": "questions correctly."
  ,"答对题数": "Correct answers"
  ,"正确率": "Accuracy"
  ,"答题用时": "Time spent"
  ,"完成时间": "Completed at"
  ,"返回学生首页": "Back to student home"
  ,"查看作答解析": "Review answers"
  ,"← 返回结算": "← Back to results"
  ,"答题解析": "Answer review"
  ,"你的答案：": "Your answer:"
  ,"正确答案：": "Correct answer:"
  ,"答对": "Correct"
  ,"答错": "Incorrect"
  ,"学生实时进度": "Live student progress"
  ,"学生作答时自动更新": "Updates automatically while students answer"
  ,"实时": "LIVE"
  ,"已完成": "Completed"
  ,"正在作答": "In progress"
  ,"每份作业的学生进度": "Student Progress by Assignment"
  ,"展开作业即可查看每位学生的实时作答状态与成绩。": "Expand an assignment to view every student's live answer progress and score."
  ,"尚未开始": "Not started"
  ,"所有班级": "All classes"
  ,"学生作答明细": "Student progress details"
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
  updateAIChatResizeControl();
}

function refreshLanguage() {
  if (currentLanguage === "en") applyLanguage("en", { persist: false });
}

function getTeacherPassword() {
  return localStorage.getItem(PASSWORD_KEY) || "0000";
}

function createStudentId(student) {
  const source = [student?.name, student?.className, student?.year, student?.createdAt].join("|");
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `student-${(hash >>> 0).toString(36)}`;
}

function getStudents() {
  if (Cloud?.enabled && cloudDataLoaded) return cloudStudents;
  try {
    const stored = JSON.parse(localStorage.getItem(STUDENTS_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    let migrated = false;
    const students = stored.filter((student) => student && typeof student === "object").map((student) => {
      const normalized = {
        ...student,
        id: String(student.id || createStudentId(student)),
        name: String(student.name || "").trim(),
        className: String(student.className || "").trim(),
        year: String(student.year || ""),
        password: String(student.password || "0000"),
        status: student.status === "disabled" ? "disabled" : "active"
      };
      if (normalized.id !== student.id || normalized.password !== student.password || normalized.status !== student.status) migrated = true;
      return normalized;
    });
    if (migrated) localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
    return students;
  } catch {
    return [];
  }
}

function saveStudents(students) {
  if (Cloud?.enabled && cloudDataLoaded) cloudStudents = students;
  const cachedStudents = Cloud?.enabled ? students.map(({ password: _password, ...student }) => student) : students;
  localStorage.setItem(STUDENTS_KEY, JSON.stringify(cachedStudents));
  syncCloud(() => Cloud.updateStudents(students), "student accounts");
  renderTeacherMetrics();
  if (activeWorkspaceView === "classes") renderWorkspaceView("classes");
}

function getClasses() {
  if (Cloud?.enabled && cloudDataLoaded) return cloudClasses.map((item) => item.name);
  try {
    const stored = JSON.parse(localStorage.getItem(CLASSES_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function savePapers() {
  localStorage.setItem(PAPERS_KEY, JSON.stringify(papers));
  syncCloud(() => Cloud.upsertPapers(papers), "learning materials");
}

function saveAssignments() {
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  syncCloud(() => Cloud.upsertAssignments(assignments), "assignments");
}

function saveQuestions() {
  const positions = new Map();
  questionBank.forEach((question) => {
    const group = question.paperId || "manual";
    question.position = positions.get(group) || 0;
    positions.set(group, question.position + 1);
  });
  localStorage.setItem(QUESTIONS_KEY, JSON.stringify(questionBank));
  syncCloud(() => Cloud.upsertQuestions(questionBank), "questions");
}

function saveTeacherNotes() {
  localStorage.setItem(NOTES_KEY, JSON.stringify(teacherNotes));
  syncCloud(() => Cloud.upsertNotes(teacherNotes), "teacher notes");
  renderStudentNotesPreview();
  if (activeWorkspaceView === "notes") renderWorkspaceView("notes");
}

function saveSession() {
  const learningApp = $("#learning-app");
  if (!learningApp || learningApp.classList.contains("screen-hidden")) return;
  const activeView = $("#quiz-view")?.classList.contains("active")
    ? "quiz"
    : $("#placeholder-view")?.classList.contains("active")
      ? activeWorkspaceView || "dashboard"
      : "dashboard";
  const activeAssignment = assignments[activeAssignmentIndex];
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    role,
    student: role === "student" && activeStudent ? {
      id: activeStudent.id,
      name: activeStudent.name,
      className: activeStudent.className,
      year: activeStudent.year
    } : null,
    view: activeView,
    assignmentId: activeView === "quiz" ? activeAssignment?.id || "" : "",
    scrollY: Math.max(0, Math.round(window.scrollY || 0))
  }));
}

function readStoredSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!session || !["teacher", "student"].includes(session.role)) return null;
    if (session.role === "student" && !session.student?.name) return null;
    return session;
  } catch {
    return null;
  }
}

function restoreSession() {
  if (Cloud?.enabled) return false;
  const session = readStoredSession();
  try {
    if (session?.role === "teacher") {
      enterApp("teacher", null, session);
      return true;
    }
    if (session?.role === "student" && session.student?.name) {
      const registeredStudent = getStudents().find((student) => (
        (session.student.id && student.id === session.student.id)
        || (student.name === session.student.name
          && student.className === session.student.className
          && student.year === session.student.year)
      ));
      if (registeredStudent && registeredStudent.status !== "disabled") {
        enterApp("student", registeredStudent, session);
        return true;
      }
    }
  } catch {
    // Invalid session data is cleared below.
  }
  localStorage.removeItem(SESSION_KEY);
  return false;
}

function saveClasses(classes) {
  localStorage.setItem(CLASSES_KEY, JSON.stringify(classes));
  if (Cloud?.enabled && cloudDataLoaded) {
    cloudClasses = classes.map((name) => cloudClasses.find((item) => item.name === name) || { id: "", name, active: true });
  }
  renderClassOptions();
  renderTeacherClasses();
  renderTeacherMetrics();
  renderClassPerformance();
}

function syncCloud(action, label) {
  if (!Cloud?.enabled || !cloudProfile) return;
  cloudSyncQueue = cloudSyncQueue.then(action).catch((error) => {
    lastCloudSyncError = { error, label };
    console.error(`Unable to sync ${label} to Supabase`, error);
    if (Date.now() - lastCloudSyncErrorAt > 5000) {
      lastCloudSyncErrorAt = Date.now();
      showToast(localized("Cloud sync failed. Check the Supabase schema and connection.", "云端同步失败，请检查 Supabase 资料表与连接。"));
    }
  });
}

async function flushCloudSync({ throwOnError = false } = {}) {
  if (Cloud?.enabled) await cloudSyncQueue;
  if (throwOnError && lastCloudSyncError) {
    const failure = lastCloudSyncError;
    lastCloudSyncError = null;
    const error = failure.error instanceof Error ? failure.error : new Error(String(failure.error || "Cloud sync failed."));
    error.cloudLabel = failure.label;
    throw error;
  }
}

function readLocalCloudMigrationSnapshot() {
  return {
    papers: [...papers],
    questions: [...questionBank],
    assignments: [...assignments],
    notes: [...teacherNotes],
    classes: readStoredArray(CLASSES_KEY),
    students: readStoredArray(STUDENTS_KEY)
  };
}

function getLocalCompletedReviewsForStudent(profile) {
  if (!profile?.id || profile.role !== "student") return [];
  const prefix = `${profile.id}:`;
  return Object.entries(readQuizReviewStore())
    .filter(([key, review]) => key.startsWith(prefix) && review && typeof review === "object")
    .map(([, review]) => review)
    .filter((review) => review.assignmentId && Object.keys(review.answersByQuestionId || {}).length);
}

function preserveLocalCompletedReviews(snapshot, profile) {
  const completedIds = new Set(getLocalCompletedReviewsForStudent(profile).map((review) => review.assignmentId));
  if (!completedIds.size) return snapshot;
  snapshot.assignments = (snapshot.assignments || []).map((assignment) => completedIds.has(assignment.id) ? {
    ...assignment,
    done: true,
    action: "查看解析",
    actionEn: "Review Answers",
    detail: `${assignment.questionCount || assignment.questionIds?.length || 0} 题 · 已完成`,
    detailEn: `${assignment.questionCount || assignment.questionIds?.length || 0} questions · Completed`
  } : assignment);
  return snapshot;
}

async function recoverLocalCompletedSubmissions(profile, snapshot) {
  const reviews = getLocalCompletedReviewsForStudent(profile);
  if (!reviews.length) return 0;
  const completedAssignmentIds = new Set((snapshot.submissions || [])
    .filter((submission) => submission.studentId === profile.id && submission.status === "completed")
    .map((submission) => submission.assignmentId));
  const assignmentMap = new Map((snapshot.assignments || []).map((assignment) => [assignment.id, assignment]));
  const questionMap = new Map((snapshot.questions || []).map((question) => [question.id, question]));
  let recovered = 0;
  for (const review of reviews) {
    if (completedAssignmentIds.has(review.assignmentId)) continue;
    const assignment = assignmentMap.get(review.assignmentId);
    if (!assignment) continue;
    const questionIds = Array.isArray(review.questionIds) && review.questionIds.length
      ? review.questionIds
      : assignment.questionIds || [];
    const reviewQuestions = questionIds.map((questionId) => questionMap.get(questionId)).filter(Boolean);
    const savedAnswers = review.answersByQuestionId || {};
    if (!reviewQuestions.length || !reviewQuestions.every((question) => Object.prototype.hasOwnProperty.call(savedAnswers, question.id))) continue;
    const reviewAnswers = reviewQuestions.map((question) => savedAnswers[question.id]);
    try {
      await Cloud.saveSubmission(assignment, reviewQuestions, reviewAnswers, {
        startedAt: review.startedAt || review.completedAt || "",
        completedAt: review.completedAt || ""
      });
      completedAssignmentIds.add(review.assignmentId);
      recovered += 1;
    } catch (error) {
      console.warn("Unable to recover a locally completed submission", error);
    }
  }
  return recovered;
}

function applyCloudSnapshot(snapshot) {
  papers = (snapshot.papers || []).map(normalizePaperRecord);
  questionBank = snapshot.questions || [];
  assignments = snapshot.assignments || [];
  teacherNotes = snapshot.notes || [];
  cloudStudents = snapshot.students || [];
  cloudClasses = snapshot.classes || [];
  cloudSubmissions = snapshot.submissions || [];
  cloudDataLoaded = true;
  localStorage.setItem(PAPERS_KEY, JSON.stringify(papers));
  localStorage.setItem(QUESTIONS_KEY, JSON.stringify(questionBank));
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  localStorage.setItem(NOTES_KEY, JSON.stringify(teacherNotes));
  localStorage.setItem(CLASSES_KEY, JSON.stringify(cloudClasses.map((item) => item.name)));
  localStorage.setItem(STUDENTS_KEY, JSON.stringify(cloudStudents));
}

async function activateCloudProfile(profile, { migrateLocal = true } = {}) {
  if (!Cloud?.enabled || !profile) return false;
  const schemaReady = await Cloud.checkSchema();
  if (!schemaReady) {
    const error = new Error(localized(
      "The Supabase tables need the cloud schema upgrade before this app can connect.",
      "Supabase 资料表需要先执行云端结构升级，系统才能连接。"
    ));
    error.code = "CLOUD_SCHEMA_REQUIRED";
    throw error;
  }
  cloudProfile = profile;
  if (profile.role === "teacher") {
    try {
      const repairResult = await Cloud.repairStudentProfiles();
      if (repairResult?.repaired) {
        console.info(`Restored ${repairResult.repaired} missing student profile(s).`);
      }
    } catch (repairError) {
      // Account reconciliation is a safety repair. A temporary Worker failure
      // must not prevent the teacher from entering the rest of the platform.
      console.warn("Unable to reconcile student profiles", repairError);
    }
  }
  const localSnapshot = readLocalCloudMigrationSnapshot();
  let snapshot = await Cloud.loadSnapshot(profile);
  const cloudHasLearningData = snapshot.papers.length || snapshot.questions.length || snapshot.assignments.length || snapshot.notes.length;
  const localHasLearningData = localSnapshot.papers.length || localSnapshot.questions.length || localSnapshot.assignments.length || localSnapshot.notes.length || localSnapshot.classes.length;
  if (migrateLocal && profile.role === "teacher" && !cloudHasLearningData && localHasLearningData) {
    try {
      const result = await Cloud.migrateLocalSnapshot(localSnapshot);
      snapshot = await Cloud.loadSnapshot(profile);
      if (result?.skippedStudents) {
        showToast(localized(
          `${result.skippedStudents} local student accounts need to register again securely in the cloud.`,
          `${result.skippedStudents} 个本机学生账号需要在云端重新安全注册。`
        ));
      }
    } catch (migrationError) {
      console.error("Unable to migrate local learning data to Supabase", migrationError);
      showToast(localized(
        "Teacher login succeeded. Some old browser data was not migrated; the cloud workspace is still available.",
        "老师登入成功，但部分旧浏览器资料未能迁移；云端学习空间仍然可以使用。"
      ));
      snapshot = await Cloud.loadSnapshot(profile);
    }
  }
  if (profile.role === "student") {
    const recovered = await recoverLocalCompletedSubmissions(profile, snapshot);
    if (recovered) snapshot = await Cloud.loadSnapshot(profile);
    preserveLocalCompletedReviews(snapshot, profile);
  }
  applyCloudSnapshot(snapshot);
  return true;
}

let sessionLoadingHideTimer = 0;
const sessionLoadingInertState = new Map();

function setSessionLoadingInteractionBlocked(blocked) {
  const loader = $("#session-loading");
  if (!loader) return;
  if (blocked) {
    for (const element of document.body.children) {
      if (element === loader || sessionLoadingInertState.has(element)) continue;
      sessionLoadingInertState.set(element, element.inert);
      element.inert = true;
    }
  } else {
    for (const [element, wasInert] of sessionLoadingInertState) element.inert = wasInert;
    sessionLoadingInertState.clear();
  }
  document.documentElement.classList.toggle("session-loading-active", blocked);
}

function showSessionLoading(titleEn, titleZh, detailEn, detailZh) {
  const loader = $("#session-loading");
  if (!loader) return;
  clearTimeout(sessionLoadingHideTimer);
  const title = loader.querySelector(".session-loading-copy strong");
  const detail = loader.querySelector(".session-loading-copy span");
  const localizedTitle = localized(titleEn, titleZh);
  if (title) title.textContent = localizedTitle;
  if (detail) detail.textContent = localized(detailEn, detailZh);
  loader.setAttribute("aria-label", localizedTitle);
  loader.hidden = false;
  loader.classList.remove("is-hiding");
  setSessionLoadingInteractionBlocked(true);
}

function hideSessionLoading({ waitForTransition = false } = {}) {
  const loader = $("#session-loading");
  if (!loader || loader.hidden) return Promise.resolve();
  clearTimeout(sessionLoadingHideTimer);
  loader.classList.add("is-hiding");
  const transition = new Promise((resolve) => {
    sessionLoadingHideTimer = setTimeout(() => {
      loader.hidden = true;
      setSessionLoadingInteractionBlocked(false);
      resolve();
    }, 260);
  });
  return waitForTransition ? transition : Promise.resolve();
}

async function initializeAppSession() {
  const cachedSession = Cloud?.enabled ? readStoredSession() : null;
  if (cachedSession) showSessionBackdrop(cachedSession);
  try {
    if (!Cloud?.enabled) {
      restoreSession();
      return;
    }
    try {
      const session = await Cloud.getSession();
      if (!session?.user?.id) {
        localStorage.removeItem(SESSION_KEY);
        if (cachedSession) showPublicScreen("landing");
        cloudClasses = await Cloud.loadPublicClasses().catch(() => []);
        cloudDataLoaded = true;
        renderClassOptions();
        return;
      }
      const profile = Cloud.normalizeProfile(await Cloud.getProfile(session.user.id));
      if (!profile || profile.status === "disabled") {
        await Cloud.signOut();
        localStorage.removeItem(SESSION_KEY);
        if (cachedSession) showPublicScreen("landing");
        return;
      }
      await activateCloudProfile(profile);
      const matchingCachedSession = cachedSession?.role === profile.role ? cachedSession : null;
      enterApp(profile.role, profile.role === "student" ? profile : null, matchingCachedSession);
    } catch (error) {
      console.error("Unable to restore cloud session", error);
      await Cloud.signOut().catch(() => {});
      cloudProfile = null;
      cloudDataLoaded = false;
      localStorage.removeItem(SESSION_KEY);
      if (cachedSession) showPublicScreen("landing");
      showToast(error?.message || localized("Cloud sign-in could not be restored.", "无法恢复云端登入状态。"));
    }
  } finally {
    await hideSessionLoading({ waitForTransition: true });
  }
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
  $("#edit-student-year").innerHTML = options;
}

function renderClassOptions() {
  const classes = getClasses();
  const options = classes.length
    ? classes.map((className) => `<option value="${escapeHTML(className)}">${escapeHTML(className)}</option>`).join("")
    : `<option value="" disabled selected>${localized("No classes available", "暂无班级")}</option>`;
  $("#student-login-class").innerHTML = options;
  $("#register-class").innerHTML = options;
  $("#edit-student-class").innerHTML = options;
}

function renderTeacherClasses() {
  const classes = getClasses();
  $("#class-count").textContent = localized(`${classes.length} classes`, `${classes.length} 个班级`);
  $("#class-list").innerHTML = classes.map((className) => `<span class="class-chip">${escapeHTML(className)}<button type="button" data-remove-class="${escapeHTML(className)}" aria-label="${localized(`Remove ${className}`, `移除 ${className}`)}">×</button></span>`).join("");
  refreshLanguage();
}

function getLatestCloudSubmissions() {
  const latest = new Map();
  cloudSubmissions.forEach((submission) => {
    const key = `${submission.studentId || "unknown"}:${submission.assignmentId || submission.id}`;
    const current = latest.get(key);
    const submissionTime = new Date(submission.updatedAt || submission.createdAt || 0).getTime();
    const currentTime = new Date(current?.updatedAt || current?.createdAt || 0).getTime();
    if (!current || submissionTime >= currentTime) latest.set(key, submission);
  });
  return [...latest.values()];
}

function getStudentsForAssignment(assignment) {
  const students = getStudents().filter((student) => student.status !== "disabled");
  if (!assignment?.classId && !assignment?.className) return students;
  const assignedClass = cloudClasses.find((item) => item.id === assignment.classId);
  return students.filter((student) => (
    (assignment.classId && student.classId === assignment.classId)
    || (assignedClass?.name && student.className === assignedClass.name)
    || (assignment.className && student.className === assignment.className)
  ));
}

function getAssignmentClassLabel(assignment) {
  return assignment?.className
    || cloudClasses.find((item) => item.id === assignment?.classId)?.name
    || localized("All Classes", "所有班级");
}

function assignmentProgressCardMarkup(assignment, latestByStudentAndAssignment, openAssignmentIds) {
  const students = getStudentsForAssignment(assignment);
  const studentRows = students.map((student) => ({
    student,
    submission: latestByStudentAndAssignment.get(`${assignment.id}:${student.id}`) || null
  }));
  const completedCount = studentRows.filter(({ submission }) => submission?.status === "completed").length;
  const activeCount = studentRows.filter(({ submission }) => submission?.status === "in_progress").length;
  const className = getAssignmentClassLabel(assignment);
  const title = currentLanguage === "en" ? assignment.titleEn : assignment.title;
  const totalQuestions = Number(assignment.questionCount) || assignment.questionIds?.length || 0;
  const open = openAssignmentIds.has(assignment.id) ? " open" : "";
  return `<details class="assignment-progress-card" data-assignment-progress-id="${escapeHTML(assignment.id)}"${open}>
    <summary>
      <span class="assignment-progress-icon">${escapeHTML(assignment.icon || "✦")}</span>
      <span class="assignment-progress-title"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(className)} · ${totalQuestions} ${localized("questions", "题")}</small></span>
      <span class="assignment-progress-overview"><strong>${completedCount} / ${students.length}</strong><small>${localized("completed", "已完成")} · ${activeCount} ${localized("in progress", "进行中")}</small></span>
      <span class="assignment-progress-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="assignment-student-progress" aria-label="${localized("Student progress details", "学生作答明细")}">
      ${studentRows.length ? studentRows.map(({ student, submission }) => {
        const total = submission?.totalQuestions || totalQuestions;
        const completed = submission?.status === "completed";
        const active = submission?.status === "in_progress";
        const answered = completed ? total : Math.min(total || submission?.answeredQuestions || 0, submission?.answeredQuestions || 0);
        const percentage = completed ? 100 : total ? Math.round((answered / total) * 100) : 0;
        const statusText = completed ? localized("Completed", "已完成") : active ? localized("In progress", "正在作答") : localized("Not started", "尚未开始");
        const detail = completed
          ? localized(`Score ${submission.score} / ${total}`, `成绩 ${submission.score} / ${total}`)
          : active ? localized(`${answered} / ${total} answered`, `已作答 ${answered} / ${total} 题`) : localized(`0 / ${total} answered`, `已作答 0 / ${total} 题`);
        const updated = submission?.updatedAt ? formatNoteDate(submission.updatedAt) : localized("No activity yet", "尚无活动");
        return `<article class="assignment-student-row">
          <span class="assignment-student-avatar">${escapeHTML(student.name?.slice(-1) || "学")}</span>
          <span class="assignment-student-name"><strong>${escapeHTML(student.name || localized("Student", "学生"))}</strong><small>${escapeHTML(student.className || "—")} · ${escapeHTML(String(student.year || ""))}</small></span>
          <span class="assignment-student-meter"><span><b>${escapeHTML(detail)}</b><small>${escapeHTML(updated)}</small></span><i><b style="width:${percentage}%"></b></i></span>
          <em class="assignment-status ${completed ? "completed" : active ? "active" : "not-started"}">${escapeHTML(statusText)}</em>
        </article>`;
      }).join("") : `<div class="assignment-progress-empty">${localized("No students are assigned to this class yet.", "此班级尚未有学生账号。")}</div>`}
    </div>
  </details>`;
}

function teacherAssignmentProgressCardsMarkup(openAssignmentIds = openTeacherAssignmentProgressIds) {
  if (!assignments.length) {
    return `<div class="data-empty"><strong>${localized("No assignments yet", "尚未布置练习")}</strong><p>${localized("Create an assignment to begin tracking every student.", "建立作业后即可追踪每位学生的进度。")}</p></div>`;
  }
  const latestByStudentAndAssignment = new Map(getLatestCloudSubmissions().map((submission) => [
    `${submission.assignmentId}:${submission.studentId}`,
    submission
  ]));
  const groups = new Map();
  assignments.forEach((assignment) => {
    const label = getAssignmentClassLabel(assignment);
    const key = assignment.classId ? `id:${assignment.classId}` : assignment.className ? `name:${assignment.className}` : "all";
    if (!groups.has(key)) groups.set(key, { key, label, assignments: [] });
    groups.get(key).assignments.push(assignment);
  });
  const classOrder = new Map(getClasses().map((className, index) => [className, index]));
  return [...groups.values()]
    .sort((left, right) => {
      if (left.key === "all") return -1;
      if (right.key === "all") return 1;
      return (classOrder.get(left.label) ?? 999) - (classOrder.get(right.label) ?? 999) || left.label.localeCompare(right.label);
    })
    .map((group) => {
      const groupStudents = new Set(group.assignments.flatMap((assignment) => getStudentsForAssignment(assignment).map((student) => student.id)));
      return `<section class="assignment-class-group">
        <header><div><span>${localized("CLASS", "班级")}</span><h3>${escapeHTML(group.label)}</h3></div><p>${group.assignments.length} ${localized("assignments", "份作业")} · ${groupStudents.size} ${localized("students", "名学生")}</p></header>
        <div class="assignment-class-list">${group.assignments.map((assignment) => assignmentProgressCardMarkup(assignment, latestByStudentAndAssignment, openAssignmentIds)).join("")}</div>
      </section>`;
    }).join("");
}

function renderTeacherAssignmentProgress() {
  const container = $("#teacher-assignment-progress");
  if (!container || role !== "teacher") return;
  $$("details[open][data-assignment-progress-id]", container).forEach((details) => openTeacherAssignmentProgressIds.add(details.dataset.assignmentProgressId));
  container.innerHTML = teacherAssignmentProgressCardsMarkup();
}

function renderTeacherLiveProgress() {
  const container = $("#teacher-live-progress");
  if (!container || role !== "teacher") return;
  const studentMap = new Map(getStudents().map((student) => [student.id, student]));
  const assignmentMap = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const selectedClass = $("#performance-class-select")?.value || "";
  const rows = getLatestCloudSubmissions()
    .filter((submission) => ["in_progress", "completed"].includes(submission.status))
    .filter((submission) => !selectedClass || studentMap.get(submission.studentId)?.className === selectedClass)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 10);
  if (!rows.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <div class="live-progress-heading"><div><strong>${localized("Live student progress", "学生实时进度")}</strong><small>${localized("Updates automatically while students answer", "学生作答时自动更新")}</small></div><span>● ${localized("LIVE", "实时")}</span></div>
    <div class="live-progress-list">${rows.map((submission) => {
      const student = studentMap.get(submission.studentId);
      const assignment = assignmentMap.get(submission.assignmentId);
      const total = submission.totalQuestions || assignment?.questionCount || 0;
      const answered = Math.min(total || submission.answeredQuestions || 0, submission.answeredQuestions || 0);
      const percentage = total ? Math.round((answered / total) * 100) : 0;
      const completed = submission.status === "completed";
      const title = assignment ? (currentLanguage === "en" ? assignment.titleEn : assignment.title) : localized("Practice", "练习");
      const studentName = student?.name || `${localized("Student", "学生")} · ${String(submission.studentId || "").slice(-6)}`;
      const updated = submission.updatedAt ? formatNoteDate(submission.updatedAt) : localized("just now", "刚刚");
      return `<article class="live-progress-row"><div class="live-progress-avatar">${escapeHTML(studentName.slice(-1) || "学")}</div><div class="live-progress-copy"><strong>${escapeHTML(studentName)}</strong><small>${escapeHTML(title)} · ${completed ? localized("Completed", "已完成") : localized(`${answered} / ${total} answered`, `已作答 ${answered} / ${total} 题`)} · ${escapeHTML(updated)}</small><i><b style="width:${completed ? 100 : percentage}%"></b></i></div><em class="${completed ? "completed" : "active"}">${completed ? `${submission.score} / ${total}` : `${percentage}%`}</em></article>`;
    }).join("")}</div>`;
}

function renderTeacherMetrics() {
  const questionCount = questionBank.length;
  const students = getStudents();
  const classes = getClasses();
  const latestSubmissions = getLatestCloudSubmissions();
  const completedRows = latestSubmissions.filter((submission) => submission.status === "completed");
  const completedSubmissions = completedRows.length;
  const activeSubmissions = latestSubmissions.filter((submission) => submission.status === "in_progress").length;
  const expectedSubmissions = assignments.reduce((total, assignment) => total + getStudentsForAssignment(assignment).length, 0);
  const completedAssignments = cloudSubmissions.length ? completedSubmissions : assignments.filter((assignment) => assignment.done).length;
  const completionRate = expectedSubmissions ? Math.round((completedAssignments / expectedSubmissions) * 100) : assignments.length ? Math.round((completedAssignments / assignments.length) * 100) : 0;
  $("#teacher-question-count").textContent = questionCount.toLocaleString();
  $("#teacher-paper-count").textContent = localized(`${papers.length} materials uploaded`, `${papers.length} 份资料已上传`);
  $("#teacher-completion-rate").innerHTML = `${Math.min(100, completionRate)}<sup>%</sup>`;
  $("#teacher-completion-note").textContent = cloudSubmissions.length
    ? localized(`${activeSubmissions} active · ${completedSubmissions} completed`, `${activeSubmissions} 人正在作答 · ${completedSubmissions} 份已完成`)
    : localized(`${completedAssignments} of ${assignments.length} assignments completed`, `${completedAssignments} / ${assignments.length} 份练习已完成`);
  const gradedQuestions = completedRows.reduce((total, submission) => total + submission.totalQuestions, 0);
  const correctAnswers = completedRows.reduce((total, submission) => total + submission.score, 0);
  $("#teacher-accuracy").textContent = gradedQuestions ? `${Math.round((correctAnswers / gradedQuestions) * 100)}%` : "—";
  $("#teacher-accuracy-note").textContent = gradedQuestions
    ? localized(`${correctAnswers} of ${gradedQuestions} answers correct`, `${correctAnswers} / ${gradedQuestions} 题回答正确`)
    : localized("No graded results yet", "尚无评分记录");
  $("#teacher-student-count").textContent = students.filter((student) => student.status !== "disabled").length;
  $("#teacher-class-count").textContent = localized(`${classes.length} classes`, `${classes.length} 个班级`);
}

function renderClassPerformance() {
  const classes = getClasses();
  const select = $("#performance-class-select");
  if (!select) return;
  const selectedClass = select.value;
  select.innerHTML = classes.length
    ? `<option value="">${localized("All classes", "全部班级")}</option>${classes.map((className) => `<option value="${escapeHTML(className)}">${escapeHTML(className)}</option>`).join("")}`
    : `<option value="">${localized("No classes", "暂无班级")}</option>`;
  if (classes.includes(selectedClass)) select.value = selectedClass;
  select.disabled = !classes.length;
  $("#performance-empty").innerHTML = classes.length
    ? (cloudSubmissions.length ? `<strong>${localized("Live progress is ready", "实时进度已开启")}</strong><p>${localized("Student answers and completion status appear below.", "学生的作答与完成状态会显示在下方。")}</p>` : `<strong>${localized("No performance data yet", "尚无学习表现数据")}</strong><p>${localized("Results will appear after students start graded assignments.", "学生开始评分练习后，成绩会显示在这里。")}</p>`)
    : `<strong>${localized("No classes yet", "尚未建立班级")}</strong><p>${localized("Add a class above to begin collecting learning data.", "请先在上方添加班级。")}</p>`;
  renderTeacherLiveProgress();
}

async function refreshTeacherProgress() {
  if (!Cloud?.enabled || !cloudProfile || cloudProfile.role !== "teacher" || progressRefreshInFlight) return;
  progressRefreshInFlight = true;
  try {
    const snapshot = await Cloud.loadSnapshot(cloudProfile);
    applyCloudSnapshot(snapshot);
    renderPapers(activePaperFilter);
    renderAssignments();
    renderTeacherClasses();
    renderClassPerformance();
    renderTeacherMetrics();
    // The arena owns a live React/Three.js tree and subscribes to its own
    // battle-room updates. Replacing workspace-content here would detach the
    // canvas whenever the teacher progress poll receives a submission, which
    // made the waiting room appear to disappear. Keep that tree mounted while
    // still refreshing every ordinary workspace view.
    if (activeWorkspaceView && activeWorkspaceView !== "arena") renderWorkspaceView(activeWorkspaceView);
  } catch (error) {
    console.warn("Unable to refresh teacher progress", error);
  } finally {
    progressRefreshInFlight = false;
  }
}

function scheduleTeacherProgressRefresh() {
  clearTimeout(progressRefreshTimer);
  progressRefreshTimer = setTimeout(() => void refreshTeacherProgress(), 450);
}

function startTeacherProgressRealtime() {
  stopTeacherProgressRealtime();
  if (!Cloud?.enabled || role !== "teacher" || !Cloud.subscribeToProgress) return;
  stopProgressRealtime = Cloud.subscribeToProgress(scheduleTeacherProgressRefresh);
  // Polling keeps the dashboard responsive if Realtime has not yet been enabled
  // for submissions in the Supabase project.
  teacherProgressPollTimer = setInterval(scheduleTeacherProgressRefresh, 10000);
}

function stopTeacherProgressRealtime() {
  stopProgressRealtime?.();
  stopProgressRealtime = null;
  clearInterval(teacherProgressPollTimer);
  teacherProgressPollTimer = null;
  clearTimeout(progressRefreshTimer);
  progressRefreshTimer = null;
}

function showPublicScreen(screen) {
  closeAIChat();
  document.documentElement.classList.remove("session-restore-app");
  delete document.documentElement.dataset.sessionRole;
  $("#landing-page").classList.toggle("screen-hidden", screen !== "landing");
  $("#auth-screen").classList.toggle("screen-hidden", screen !== "auth");
  $("#learning-app").classList.add("screen-hidden");
  document.body.classList.remove("app-active");
  document.body.classList.remove("student-app");
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function openAuth() {
  showPublicScreen("auth");
  if (Cloud?.enabled && !cloudDataLoaded) {
    try {
      cloudClasses = await Cloud.loadPublicClasses();
      cloudDataLoaded = true;
      renderClassOptions();
    } catch (error) {
      console.error("Unable to load public cloud classes", error);
    }
  }
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

function restoreSessionView(session, { silentQuiz = false } = {}) {
  const requestedView = ["dashboard", "library", "notes", "classes", "arena", "insights", "quiz"].includes(session?.view)
    ? session.view
    : "dashboard";
  if (requestedView === "quiz" && role === "student") {
    const assignmentIndex = assignments.findIndex((assignment) => assignment.id === session?.assignmentId);
    startQuiz(assignmentIndex >= 0 ? assignmentIndex : null, { silent: silentQuiz });
  } else {
    showView(requestedView === "quiz" ? "dashboard" : requestedView);
  }
  const savedScrollY = Number(session?.scrollY);
  if (Number.isFinite(savedScrollY) && savedScrollY > 0 && requestedView !== "quiz") {
    requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: "auto" }));
  }
}

function showSessionBackdrop(session) {
  role = session.role;
  activeStudent = session.role === "student" ? session.student : null;
  $("#landing-page").classList.add("screen-hidden");
  $("#auth-screen").classList.add("screen-hidden");
  $("#learning-app").classList.remove("screen-hidden");
  document.body.classList.add("app-active");
  document.body.classList.toggle("student-app", session.role === "student");
  updateAccountUI();
  $("#ai-chat-launcher").hidden = session.role !== "student";
  setRole(session.role);
  renderPapers(activePaperFilter);
  renderAssignments();
  restoreSessionView(session, { silentQuiz: true });
  document.documentElement.classList.remove("session-restore-app");
  delete document.documentElement.dataset.sessionRole;
}

function enterApp(nextRole, student = null, restoredSession = null) {
  role = nextRole;
  activeStudent = student;
  $("#landing-page").classList.add("screen-hidden");
  $("#auth-screen").classList.add("screen-hidden");
  $("#learning-app").classList.remove("screen-hidden");
  document.body.classList.add("app-active");
  document.body.classList.toggle("student-app", nextRole === "student");
  updateAccountUI();
  $("#ai-chat-launcher").hidden = nextRole !== "student";
  setRole(nextRole);
  renderPapers(activePaperFilter);
  renderAssignments();
  if (restoredSession) restoreSessionView(restoredSession, { silentQuiz: true });
  saveSession();
  if (nextRole === "teacher") {
    renderClassPerformance();
    startCodeTimer();
    startTeacherProgressRealtime();
  } else {
    clearInterval(codeTimer);
    stopTeacherProgressRealtime();
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

function updateVerificationCode() {
  const code = Cloud?.enabled ? (cloudRegistrationCode || "------") : getHourlyCode();
  $("#verification-code").textContent = code;
  $("#verification-code-large").textContent = code;
  const now = new Date();
  const nextHour = Cloud?.enabled && cloudRegistrationCodeExpiresAt ? new Date(cloudRegistrationCodeExpiresAt) : new Date(now);
  if (!Cloud?.enabled || !cloudRegistrationCodeExpiresAt) nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  const remaining = Math.max(0, nextHour - now);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const countdown = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  $("#code-countdown").textContent = countdown;
  $("#code-countdown-large").textContent = countdown;
}

function startCodeTimer() {
  clearInterval(codeTimer);
  updateVerificationCode();
  if (Cloud?.enabled && cloudProfile?.role === "teacher") {
    Cloud.getRegistrationCode().then((result) => {
      cloudRegistrationCode = result.code;
      cloudRegistrationCodeExpiresAt = result.expiresAt;
      updateVerificationCode();
    }).catch((error) => {
      console.error("Unable to load cloud registration code", error);
      showToast(localized("Cloud registration code is unavailable. Configure the Cloudflare secret.", "无法取得云端验证码，请设置 Cloudflare 密钥。"));
    });
  }
  codeTimer = setInterval(updateVerificationCode, 1000);
}

function getPaperMainCategory(paper) {
  return normalizeMainCategory(paper?.mainCategory || paper?.topic, paper?.subject);
}

function getPaperSubject(paper) {
  return normalizeSubject(paper?.subject, getPaperMainCategory(paper));
}

function getPaperClassificationLabel(paper) {
  const mainCategory = getPaperMainCategory(paper);
  const subject = getPaperSubject(paper);
  return currentLanguage === "en"
    ? `${MAIN_CATEGORY_EN[mainCategory]} · ${SUBJECT_EN[subject]}`
    : `${mainCategory} · ${subject}`;
}

function categoryFilterButtons(activeFilter, attribute = "data-library-category") {
  return ["全部", ...MAIN_CATEGORIES].map((category) => {
    const label = category === "全部" ? localized("All", "全部") : localized(MAIN_CATEGORY_EN[category], category);
    return `<button type="button" class="filter ${category === activeFilter ? "active" : ""}" ${attribute}="${escapeHTML(category)}">${escapeHTML(label)}</button>`;
  }).join("");
}

function getPaperAuthorizedClassNames(paperId) {
  const paperAssignments = assignments.filter((assignment) => assignment.paperId === paperId);
  if (!paperAssignments.length) return [];
  if (paperAssignments.some((assignment) => !assignment.classId && !assignment.className)) {
    return [localized("All Classes", "所有班级")];
  }
  return [...new Set(paperAssignments.map((assignment) => {
    if (assignment.className) return assignment.className;
    return cloudClasses.find((item) => item.id === assignment.classId)?.name || "";
  }).filter(Boolean))];
}

function paperAuthorizedClassesMarkup(paperId) {
  const authorizedClasses = getPaperAuthorizedClassNames(paperId);
  const classChips = (authorizedClasses.length ? authorizedClasses : [localized("Not Assigned", "尚未授权")])
    .map((className) => `<span class="paper-access-chip">${escapeHTML(className)}</span>`).join("");
  return `<div class="paper-access"><span class="paper-access-label">${localized("Authorized Classes", "授权班级")}</span><div class="paper-access-classes">${classChips}</div></div>`;
}

function renderPapers(filter = "全部") {
  activePaperFilter = filter;
  $$(".question-panel .filter[data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
  const visible = filter === "全部" ? papers : papers.filter((paper) => getPaperMainCategory(paper) === filter);
  $("#paper-list").innerHTML = visible.map((paper) => `
      <article class="paper-row">
        <div class="paper-year">${paper.year}</div>
        <div class="paper-info">
          <strong>${escapeHTML(currentLanguage === "en" ? paper.titleEn : paper.title)}</strong>
          <small>${paper.count} ${localized("questions", "道题目")} · ${escapeHTML(currentLanguage === "en" ? paper.statusEn : paper.status)}</small>
          ${paperAuthorizedClassesMarkup(paper.id)}
        </div>
        <div class="paper-meta"><span>${escapeHTML(getPaperClassificationLabel(paper))}</span><button data-paper-id="${escapeHTML(paper.id)}">${localized("Edit Material →", "编辑资料 →")}</button></div>
      </article>`).join("") || `<div class="data-empty"><strong>${localized("No learning materials uploaded", "尚未上传学习资料")}</strong><p>${localized("Upload a paper, handout, image, or document to generate interactive questions.", "上传试卷、讲义、图片或文件即可生成互动题目。")}</p><button type="button" data-empty-upload>${localized("Upload Learning Material", "上传学习资料")}</button></div>`;
  renderTeacherMetrics();
  refreshLanguage();
}

function renderAssignments() {
  $("#assignment-list").innerHTML = assignments.length ? assignments.map((item, index) => {
    const progress = role === "student" && !item.done ? getStoredQuizProgress(item.id) : null;
    const validQuestionIds = new Set(Array.isArray(item.questionIds) ? item.questionIds : []);
    const answeredCount = progress ? Object.entries(progress.answersByQuestionId || {}).filter(([questionId, answer]) => validQuestionIds.has(questionId) && hasAnswer(answer)).length : 0;
    const hasProgress = Boolean(progress && (answeredCount > 0 || Object.keys(progress.draftAnswersByQuestionId || {}).length));
    const detail = hasProgress
      ? localized(`${answeredCount} / ${item.questionCount || validQuestionIds.size} answered · Continue`, `已作答 ${answeredCount} / ${item.questionCount || validQuestionIds.size} 题 · 可继续`)
      : currentLanguage === "en" ? item.detailEn : item.detail;
    const action = hasProgress ? localized("Continue", "继续作答") : currentLanguage === "en" ? item.actionEn : item.action;
    return `
    <article class="assignment ${item.done ? "done" : ""} ${hasProgress ? "in-progress" : ""}">
      <div class="paper-year">${item.icon}</div>
      <div><strong>${escapeHTML(currentLanguage === "en" ? item.titleEn : item.title)}</strong><small>${escapeHTML(detail)}</small></div>
      <button data-assignment="${index}">${escapeHTML(action)}</button>
    </article>`;
  }).join("") : `<div class="data-empty"><strong>${localized("No assignments yet", "尚未布置练习")}</strong><p>${localized("Assignments created by the teacher will appear here.", "老师建立练习后会显示在这里。")}</p></div>`;
  updateStudentProgress();
  renderLastUnfinishedAssignment();
  renderTeacherAssignmentProgress();
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
  const analytics = role === "student" ? calculateLearningAnalytics(getCompletedAnalyticsSubmissions()) : { accuracy: 0, totalQuestions: 0, streak: 0 };
  const accuracyText = analytics.totalQuestions ? `${analytics.accuracy}%` : "—";
  $("#student-accuracy").textContent = accuracyText;
  $("#student-progress-accuracy").textContent = accuracyText;
  $("#student-streak").textContent = localized(`${analytics.streak} days`, `${analytics.streak} 天`);
  $("#student-question-count").textContent = analytics.totalQuestions;
  $("#student-rank").textContent = "—";
  $("#student-weekly-count").textContent = completed;
  $("#student-weekly-total").textContent = `/ ${assignments.length}`;
  const unfinished = getLatestQuizProgressCandidate();
  $("#student-hero-summary").textContent = unfinished
    ? localized(
      `Your last unfinished assignment is “${unfinished.assignment.titleEn || unfinished.assignment.title}”.`,
      `你上次尚未完成的作业是《${unfinished.assignment.title}》。`
    )
    : assignments.length
      ? localized(`${completed} of ${assignments.length} assignments completed.`, `已完成 ${completed} / ${assignments.length} 份练习。`)
      : localized("No assignments have been assigned yet.", "老师尚未布置练习。 ");
  const continueButton = $("#continue-quiz");
  continueButton.innerHTML = unfinished
    ? `${localized("Continue unfinished assignment", "继续未完成的作业")} <span>→</span>`
    : `${localized("Start practice", "开始练习")} <span>→</span>`;
  continueButton.disabled = !assignments.some((assignment) => (
    !assignment.done && Array.isArray(assignment.questionIds) && assignment.questionIds.some((id) => questionBank.some((question) => question.id === id))
  ));
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

function formatAIInlineMarkdown(value) {
  const codeTokens = [];
  let text = escapeHTML(value);
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `\uE000${codeTokens.length}\uE001`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。；：、！？,.!?:;)）])/g, "$1<em>$2</em>")
    .replace(/(^|[\s（(])_([^_\n]+)_(?=$|[\s，。；：、！？,.!?:;)）])/g, "$1<em>$2</em>");
  return text.replace(/\uE000(\d+)\uE001/g, (_, index) => codeTokens[Number(index)] || "");
}

function renderAIMessageMarkdown(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listType = "";
  let codeLines = null;
  let codeLanguage = "";

  const closeParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(formatAIInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = "";
  };
  const openList = (type) => {
    closeParagraph();
    if (listType === type) return;
    closeList();
    listType = type;
    output.push(`<${type}>`);
  };
  const closeCode = () => {
    if (!codeLines) return;
    const language = /^[a-z0-9_+-]{1,24}$/i.test(codeLanguage) ? ` data-language="${codeLanguage}"` : "";
    output.push(`<pre${language}><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
    codeLines = null;
    codeLanguage = "";
  };

  lines.forEach((line) => {
    const fence = line.match(/^\s*```\s*([a-z0-9_+-]*)\s*$/i);
    if (fence) {
      if (codeLines) closeCode();
      else {
        closeParagraph();
        closeList();
        codeLines = [];
        codeLanguage = fence[1] || "";
      }
      return;
    }
    if (codeLines) {
      codeLines.push(line);
      return;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      return;
    }
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(5, heading[1].length + 2);
      output.push(`<h${level}>${formatAIInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      closeParagraph();
      closeList();
      output.push("<hr>");
      return;
    }
    const unorderedItem = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unorderedItem) {
      openList("ul");
      output.push(`<li>${formatAIInlineMarkdown(unorderedItem[1])}</li>`);
      return;
    }
    const orderedItem = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (orderedItem) {
      openList("ol");
      output.push(`<li>${formatAIInlineMarkdown(orderedItem[1])}</li>`);
      return;
    }
    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      closeParagraph();
      closeList();
      output.push(`<blockquote>${formatAIInlineMarkdown(quote[1])}</blockquote>`);
      return;
    }
    closeList();
    paragraph.push(line.trim());
  });
  closeParagraph();
  closeList();
  closeCode();
  return output.join("");
}

function appendChatMessage(type, message, { typing = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${type === "user" ? "user-message" : "ai-message"}${typing ? " typing-message" : ""}`;
  const avatar = document.createElement("span");
  avatar.textContent = type === "user" ? localized("You", "你") : "AI";
  const body = document.createElement("div");
  body.className = "message-body";
  body.dataset.rawMessage = message;
  const text = document.createElement(type === "ai" && !typing ? "div" : "p");
  if (typing) {
    text.className = "typing-dots";
    text.innerHTML = "<i></i><i></i><i></i>";
  } else if (type === "ai") {
    text.className = "message-markdown";
    text.innerHTML = renderAIMessageMarkdown(message);
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

function getChatSystemInstruction(mode) {
  const modeInstruction = mode === "study"
    ? "Teach step by step, check the learner's reasoning, use concrete examples, and end with one useful practice prompt when appropriate."
    : mode === "creative"
      ? "Generate polished, original ideas and drafts. Offer alternatives when that improves the result."
      : "Act as a capable general-purpose assistant comparable to a modern conversational AI. Answer the actual question directly and thoroughly.";
  return `You are the Personal AI Assistant for secondary-school students and teachers. ${modeInstruction}
You are not limited to uploaded school material: answer questions across computing, mathematics, science, languages, writing, planning, current concepts, and everyday knowledge.
Use the user's language unless they request another language. Preserve important English technical terms when helpful.
For calculations and code, reason carefully and verify the result. If the request is ambiguous, state the most useful assumption or ask one concise clarification question.
Do not give a canned topic overview when the user asked a specific question. Be honest about uncertainty and never claim to have browsed or performed actions you did not perform.`;
}

function extractGeminiChatReply(data) {
  const interaction = data?.interaction || data;
  return interaction?.steps
    ?.filter((step) => step?.type === "model_output")
    .flatMap((step) => Array.isArray(step.content) ? step.content : [])
    .filter((content) => content?.type === "text")
    .map((content) => content.text || "")
    .join("\n")
    .trim() || interaction?.output_text?.trim() || "";
}

async function requestChatFromGemini(apiKey, question) {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const mode = $("#ai-model-select")?.value || "general";
  const conversation = aiConversation.slice(-16).map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`).join("\n\n");
  const input = conversation || `User: ${question}`;
  const attemptModels = getGeminiAttemptModels(getGeminiModel());
  let lastError;

  for (let attempt = 0; attempt < attemptModels.length; attempt += 1) {
    const attemptedModel = attemptModels[attempt];
    try {
      const response = await fetchWithGeminiAttemptTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: attemptedModel,
          input,
          system_instruction: getChatSystemInstruction(mode),
          store: false,
          generation_config: {
            temperature: mode === "creative" ? 0.9 : mode === "study" ? 0.45 : 0.65,
            max_output_tokens: 4096,
            thinking_level: "medium"
          }
        })
      }, null, 60000);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const providerMessage = data?.error?.message || `Gemini returned ${response.status}`;
        const error = new Error(providerMessage);
        error.httpStatus = response.status;
        if ((isTransientGeminiError(response.status, providerMessage) || isGeminiModelError(response.status, providerMessage)) && attempt < attemptModels.length - 1) {
          await waitForGeminiRetry(650 * (2 ** attempt));
          continue;
        }
        throw error;
      }
      const reply = extractGeminiChatReply(data);
      if (!reply) throw new Error("Gemini returned an empty response");
      localStorage.setItem(GEMINI_KEY_STATUS_KEY, "valid");
      updateAIConfigStatus();
      return { reply, model: attemptedModel };
    } catch (error) {
      lastError = error;
      if (attempt < attemptModels.length - 1 && (["TimeoutError", "AbortError", "GeminiAttemptTimeout"].includes(error?.name) || !error?.httpStatus || isTransientGeminiError(error.httpStatus, error.message) || isGeminiModelError(error.httpStatus, error.message))) {
        await waitForGeminiRetry(650 * (2 ** attempt));
        continue;
      }
      break;
    }
  }
  throw lastError || new Error("Gemini chat failed");
}

async function cloudAuthorizationHeaders({ forceRefresh = false } = {}) {
  if (!Cloud?.enabled) return {};
  let session = await Cloud.getSession();
  const expiresSoon = Number(session?.expires_at) > 0
    && Number(session.expires_at) <= Math.floor(Date.now() / 1000) + 60;
  if ((forceRefresh || !session?.access_token || expiresSoon) && Cloud.refreshSession) {
    session = await Cloud.refreshSession().catch(() => session);
  }
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function requestConfiguredAI(endpoint, payload) {
  const request = async (authorization) => fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorization },
    body: JSON.stringify(payload)
  });

  let authorization = await cloudAuthorizationHeaders();
  let response = await request(authorization);
  // Supabase sessions can expire while the app remains open. Refresh once and
  // retry the same request so the student does not have to reload the app.
  if ((response.status === 401 || response.status === 403) && Cloud?.refreshSession) {
    const refreshed = await Cloud.refreshSession().catch(() => null);
    if (refreshed?.access_token) {
      authorization = await cloudAuthorizationHeaders({ forceRefresh: true });
      response = await request(authorization);
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `AI endpoint returned ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  if (!data?.reply || typeof data.reply !== "string") throw new Error("AI response was empty");
  return data;
}

function isTouchInputDevice() {
  return Boolean(
    window.matchMedia?.("(pointer: coarse)").matches
    || Number(navigator.maxTouchPoints) > 0
  );
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
    const canTrySameOrigin = !location.hostname.endsWith("github.io") && !globalThis.Capacitor?.isNativePlatform?.();
    let data;
    let endpointError;

    if (configuredEndpoint || canTrySameOrigin) {
      try {
        data = await requestConfiguredAI(configuredEndpoint || "./api/chat", {
          message: trimmed,
          messages: aiConversation.slice(-16),
          mode: $("#ai-model-select")?.value || "general",
          language: currentLanguage
        });
      } catch (error) {
        endpointError = error;
      }
    }

    if (!data?.reply && getGeminiApiKey()) data = await requestChatFromGemini(getGeminiApiKey(), trimmed);
    if (!data?.reply) throw endpointError || createAISetupError(localized(
      "AI is not connected. Configure the Gemini backend or API key in the teacher portal.",
      "AI 尚未连接，请先在老师端设置 Gemini 后端或 API Key。"
    ));
    typingMessage.remove();
    aiConversation.push({ role: "assistant", content: data.reply });
    appendChatMessage("ai", data.reply);
    if (Cloud?.enabled && cloudProfile) {
      syncCloud(
        async () => { cloudChatThreadId = await Cloud.saveChatConversation(cloudChatThreadId, aiConversation, "学生 AI 对话"); },
        "AI chat"
      );
    }
    const status = $("#ai-connection-status");
    if (status) {
      status.classList.remove("offline");
      status.innerHTML = `<i></i> ${localized("Online · Gemini", "在线 · Gemini")}`;
    }
  } catch (error) {
    typingMessage.remove();
    const unavailable = error?.httpStatus === 401
      ? localized("Your cloud session has expired. Sign in again before using AI.", "云端登入已过期，请重新登入后再使用 AI。")
      : error?.httpStatus === 503
        ? localized("The AI service is temporarily busy. Please try again shortly.", "AI 服务目前繁忙，请稍后再试。")
        : localized(
          "I could not connect to the generative AI service. Ask your teacher to check the Gemini connection, API key, and model, then try again. Your question was not answered by a scripted demo.",
          "目前无法连接生成式 AI 服务。请老师检查 Gemini 连接、API Key 与模型后再试。系统不会再用固定示范答案代替真正的 AI 回答。"
        );
    aiConversation.push({ role: "assistant", content: unavailable });
    appendChatMessage("ai", unavailable);
    if (Cloud?.enabled && cloudProfile) {
      syncCloud(
        async () => { cloudChatThreadId = await Cloud.saveChatConversation(cloudChatThreadId, aiConversation, "学生 AI 对话"); },
        "AI chat"
      );
    }
    const status = $("#ai-connection-status");
    if (status) {
      status.classList.add("offline");
      status.innerHTML = `<i></i> ${localized("Connection needed", "需要连接")}`;
    }
    console.warn("Generative AI connection failed", error);
  } finally {
    submitButton.disabled = false;
    const input = $("#ai-question-input");
    // Do not restore focus on phones/tablets: doing so reopens the virtual
    // keyboard after the answer arrives and shifts the chat viewport.
    if (isTouchInputDevice()) input?.blur();
    else input?.focus();
  }
}

function resetAIChat() {
  clearTimeout(aiReplyTimer);
  lastAIQuestion = "";
  aiConversation = [];
  cloudChatThreadId = "";
  $("#ai-chat-log").innerHTML = "";
  appendChatMessage("ai", localized(
    "Hello! I am your generative AI assistant. Ask me anything, request an explanation, rewrite text, compare ideas, or create something new.",
    "你好！我是你的生成式 AI 助理。你可以连续提问、要求我解释、改写、比较或产生新点子。"
  ));
  $("#ai-question-form button[type='submit']").disabled = false;
}

function openAIChat() {
  if (role !== "student" || $("#learning-app").classList.contains("screen-hidden")) return;
  const panel = $("#ai-chat-popover");
  const status = $("#ai-connection-status");
  const configuredEndpoint = globalThis.PERSONAL_AI_CONFIG?.aiEndpoint?.trim();
  const hasSameOriginBackend = !location.hostname.endsWith("github.io")
    && !globalThis.Capacitor?.isNativePlatform?.()
    && !["127.0.0.1", "localhost"].includes(location.hostname);
  const connected = Boolean(configuredEndpoint || getGeminiApiKey() || hasSameOriginBackend);
  status?.classList.toggle("offline", !connected);
  if (status) status.innerHTML = connected
    ? `<i></i> ${localized("Ready", "已就绪")}`
    : `<i></i> ${localized("Connection needed", "需要连接")}`;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));
  $("#ai-chat-launcher").classList.add("active");
  $("#ai-chat-launcher").setAttribute("aria-expanded", "true");
  if (!isTouchInputDevice()) setTimeout(() => $("#ai-question-input")?.focus(), 180);
}

function closeAIChat() {
  const panel = $("#ai-chat-popover");
  const launcher = $("#ai-chat-launcher");
  if (!panel || !launcher) return;
  panel.classList.remove("open");
  launcher.classList.remove("active");
  launcher.setAttribute("aria-expanded", "false");
  setTimeout(() => {
    if (!panel.classList.contains("open")) panel.hidden = true;
  }, 180);
}

function toggleAIChat() {
  $("#ai-chat-popover").hidden || !$("#ai-chat-popover").classList.contains("open") ? openAIChat() : closeAIChat();
}

function updateAIChatResizeControl() {
  const panel = $("#ai-chat-popover");
  const button = $("#resize-ai-chat");
  if (!panel || !button) return;
  const maximized = panel.classList.contains("maximized");
  const label = maximized
    ? localized("Restore chat size", "还原聊天窗口")
    : localized("Enlarge chat", "放大聊天窗口");
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(maximized));
  button.title = label;
  button.querySelector("span").textContent = maximized ? "↙" : "↗";
}

function toggleAIChatSize() {
  const panel = $("#ai-chat-popover");
  if (!panel) return;
  panel.classList.toggle("maximized");
  updateAIChatResizeControl();
  requestAnimationFrame(() => {
    const log = $("#ai-chat-log");
    log.scrollTop = log.scrollHeight;
    if (!isTouchInputDevice()) $("#ai-question-input")?.focus();
  });
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast p").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}

function confirmDestructiveAction(firstMessage, finalMessage) {
  if (!window.confirm(firstMessage)) return false;
  return window.confirm(finalMessage);
}

function localized(english, chinese) {
  return currentLanguage === "en" ? english : chinese;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function formatNoteDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLanguage === "en" ? "en-MY" : "zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function noteCardsMarkup({ editable = false, limit = teacherNotes.length } = {}) {
  const visibleNotes = teacherNotes.slice(0, limit);
  if (!visibleNotes.length) {
    return `<div class="data-empty"><strong>${localized("No teacher notes yet", "老师尚未发布笔记")}</strong><p>${editable
      ? localized("Create a note to share key points, reminders, or supplementary learning material with students.", "新增笔记，把重点、提醒或补充学习资料分享给学生。")
      : localized("Notes published by your teacher will appear here.", "老师发布笔记后会显示在这里。")}</p></div>`;
  }
  return visibleNotes.map((note) => `
    <article class="teacher-note-card" data-note-id="${escapeHTML(note.id)}">
      <div class="teacher-note-meta"><span>${localized("TEACHER NOTE", "教师笔记")}</span><time>${escapeHTML(formatNoteDate(note.updatedAt))}</time></div>
      <h2>${escapeHTML(note.title)}</h2>
      <p>${escapeHTML(note.content)}</p>
      ${editable ? `<div class="teacher-note-actions"><button type="button" data-edit-note="${escapeHTML(note.id)}">${localized("Edit", "编辑")}</button><button type="button" class="note-delete-button" data-delete-note="${escapeHTML(note.id)}">${localized("Delete", "删除")}</button></div>` : ""}
    </article>`).join("");
}

function renderStudentNotesPreview() {
  const container = $("#student-notes-preview");
  if (!container) return;
  container.innerHTML = noteCardsMarkup({ limit: 3 });
}

function openNoteDialog(noteId = "") {
  if (role !== "teacher") return;
  const note = teacherNotes.find((item) => item.id === noteId);
  $("#note-form").reset();
  $("#edit-note-id").value = note?.id || "";
  $("#note-dialog-title").textContent = note ? localized("Edit Note", "编辑笔记") : localized("New Note", "新增笔记");
  $("#note-title").value = note?.title || "";
  $("#note-content").value = note?.content || "";
  $("#note-error").textContent = "";
  $("#note-dialog").showModal();
  $("#note-title").focus();
}

function closeNoteDialog() {
  $("#note-dialog").close();
  $("#note-error").textContent = "";
}

function getCompletedAnalyticsSubmissions() {
  const completed = getLatestCloudSubmissions().filter((submission) => submission.status === "completed");
  if (role === "teacher") return completed;
  const studentId = String(cloudProfile?.id || activeStudent?.id || "");
  const scoped = completed.filter((submission) => !studentId || !submission.studentId || String(submission.studentId) === studentId);
  const assignmentIds = new Set(scoped.map((submission) => submission.assignmentId));
  assignments.filter((assignment) => assignment.done && !assignmentIds.has(assignment.id)).forEach((assignment) => {
    const review = getCompletedQuizReview(assignment);
    if (!review || !Object.keys(review.answersByQuestionId || {}).length) return;
    scoped.push({
      id: `local:${assignment.id}`,
      assignmentId: assignment.id,
      studentId,
      score: Number(review.correctCount) || 0,
      totalQuestions: Number(review.total) || assignment.questionCount || Object.keys(review.answersByQuestionId).length,
      answeredQuestions: Object.keys(review.answersByQuestionId).length,
      answersByQuestionId: review.answersByQuestionId,
      status: "completed",
      startedAt: review.startedAt || "",
      submittedAt: review.completedAt || "",
      createdAt: review.completedAt || "",
      updatedAt: review.completedAt || ""
    });
  });
  return scoped;
}

function calculateLearningStreak(submissions) {
  const days = [...new Set(submissions.map((submission) => {
    const date = new Date(submission.submittedAt || submission.updatedAt || submission.createdAt || 0);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }).filter(Boolean))].sort().reverse();
  if (!days.length) return 0;
  let streak = 1;
  for (let index = 1; index < days.length; index += 1) {
    const previous = new Date(`${days[index - 1]}T00:00:00`);
    const current = new Date(`${days[index]}T00:00:00`);
    if (Math.round((previous - current) / 86400000) !== 1) break;
    streak += 1;
  }
  return streak;
}

function calculateLearningAnalytics(submissions) {
  const totalQuestions = submissions.reduce((total, submission) => total + (Number(submission.totalQuestions) || 0), 0);
  const correctAnswers = submissions.reduce((total, submission) => total + (Number(submission.score) || 0), 0);
  const topicMap = new Map();
  const questionMap = new Map(questionBank.map((question) => [question.id, question]));
  submissions.forEach((submission) => {
    Object.entries(submission.answersByQuestionId || {}).forEach(([questionId, answer]) => {
      const question = questionMap.get(questionId);
      if (!question) return;
      const topic = question.topic || localized("General", "综合");
      if (!topicMap.has(topic)) topicMap.set(topic, { topic, correct: 0, total: 0 });
      const item = topicMap.get(topic);
      item.total += 1;
      const savedCorrectness = submission.correctnessByQuestionId || {};
      const isCorrect = Object.prototype.hasOwnProperty.call(savedCorrectness, questionId)
        ? savedCorrectness[questionId]
        : isQuestionAnswerCorrect(question, answer);
      if (isCorrect) item.correct += 1;
    });
  });
  const topics = [...topicMap.values()].map((item) => ({
    ...item,
    accuracy: item.total ? Math.round((item.correct / item.total) * 100) : 0
  })).sort((left, right) => left.accuracy - right.accuracy || right.total - left.total);
  return {
    submissions,
    completedAssignments: submissions.length,
    totalQuestions,
    correctAnswers,
    accuracy: totalQuestions ? Math.round((correctAnswers / totalQuestions) * 100) : 0,
    streak: calculateLearningStreak(submissions),
    topics
  };
}

function getTeacherClassAnalytics(completedSubmissions) {
  const activeStudents = getStudents().filter((student) => student.status !== "disabled");
  const knownClasses = [...new Set([...getClasses(), ...activeStudents.map((student) => student.className).filter(Boolean)])];
  return knownClasses.map((className) => {
    const classRecord = cloudClasses.find((item) => item.name === className);
    const students = activeStudents.filter((student) => student.className === className || (classRecord?.id && student.classId === classRecord.id));
    const studentIds = new Set(students.map((student) => student.id));
    const classAssignments = assignments.filter((assignment) => (
      (!assignment.classId && !assignment.className)
      || assignment.className === className
      || (classRecord?.id && assignment.classId === classRecord.id)
    ));
    const assignmentIds = new Set(classAssignments.map((assignment) => assignment.id));
    const submissions = completedSubmissions.filter((submission) => studentIds.has(submission.studentId) && assignmentIds.has(submission.assignmentId));
    const totalQuestions = submissions.reduce((total, submission) => total + (Number(submission.totalQuestions) || 0), 0);
    const correctAnswers = submissions.reduce((total, submission) => total + (Number(submission.score) || 0), 0);
    const expected = students.length * classAssignments.length;
    return {
      className,
      students: students.length,
      assignments: classAssignments.length,
      completed: submissions.length,
      completionRate: expected ? Math.min(100, Math.round((submissions.length / expected) * 100)) : 0,
      accuracy: totalQuestions ? Math.round((correctAnswers / totalQuestions) * 100) : 0,
      gradedQuestions: totalQuestions
    };
  });
}

function analyticsTopicMarkup(topics) {
  if (!topics.length) {
    return `<div class="data-empty"><strong>${localized("No topic results yet", "尚无知识点成绩")}</strong><p>${localized("Topic performance will appear after completed assignments contain saved answers.", "学生完成作业并储存答案后，知识点表现会显示在这里。")}</p></div>`;
  }
  return `<div class="analytics-topic-list">${topics.map((item) => `
    <article class="analytics-topic-row ${item.accuracy < 60 ? "needs-attention" : ""}">
      <div><strong>${escapeHTML(item.topic)}</strong><small>${item.correct} / ${item.total} ${localized("correct", "题正确")}</small></div>
      <span><i><b style="width:${item.accuracy}%"></b></i><em>${item.accuracy}%</em></span>
    </article>`).join("")}</div>`;
}

function teacherStudentRosterMarkup(students) {
  if (!students.length) return `<div class="workspace-empty"><strong>${localized("No students registered yet", "暂时没有学生注册")}</strong><p>${localized("Share the hourly verification code with students to get started.", "把每小时验证码交给学生即可开始注册。")}</p></div>`;
  const groups = new Map();
  students.forEach((student) => {
    const className = student.className || localized("Unassigned", "未分班");
    if (!groups.has(className)) groups.set(className, []);
    groups.get(className).push(student);
  });
  const order = new Map(getClasses().map((className, index) => [className, index]));
  return `<div class="class-roster-groups">${[...groups.entries()].sort((left, right) => (order.get(left[0]) ?? 999) - (order.get(right[0]) ?? 999) || left[0].localeCompare(right[0])).map(([className, classStudents]) => `
    <section class="class-roster-group">
      <header><h3>${escapeHTML(className)}</h3><span>${classStudents.length} ${localized("students", "名学生")}</span></header>
      <div class="workspace-table">${classStudents.map((student) => `<article><span class="student-initial">${escapeHTML(student.name?.slice(-1) || "S")}</span><div><strong>${escapeHTML(student.name)}</strong><small>${escapeHTML(student.className)} · ${escapeHTML(student.year)}</small></div><span class="status-pill ${student.status === "disabled" ? "status-disabled" : ""}">${student.status === "disabled" ? localized("Disabled", "已停用") : localized("Active", "启用中")}</span><button type="button" data-manage-student-id="${escapeHTML(student.id)}">${localized("Manage Account", "管理账号")}</button></article>`).join("")}</div>
    </section>`).join("")}</div>`;
}

function analyticsRecentResultsMarkup(submissions, { teacher = false } = {}) {
  const studentMap = new Map(getStudents().map((student) => [student.id, student]));
  const assignmentMap = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const rows = [...submissions]
    .sort((left, right) => new Date(right.submittedAt || right.updatedAt || 0) - new Date(left.submittedAt || left.updatedAt || 0))
    .slice(0, 10);
  if (!rows.length) return `<div class="data-empty"><strong>${localized("No completed results yet", "尚无已完成成绩")}</strong><p>${localized("Completed assignments will be listed here.", "完成作业后，成绩会列在这里。")}</p></div>`;
  return `<div class="analytics-result-list">${rows.map((submission) => {
    const assignment = assignmentMap.get(submission.assignmentId);
    const student = studentMap.get(submission.studentId);
    const total = Number(submission.totalQuestions) || assignment?.questionCount || 0;
    const score = Number(submission.score) || 0;
    const percentage = total ? Math.round((score / total) * 100) : 0;
    const title = assignment ? (currentLanguage === "en" ? assignment.titleEn : assignment.title) : localized("Practice", "练习");
    const date = formatNoteDate(submission.submittedAt || submission.updatedAt || submission.createdAt);
    return `<article><div><strong>${escapeHTML(teacher ? student?.name || localized("Student", "学生") : title)}</strong><small>${escapeHTML(teacher ? `${student?.className || "—"} · ${title} · ${date}` : date)}</small></div><span><b>${score} / ${total}</b><em>${percentage}%</em></span></article>`;
  }).join("")}</div>`;
}

function teacherAnalyticsMarkup() {
  const submissions = getCompletedAnalyticsSubmissions();
  const analytics = calculateLearningAnalytics(submissions);
  const classAnalytics = getTeacherClassAnalytics(submissions);
  const participatingStudents = new Set(submissions.map((submission) => submission.studentId).filter(Boolean)).size;
  return `
    <div class="workspace-metrics analytics-metrics">
      <article><strong>${analytics.totalQuestions ? `${analytics.accuracy}%` : "—"}</strong><span>${localized("Average accuracy", "平均正确率")}</span></article>
      <article><strong>${analytics.completedAssignments}</strong><span>${localized("Completed submissions", "已完成作业")}</span></article>
      <article><strong>${participatingStudents}</strong><span>${localized("Participating students", "参与学生")}</span></article>
      <article><strong>${analytics.totalQuestions}</strong><span>${localized("Graded answers", "已评分题目")}</span></article>
    </div>
    <div class="analytics-grid">
      <section class="panel workspace-panel"><div class="analytics-panel-heading"><div><span>${localized("BY CLASS", "按班级")}</span><h2>${localized("Class Performance", "班级表现")}</h2></div></div>
        ${classAnalytics.length ? `<div class="analytics-class-list">${classAnalytics.map((item) => `<article><div><strong>${escapeHTML(item.className)}</strong><small>${item.students} ${localized("students", "名学生")} · ${item.assignments} ${localized("assignments", "份作业")}</small></div><span><b>${item.accuracy || 0}%</b><small>${localized("Accuracy", "正确率")}</small></span><span><b>${item.completionRate}%</b><small>${localized("Completion", "完成率")}</small></span></article>`).join("")}</div>` : `<div class="data-empty"><strong>${localized("No classes yet", "尚未建立班级")}</strong></div>`}
      </section>
      <section class="panel workspace-panel"><div class="analytics-panel-heading"><div><span>${localized("BY TOPIC", "按知识点")}</span><h2>${localized("Topic Performance", "知识点表现")}</h2></div></div>${analyticsTopicMarkup(analytics.topics)}</section>
    </div>
    <section class="panel workspace-panel analytics-recent-panel"><div class="analytics-panel-heading"><div><span>${localized("LATEST", "最近")}</span><h2>${localized("Recent Results", "最近成绩")}</h2></div></div>${analyticsRecentResultsMarkup(submissions, { teacher: true })}</section>`;
}

function studentAnalyticsMarkup() {
  const submissions = getCompletedAnalyticsSubmissions();
  const analytics = calculateLearningAnalytics(submissions);
  const weakest = analytics.topics[0];
  const recommendation = weakest
    ? localized(`Focus next on ${weakest.topic}; your current accuracy is ${weakest.accuracy}%.`, `建议下一步加强“${weakest.topic}”，目前正确率为 ${weakest.accuracy}%。`)
    : localized("Complete an assignment to receive a personalised learning recommendation.", "完成一份作业后，系统会提供个人化学习建议。");
  return `
    <div class="workspace-metrics analytics-metrics">
      <article><strong>${analytics.totalQuestions ? `${analytics.accuracy}%` : "—"}</strong><span>${localized("Answer accuracy", "答题正确率")}</span></article>
      <article><strong>${analytics.totalQuestions}</strong><span>${localized("Questions completed", "完成题数")}</span></article>
      <article><strong>${analytics.completedAssignments}</strong><span>${localized("Assignments completed", "已完成作业")}</span></article>
      <article><strong>${analytics.streak}</strong><span>${localized("Day streak", "连续学习天数")}</span></article>
    </div>
    <div class="analytics-grid">
      <section class="panel workspace-panel"><div class="analytics-panel-heading"><div><span>${localized("MY TOPICS", "我的知识点")}</span><h2>${localized("Topic Performance", "知识点表现")}</h2></div></div>${analyticsTopicMarkup(analytics.topics)}</section>
      <section class="panel workspace-panel analytics-recommendation"><span>✦</span><div><small>${localized("NEXT STEP", "下一步建议")}</small><h2>${localized("Learning Recommendation", "学习建议")}</h2><p>${escapeHTML(recommendation)}</p></div></section>
    </div>
    <section class="panel workspace-panel analytics-recent-panel"><div class="analytics-panel-heading"><div><span>${localized("HISTORY", "历史")}</span><h2>${localized("Recent Results", "最近成绩")}</h2></div></div>${analyticsRecentResultsMarkup(submissions)}</section>`;
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
    const visiblePapers = activeLibraryCategoryFilter === "全部"
      ? papers
      : papers.filter((paper) => getPaperMainCategory(paper) === activeLibraryCategoryFilter);
    const visibleAssignments = assignments.map((item, index) => ({ item, index, paper: papers.find((paper) => paper.id === item.paperId) }))
      .filter(({ paper }) => activeLibraryCategoryFilter === "全部" || (paper && getPaperMainCategory(paper) === activeLibraryCategoryFilter));
    const categoryFilters = `<div class="filters workspace-category-filters" aria-label="${localized("Filter by main category", "按主要分类筛选")}">${categoryFilterButtons(activeLibraryCategoryFilter)}</div>`;
    title.textContent = localized("Learning Materials", "学习资料题库");
    description.textContent = role === "teacher"
      ? localized("Review uploaded materials, edit their details, or generate more question sets.", "查看已上传资料、编辑内容，或继续生成更多题目。")
      : localized("Choose a practice set and start an interactive exercise.", "选择练习套题并开始互动式作答。 ");
    action.textContent = role === "teacher" ? localized("＋ Upload Material", "＋ 上传资料") : localized("Start Practice →", "开始练习 →");
    action.dataset.action = role === "teacher" ? "upload" : "start-practice";
    content.innerHTML = role === "teacher" ? `
      ${categoryFilters}
      <section class="panel workspace-panel">
        <div class="workspace-summary"><strong>${visiblePapers.length}</strong><span>${localized("materials in this category", "份此分类资料")}</span></div>
        <div class="workspace-table" role="table">
          ${visiblePapers.length ? visiblePapers.map((paper) => `<article role="row"><span class="workspace-year">${escapeHTML(paper.year)}</span><div><strong>${escapeHTML(currentLanguage === "en" ? paper.titleEn : paper.title)}</strong><small>${escapeHTML(getPaperClassificationLabel(paper))} · ${paper.count} ${localized("questions", "题")}</small>${paperAuthorizedClassesMarkup(paper.id)}</div><span class="status-pill">${escapeHTML(currentLanguage === "en" ? paper.statusEn : paper.status)}</span><button type="button" data-workspace-paper-id="${escapeHTML(paper.id)}">${localized("Edit Material", "编辑资料")}</button></article>`).join("") : `<div class="data-empty"><strong>${localized("No materials in this category", "此分类尚无学习资料")}</strong><p>${localized("Choose another category or upload a new material.", "请选择其他分类或上传新资料。")}</p></div>`}
        </div>
      </section>` : `
      ${categoryFilters}
      <div class="practice-grid">
        ${visibleAssignments.length ? visibleAssignments.map(({ item, index, paper }) => `<article class="panel practice-card"><span>${escapeHTML(item.icon)}</span><small>${paper ? escapeHTML(getPaperClassificationLabel(paper)) : (item.done ? localized("COMPLETED", "已完成") : localized("READY", "可开始"))}</small><h2>${escapeHTML(currentLanguage === "en" ? item.titleEn : item.title)}</h2><p>${escapeHTML(currentLanguage === "en" ? item.detailEn : item.detail)}</p><button type="button" data-start-assignment="${index}">${item.done ? localized("Review Answers", "查看解析") : localized("Start Practice", "开始练习")}</button></article>`).join("") : `<div class="data-empty"><strong>${localized("No assignments in this category", "此分类尚无练习")}</strong><p>${localized("Choose another main category to continue.", "请选择其他主要分类继续学习。")}</p></div>`}
      </div>`;
  } else if (name === "notes") {
    title.textContent = localized("Teacher Notes", "教师笔记");
    description.textContent = role === "teacher"
      ? localized("Publish explanations, reminders, and supplementary material for every student.", "发布重点说明、学习提醒与补充资料，让所有学生都能查看。")
      : localized("Read key points, reminders, and learning supplements published by your teacher.", "查看老师发布的重点、提醒与学习补充。");
    action.hidden = role !== "teacher";
    action.textContent = localized("＋ New Note", "＋ 新增笔记");
    action.dataset.action = role === "teacher" ? "new-note" : "";
    content.innerHTML = `<div class="teacher-notes-grid">${noteCardsMarkup({ editable: role === "teacher" })}</div>`;
  } else if (name === "classes") {
    title.textContent = role === "teacher" ? localized("Class Progress", "班级进度") : localized("My Progress", "我的进度");
    description.textContent = role === "teacher"
      ? localized("View registered students and the classes available for registration.", "查看已注册学生及可供注册的班级。")
      : localized("Track completed assignments and your current learning level.", "追踪已完成作业与目前学习等级。 ");
    if (role === "teacher") {
      const students = getStudents();
      action.textContent = localized("＋ Add Class", "＋ 添加班级");
      action.dataset.action = "dashboard-classes";
      const completedAssignments = getLatestCloudSubmissions().filter((item) => item.status === "completed").length;
      const expectedAssignments = assignments.reduce((total, assignment) => total + getStudentsForAssignment(assignment).length, 0);
      const completionRate = expectedAssignments ? Math.round((completedAssignments / expectedAssignments) * 100) : 0;
      content.innerHTML = `
        <div class="workspace-metrics"><article><strong>${getClasses().length}</strong><span>${localized("Active classes", "启用班级")}</span></article><article><strong>${students.length}</strong><span>${localized("Registered students", "已注册学生")}</span></article><article><strong>${completionRate}%</strong><span>${localized("Completion rate", "完成率")}</span></article></div>
        <section class="panel workspace-panel"><h2>${localized("Student Roster by Class", "按班级分类的学生名册")}</h2>${teacherStudentRosterMarkup(students)}</section>
        <section class="panel workspace-panel workspace-assignment-progress"><h2>${localized("Assignment Progress by Class", "按班级分类的作业进度")}</h2><div class="teacher-assignment-progress">${teacherAssignmentProgressCardsMarkup()}</div></section>`;
    } else {
      const completed = assignments.filter((item) => item.done).length;
      const level = Math.max(1, LEVEL_TARGETS.filter((target) => completed >= target).length + 1);
      const analytics = calculateLearningAnalytics(getCompletedAnalyticsSubmissions());
      action.textContent = localized("Continue Learning →", "继续学习 →");
      action.dataset.action = "start-practice";
      content.innerHTML = `<div class="workspace-metrics"><article><strong>LV. ${level}</strong><span>${localized("Current level", "目前等级")}</span></article><article><strong>${completed}/${assignments.length}</strong><span>${localized("Assignments completed", "已完成作业")}</span></article><article><strong>${analytics.totalQuestions ? `${analytics.accuracy}%` : "—"}</strong><span>${localized("Answer accuracy", "答题正确率")}</span></article></div><section class="panel workspace-panel"><h2>${localized("Learning Milestones", "学习里程碑")}</h2><div class="milestone-list"><span class="done">✓ ${localized("Registered an account", "完成账号注册")}</span>${completed ? `<span class="done">✓ ${localized(`${completed} assignments completed`, `完成 ${completed} 份练习`)}</span>` : ""}<span>${localized("Complete assignments to unlock more milestones", "完成练习以解锁更多里程碑")}</span></div></section>`;
    }
  } else if (name === "arena") {
    title.textContent = localized("Battle Arena", "联机对战");
    description.textContent = role === "teacher"
      ? localized("Open a classroom room and let the system pair students for a live 1v1 quiz battle.", "开启课堂房间，让系统自动把学生配成 1 对 1 答题对战。")
      : localized("Join your teacher's room, answer quickly, and use correct answers to attack your opponent.", "输入老师提供的验证码加入房间，用正确答案攻击对手。 ");
    action.hidden = true;
    // renderWorkspaceView can be called by session/progress refreshes. Do not
    // replace an existing arena root: React Three Fiber needs that DOM node to
    // remain mounted while it is receiving realtime room events.
    if (!content.querySelector("#arena-root")) {
      content.innerHTML = `<section class="arena-workspace-panel panel"><div id="arena-root" class="arena-root" data-role="${role}"></div></section>`;
    }
    if (globalThis.personalAIArena?.mount) globalThis.personalAIArena.mount("#arena-root");
  } else {
    title.textContent = role === "teacher" ? localized("Learning Analytics", "学习分析") : localized("Learning Report", "学习报告");
    description.textContent = role === "teacher"
      ? localized("Use classroom data to identify strengths and topics that need support.", "根据班级数据掌握强项与需要加强的知识点。")
      : localized("Review your performance and choose what to practise next.", "查看学习表现，并选择下一步要加强的内容。 ");
    action.textContent = role === "teacher" ? localized("Download CSV", "下载 CSV") : localized("Practise Weak Topics", "练习弱项");
    action.dataset.action = role === "teacher" ? "export" : "start-practice";
    content.innerHTML = role === "teacher" ? teacherAnalyticsMarkup() : studentAnalyticsMarkup();
  }
}

function downloadReport() {
  const submissions = getCompletedAnalyticsSubmissions();
  const analytics = calculateLearningAnalytics(submissions);
  const classAnalytics = role === "teacher" ? getTeacherClassAnalytics(submissions) : [];
  const rows = [
    ["Metric", "Value"],
    ["Questions in library", questionBank.length],
    ["Registered students", role === "teacher" ? getStudents().length : 1],
    ["Classes", role === "teacher" ? getClasses().length : activeStudent?.className || ""],
    ["Completed submissions", analytics.completedAssignments],
    ["Graded answers", analytics.totalQuestions],
    ["Correct answers", analytics.correctAnswers],
    ["Average accuracy", analytics.totalQuestions ? `${analytics.accuracy}%` : "N/A"],
    [],
    ["Topic", "Correct", "Total", "Accuracy"],
    ...analytics.topics.map((item) => [item.topic, item.correct, item.total, `${item.accuracy}%`]),
    ...(classAnalytics.length ? [[], ["Class", "Students", "Assignments", "Completed", "Completion Rate", "Accuracy"], ...classAnalytics.map((item) => [item.className, item.students, item.assignments, item.completed, `${item.completionRate}%`, `${item.accuracy}%`])] : [])
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
  if (name !== "quiz" && $("#quiz-view")?.classList.contains("active")) saveCurrentQuizProgress();
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
  saveSession();
}

function setRole(nextRole) {
  role = nextRole;
  showView("dashboard");
  updateNavigationLabels();
}

function updateNavigationLabels() {
  $$(".nav-item span:last-child").forEach((span, index) => {
    if (role === "student") span.textContent = currentLanguage === "en"
      ? ["Learning Home", "Practice Library", "Teacher Notes", "My Progress", "Battle Arena", "Learning Report"][index]
      : ["学习首页", "练习题库", "老师笔记", "我的进度", "联机对战", "学习报告"][index];
    else span.textContent = currentLanguage === "en"
      ? ["Overview", "Learning Materials", "Teacher Notes", "Class Progress", "Battle Arena", "Learning Analytics"][index]
      : ["总览", "学习资料", "教师笔记", "班级进度", "联机对战", "学习分析"][index];
  });
  $$(".mobile-nav-label").forEach((span, index) => {
    if (role === "student") span.textContent = currentLanguage === "en"
      ? ["Overview", "Library", "Notes", "Progress", "Report"][index]
      : ["总览", "题库", "笔记", "进度", "报告"][index];
    else span.textContent = currentLanguage === "en"
      ? ["Overview", "Library", "Notes", "Class", "Analytics"][index]
      : ["总览", "题库", "笔记", "班级", "分析"][index];
  });
}

function getUploadGenerationOptions() {
  const materialType = $("#upload-material-type").value === "teaching-material" ? "teaching-material" : "past-paper";
  const requested = Number.parseInt($("#upload-question-count").value, 10);
  return {
    materialType,
    questionCount: materialType === "teaching-material" ? Math.max(10, Math.min(50, requested || 10)) : 40
  };
}

function syncSubjectWithMainCategory(categorySelectId, subjectSelectId) {
  const category = $(categorySelectId)?.value;
  const subjectSelect = $(subjectSelectId);
  if (!subjectSelect) return;
  subjectSelect.value = category === "初中" ? "初中电脑与资讯工艺" : "高中资讯科技";
}

function syncUploadGenerationOptions() {
  const { materialType, questionCount } = getUploadGenerationOptions();
  const isTeachingMaterial = materialType === "teaching-material";
  $("#upload-question-count-field").hidden = !isTeachingMaterial;
  $("#upload-option-help").textContent = isTeachingMaterial
    ? localized(
      `Gemini will understand the teaching content and create exactly ${questionCount} Chinese questions (minimum 10).`,
      `Gemini 会理解教学内容，并生成 ${questionCount} 道中文题目（最少 10 题）。`
    )
    : localized(
      "The system will identify every question and sub-question in the paper and generate at least 40 in the original order.",
      "系统会辨识试卷里的所有题目和分题，并依原顺序生成至少 40 题。"
    );
}

function openUpload() {
  pendingUploadFile = null;
  pendingUploadVisuals = [];
  $("#file-input").value = "";
  $("#material-extra-images").value = "";
  $("#file-preview").innerHTML = "";
  $("#material-extra-images-preview").innerHTML = "";
  $("#upload-material-type").value = "past-paper";
  $("#upload-question-count").value = "10";
  if (!MAIN_CATEGORIES.includes($("#upload-topic").value)) $("#upload-topic").value = "高一";
  syncSubjectWithMainCategory("#upload-topic", "#upload-subject");
  syncUploadGenerationOptions();
  resetGenerationUI();
  $("#upload-dialog").showModal();
}

function loadFiles(files) {
  if (isGeneratingQuestions) return;
  if (!files.length) return;
  const file = files[0];
  const accepted = /\.(pdf|png|jpe?g|webp|txt|md|csv|json|html?|xml|js|py|java|c|cpp|sql|docx|pptx|xlsx)$/i.test(file.name);
  if (!accepted) {
    pendingUploadFile = null;
    $("#file-preview").innerHTML = `<p class="form-error">${localized("Choose a supported document, image, or text file.", "请选择支持的文件、图片或文字档。")}</p>`;
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
  resetGenerationUI();
  $("#process-upload").disabled = false;
}

async function loadSupplementalVisuals(files) {
  if (isGeneratingQuestions) return;
  const selected = Array.from(files || []).slice(0, 12);
  pendingUploadVisuals = [];
  const preview = $("#material-extra-images-preview");
  preview.innerHTML = "";
  for (const file of selected) {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 8 * 1024 * 1024) continue;
    try {
      const data = await compressImageData(await fileToDataUrl(file), 1200, 0.62);
      const previewData = await compressImageData(data, 180, 0.55);
      pendingUploadVisuals.push({ data, previewData, mimeType: "image/jpeg", name: file.name });
    } catch (error) {
      console.warn("Unable to read supplemental image", error);
    }
  }
  preview.innerHTML = pendingUploadVisuals.length
    ? pendingUploadVisuals.map((visual) => `<span class="upload-visual-thumb"><img src="${escapeHTML(visual.previewData || visual.data)}" alt="${escapeHTML(visual.name)}"><small>${escapeHTML(visual.name)}</small></span>`).join("")
    : "";
}

function resetGenerationUI() {
  isGeneratingQuestions = false;
  $("#generation-progress").classList.remove("success", "error");
  $("#generation-progress").hidden = true;
  $("#generation-status").textContent = localized("Ready to read material", "准备读取资料");
  $("#generation-percent").textContent = "0%";
  $("#generation-progress-bar").style.width = "0%";
  $("#generation-result").textContent = "";
  $$('[data-generation-step]').forEach((step) => step.classList.remove("active", "done"));
  const button = $("#process-upload");
  button.dataset.complete = "";
  button.dataset.setupAi = "";
  button.textContent = localized("Generate Questions", "开始生成题目");
  button.disabled = !pendingUploadFile;
  $("#close-upload").disabled = false;
  $("#cancel-upload").disabled = false;
  $("#file-input").disabled = false;
  $("#material-extra-images").disabled = false;
  $("#upload-material-type").disabled = false;
  $("#upload-question-count").disabled = false;
  $("#upload-topic").disabled = false;
  $("#upload-subject").disabled = false;
}

function setGenerationProgress(percent, status, stage, result = "") {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  $("#generation-progress").hidden = false;
  $("#generation-status").textContent = status;
  $("#generation-percent").textContent = `${safePercent}%`;
  $("#generation-progress-bar").style.width = `${safePercent}%`;
  const stages = ["read", "extract", "generate", "save"];
  const currentIndex = stages.indexOf(stage);
  $$('[data-generation-step]').forEach((step) => {
    const stepIndex = stages.indexOf(step.dataset.generationStep);
    step.classList.toggle("done", currentIndex >= 0 && (stepIndex < currentIndex || (safePercent === 100 && stepIndex === currentIndex)));
    step.classList.toggle("active", safePercent < 100 && step.dataset.generationStep === stage);
  });
  if (result) $("#generation-result").textContent = result;
}

function loadExternalScript(url, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (loadedScripts.has(url)) return loadedScripts.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error(`${globalName} was not loaded`));
    script.onerror = () => reject(new Error(`Unable to load ${globalName}`));
    document.head.appendChild(script);
  });
  loadedScripts.set(url, promise);
  return promise;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image"));
    image.src = dataUrl;
  });
}

async function compressImageData(dataUrl, maxWidth = 1200, quality = 0.68) {
  const image = await loadImageElement(dataUrl);
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth || image.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl || "").split(",");
  if (!header || !encoded) throw new Error("Invalid image data");
  const mimeType = header.match(/data:([^;]+)/i)?.[1] || "image/jpeg";
  const bytes = atob(encoded);
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: mimeType });
}

function visualMimeType(dataUrl) {
  return String(dataUrl || "").match(/^data:([^;]+);/i)?.[1] || "image/jpeg";
}

async function recognizeImageText(source, startPercent = 22, span = 34) {
  setGenerationProgress(startPercent, localized("Loading image recognition…", "正在载入图片文字辨识……"), "extract");
  const Tesseract = await loadExternalScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", "Tesseract");
  const result = await Tesseract.recognize(source, "eng+chi_sim", {
    logger(message) {
      if (message.status === "recognizing text") {
        const percent = startPercent + (Number(message.progress) || 0) * span;
        setGenerationProgress(percent, localized(`Recognizing text… ${Math.round((message.progress || 0) * 100)}%`, `正在辨识文字……${Math.round((message.progress || 0) * 100)}%`), "extract");
      }
    }
  });
  return result?.data?.text || "";
}

async function extractPdfText(file) {
  const pdfjsLib = await loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "pdfjsLib");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageLimit = pdf.numPages;
  const chunks = [];
  const visuals = [];
  let visualBytes = 0;
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => item.str).join(" "));
    const viewport = page.getViewport({ scale: Math.min(1.15, 1000 / Math.max(1, page.getViewport({ scale: 1 }).width)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const imageData = canvas.toDataURL("image/jpeg", 0.54);
    visualBytes += imageData.length;
    if (visualBytes <= 16000000) visuals.push({ page: pageNumber, data: imageData, mimeType: "image/jpeg" });
    setGenerationProgress(18 + (pageNumber / pageLimit) * 35, localized(`Reading PDF page ${pageNumber} of ${pageLimit}`, `正在读取 PDF 第 ${pageNumber} / ${pageLimit} 页`), "extract");
  }
  let text = chunks.join("\n").trim();
  if (text.replace(/\s/g, "").length < 100) {
    const ocrChunks = [];
    const ocrLimit = pdf.numPages;
    for (let pageNumber = 1; pageNumber <= ocrLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.45 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      ocrChunks.push(await recognizeImageText(canvas, 22 + ((pageNumber - 1) / ocrLimit) * 30, 30 / ocrLimit));
    }
    text = ocrChunks.join("\n").trim();
  }
  return { text, visuals };
}

function officeMimeType(name) {
  const extension = String(name).split(".").pop()?.toLowerCase();
  return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
}

async function extractOfficeText(file, extension) {
  const JSZip = await loadExternalScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", "JSZip");
  const zip = await JSZip.loadAsync(file);
  const patterns = extension === "docx"
    ? [/^word\/document\.xml$/]
    : extension === "pptx"
      ? [/^ppt\/slides\/slide\d+\.xml$/]
      : [/^xl\/sharedStrings\.xml$/, /^xl\/worksheets\/sheet\d+\.xml$/];
  const names = Object.keys(zip.files).filter((name) => patterns.some((pattern) => pattern.test(name))).sort();
  const visualNames = Object.keys(zip.files).filter((name) => new RegExp(`^(?:word|ppt|xl)/media/[^/]+\\.(?:png|jpe?g|webp)$`, "i").test(name)).slice(0, 12);
  const visuals = [];
  for (let index = 0; index < visualNames.length; index += 1) {
    const name = visualNames[index];
    const data = await zip.files[name].async("base64");
    const dataUrl = `data:${officeMimeType(name)};base64,${data}`;
    visuals.push({ page: index + 1, data: await compressImageData(dataUrl, 1050, 0.58), mimeType: "image/jpeg" });
  }
  const chunks = [];
  for (let index = 0; index < names.length; index += 1) {
    const xml = await zip.files[names[index]].async("string");
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    const textParts = [...documentNode.getElementsByTagName("*")]
      .filter((element) => ["t", "v"].includes(element.localName))
      .map((element) => element.textContent?.trim())
      .filter(Boolean);
    chunks.push(textParts.length ? textParts.join(" ") : documentNode.documentElement?.textContent || "");
    setGenerationProgress(20 + ((index + 1) / Math.max(1, names.length)) * 35, localized("Extracting document content…", "正在抽取文件内容……"), "extract");
  }
  return { text: chunks.join("\n"), visuals };
}

async function extractMaterialText(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  setGenerationProgress(8, localized("Reading the uploaded file…", "正在读取上传文件……"), "read");
  if (extension === "pdf") return extractPdfText(file);
  if (/^(png|jpe?g|webp)$/.test(extension)) {
    const original = await fileToDataUrl(file);
    const visual = await compressImageData(original, 1400, 0.7);
    return { text: await recognizeImageText(file), visuals: [{ page: 1, data: visual, mimeType: visualMimeType(visual) }] };
  }
  if (/^(docx|pptx|xlsx)$/.test(extension)) return extractOfficeText(file, extension);
  const raw = await file.text();
  if (/^(html?|xml)$/.test(extension)) {
    const parsed = new DOMParser().parseFromString(raw, extension === "xml" ? "application/xml" : "text/html");
    return { text: parsed.documentElement?.textContent || raw, visuals: [] };
  }
  setGenerationProgress(52, localized("Text content extracted", "文字内容读取完成"), "extract");
  return { text: raw, visuals: [] };
}

function normalizeMaterialText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function containsChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

const STANDARD_ENGLISH_COMPUTING_TERMS = new Set([
  "artificial intelligence", "machine learning", "cloud computing", "operating system",
  "computer network", "local area network", "wide area network", "star topology",
  "bus topology", "ring topology", "mesh topology", "primary key", "foreign key",
  "binary search", "linear search", "bubble sort", "insertion sort", "selection sort",
  "web browser", "web server", "source code", "open source", "virtual memory",
  "central processing unit", "graphics processing unit", "database management system",
  "input device", "output device", "system software", "application software",
  "random access memory", "read only memory", "solid state drive", "hard disk drive",
  "domain name system", "internet protocol", "media access control",
  "uniform resource locator", "structured query language"
]);

function isAcceptableChineseOption(value) {
  const text = String(value || "").trim();
  if (containsChineseText(text)) return true;
  if (!text) return false;
  const normalized = text.replace(/\s+/g, " ").toLocaleLowerCase();
  const numericOrSymbolic = /^(?=.*\p{N})[\p{N}\p{Zs}.,:%‰+\-−–—×÷*/=<>≤≥()\[\]{}^~°'"]+$/u.test(text);
  const numericWithUnit = /^[+\-−]?(?:\d+(?:\.\d+)?|\.\d+)\s*(?:%|‰|B|Ki?B|Mi?B|Gi?B|Ti?B|bps|Kbps|Mbps|Gbps|Tbps|Hz|KHz|MHz|GHz|ns|ms|s)?$/iu.test(text);
  const codeIdentifierOrAbbreviation = /^[A-Za-z0-9_$][A-Za-z0-9_$+.#/@:\-]*$/u.test(text);
  const codeOrCommand = /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b|[=<>()[\]{};]/iu.test(text);
  const titleCaseTechnicalTerm = text.split(/\s+/).length <= 5
    && text.split(/\s+/).every((word) => /^[A-Z][A-Za-z0-9+.#/_-]*$/u.test(word));
  return numericOrSymbolic
    || numericWithUnit
    || codeIdentifierOrAbbreviation
    || codeOrCommand
    || titleCaseTechnicalTerm
    || STANDARD_ENGLISH_COMPUTING_TERMS.has(normalized);
}

function normalizeGeneratedQuestion(item, index, paperId, topic) {
  const title = String(item?.question || item?.title || "").trim();
  const optionSource = item?.options ?? item?.choices ?? item?.answers;
  const rawOptions = Array.isArray(optionSource)
    ? optionSource
    : typeof optionSource === "string"
      ? optionSource.split(/\n|(?=\b[A-D][.)、:：])|(?=\b(?:I|II|III|IV|V)\s*(?:和|与|及|、))/u)
      : optionSource && typeof optionSource === "object"
        ? Object.values(optionSource)
        : [];
  const options = rawOptions.map((option) => String(option).trim().replace(/^[A-D][.)、:：]\s*/iu, "")).filter(Boolean).slice(0, 6);
  const clozePattern = /_{2,}|填(?:入|写).{0,8}(?:空格|横线)|(?:fill|complete).{0,12}(?:blank|gap)|missing\s+(?:word|term)/iu;
  const explanation = String(item?.explanation || "请对照原始资料中的重点内容理解正确答案。").trim();
  const mistake = String(item?.mistake || "常见错误：没有检查题目中的全部条件就作答。").trim();
  if (!title
    || !explanation
    || !mistake
    || options.length < 2
    || clozePattern.test(title)
    || new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) return null;
  let correct = Number(item.correct);
  if (!Number.isInteger(correct) && typeof item.correct === "string") correct = Math.max(0, "ABCD".indexOf(item.correct.toUpperCase()));
  correct = Math.max(0, Math.min(Number.isInteger(correct) ? correct : 0, options.length - 1));
  const levelMap = { Basic: "基础", Intermediate: "中等", Advanced: "进阶", "基础": "基础", "中等": "中等", "进阶": "进阶" };
  return {
    id: createRecordId("question"),
    type: "mcq",
    paperId,
    topic,
    level: levelMap[item.level] || "中等",
    title,
    titleEn: title,
    code: String(item.code || "").trim(),
    options,
    optionsEn: options,
    correct,
    explanation,
    explanationEn: explanation,
    mistake,
    mistakeEn: mistake
  };
}

function getGeminiApiKey() {
  return localStorage.getItem(GEMINI_KEY)?.trim() || "";
}

function normalizeGeminiModel(value = "") {
  const model = String(value).trim().replace(/^models\//i, "");
  return !model || model === "gemini-2.5-flash" || model === "gemini-3.8-flash" ? DEFAULT_GEMINI_MODEL : model;
}

function getGeminiModel() {
  const storedModel = localStorage.getItem(GEMINI_MODEL_KEY)?.trim() || "";
  const currentModel = normalizeGeminiModel(storedModel);
  if (storedModel && storedModel !== currentModel) {
    localStorage.setItem(GEMINI_MODEL_KEY, currentModel);
    if (getGeminiApiKey()) localStorage.setItem(GEMINI_KEY_STATUS_KEY, "untested");
  }
  return currentModel;
}

function createAISetupError(message) {
  const error = new Error(message || localized(
    "Connect Gemini AI in the teacher portal before generating questions.",
    "请先在老师端连接 Gemini AI，再生成题目。"
  ));
  error.code = "AI_NOT_CONFIGURED";
  return error;
}

function getQuestionGenerationLimits(options = {}) {
  const materialType = options.materialType === "teaching-material" ? "teaching-material" : "past-paper";
  const requestedCount = materialType === "teaching-material"
    ? Math.max(10, Math.min(50, Number(options.questionCount) || 10))
    : Math.max(40, Math.min(100, Number(options.questionCount) || 40));
  return materialType === "teaching-material"
    ? { materialType, requestedCount, minItems: requestedCount, maxItems: requestedCount }
    : { materialType, requestedCount, minItems: 40, maxItems: 100 };
}

function getQuestionGenerationTarget(options = {}) {
  const { materialType, requestedCount } = getQuestionGenerationLimits(options);
  return materialType === "past-paper"
    ? Math.min(100, requestedCount + 8)
    : requestedCount;
}

function buildQuestionResponseSchema(options = {}, { compact = false } = {}) {
  const { maxItems } = getQuestionGenerationLimits(options);
  const generationTarget = getQuestionGenerationTarget(options);
  const arrayLimits = compact ? {} : { minItems: generationTarget, ...(maxItems ? { maxItems } : {}) };
  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        ...arrayLimits,
        items: {
          type: "object",
          required: ["question", "code", "options", "correct", "level", "explanation", "mistake"],
          properties: {
            question: { type: "string" },
            code: { type: "string" },
            options: { type: "array", ...(compact ? {} : { minItems: 2, maxItems: 6 }), items: { type: "string" } },
            correct: { type: "integer", ...(compact ? {} : { minimum: 0, maximum: 5 }) },
            level: { type: "string", enum: ["Basic", "Intermediate", "Advanced"] },
            explanation: { type: "string" },
            mistake: { type: "string" }
          }
        }
      }
    },
    required: ["questions"]
  };
}

function buildQuestionGenerationPrompt(text, fileName, topic, options = {}) {
  const { materialType, requestedCount } = getQuestionGenerationLimits(options);
  const generationTarget = getQuestionGenerationTarget(options);
  const generationTask = materialType === "past-paper"
    ? `This is a past-year examination paper. Generate AT LEAST ${generationTarget} complete questions so that at least ${requestedCount} remain after validation. Identify EVERY top-level question AND EVERY separately numbered sub-question or part (such as 1(a), 1(b), 1(c), Section A items, table/diagram items) visible in the supplied document. Return one output item for each source question or sub-question, in exactly the original order. Never return only the first few top-level questions. If there are fewer than ${requestedCount} top-level numbers, expand all visible sub-parts into separate items until at least ${generationTarget}; do not invent facts outside the document. Preserve the original meaning and choices when they exist; if an item is not already multiple-choice, convert it into one logically equivalent single-best-answer question without losing the tested concept.`
    : `This is a handout or teaching resource. Create exactly ${requestedCount} distinct single-best-answer multiple-choice questions that cover the material broadly and proportionally.`;
  return `You are an experienced Malaysian Independent Chinese Secondary School computer science teacher and UEC examination setter. Read and understand the supplied learning material before writing any question.

${generationTask}

Strict quality rules:
1. Every correct answer must be directly supported by the supplied material. Do not invent facts, definitions, numbers, program output, or technical requirements.
2. Each question must be logically complete and answerable without seeing this instruction. Use a clear scenario, program fragment, table, network situation, database situation, or concept comparison when the material supports it.
3. Provide the same number of options as the source question when it is clear (normally four, but two to six are allowed). There must be one and only one correct answer. Preserve combination choices and Roman-numeral choices exactly, including I, II, III, IV, V, ①, ② and connectors such as “I 和 II”；do not skip or simplify these options. Distractors must reflect realistic student misconceptions, not absurd claims or generic statements.
4. Never create cloze, missing-word, fill-in-the-blank, underscore, or simple sentence-copy questions.
5. Avoid repeatedly asking “according to the material”. Test understanding, application, output tracing, comparison, or reasoning instead.
6. The explanation must state why the correct option is correct. The common mistake must identify a realistic misunderstanding.
7. ALL user-visible natural-language content must be in Simplified Chinese, even when the source is English or Malay. This includes every question, every answer option, every explanation, and every common mistake. Do not write complete English sentences. English is allowed only inside source code, identifiers, commands, protocol abbreviations, or unavoidable standard computing terms such as CPU, SQL, HTML and Python. Numeric or symbolic answer options such as 0, 16, 3.14, 1010, -1 and 50% are valid as written; do not translate them or add unnecessary Chinese words merely to satisfy the language rule.
8. For a past paper, solve each source question carefully and set the correct answer from the source answer key when present; otherwise determine it by sound computer-science reasoning. A question containing a picture, table, combination option, or Roman-numeral option is still a complete question and must be returned.
9. Inspect supplied page images to recognize every source question, including questions containing charts, tables, diagrams, screenshots, network layouts, or circuits. Do not attach or return any image with a generated question. When possible, include the essential visual information in Chinese text; the teacher will add any required question image manually during review.
  10. Return only a JSON object with a "questions" array using this exact schema:
{"questions":[{"question":"...","code":"optional code or empty string","options":["选项文字 1","选项文字 2"],"correct":0,"level":"Basic|Intermediate|Advanced","explanation":"...","mistake":"..."}]}
The correct value is a zero-based integer from 0 to one less than the number of options (maximum 5).

Main category: ${MAIN_CATEGORY_EN[topic] || topic}
Subject: ${SUBJECT_EN[options.subject] || options.subject || "Senior Information Technology"}
Source file: ${fileName}

LEARNING MATERIAL:
${text.slice(0, 500000)}

VISUAL PAGE INDEX:
${(options.visuals || []).map((visual) => `第 ${visual.page} 页：可供辨识的页面图像`).join("\n") || "没有可附加的页面图像。"}`;
}

async function parseAIQuestionResponse(raw, paperId, topic, options = {}) {
  if (typeof raw !== "string") throw new Error("Question generation response was empty");
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const objectStart = raw.indexOf("{");
    const objectEnd = raw.lastIndexOf("}");
    const arrayStart = raw.indexOf("[");
    const arrayEnd = raw.lastIndexOf("]");
    if (objectStart >= 0 && objectEnd > objectStart) parsed = JSON.parse(raw.slice(objectStart, objectEnd + 1));
    else if (arrayStart >= 0 && arrayEnd > arrayStart) parsed = JSON.parse(raw.slice(arrayStart, arrayEnd + 1));
    else throw new Error("Question generation response did not contain JSON");
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(items)) throw new Error("Question generation response did not contain a questions array");
  const questions = items.map((item, index) => normalizeGeneratedQuestion(item, index, paperId, topic)).filter(Boolean);
  const { materialType, requestedCount, maxItems } = getQuestionGenerationLimits(options);
  if (!options.allowShortGeneration && materialType === "teaching-material" && questions.length !== requestedCount) {
    throw new Error(localized(
      `Gemini returned ${questions.length} valid Chinese questions instead of the requested ${requestedCount}. Please try again.`,
      `Gemini 返回了 ${questions.length} 道有效中文题目，没有达到所选的 ${requestedCount} 题，请重新尝试。`
    ));
  }
  if (!options.allowShortGeneration && materialType === "past-paper" && questions.length < requestedCount) {
    throw new Error(localized(
      `Gemini returned ${questions.length} questions, but a past-year paper requires at least ${requestedCount}. Please try again.`,
      `Gemini 只返回了 ${questions.length} 道题，历届试卷至少需要 ${requestedCount} 道，请重新尝试。`
    ));
  }
  return maxItems ? questions.slice(0, maxItems) : questions;
}

function isTransientGeminiError(status, message = "") {
  return status >= 500
    || status === 408
    || status === 429
    || /high demand|temporar|overload|unavailable|try again|deadline|timeout/i.test(message);
}

function isGeminiModelError(status, message = "") {
  return (status === 400 || status === 404)
    && /model|not found|not supported|not available|unknown model|invalid.*model/i.test(message);
}

function isGeminiRequestArgumentError(status, message = "") {
  return status === 400 && /invalid argument|invalid request|invalid parameter|invalid schema/i.test(message);
}

function waitForGeminiRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    }, { once: true });
  });
}

async function fetchWithGeminiAttemptTimeout(endpoint, options, parentSignal, timeoutMs = 90000) {
  const attemptController = new AbortController();
  let attemptTimedOut = false;
  const abortFromParent = () => attemptController.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    attemptTimedOut = true;
    attemptController.abort(new DOMException("Gemini attempt timed out", "TimeoutError"));
  }, timeoutMs);
  try {
    return await fetch(endpoint, { ...options, signal: attemptController.signal });
  } catch (error) {
    if (parentSignal?.aborted) {
      const abortError = new Error("Question generation timed out");
      abortError.name = "AbortError";
      throw abortError;
    }
    if (attemptTimedOut) {
      const timeoutError = new Error("Gemini model attempt timed out");
      timeoutError.name = "GeminiAttemptTimeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function getGeminiAttemptModels(preferredModel) {
  const preferred = normalizeGeminiModel(preferredModel);
  const fallbacks = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ].filter((model) => model !== preferred);
  return [preferred, preferred, ...fallbacks];
}

function imagePartFromVisual(visual) {
  const [, encoded] = String(visual?.data || "").split(",");
  return encoded ? { type: "image", data: encoded, mime_type: visual.mimeType || visualMimeType(visual.data) } : null;
}

async function requestQuestionsFromProxy(endpoint, prompt, paperId, topic, options, signal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await cloudAuthorizationHeaders()) },
    signal,
    body: JSON.stringify({ message: prompt, messages: [{ role: "user", content: prompt }], visuals: (options.visuals || []).map((visual) => { const image = imagePartFromVisual(visual); return image ? { ...image, page: visual.page } : null; }).filter(Boolean), mode: "study", task: "question-generation", language: "zh", materialType: options.materialType, questionCount: options.questionCount })
  });
  if (!response.ok) throw new Error(`Question generation endpoint returned ${response.status}`);
  const data = await response.json();
  const raw = Array.isArray(data.questions) ? JSON.stringify(data.questions) : data.reply;
  return parseAIQuestionResponse(raw, paperId, topic, options);
}

async function requestQuestionsFromGemini(apiKey, model, prompt, paperId, topic, options, signal) {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const preferredModel = normalizeGeminiModel(model);
  const attemptModels = getGeminiAttemptModels(preferredModel);
  for (let attempt = 0; attempt < attemptModels.length; attempt += 1) {
    const attemptedModel = attemptModels[attempt];
    const compactRequest = attempt > 0;
    const requestVisuals = compactRequest
      ? (options.visuals || []).reduce((items, visual) => {
        const currentBytes = items.reduce((sum, item) => sum + String(item?.data || "").length, 0);
        if (items.length >= 12 || currentBytes + String(visual?.data || "").length > 9000000) return items;
        items.push(visual);
        return items;
      }, [])
      : (options.visuals || []);
    let response;
    let data = {};
    try {
      response = await fetchWithGeminiAttemptTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: attemptedModel,
          input: [
            { type: "text", text: prompt },
            ...requestVisuals.flatMap((visual) => {
              const image = imagePartFromVisual(visual);
              return image ? [{ type: "text", text: `这是供辨识的第 ${visual.page} 页图像。` }, image] : [];
            })
          ],
          system_instruction: "Produce accurate, source-grounded UEC computer science assessment questions. Inspect supplied page images to recognize all source questions, including visual questions, but never attach or return images; the teacher adds question images manually. All natural-language question content must be Simplified Chinese. Return JSON only.",
          store: false,
          generation_config: {
            temperature: 0.2,
            max_output_tokens: compactRequest
              ? options.materialType === "past-paper" ? 32768 : Math.min(20000, Math.max(8000, options.questionCount * 600))
              : options.materialType === "past-paper" ? 49152 : Math.min(24000, Math.max(10000, options.questionCount * 700)),
            ...(compactRequest ? {} : { thinking_level: "medium" })
          },
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: buildQuestionResponseSchema(options, { compact: compactRequest })
          }
        })
      }, signal, options.materialType === "past-paper" ? 150000 : 90000);
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.name === "GeminiAttemptTimeout" && attemptModels[attempt + 1] === attemptedModel) {
        attempt += 1;
      }
      if (attempt < attemptModels.length - 1) {
        const nextModel = attemptModels[attempt + 1];
        setGenerationProgress(
          Math.min(88, 78 + (attempt * 3)),
          localized(`Gemini is taking longer than expected. Retrying with ${nextModel}…`, `Gemini 回应时间较长，正在使用 ${nextModel} 重试……`),
          "generate"
        );
        await waitForGeminiRetry(700 * (2 ** attempt), signal);
        continue;
      }
      const transientError = new Error(localized("Gemini is temporarily busy. Automatic retries and backup models were unsuccessful. Please try again shortly.", "Gemini 目前繁忙，自动重试及备用模型仍未成功，请稍后再试。"));
      transientError.code = "GEMINI_TEMPORARILY_UNAVAILABLE";
      transientError.source = "gemini-transient";
      throw transientError;
    }

    if (!response.ok) {
      const providerMessage = data?.error?.message || "";
      const modelRejected = isGeminiModelError(response.status, providerMessage);
      const requestRejected = isGeminiRequestArgumentError(response.status, providerMessage);
      if (isTransientGeminiError(response.status, providerMessage) || modelRejected || requestRejected) {
        if (attempt < attemptModels.length - 1) {
          const nextModel = attemptModels[attempt + 1];
          setGenerationProgress(
            Math.min(88, 78 + (attempt * 3)),
            requestRejected && !modelRejected
              ? localized(`Gemini rejected the request format. Retrying in compatibility mode…`, `Gemini 拒绝了请求格式，正在使用兼容模式重试……`)
              : modelRejected
              ? localized(`The model was rejected. Retrying with ${nextModel}…`, `当前模型被拒绝，正在使用 ${nextModel} 重试……`)
              : localized(`Gemini is busy. Retrying with ${nextModel}…`, `Gemini 目前繁忙，正在使用 ${nextModel} 重试……`),
            "generate"
          );
          await waitForGeminiRetry(700 * (2 ** attempt), signal);
          continue;
        }
        if (isTransientGeminiError(response.status, providerMessage)) {
          const transientError = new Error(localized("Gemini is temporarily busy. Automatic retries and backup models were unsuccessful. Please try again shortly.", "Gemini 目前繁忙，自动重试及备用模型仍未成功，请稍后再试。"));
          transientError.code = "GEMINI_TEMPORARILY_UNAVAILABLE";
          transientError.source = "gemini-transient";
          transientError.httpStatus = response.status;
          throw transientError;
        }
      }
      const messages = {
        400: localized("Gemini rejected the request. Check the API key, model name, and request details.", "Gemini 拒绝了请求，请检查 API Key、模型名称及请求内容。"),
        401: localized("The Gemini API key is invalid. Please replace it with a new key.", "Gemini API Key 无效，请更换新的 Key。"),
        403: localized("This Gemini API key is not authorized. Please replace it with another key.", "这个 Gemini API Key 没有使用权限，请更换其他 Key。")
      };
      const providerDetail = String(providerMessage || "").replace(/AIza[\w-]+/gi, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 360);
      const baseMessage = messages[response.status] || `Gemini returned ${response.status}`;
      const error = new Error(providerDetail ? `${baseMessage} (${providerDetail})` : baseMessage);
      error.code = "GEMINI_DIRECT_FAILED";
      error.source = "gemini-direct";
      error.httpStatus = response.status;
      localStorage.setItem(GEMINI_KEY_STATUS_KEY, "error");
      updateAIConfigStatus();
      throw error;
    }

    localStorage.setItem(GEMINI_KEY_STATUS_KEY, "valid");
    updateAIConfigStatus();
    const interaction = data?.interaction || data;
    if (interaction?.status && interaction.status !== "completed") {
      const error = new Error(localized("Gemini did not complete the request. Please try again.", "Gemini 未能完成请求，请重新尝试。"));
      error.code = "GEMINI_RESPONSE_INCOMPLETE";
      error.source = "gemini-response";
      throw error;
    }
    const raw = interaction?.steps
      ?.filter((step) => step?.type === "model_output")
      .flatMap((step) => Array.isArray(step.content) ? step.content : [])
      .filter((content) => content?.type === "text")
      .map((content) => content.text || "")
      .join("\n")
      .trim() || interaction?.output_text?.trim();
    try {
      const questions = await parseAIQuestionResponse(raw, paperId, topic, options);
      if (attemptedModel !== preferredModel) {
        showToast(localized(
          `${preferredModel} is busy. Questions were generated with backup model ${attemptedModel}.`,
          `${preferredModel} 目前繁忙，已自动使用备用模型 ${attemptedModel} 生成题目。`
        ));
      }
      return questions;
    } catch (error) {
      error.code = "GEMINI_RESPONSE_INVALID";
      error.source = "gemini-response";
      throw error;
    }
  }
  throw new Error("Gemini generation failed");
}

function buildQuestionSupplementPrompt(text, fileName, topic, options, existingQuestions, missingCount) {
  const titles = existingQuestions.map((question, index) => `${index + 1}. ${question.title}`).join("\n");
  const supplementOptions = { ...options, materialType: "teaching-material", questionCount: Math.max(10, Math.min(50, missingCount + 5)) };
  return `${buildQuestionGenerationPrompt(text, fileName, topic, supplementOptions)}

IMPORTANT SUPPLEMENT TASK:
The first pass produced ${existingQuestions.length} valid questions, but at least ${missingCount} more are required. Create NEW questions only. Do not repeat, paraphrase, or copy any question in this existing list:
${titles.slice(0, 12000)}
Return enough additional valid questions so the combined result reaches the required count. Keep every question a single-best-answer multiple-choice question in Simplified Chinese.`;
}

async function requestAIQuestions(text, fileName, paperId, topic, options) {
  const configuredEndpoint = globalThis.PERSONAL_AI_CONFIG?.generationEndpoint?.trim()
    || globalThis.PERSONAL_AI_CONFIG?.aiEndpoint?.trim();
  const apiKey = getGeminiApiKey();
  const controller = new AbortController();
  let generationTimedOut = false;
  const timeout = setTimeout(() => {
    generationTimedOut = true;
    controller.abort(new DOMException("Question generation timed out", "TimeoutError"));
  }, 300000);
  try {
    const requestGenerated = async (generationPrompt, generationOptions) => {
      if (configuredEndpoint) return requestQuestionsFromProxy(configuredEndpoint, generationPrompt, paperId, topic, generationOptions, controller.signal);
      if (apiKey) {
        try {
          return await requestQuestionsFromGemini(apiKey, getGeminiModel(), generationPrompt, paperId, topic, generationOptions, controller.signal);
        } catch (error) {
          if (error?.name === "AbortError" || error?.source) throw error;
          error.code = "GEMINI_DIRECT_FAILED";
          error.source = "gemini-direct";
          localStorage.setItem(GEMINI_KEY_STATUS_KEY, "error");
          updateAIConfigStatus();
          throw error;
        }
      }
      if (location.hostname.endsWith("github.io") || globalThis.Capacitor?.isNativePlatform?.()) throw createAISetupError();
      try {
        return await requestQuestionsFromProxy("./api/chat", generationPrompt, paperId, topic, generationOptions, controller.signal);
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw createAISetupError();
      }
    };

    const firstOptions = options.materialType === "past-paper"
      ? { ...options, allowShortGeneration: true }
      : options;
    let questions = await requestGenerated(buildQuestionGenerationPrompt(text, fileName, topic, firstOptions), firstOptions);
    const { materialType, requestedCount, maxItems } = getQuestionGenerationLimits(options);
    if (materialType === "past-paper" && questions.length < requestedCount) {
      const missingCount = requestedCount - questions.length;
      setGenerationProgress(86, localized(
        `Gemini returned ${questions.length} usable questions. Creating ${missingCount} additional questions…`,
        `Gemini 返回了 ${questions.length} 道有效题目，正在补充 ${missingCount} 道题目……`
      ), "generate");
      const supplementOptions = {
        ...options,
        materialType: "teaching-material",
        questionCount: Math.max(10, Math.min(50, missingCount + 5)),
        allowShortGeneration: true
      };
      const supplementPrompt = buildQuestionSupplementPrompt(text, fileName, topic, options, questions, missingCount);
      const supplement = await requestGenerated(supplementPrompt, supplementOptions);
      const existingTitles = new Set(questions.map((question) => String(question.title || "").trim().toLocaleLowerCase()));
      questions = questions.concat(supplement.filter((question) => {
        const key = String(question.title || "").trim().toLocaleLowerCase();
        if (!key || existingTitles.has(key)) return false;
        existingTitles.add(key);
        return true;
      }));
      if (questions.length < requestedCount) {
        throw new Error(localized(
          `Gemini returned ${questions.length} usable questions, but a past-year paper requires at least ${requestedCount}. Please try again.`,
          `Gemini 返回了 ${questions.length} 道有效题目，但历届试卷至少需要 ${requestedCount} 道，请重新尝试。`
        ));
      }
    }
    return maxItems ? questions.slice(0, maxItems) : questions;
  } catch (error) {
    if (generationTimedOut || error?.name === "AbortError" || error?.name === "TimeoutError") {
      const timeoutError = new Error(localized(
        "AI generation took longer than five minutes. No material was saved. Please try again; the system will retry and switch backup models automatically.",
        "AI 生成超过五分钟，系统没有储存未完成的资料。请重新尝试，系统会自动重试并切换备用模型。"
      ));
      timeoutError.code = "GEMINI_TIMEOUT";
      timeoutError.source = "gemini-transient";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateQuestionsFromFile(file, paperId, topic, options) {
  const extracted = await extractMaterialText(file);
  const extractedText = normalizeMaterialText(extracted?.text ?? extracted);
  const extractedVisuals = extracted?.visuals || [];
  const extraVisuals = Array.isArray(options.extraVisuals) ? options.extraVisuals : [];
  const nextPage = extractedVisuals.reduce((highest, visual) => Math.max(highest, Number(visual.page) || 0), 0) + 1;
  options.visuals = [
    ...extractedVisuals,
    ...extraVisuals.map((visual, index) => ({ ...visual, page: nextPage + index }))
  ].slice(0, 24);
  if (extractedText.replace(/\s/g, "").length < 30 && !options.visuals.length) {
    throw new Error(localized("Not enough readable text was found. Try a clearer scan or a text-based document.", "无法辨识足够文字，请尝试更清晰的扫描或含文字的文件。"));
  }
  setGenerationProgress(66, localized("Organizing key concepts…", "正在整理重点内容……"), "generate");
  setGenerationProgress(76, options.materialType === "past-paper"
    ? localized("Gemini is extracting at least 40 questions and sub-questions from the paper…", "Gemini 正在从试卷整理至少 40 道题目和分题……")
    : localized(`Gemini is understanding the material and writing ${options.questionCount} questions…`, `Gemini 正在理解资料并编写 ${options.questionCount} 道题目……`), "generate");
  const aiQuestions = await requestAIQuestions(extractedText, file.name, paperId, topic, options);
  return { questions: aiQuestions, mode: "ai" };
}

function populateQuestionMaterialOptions() {
  const materialSelect = $("#question-material");
  materialSelect.innerHTML = `<option value="">${localized("Standalone Question", "独立出题")}</option>${papers.map((paper) => (
    `<option value="${escapeHTML(paper.id)}">${escapeHTML(currentLanguage === "en" ? paper.titleEn : paper.title)}</option>`
  )).join("")}`;
}

function toggleQuestionTypeFields() {
  const isFill = $("#question-type").value === "fill";
  $("#mcq-fields").classList.toggle("hidden", isFill);
  $("#fill-fields").classList.toggle("hidden", !isFill);
  for (let index = 0; index < 4; index += 1) $("#manual-option-" + index).required = !isFill;
  $("#manual-correct-answer").required = isFill;
}

function renderManualQuestionImagePreview() {
  const preview = $("#manual-question-image-preview");
  const remove = $("#remove-manual-question-image");
  if (!preview || !remove) return;
  const source = pendingQuestionImageData || "";
  preview.innerHTML = source ? `<img src="${escapeHTML(source)}" alt="${escapeHTML(pendingQuestionImageAlt || "题目图表")}">` : "";
  remove.hidden = !source && !pendingQuestionImagePath;
}

function refreshCloudQuestionImagePreview(questionId, imagePath) {
  if (!Cloud?.enabled || !imagePath || !Cloud.getQuestionImageUrl) return;
  void Cloud.getQuestionImageUrl(imagePath).then((signedUrl) => {
    if (!signedUrl || $("#editing-question-id")?.value !== questionId || !$("#question-dialog")?.open) return;
    pendingQuestionImageData = signedUrl;
    pendingQuestionImagePath = imagePath;
    renderManualQuestionImagePreview();
  }).catch((error) => {
    console.warn("Unable to load question image preview", error);
  });
}

function updateAIConfigStatus() {
  const configuredEndpoint = globalThis.PERSONAL_AI_CONFIG?.generationEndpoint?.trim()
    || globalThis.PERSONAL_AI_CONFIG?.aiEndpoint?.trim();
  getGeminiModel();
  const hasBrowserKey = Boolean(getGeminiApiKey());
  const browserKeyStatus = localStorage.getItem(GEMINI_KEY_STATUS_KEY) || "untested";
  const hasSameOriginBackend = !location.hostname.endsWith("github.io")
    && !globalThis.Capacitor?.isNativePlatform?.()
    && !["127.0.0.1", "localhost"].includes(location.hostname);
  const configured = Boolean(configuredEndpoint || hasSameOriginBackend || (hasBrowserKey && browserKeyStatus === "valid"));
  const needsUpdate = hasBrowserKey && browserKeyStatus === "error" && !configuredEndpoint;
  const readyToTest = hasBrowserKey && browserKeyStatus === "untested" && !configuredEndpoint;
  $("#ai-config-status").textContent = needsUpdate
    ? localized("Needs Update", "需要更新")
    : readyToTest
      ? localized("Ready to Test", "等待验证")
      : configured
        ? localized("Connected", "已连接")
        : localized("Not Connected", "尚未连接");
  $("#open-ai-settings").classList.toggle("configured", configured);
  $("#open-ai-settings").classList.toggle("attention", needsUpdate);
}

function openAISettings({ resumeUpload = false, replaceKey = false } = {}) {
  resumeUploadAfterAISetup = resumeUpload;
  const keyInput = $("#gemini-api-key");
  keyInput.value = getGeminiApiKey();
  $("#gemini-model").value = getGeminiModel();
  $("#ai-settings-error").textContent = replaceKey
    ? localized("Enter a new API key below. Saving will immediately replace the previous key on this device.", "请在下方输入新的 API Key；储存后会立即取代这台装置里的旧 Key。")
    : "";
  $("#ai-settings-dialog").showModal();
  keyInput.focus();
  if (replaceKey && keyInput.value) keyInput.select();
}

function openAISettingsFromUpload() {
  if ($("#upload-dialog").open) $("#upload-dialog").close();
  openAISettings({ resumeUpload: true, replaceKey: true });
}

function openQuestionDialog({ questionId = "", paperId = "" } = {}) {
  const form = $("#question-form");
  form.reset();
  $("#editing-question-id").value = "";
  $("#question-return-paper-id").value = paperId;
  $("#question-form-error").textContent = "";
  pendingQuestionImageData = "";
  pendingQuestionImagePath = "";
  pendingQuestionImageAlt = "题目图表";
  $("#manual-question-image").value = "";
  populateQuestionMaterialOptions();
  $("#question-material").disabled = false;
  const question = questionId ? questionBank.find((item) => item.id === questionId) : null;
  if (question) {
    $("#editing-question-id").value = question.id;
    $("#question-return-paper-id").value = paperId || question.paperId;
    $("#question-dialog-title").textContent = localized("Edit Interactive Question", "编辑互动题目");
    $("#question-dialog-intro").textContent = localized(
      "Changes immediately update this question in student practice.",
      "修改后会立即更新学生练习中的这道题目。"
    );
    $("#save-question-button").textContent = localized("Save Question Changes", "储存题目修改");
    $("#question-type").value = question.type === "fill" ? "fill" : "mcq";
    $("#question-material").value = question.paperId || "";
    $("#question-material").disabled = true;
    $("#manual-question-topic").value = question.topic || "综合试卷";
    $("#manual-question-level").value = question.level || "中等";
    $("#manual-question-title").value = question.title || "";
    $("#manual-question-code").value = question.code || "";
    for (let index = 0; index < 4; index += 1) $("#manual-option-" + index).value = question.options?.[index] || "";
    $("#manual-correct-option").value = String(question.correct || 0);
    $("#manual-correct-answer").value = question.correctAnswer || "";
    $("#manual-accepted-answers").value = (question.acceptedAnswers || [])
      .filter((answer) => normalizeAnswer(answer) !== normalizeAnswer(question.correctAnswer))
      .join(", ");
    $("#manual-explanation").value = question.explanation || "";
    $("#manual-mistake").value = question.mistake || "";
    pendingQuestionImageData = question.imageData || question.imageUrl || "";
    pendingQuestionImagePath = question.imagePath || "";
    pendingQuestionImageAlt = question.imageAlt || "题目图表";
  } else {
    $("#question-dialog-title").textContent = localized("Create an Interactive Question", "建立互动题目");
    $("#question-dialog-intro").textContent = localized(
      "Create an MCQ or fill-in question. It will be added to student practice immediately.",
      "自行建立选择题或填充题。储存后会立即加入学生练习。"
    );
    $("#save-question-button").textContent = localized("Save and Publish", "储存并发布");
    if (paperId) $("#question-material").value = paperId;
  }
  renderManualQuestionImagePreview();
  if (question?.imagePath && !pendingQuestionImageData) refreshCloudQuestionImagePreview(question.id, question.imagePath);
  toggleQuestionTypeFields();
  $("#question-dialog").showModal();
  $("#manual-question-title").focus();
}

function addQuestionToAssignment(question, paper) {
  let targetAssignments = paper
    ? assignments.filter((item) => item.paperId === paper.id)
    : assignments.filter((item) => item.paperId === "manual");
  if (!targetAssignments.length) {
    const assignment = {
      id: createRecordId("assignment"),
      paperId: paper?.id || "manual",
      questionIds: [],
      icon: paper ? "✦" : "✎",
      title: paper?.title || "老师自行出题",
      titleEn: paper?.titleEn || "Teacher-Created Questions",
      done: false
    };
    assignments.unshift(assignment);
    targetAssignments = [assignment];
  }
  targetAssignments.forEach((assignment) => {
    if (!Array.isArray(assignment.questionIds)) assignment.questionIds = [];
    if (!assignment.questionIds.includes(question.id)) assignment.questionIds.push(question.id);
    assignment.questionCount = assignment.questionIds.length;
    assignment.detail = `${assignment.questionCount} 题 · 可开始`;
    assignment.detailEn = `${assignment.questionCount} questions · Ready`;
    assignment.action = "开始练习";
    assignment.actionEn = "Start Practice";
    assignment.done = false;
  });
}

async function saveManualQuestion(event) {
  event.preventDefault();
  const editingId = $("#editing-question-id").value;
  const existingQuestion = editingId ? questionBank.find((item) => item.id === editingId) : null;
  const type = $("#question-type").value === "fill" ? "fill" : "mcq";
  const title = $("#manual-question-title").value.trim();
  const explanation = $("#manual-explanation").value.trim();
  const mistake = $("#manual-mistake").value.trim() || "常见错误：还没有检查题目中的所有条件就作答。";
  const materialId = existingQuestion?.paperId || $("#question-material").value;
  const paper = papers.find((item) => item.id === materialId);
  const options = type === "mcq" ? Array.from({ length: 4 }, (_, index) => $("#manual-option-" + index).value.trim()) : [];
  const correctAnswer = type === "fill" ? $("#manual-correct-answer").value.trim() : "";
  const error = $("#question-form-error");

  if (!title || !explanation) {
    error.textContent = localized("Enter the question and answer explanation.", "请输入题目与答案解析。");
    return;
  }
  if (!containsChineseText(title) || !containsChineseText(explanation) || (mistake && !containsChineseText(mistake))) {
    error.textContent = localized(
      "Write the question, explanation, and common mistake in Chinese. Code and standard computing terms may remain in English.",
      "题目、答案解析与常见错误必须使用中文；程序代码及标准电脑术语可以保留英文。"
    );
    return;
  }
  if (type === "mcq" && (options.some((option) => !option) || new Set(options.map((option) => option.toLocaleLowerCase())).size !== 4)) {
    error.textContent = localized("Enter four different answer options.", "请输入四个不同的答案选项。");
    return;
  }
  if (type === "mcq" && options.some((option) => !isAcceptableChineseOption(option))) {
    error.textContent = localized(
      "Write natural-language answer options in Chinese. Numbers, formulas, code, abbreviations, and standard computing terms may remain unchanged.",
      "答案选项的叙述必须使用中文；数字、算式、程序代码、缩写及标准电脑术语可以保留原样。"
    );
    return;
  }
  if (type === "fill" && !correctAnswer) {
    error.textContent = localized("Enter the correct answer for the fill-in question.", "请输入填充题的正确答案。");
    return;
  }

  const acceptedAnswers = type === "fill"
    ? [...new Set([correctAnswer, ...$("#manual-accepted-answers").value.split(/[,，;；\n]/u)].map((answer) => answer.trim()).filter(Boolean))]
    : [];
  const question = {
    id: existingQuestion?.id || createRecordId("question"),
    type,
    paperId: existingQuestion?.paperId || paper?.id || "manual",
    topic: $("#manual-question-topic").value,
    level: $("#manual-question-level").value,
    title,
    titleEn: title,
    code: $("#manual-question-code").value.trim(),
    options,
    optionsEn: options,
    correct: type === "mcq" ? Number($("#manual-correct-option").value) : 0,
    correctAnswer,
    acceptedAnswers,
    explanation,
    explanationEn: explanation,
    mistake,
    mistakeEn: mistake,
    imageData: pendingQuestionImageData,
    imagePath: pendingQuestionImagePath,
    imageUrl: /^https?:\/\//i.test(pendingQuestionImageData) ? pendingQuestionImageData : (existingQuestion?.imageUrl || ""),
    imageAlt: pendingQuestionImageAlt || "题目图表",
    createdAt: existingQuestion?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const saveButton = $("#save-question-button");
  saveButton.disabled = true;
  try {
    if (Cloud?.enabled && cloudProfile && pendingQuestionImageData && !pendingQuestionImageData.startsWith("http")) {
      if (existingQuestion?.imagePath) await Cloud.deleteQuestionImage(existingQuestion.imagePath);
      question.imagePath = await Cloud.uploadQuestionImage(question.id, dataUrlToBlob(pendingQuestionImageData));
      question.imageData = "";
      question.imageUrl = await Cloud.getQuestionImageUrl(question.imagePath);
    } else if (Cloud?.enabled && cloudProfile && !pendingQuestionImageData && existingQuestion?.imagePath) {
      await Cloud.deleteQuestionImage(existingQuestion.imagePath);
      question.imagePath = "";
      question.imageUrl = "";
    }
    if (existingQuestion) questionBank[questionBank.indexOf(existingQuestion)] = { ...existingQuestion, ...question };
    else questionBank.push(question);
  } catch (uploadError) {
    console.error("Unable to save question image", uploadError);
    error.textContent = localized("The question image could not be uploaded. Try again.", "题目照片无法上传，请重新尝试。");
    saveButton.disabled = false;
    return;
  }
  if (paper) paper.count = questionBank.filter((item) => item.paperId === paper.id).length;
  if (!existingQuestion) addQuestionToAssignment(question, paper);
  saveQuestions();
  savePapers();
  saveAssignments();
  renderPapers(activePaperFilter);
  renderAssignments();
  if (activeWorkspaceView) renderWorkspaceView(activeWorkspaceView);
  $("#question-dialog").close();
  const returnPaperId = $("#question-return-paper-id").value;
  showToast(localized(
    existingQuestion ? "Question changes saved." : `${type === "fill" ? "Fill-in" : "Multiple-choice"} question published to student practice.`,
    existingQuestion ? "题目修改已储存。" : `${type === "fill" ? "填充" : "选择"}题已发布到学生练习。`
  ));
  if (existingQuestion && returnPaperId) openQuestionManager(returnPaperId);
  saveButton.disabled = false;
}

function getOrderedMaterialQuestions(paperId) {
  return questionBank
    .filter((question) => question.paperId === paperId)
    .sort((left, right) => {
      const leftPosition = Number.isFinite(Number(left.position)) ? Number(left.position) : questionBank.indexOf(left);
      const rightPosition = Number.isFinite(Number(right.position)) ? Number(right.position) : questionBank.indexOf(right);
      return leftPosition - rightPosition || questionBank.indexOf(left) - questionBank.indexOf(right);
    });
}

async function persistQuestionOrder(paperId, orderedIds) {
  const materialQuestions = getOrderedMaterialQuestions(paperId);
  const byId = new Map(materialQuestions.map((question) => [question.id, question]));
  const seen = new Set();
  const uniqueOrderedIds = orderedIds.filter((id) => {
    if (!byId.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const ordered = uniqueOrderedIds.map((id) => byId.get(id));
  const remaining = materialQuestions.filter((question) => !seen.has(question.id));
  const finalOrder = [...ordered, ...remaining];
  let cursor = 0;
  questionBank = questionBank.map((question) => question.paperId === paperId ? finalOrder[cursor++] : question);

  const orderMap = new Map(finalOrder.map((question, index) => [question.id, index]));
  assignments.forEach((assignment) => {
    if (assignment.paperId !== paperId || !Array.isArray(assignment.questionIds)) return;
    assignment.questionIds = [...assignment.questionIds].sort((left, right) => (orderMap.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(right) ?? Number.MAX_SAFE_INTEGER));
    assignment.questionCount = assignment.questionIds.length;
    assignment.detail = `${assignment.questionCount} 题 · 可开始`;
    assignment.detailEn = `${assignment.questionCount} questions · Ready`;
  });

  saveQuestions();
  saveAssignments();
  renderPapers(activePaperFilter);
  renderAssignments();
  openQuestionManager(paperId);
  try {
    await flushCloudSync({ throwOnError: true });
    showToast(localized("Question order saved.", "题目顺序已储存。"));
  } catch (error) {
    console.error("Unable to save question order", error);
    showToast(localized("Order saved on this device, but cloud sync failed.", "顺序已储存在本机，但云端同步失败。"));
  }
}

async function moveQuestionInMaterial(questionId, direction, paperId) {
  const ids = getOrderedMaterialQuestions(paperId).map((question) => question.id);
  const index = ids.indexOf(questionId);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
  [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
  await persistQuestionOrder(paperId, ids);
}

async function deleteQuestionFromMaterial(questionId, paperId) {
  const question = questionBank.find((item) => item.id === questionId && item.paperId === paperId);
  if (!question) return;
  const confirmed = window.confirm(localized(
    `Delete question “${question.title}”? This cannot be undone.`,
    `确定删除题目“${question.title}”吗？此操作无法复原。`
  ));
  if (!confirmed) return;

  try {
    await flushCloudSync({ throwOnError: true });
    if (Cloud?.enabled && question.imagePath) await Cloud.deleteQuestionImage(question.imagePath);
    if (Cloud?.enabled) await Cloud.deleteQuestion(question.id);
    questionBank = questionBank.filter((item) => item.id !== questionId);
    assignments.forEach((assignment) => {
      if (!Array.isArray(assignment.questionIds)) return;
      assignment.questionIds = assignment.questionIds.filter((id) => id !== questionId);
      assignment.questionCount = assignment.questionIds.length;
      assignment.detail = `${assignment.questionCount} 题 · 可开始`;
      assignment.detailEn = `${assignment.questionCount} questions · Ready`;
    });
    const paper = papers.find((item) => item.id === paperId);
    if (paper) paper.count = questionBank.filter((item) => item.paperId === paperId).length;
    saveQuestions();
    saveAssignments();
    savePapers();
    renderPapers(activePaperFilter);
    renderAssignments();
    openQuestionManager(paperId);
    await flushCloudSync({ throwOnError: true });
    showToast(localized("Question deleted.", "题目已删除。"));
  } catch (error) {
    console.error("Unable to delete question", error);
    showToast(localized("Question could not be deleted. Please try again.", "题目无法删除，请重新尝试。"));
  }
}

function openQuestionManager(paperId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) return;
  const materialQuestions = getOrderedMaterialQuestions(paper.id);
  $("#question-list-paper-id").value = paper.id;
  $("#question-list-title").textContent = `${currentLanguage === "en" ? paper.titleEn : paper.title} · ${localized("Edit Questions", "编辑题目")}`;
  $("#material-question-list").innerHTML = materialQuestions.length ? materialQuestions.map((question, index) => {
    const answer = question.type === "fill"
      ? question.correctAnswer
      : `${String.fromCharCode(65 + question.correct)}. ${question.options?.[question.correct] || ""}`;
    const imageSource = question.imageUrl || question.imageData || "";
    const imagePreview = imageSource
      ? `<img class="material-question-thumb" src="${escapeHTML(imageSource)}" alt="${escapeHTML(question.imageAlt || "题目图表")}">`
      : question.imagePath
        ? `<span class="material-question-image-pending">${localized("Image uploaded", "照片已上传")}</span>`
        : "";
    return `<article class="material-question-item" draggable="true" data-question-id="${escapeHTML(question.id)}">
      <span class="material-question-number">${index + 1}</span>
      <div class="material-question-copy">${imagePreview}<strong>${escapeHTML(question.title)}</strong><small>${localized(question.type === "fill" ? "Fill in the Answer" : "Multiple Choice", question.type === "fill" ? "填充题" : "选择题")} · ${localized("Answer", "答案")}: ${escapeHTML(answer)}</small></div>
      <div class="material-question-actions">
        <button type="button" class="icon-button" data-move-question="up" aria-label="${localized("Move up", "上移")}" title="${localized("Move up", "上移")}">↑</button>
        <button type="button" class="icon-button" data-move-question="down" aria-label="${localized("Move down", "下移")}" title="${localized("Move down", "下移")}">↓</button>
        <button type="button" data-edit-question="${escapeHTML(question.id)}">${localized("Edit Question", "编辑题目")}</button>
        <button type="button" class="danger-outline-button" data-delete-question="${escapeHTML(question.id)}">${localized("Delete", "删除")}</button>
      </div>
    </article>`;
  }).join("") : `<div class="data-empty"><strong>${localized("No questions in this material", "这份资料还没有题目")}</strong></div>`;
  $("#question-list-dialog").showModal();
}

function getAssignableClasses() {
  const activeCloudClasses = cloudClasses.filter((item) => item.active !== false && item.name);
  if (activeCloudClasses.length) return activeCloudClasses.map((item) => ({ id: item.id || "", name: item.name }));
  return getClasses().map((name) => ({ id: "", name }));
}

function getAssignmentTargetKey(assignment) {
  if (assignment?.classId) return `id:${assignment.classId}`;
  if (assignment?.className) return `name:${assignment.className}`;
  return "all";
}

function renderPaperClassOptions(paperId) {
  const paperAssignments = assignments.filter((assignment) => assignment.paperId === paperId);
  const selectedTargets = new Set(paperAssignments.map(getAssignmentTargetKey));
  const classes = getAssignableClasses();
  const allSelected = selectedTargets.has("all");
  $("#edit-paper-classes").innerHTML = `
    <label class="material-class-option"><input type="checkbox" data-paper-class-all ${allSelected ? "checked" : ""}><span>${localized("All Classes", "所有班级")}</span></label>
    ${classes.map((item) => {
      const key = item.id ? `id:${item.id}` : `name:${item.name}`;
      return `<label class="material-class-option"><input type="checkbox" data-paper-class data-class-id="${escapeHTML(item.id)}" data-class-name="${escapeHTML(item.name)}" ${!allSelected && selectedTargets.has(key) ? "checked" : ""}><span>${escapeHTML(item.name)}</span></label>`;
    }).join("")}`;
  $("#edit-paper-classes-error").textContent = "";
}

function getSelectedPaperClassTargets() {
  if ($("[data-paper-class-all]", $("#edit-paper-classes"))?.checked) return [{ classId: "", className: "" }];
  return $$("[data-paper-class]:checked", $("#edit-paper-classes")).map((input) => ({
    classId: input.dataset.classId || "",
    className: input.dataset.className || ""
  }));
}

async function updatePaperClassAssignments(paper, targets) {
  const currentAssignments = assignments.filter((assignment) => assignment.paperId === paper.id);
  const currentByTarget = new Map(currentAssignments.map((assignment) => [getAssignmentTargetKey(assignment), assignment]));
  const questionIds = getOrderedMaterialQuestions(paper.id).map((question) => question.id);
  const nextAssignments = targets.map((target) => {
    const targetKey = target.classId ? `id:${target.classId}` : target.className ? `name:${target.className}` : "all";
    const existing = currentByTarget.get(targetKey);
    return {
      ...(existing || {}),
      id: existing?.id || createRecordId("assignment"),
      paperId: paper.id,
      classId: target.classId,
      className: target.className,
      questionIds: [...questionIds],
      questionCount: questionIds.length,
      icon: existing?.icon || "✦",
      title: paper.title,
      titleEn: paper.titleEn,
      detail: `${questionIds.length} 题 · 可开始`,
      detailEn: `${questionIds.length} questions · Ready`,
      action: existing?.done ? "查看解析" : "开始练习",
      actionEn: existing?.done ? "Review Answers" : "Start Practice",
      done: existing?.done || false,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
  });
  const retainedIds = new Set(nextAssignments.map((assignment) => assignment.id));
  const removedIds = currentAssignments.filter((assignment) => !retainedIds.has(assignment.id)).map((assignment) => assignment.id);
  if (Cloud?.enabled && cloudProfile && removedIds.length) await Cloud.deleteAssignments(removedIds);
  assignments = [...nextAssignments, ...assignments.filter((assignment) => assignment.paperId !== paper.id)];
}

function getRemovedPaperAssignments(paper, targets) {
  const retainedTargets = new Set(targets.map((target) => target.classId ? `id:${target.classId}` : target.className ? `name:${target.className}` : "all"));
  return assignments.filter((assignment) => assignment.paperId === paper.id && !retainedTargets.has(getAssignmentTargetKey(assignment)));
}

function openPaperEditor(paperId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) {
    showToast(localized("Material not found", "找不到这份学习资料"));
    return;
  }
  $("#edit-paper-error").textContent = "";
  $("#edit-paper-id").value = paper.id;
  $("#edit-paper-title").value = paper.title;
  $("#edit-paper-year").value = paper.year;
  $("#edit-paper-topic").value = getPaperMainCategory(paper);
  $("#edit-paper-subject").value = getPaperSubject(paper);
  $("#edit-paper-status").value = paper.status;
  renderPaperClassOptions(paper.id);
  $("#edit-paper-file").textContent = paper.fileName
    ? `${paper.fileName} · ${(paper.fileSize / 1024 / 1024).toFixed(1)} MB`
    : localized("No source filename recorded", "没有记录来源文件名");
  const materialQuestionCount = questionBank.filter((question) => question.paperId === paper.id).length;
  $("#manage-paper-questions").textContent = localized(
    `View and Edit Questions (${materialQuestionCount})`,
    `查看与编辑题目（${materialQuestionCount}）`
  );
  $("#manage-paper-questions").disabled = materialQuestionCount === 0;
  $("#edit-paper-dialog").showModal();
}

async function deletePaper(paperId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) return;
  const confirmed = confirmDestructiveAction(
    localized(
      `Delete “${paper.title}” and all of its questions and assignments?`,
      `要删除“${paper.title}”及其所有题目与作业吗？`
    ),
    localized(
      `Final confirmation: all assignment progress for “${paper.title}” will also be permanently deleted. Continue?`,
      `最终确认：与“${paper.title}”相关的所有作业进度也会永久删除。确定继续吗？`
    )
  );
  if (!confirmed) return;
  if (Cloud?.enabled) {
    try {
      await flushCloudSync();
      await Promise.all(questionBank.filter((question) => question.paperId === paperId && question.imagePath).map((question) => Cloud.deleteQuestionImage(question.imagePath)));
      await Cloud.deleteMaterial(paper);
    } catch (error) {
      console.error("Unable to delete cloud material", error);
      showToast(localized("The material could not be deleted from the cloud.", "无法从云端删除学习资料。"));
      return;
    }
  }
  const deletedQuestionCount = questionBank.filter((question) => question.paperId === paperId).length;
  papers = papers.filter((item) => item.id !== paperId);
  questionBank = questionBank.filter((question) => question.paperId !== paperId);
  assignments = assignments.filter((assignment) => assignment.paperId !== paperId);
  questions = questions.filter((question) => question.paperId !== paperId);
  activeAssignmentIndex = Math.max(0, Math.min(activeAssignmentIndex, assignments.length - 1));
  savePapers();
  saveQuestions();
  saveAssignments();
  renderPapers(activePaperFilter);
  renderAssignments();
  if (activeWorkspaceView) renderWorkspaceView(activeWorkspaceView);
  if ($("#edit-paper-dialog").open) $("#edit-paper-dialog").close();
  showToast(localized(
    `Material deleted with ${deletedQuestionCount} questions.`,
    `学习资料及其 ${deletedQuestionCount} 道题目已删除。`
  ));
}

function closeStudentAccountEditor() {
  $("#student-account-dialog").close();
  $("#student-account-error").textContent = "";
}

function openStudentAccountEditor(studentId) {
  const student = getStudents().find((item) => item.id === studentId);
  if (!student) {
    showToast(localized("Student account not found.", "找不到这个学生账号。"));
    return;
  }
  renderClassOptions();
  const classSelect = $("#edit-student-class");
  if (![...classSelect.options].some((option) => option.value === student.className)) {
    classSelect.add(new Option(student.className, student.className));
  }
  const yearSelect = $("#edit-student-year");
  if (![...yearSelect.options].some((option) => option.value === student.year)) {
    yearSelect.add(new Option(student.year, student.year));
  }
  $("#student-account-form").reset();
  $("#edit-student-id").value = student.id;
  $("#edit-student-name").value = student.name;
  $("#edit-student-class").value = student.className;
  $("#edit-student-year").value = student.year;
  $("#edit-student-status").value = student.status;
  $("#edit-student-password").value = "";
  $("#student-account-error").textContent = "";
  $("#student-account-dialog").showModal();
}

async function saveStudentAccount(event) {
  event.preventDefault();
  const students = getStudents();
  const student = students.find((item) => item.id === $("#edit-student-id").value);
  const error = $("#student-account-error");
  const name = $("#edit-student-name").value.trim();
  const className = $("#edit-student-class").value;
  const year = $("#edit-student-year").value;
  const newPassword = $("#edit-student-password").value;
  if (!student) {
    error.textContent = localized("Student account not found.", "找不到这个学生账号。");
    return;
  }
  if (!/^[\u3400-\u9fff·]{2,12}$/u.test(name)) {
    error.textContent = localized("Enter a Chinese name containing 2 to 12 characters.", "请输入 2 至 12 个字的中文姓名。");
    return;
  }
  if (!className || !year) {
    error.textContent = localized("Select the student's class and enrollment year.", "请选择学生班级与入学年份。");
    return;
  }
  if (newPassword && newPassword.length < 6) {
    error.textContent = localized("The new password must contain at least 6 characters.", "新密码至少需要 6 个字符。");
    return;
  }
  if (students.some((item) => item.id !== student.id && item.name === name && item.className === className && item.year === year)) {
    error.textContent = localized("Another student account already uses these details.", "已有其他学生账号使用相同资料。");
    return;
  }
  student.name = name;
  student.className = className;
  student.classId = cloudClasses.find((item) => item.name === className)?.id || student.classId || "";
  student.year = year;
  student.status = $("#edit-student-status").value === "disabled" ? "disabled" : "active";
  student.updatedAt = new Date().toISOString();
  if (Cloud?.enabled) {
    try {
      await flushCloudSync();
      await Cloud.updateStudent(student, newPassword);
    } catch (cloudError) {
      console.error("Unable to update cloud student", cloudError);
      error.textContent = cloudError?.message || localized("The student account could not be updated in the cloud.", "学生账号无法在云端更新。 ");
      return;
    }
  } else if (newPassword) student.password = newPassword;
  saveStudents(students);
  closeStudentAccountEditor();
  showToast(localized("Student account changes saved.", "学生账号修改已储存。"));
}

async function deleteStudentAccount() {
  const studentId = $("#edit-student-id").value;
  const students = getStudents();
  const student = students.find((item) => item.id === studentId);
  if (!student) return;
  const confirmed = confirmDestructiveAction(
    localized(
      `Delete the student account for ${student.name}?`,
      `要删除学生“${student.name}”的账号吗？`
    ),
    localized(
      `Final confirmation: ${student.name}'s account and linked learning records cannot be recovered. Continue?`,
      `最终确认：学生“${student.name}”的账号及关联学习记录将无法复原。确定继续吗？`
    )
  );
  if (!confirmed) return;
  if (Cloud?.enabled) {
    try {
      await flushCloudSync();
      await Cloud.deleteStudent(studentId);
    } catch (error) {
      console.error("Unable to delete cloud student", error);
      showToast(localized("The student account could not be deleted from the cloud.", "无法从云端删除学生账号。"));
      return;
    }
  }
  saveStudents(students.filter((item) => item.id !== studentId));
  closeStudentAccountEditor();
  showToast(localized("Student account deleted.", "学生账号已删除。"));
}

function readQuizProgressStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(QUIZ_PROGRESS_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function readQuizReviewStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(QUIZ_REVIEW_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function getQuizStudentKey() {
  if (activeStudent?.id) return String(activeStudent.id);
  if (!activeStudent) return "";
  return [activeStudent.name, activeStudent.className, activeStudent.year]
    .map((value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase())
    .join("|");
}

function getQuizProgressStorageKey(assignmentId, studentKey = getQuizStudentKey()) {
  return studentKey && assignmentId ? `${studentKey}:${assignmentId}` : "";
}

function getStoredQuizProgress(assignmentId) {
  const key = getQuizProgressStorageKey(assignmentId);
  const progress = key ? readQuizProgressStore()[key] : null;
  if (progress && typeof progress === "object") return progress;
  const cloudSubmission = getLatestInProgressSubmission(assignmentId);
  if (!cloudSubmission) return null;
  const assignment = assignments.find((item) => item.id === assignmentId);
  return {
    assignmentId,
    questionIds: Array.isArray(assignment?.questionIds) ? assignment.questionIds : [],
    currentQuestionId: "",
    answersByQuestionId: cloudSubmission.answersByQuestionId || {},
    draftAnswersByQuestionId: {},
    startedAt: cloudSubmission.startedAt || cloudSubmission.createdAt || "",
    updatedAt: cloudSubmission.updatedAt || cloudSubmission.createdAt || ""
  };
}

function getLatestInProgressSubmission(assignmentId) {
  const studentId = String(cloudProfile?.id || activeStudent?.id || "");
  return cloudSubmissions
    .filter((submission) => submission.assignmentId === assignmentId && submission.status === "in_progress")
    .filter((submission) => !studentId || !submission.studentId || String(submission.studentId) === studentId)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0] || null;
}

function getLatestCompletedSubmission(assignmentId) {
  const studentId = String(cloudProfile?.id || activeStudent?.id || "");
  return cloudSubmissions
    .filter((submission) => submission.assignmentId === assignmentId && submission.status === "completed")
    .filter((submission) => !studentId || !submission.studentId || String(submission.studentId) === studentId)
    .sort((left, right) => new Date(right.submittedAt || right.updatedAt || right.createdAt || 0) - new Date(left.submittedAt || left.updatedAt || left.createdAt || 0))[0] || null;
}

function getCompletedQuizReview(assignment) {
  const key = getQuizProgressStorageKey(assignment?.id);
  const stored = key ? readQuizReviewStore()[key] : null;
  const cloudSubmission = getLatestCompletedSubmission(assignment?.id);
  if (cloudSubmission && Object.keys(cloudSubmission.answersByQuestionId || {}).length) {
    return {
      assignmentId: assignment.id,
      answersByQuestionId: cloudSubmission.answersByQuestionId,
      startedAt: cloudSubmission.startedAt || cloudSubmission.createdAt || "",
      completedAt: cloudSubmission.submittedAt || cloudSubmission.updatedAt || cloudSubmission.createdAt || "",
      correctCount: Number(cloudSubmission.score) || 0,
      total: Number(cloudSubmission.totalQuestions) || 0
    };
  }
  return stored && typeof stored === "object" ? stored : null;
}

function saveCompletedQuizReview(assignment, completedAt) {
  const key = getQuizProgressStorageKey(assignment?.id, activeQuizStudentKey || getQuizStudentKey());
  if (!key) return;
  const answersByQuestionId = {};
  questions.forEach((question, index) => {
    if (hasAnswer(answers[index])) answersByQuestionId[question.id] = answers[index];
  });
  const store = readQuizReviewStore();
  store[key] = {
    assignmentId: assignment.id,
    questionIds: questions.map((question) => question.id),
    answersByQuestionId,
    startedAt: quizStartedAt || completedAt,
    completedAt,
    correctCount: answers.filter((answer, index) => isQuestionAnswerCorrect(questions[index], answer)).length,
    total: questions.length
  };
  localStorage.setItem(QUIZ_REVIEW_KEY, JSON.stringify(store));
}

function getLatestQuizProgressCandidate() {
  return assignments
    .map((assignment, index) => ({ assignment, index, progress: assignment.done ? null : getStoredQuizProgress(assignment.id) }))
    .filter((item) => item.progress)
    .sort((left, right) => new Date(right.progress.updatedAt || 0) - new Date(left.progress.updatedAt || 0))[0] || null;
}

function getQuizProgressStats(assignment, progress) {
  const savedQuestionIds = Array.isArray(progress?.questionIds) ? progress.questionIds : [];
  const assignmentQuestionIds = Array.isArray(assignment?.questionIds) ? assignment.questionIds : [];
  const candidateIds = savedQuestionIds.length ? savedQuestionIds : assignmentQuestionIds;
  const availableIds = new Set(questionBank.map((question) => question.id));
  const questionIds = candidateIds.filter((id) => availableIds.has(id));
  const validIds = new Set(questionIds.length ? questionIds : candidateIds);
  const answeredCount = Object.entries(progress?.answersByQuestionId || {})
    .filter(([questionId, answer]) => (!validIds.size || validIds.has(questionId)) && hasAnswer(answer)).length;
  const total = questionIds.length || candidateIds.length || Number(assignment?.questionCount) || answeredCount;
  const currentIndex = questionIds.indexOf(progress?.currentQuestionId);
  return {
    answeredCount,
    total,
    currentQuestion: total ? Math.min(total, currentIndex >= 0 ? currentIndex + 1 : answeredCount + 1) : 0,
    percentage: total ? Math.min(100, Math.round((answeredCount / total) * 100)) : 0
  };
}

function renderLastUnfinishedAssignment() {
  const card = $("#last-unfinished-assignment");
  if (!card) return;
  const candidate = role === "student" ? getLatestQuizProgressCandidate() : null;
  if (!candidate) {
    card.hidden = true;
    card.innerHTML = "";
    return;
  }

  const { assignment, index, progress } = candidate;
  const stats = getQuizProgressStats(assignment, progress);
  const title = currentLanguage === "en" ? assignment.titleEn || assignment.title : assignment.title;
  card.hidden = false;
  card.innerHTML = `
    <div class="unfinished-assignment-icon" aria-hidden="true">${escapeHTML(assignment.icon || "↗")}</div>
    <div class="unfinished-assignment-copy">
      <div class="unfinished-assignment-meta">
        <span>${localized("LAST UNFINISHED ASSIGNMENT", "上次未完成的作业")}</span>
        <time>${localized("Last activity", "上次作答")} · ${escapeHTML(formatNoteDate(progress.updatedAt))}</time>
      </div>
      <h2>${escapeHTML(title)}</h2>
      <p>${localized(
        `${stats.answeredCount} of ${stats.total} questions answered · Continue from question ${stats.currentQuestion}`,
        `已作答 ${stats.answeredCount} / ${stats.total} 题 · 从第 ${stats.currentQuestion} 题继续`
      )}</p>
      <div class="unfinished-assignment-progress" aria-label="${localized("Assignment progress", "作业进度")}">
        <i style="width:${stats.percentage}%"></i>
      </div>
    </div>
    <div class="unfinished-assignment-action">
      <strong>${stats.percentage}%</strong>
      <button type="button" data-resume-assignment="${index}">${localized("Continue", "继续作答")} <span>→</span></button>
    </div>`;
}

function saveCurrentQuizProgress() {
  if (role !== "student" || isQuizReviewMode || !questions.length) return;
  const assignment = assignments[activeAssignmentIndex];
  if (!assignment || assignment.done) return;
  const key = getQuizProgressStorageKey(assignment.id, activeQuizStudentKey || getQuizStudentKey());
  if (!key) return;

  const answersByQuestionId = {};
  const draftAnswersByQuestionId = {};
  questions.forEach((question, index) => {
    if (hasAnswer(answers[index])) answersByQuestionId[question.id] = answers[index];
    else if (hasAnswer(draftAnswers[index])) draftAnswersByQuestionId[question.id] = draftAnswers[index];
  });
  const store = readQuizProgressStore();
  store[key] = {
    assignmentId: assignment.id,
    questionIds: questions.map((question) => question.id),
    currentQuestionId: questions[currentQuestion]?.id || questions[0]?.id || "",
    answersByQuestionId,
    draftAnswersByQuestionId,
    startedAt: quizStartedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(QUIZ_PROGRESS_KEY, JSON.stringify(store));
  scheduleCloudQuizProgressSync();
}

function scheduleCloudQuizProgressSync() {
  if (role !== "student" || !Cloud?.enabled || !cloudProfile || cloudProfile.role !== "student") return;
  const assignment = assignments[activeAssignmentIndex];
  if (!assignment || assignment.done || !questions.length) return;
  clearTimeout(quizCloudProgressTimer);
  quizCloudProgressTimer = setTimeout(() => {
    quizCloudProgressTimer = null;
    const currentAnswers = questions.map((_, index) => hasAnswer(answers[index]) ? answers[index] : null);
    syncCloud(() => Cloud.saveQuizProgress(assignment, questions, currentAnswers, { startedAt: quizStartedAt }), "student progress");
  }, 700);
}

function syncSubmittedQuizProgress() {
  if (role !== "student" || !Cloud?.enabled || !cloudProfile || cloudProfile.role !== "student") return;
  const assignment = assignments[activeAssignmentIndex];
  if (!assignment || assignment.done || !questions.length) return;
  clearTimeout(quizCloudProgressTimer);
  quizCloudProgressTimer = null;
  const submittedAnswers = questions.map((_, index) => hasAnswer(answers[index]) ? answers[index] : null);
  syncCloud(() => Cloud.saveQuizProgress(assignment, questions, submittedAnswers, { startedAt: quizStartedAt }), "student progress");
}

function clearQuizProgress(assignmentId) {
  const key = getQuizProgressStorageKey(assignmentId);
  if (!key) return;
  const store = readQuizProgressStore();
  if (!Object.prototype.hasOwnProperty.call(store, key)) return;
  delete store[key];
  localStorage.setItem(QUIZ_PROGRESS_KEY, JSON.stringify(store));
}

function getContinueAssignmentIndex() {
  return getLatestQuizProgressCandidate()?.index ?? 0;
}

function restoreQuizProgress(assignment) {
  const progress = getStoredQuizProgress(assignment.id);
  answers = Array(questions.length).fill(null);
  draftAnswers = Array(questions.length).fill(null);
  if (!progress) {
    currentQuestion = 0;
    quizStartedAt = new Date().toISOString();
    return false;
  }
  quizStartedAt = progress.startedAt || progress.updatedAt || new Date().toISOString();
  const savedAnswers = progress.answersByQuestionId || {};
  const savedDrafts = progress.draftAnswersByQuestionId || {};
  questions.forEach((question, index) => {
    if (Object.prototype.hasOwnProperty.call(savedAnswers, question.id)) answers[index] = savedAnswers[question.id];
    else if (Object.prototype.hasOwnProperty.call(savedDrafts, question.id)) draftAnswers[index] = savedDrafts[question.id];
  });
  const savedIndex = questions.findIndex((question) => question.id === progress.currentQuestionId);
  const firstUnanswered = answers.findIndex((answer) => !hasAnswer(answer));
  currentQuestion = savedIndex >= 0 && !hasAnswer(answers[savedIndex])
    ? savedIndex
    : firstUnanswered >= 0 ? firstUnanswered : Math.max(0, questions.length - 1);
  return true;
}

function restoreCompletedQuizReview(assignment) {
  const review = getCompletedQuizReview(assignment);
  if (!review) return false;
  const savedAnswers = review.answersByQuestionId || {};
  answers = questions.map((question) => Object.prototype.hasOwnProperty.call(savedAnswers, question.id) ? savedAnswers[question.id] : null);
  if (!answers.some(hasAnswer)) return false;
  draftAnswers = [...answers];
  currentQuestion = 0;
  quizStartedAt = review.startedAt || review.completedAt || new Date().toISOString();
  activeQuizResultData = {
    correctCount: Number.isFinite(Number(review.correctCount))
      ? Number(review.correctCount)
      : answers.filter((answer, index) => isQuestionAnswerCorrect(questions[index], answer)).length,
    total: Number(review.total) || questions.length,
    startedAt: review.startedAt || review.completedAt || quizStartedAt,
    completedAt: review.completedAt || new Date().toISOString()
  };
  return true;
}

function startQuiz(index = null, { silent = false, review = false } = {}) {
  if (!assignments.length) {
    showToast(localized("No interactive questions are available yet.", "目前还没有可作答的互动题目。"));
    return;
  }
  const requestedIndex = Number.isInteger(index) ? index : getContinueAssignmentIndex();
  activeAssignmentIndex = Math.max(0, Math.min(requestedIndex, assignments.length - 1));
  activeQuizStudentKey = getQuizStudentKey();
  const assignment = assignments[activeAssignmentIndex];
  const questionIds = Array.isArray(assignment.questionIds) ? assignment.questionIds : null;
  const questionById = new Map(questionBank.map((question) => [question.id, question]));
  questions = questionIds
    ? questionIds.map((questionId) => questionById.get(questionId)).filter(Boolean)
    : getOrderedMaterialQuestions(assignment.paperId);
  if (!questions.length) {
    showToast(localized("This assignment does not contain generated questions yet.", "这份练习还没有生成题目。"));
    return;
  }
  isQuizReviewMode = Boolean(review || assignment.done);
  activeQuizResultData = null;
  if (isQuizReviewMode && !restoreCompletedQuizReview(assignment)) {
    isQuizReviewMode = false;
    showToast(localized("The saved answer review is not available yet.", "目前找不到已储存的答题解析。"));
    return;
  }
  if (!isQuizReviewMode) restoreQuizProgress(assignment);
  const restored = !isQuizReviewMode && Boolean(getStoredQuizProgress(assignment.id));
  $("#quiz-layout").hidden = false;
  $("#quiz-result").hidden = true;
  renderQuestion();
  showView("quiz");
  if (restored && !silent) showToast(localized("Saved progress restored.", "已恢复上次作答进度。"));
}

function hasAnswer(answer) {
  return answer !== null && answer !== undefined && String(answer).trim() !== "";
}

function normalizeAnswer(answer) {
  return String(answer ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function formatRomanStatements(value) {
  const source = String(value ?? "");
  let formatted = source.replace(/([^\n])\s+(?=(?:IV|III|II|I|V)[.)、:：．])/g, "$1\n");
  const plainStatementMarkers = source.match(/(?:^|\s)(?:IV|III|II|I)\s+[\u3400-\u9fff]/g) || [];
  if (plainStatementMarkers.length >= 3) {
    formatted = formatted.replace(/([^\n])\s+(?=(?:IV|III|II|I)\s+[\u3400-\u9fff])/g, "$1\n");
  }
  return formatted;
}

function formatQuizDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatQuizCompletionTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(currentLanguage === "en" ? "en-MY" : "zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function renderQuizResult({ correctCount, total, startedAt, completedAt }) {
  activeQuizResultData = { correctCount, total, startedAt, completedAt };
  isQuizReviewMode = false;
  const duration = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt || completedAt).getTime());
  const accuracy = total ? Math.round((correctCount / total) * 100) : 0;
  $("#quiz-layout").hidden = true;
  $("#quiz-result").hidden = false;
  $("#quiz-result-title").textContent = localized("Practice complete!", "练习完成！");
  $("#quiz-result-summary").textContent = localized(`You answered ${correctCount} of ${total} questions correctly.`, `你答对了 ${correctCount} / ${total} 题。`);
  $("#quiz-result-correct").textContent = `${correctCount} / ${total}`;
  $("#quiz-result-accuracy").textContent = `${accuracy}%`;
  $("#quiz-result-duration").textContent = formatQuizDuration(duration);
  $("#quiz-result-completed-at").textContent = formatQuizCompletionTime(completedAt);
  $("#quiz-result-review").hidden = !answers.some(hasAnswer);
  $("#exit-quiz").textContent = localized("← Back to student home", "← 返回学生首页");
  refreshLanguage();
}

function resetQuizResultView() {
  const layout = $("#quiz-layout");
  const result = $("#quiz-result");
  if (layout) layout.hidden = false;
  if (result) result.hidden = true;
}

function isQuestionAnswerCorrect(question, answer) {
  if (question.type === "fill") {
    const acceptedAnswers = Array.isArray(question.acceptedAnswers) && question.acceptedAnswers.length
      ? question.acceptedAnswers
      : [question.correctAnswer];
    const normalizedAnswer = normalizeAnswer(answer);
    return Boolean(normalizedAnswer) && acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === normalizedAnswer);
  }
  return Number(answer) === Number(question.correct);
}

function getQuestionAnswerLabel(question, answer) {
  if (!hasAnswer(answer)) return localized("No answer", "未作答");
  if (question.type === "fill") return String(answer);
  const options = currentLanguage === "en" ? question.optionsEn || question.options : question.options;
  const index = Number(answer);
  return `${String.fromCharCode(65 + index)}. ${options?.[index] || ""}`.trim();
}

function showQuestionFeedback(question, answer) {
  const isCorrect = isQuestionAnswerCorrect(question, answer);
  if (question.type === "fill") {
    const fillInput = $("#fill-answer-input");
    fillInput.disabled = true;
    fillInput.classList.add(isCorrect ? "correct" : "wrong");
  } else {
    $$(".option").forEach((option, index) => {
      option.disabled = true;
      option.classList.remove("selected");
      if (index === question.correct) option.classList.add("correct");
      if (index === Number(answer) && index !== question.correct) option.classList.add("wrong");
    });
  }
  const explanation = currentLanguage === "en" ? question.explanationEn : question.explanation;
  const mistakeSource = currentLanguage === "en" ? question.mistakeEn : question.mistake;
  const mistake = String(mistakeSource || "").replace("常见错误：", "");
  const correctAnswer = question.type === "fill" ? question.correctAnswer : question.correct;
  $("#answer-feedback").innerHTML = `
    <h3>${isCorrect ? localized("Correct!", "回答正确！") : localized("Take another look", "再留意一下")}</h3>
    <div class="review-answer-line"><strong>${localized("Your answer:", "你的答案：")}</strong> ${escapeHTML(getQuestionAnswerLabel(question, answer))}</div>
    <div class="review-answer-line"><strong>${localized("Correct answer:", "正确答案：")}</strong> ${escapeHTML(getQuestionAnswerLabel(question, correctAnswer))}</div>
    <div class="review-explanation">${escapeHTML(explanation || localized("No explanation provided.", "老师尚未提供解析。"))}</div>
    <div class="mistake"><strong>${localized("Common mistake:", "易错提醒：")}</strong> ${escapeHTML(mistake || localized("Review the key conditions before answering.", "作答前请再次检查题目的关键条件。"))}</div>`;
  $("#answer-feedback").classList.add("show");
  return isCorrect;
}

function renderQuestion() {
  const question = questions[currentQuestion];
  if (!question) {
    showView("dashboard");
    showToast(localized("No interactive questions are available yet.", "目前还没有可作答的互动题目。"));
    return;
  }
  const topic = {
    "高一": localized("Senior 1", "高一"),
    "高二": localized("Senior 2", "高二"),
    "高三": localized("Senior 3", "高三"),
    "初中": localized("Junior Secondary", "初中"),
    "程序设计": localized("Programming", "程序设计"),
    "数据库": localized("Database", "数据库"),
    "电脑网络": localized("Computer Networks", "电脑网络")
  }[question.topic] || question.topic;
  const level = question.level === "进阶"
    ? localized("Advanced", "进阶")
    : question.level === "中等" ? localized("Intermediate", "中等") : localized("Basic", "基础");
  const isFill = question.type === "fill";
  const options = currentLanguage === "en" ? question.optionsEn : question.options;
  const submitted = hasAnswer(answers[currentQuestion]);
  selectedOption = submitted ? answers[currentQuestion] : draftAnswers[currentQuestion];
  $("#quiz-mode-label").textContent = isQuizReviewMode ? localized("Answer review", "答题解析") : localized("Interactive Practice", "互动练习");
  $("#exit-quiz").textContent = isQuizReviewMode ? localized("← Back to results", "← 返回结算") : localized("← Exit Practice", "← 退出练习");
  $("#current-number").textContent = currentQuestion + 1;
  $("#question-total").textContent = questions.length;
  $("#quiz-progress-bar").style.width = `${((currentQuestion + 1) / questions.length) * 100}%`;
  $("#question-topic").textContent = topic;
  $("#question-level").textContent = level;
  $("#question-type-label").textContent = isFill ? localized("Fill in the Answer", "填充题") : localized("Multiple Choice", "选择题");
  $("#question-title").textContent = formatRomanStatements(currentLanguage === "en" ? question.titleEn : question.title);
  const questionImage = $("#question-image");
  const questionImageFigure = $("#question-image-figure");
  const imageSource = question.imageUrl || question.imageData || "";
  questionImageFigure.hidden = !imageSource;
  if (imageSource) {
    questionImage.src = imageSource;
    questionImage.alt = question.imageAlt || localized("Question diagram", "题目图表");
    $("#question-image-caption").textContent = question.imageAlt || localized("Question diagram", "题目图表");
  } else {
    questionImage.removeAttribute("src");
    questionImage.alt = "";
    $("#question-image-caption").textContent = "";
  }
  $("#code-block code").textContent = question.code;
  $("#code-block").style.display = question.code ? "block" : "none";
  $("#quiz-options").innerHTML = isFill ? "" : options.map((option, index) => `
    <button class="option ${selectedOption === index ? "selected" : ""}" data-option="${index}" ${submitted || isQuizReviewMode ? "disabled" : ""}>
      <span class="letter">${String.fromCharCode(65 + index)}</span><span>${escapeHTML(formatRomanStatements(option))}</span>
    </button>`).join("");
  $("#quiz-options").classList.toggle("hidden", isFill);
  $("#fill-answer").classList.toggle("hidden", !isFill);
  const fillInput = $("#fill-answer-input");
  fillInput.value = isFill && hasAnswer(selectedOption) ? selectedOption : "";
  fillInput.disabled = submitted || isQuizReviewMode;
  fillInput.classList.remove("correct", "wrong");
  $("#answer-feedback").className = "answer-feedback";
  $("#answer-feedback").innerHTML = "";
  $("#submit-answer").classList.toggle("hidden", submitted || isQuizReviewMode);
  $("#submit-answer").disabled = submitted || !hasAnswer(selectedOption);
  $("#next-question").classList.toggle("hidden", !submitted && !isQuizReviewMode);
  $("#previous-question").disabled = !isQuizReviewMode || currentQuestion === 0;
  if (submitted || isQuizReviewMode) {
    showQuestionFeedback(question, answers[currentQuestion]);
    $("#next-question").textContent = isQuizReviewMode && currentQuestion === questions.length - 1
      ? localized("Back to Results", "返回结算")
      : currentQuestion === questions.length - 1
        ? localized("Finish Practice ✓", "完成练习 ✓")
        : localized("Next Question →", "下一题 →");
  }
  renderQuestionMap();
  refreshLanguage();
}

function renderQuestionMap() {
  $("#question-dots").innerHTML = questions.map((question, index) => {
    const answered = hasAnswer(answers[index]);
    const resultClass = isQuizReviewMode && answered ? (isQuestionAnswerCorrect(question, answers[index]) ? "correct" : "wrong") : "";
    return `<button type="button" data-jump="${index}" class="${index === currentQuestion ? "current" : ""} ${answered ? "answered" : ""} ${resultClass}" ${isQuizReviewMode ? "" : "disabled"}>${index + 1}</button>`;
  }).join("");
  $("#quiz-map-legend").innerHTML = isQuizReviewMode
    ? `<span><i class="correct"></i>${localized("Correct", "答对")}</span><span><i class="wrong"></i>${localized("Incorrect", "答错")}</span>`
    : `<span><i class="answered"></i>${localized("Answered", "已作答")}</span><span><i></i>${localized("Unanswered", "未作答")}</span>`;
}

function submitAnswer() {
  if (isQuizReviewMode || hasAnswer(answers[currentQuestion]) || !hasAnswer(selectedOption)) return;
  const question = questions[currentQuestion];
  if (!question) return;
  answers[currentQuestion] = selectedOption;
  draftAnswers[currentQuestion] = selectedOption;
  saveCurrentQuizProgress();
  syncSubmittedQuizProgress();
  showQuestionFeedback(question, selectedOption);
  $("#submit-answer").classList.add("hidden");
  $("#next-question").classList.remove("hidden");
  $("#previous-question").disabled = true;
  $("#next-question").textContent = currentQuestion === questions.length - 1 ? localized("Finish Practice ✓", "完成练习 ✓") : localized("Next Question →", "下一题 →");
  renderQuestionMap();
  refreshLanguage();
}

document.addEventListener("toggle", (event) => {
  const details = event.target.closest?.("details[data-assignment-progress-id]");
  if (!details) return;
  if (details.open) openTeacherAssignmentProgressIds.add(details.dataset.assignmentProgressId);
  else openTeacherAssignmentProgressIds.delete(details.dataset.assignmentProgressId);
}, true);

globalThis.personalAIAppContext = () => ({
  role,
  profile: cloudProfile || activeStudent || null,
  cloudEnabled: Boolean(Cloud?.enabled && cloudProfile),
  assignments: assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    titleEn: assignment.titleEn,
    questionIds: assignment.questionIds || [],
    questionCount: assignment.questionCount || assignment.questionIds?.length || 0,
    classId: assignment.classId || "",
    className: assignment.className || ""
  })),
  questions: questionBank.map((question) => ({
    id: question.id,
    title: question.title,
    options: question.options || [],
    correct: question.correct,
    type: question.type || "mcq",
    correctAnswer: question.correctAnswer || "",
    acceptedAnswers: question.acceptedAnswers || [],
    topic: question.topic || "综合试卷"
  })),
  classes: getClasses()
});

renderPapers();
renderAssignments();
renderStudentNotesPreview();
populateYears();
renderClassOptions();
renderTeacherClasses();
applyLanguage(localStorage.getItem(LANGUAGE_KEY) || "en", { persist: false });
renderStudentNotesPreview();
renderTeacherMetrics();
renderClassPerformance();
$("#performance-class-select")?.addEventListener("change", renderTeacherLiveProgress);
updateStudentProgress();
updateAIConfigStatus();

$$(".language-select").forEach((select) => select.addEventListener("change", (event) => {
  applyLanguage(event.target.value);
  renderPapers(activePaperFilter);
  renderAssignments();
  renderStudentNotesPreview();
  renderTeacherClasses();
  renderTeacherMetrics();
  renderClassPerformance();
  updateAccountUI();
  updateNavigationLabels();
  updateStudentProgress();
  updateAIConfigStatus();
  if ($("#quiz-view").classList.contains("active")) {
    if (!$("#quiz-result").hidden && activeQuizResultData) renderQuizResult(activeQuizResultData);
    else renderQuestion();
  }
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

$("#teacher-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#teacher-email").value.trim().toLowerCase();
  const password = $("#teacher-password").value;
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  if (Cloud?.enabled) {
    submitButton.disabled = true;
    let authenticatedProfile = null;
    showSessionLoading(
      "Signing in to the teacher portal",
      "正在登入老师端",
      "Checking your account and loading cloud learning data…",
      "正在验证账号并载入云端学习资料……"
    );
    try {
      authenticatedProfile = await Cloud.signInTeacher(email, password);
      await activateCloudProfile(authenticatedProfile);
      $("#teacher-login-error").textContent = "";
    } catch (error) {
      console.error("Teacher cloud sign-in failed", error);
      await Cloud.signOut().catch(() => {});
      authenticatedProfile = null;
      cloudProfile = null;
      $("#teacher-login-error").textContent = error?.code === "CLOUD_SCHEMA_REQUIRED"
        ? error.message
      : error?.code === "ROLE_MISMATCH"
        ? localized("This account is not assigned to the teacher portal. Ask the administrator to set role=teacher.", "这个账号尚未分配老师端权限，请确认 profiles.role 是 teacher。")
        : error?.message && !/invalid login credentials/i.test(error.message)
          ? error.message
          : localized("The cloud email or password is incorrect.", "云端账号或密码不正确，请重新检查。");
    }
    if (authenticatedProfile) {
      await hideSessionLoading({ waitForTransition: true });
      enterApp("teacher");
      showToast(localized("Welcome back, Teacher Jude", "欢迎回来，Teacher Jude"));
    } else {
      hideSessionLoading();
    }
    submitButton.disabled = false;
    return;
  }
  if (email !== SUPERADMIN_EMAIL || password !== getTeacherPassword()) {
    $("#teacher-login-error").textContent = localized("The email or password is incorrect.", "账号或密码不正确，请重新检查。");
    return;
  }
  $("#teacher-login-error").textContent = "";
  enterApp("teacher");
  showToast(localized("Welcome back, Teacher Jude", "欢迎回来，Teacher Jude"));
});

$("#student-register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#register-name").value.trim();
  const className = $("#register-class").value.trim();
  const year = $("#register-year").value;
  const password = $("#register-password").value;
  const passwordConfirmation = $("#register-password-confirm").value;
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
  if (password.length < 6) {
    error.textContent = localized("The password must contain at least 6 characters.", "密码至少需要 6 个字符。");
    return;
  }
  if (password !== passwordConfirmation) {
    error.textContent = localized("The passwords do not match.", "两次输入的密码不一致。");
    return;
  }
  if (!Cloud?.enabled && code !== getHourlyCode()) {
    error.textContent = localized("The verification code is incorrect or expired. Ask your teacher for the current code.", "验证码不正确或已过期，请向老师索取本小时验证码。");
    return;
  }
  const students = getStudents();
  if (!Cloud?.enabled && students.some((student) => student.name === name && student.className === className && student.year === year)) {
    error.textContent = localized("This student account already exists. Switch to Existing Account to sign in.", "此学生账号已注册，请切换至“已有账号”登入。");
    return;
  }
  if (Cloud?.enabled) {
    const submitButton = event.currentTarget.querySelector("button[type='submit']");
    submitButton.disabled = true;
    let registeredStudent = null;
    showSessionLoading(
      "Creating your student account",
      "正在建立学生账号",
      "Verifying your registration details and preparing your learning space…",
      "正在验证注册资料并准备学习空间……"
    );
    try {
      registeredStudent = await Cloud.registerStudent({ name, className, year, password, code });
      await activateCloudProfile(registeredStudent, { migrateLocal: false });
      error.textContent = "";
    } catch (cloudError) {
      console.error("Student cloud registration failed", cloudError);
      registeredStudent = null;
      error.textContent = cloudError?.code === "REGISTRATION_SCHEMA_REQUIRED"
        ? localized(
          "Student registration needs the latest Supabase cloud_schema.sql upgrade. Ask the teacher to run it once.",
          "学生注册需要最新版 Supabase cloud_schema.sql，请老师在 SQL Editor 完整执行一次。"
        )
        : cloudError?.code === "INVALID_REGISTRATION_CODE"
          ? localized(
            "The verification code is incorrect or expired, or the selected class is unavailable.",
            "验证码不正确或已过期，或者所选班级目前不可用。"
          )
          : cloudError?.code === "STUDENT_ALREADY_EXISTS"
            ? localized(
              "This student account already exists. Use Existing Account to sign in, or ask the teacher to reset its password.",
              "此学生账号已存在，请使用“已有账号”登入，或请老师在学生管理中重设密码。"
            )
            : cloudError?.code === "STUDENT_PROFILE_RESTORED"
              ? localized(
                "The missing student record was restored. Ask the teacher to reset the password in Student Management, then use Existing Account to sign in.",
                "缺失的学生资料已补回。请老师在学生管理中重设密码，再使用“已有账号”登入。"
              )
            : cloudError?.code === "WEAK_PASSWORD"
              ? localized(
                "The password must contain at least 6 characters.",
                "密码至少需要 6 个字符。"
              )
            : cloudError?.message || localized("Cloud registration failed. Ask your teacher to check the connection.", "云端注册失败，请老师检查连接。 ");
    }
    if (registeredStudent) {
      await hideSessionLoading({ waitForTransition: true });
      enterApp("student", registeredStudent);
      showToast(localized("Registration successful. Welcome!", "注册成功，欢迎开始学习"));
    } else {
      hideSessionLoading();
    }
    submitButton.disabled = false;
    return;
  }
  const student = { id: "", name, className, year, password, status: "active", createdAt: new Date().toISOString() };
  student.id = createStudentId(student);
  students.push(student);
  saveStudents(students);
  error.textContent = "";
  enterApp("student", student);
  showToast(localized("Registration successful. Welcome!", "注册成功，欢迎开始学习"));
});

$("#student-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#student-login-name").value.trim();
  const className = $("#student-login-class").value.trim();
  const year = $("#student-login-year").value;
  const password = $("#student-login-password").value;
  if (Cloud?.enabled) {
    const submitButton = event.currentTarget.querySelector("button[type='submit']");
    submitButton.disabled = true;
    let authenticatedStudent = null;
    showSessionLoading(
      "Signing in to your learning space",
      "正在登入学习空间",
      "Checking your account and restoring your learning progress…",
      "正在验证账号并恢复学习进度……"
    );
    try {
      authenticatedStudent = await Cloud.signInStudent(name, className, year, password);
      await activateCloudProfile(authenticatedStudent, { migrateLocal: false });
      $("#student-login-error").textContent = "";
    } catch (error) {
      console.error("Student cloud sign-in failed", error);
      await Cloud.signOut().catch(() => {});
      authenticatedStudent = null;
      cloudProfile = null;
      $("#student-login-error").textContent = error?.code === "ACCOUNT_DISABLED"
        ? localized("This account has been disabled. Contact your teacher.", "此账号已停用，请联系老师。")
        : error?.code === "CLOUD_SCHEMA_REQUIRED"
          ? error.message
          : localized("Student account details or password are incorrect.", "学生账号资料或密码不正确。");
    }
    if (authenticatedStudent) {
      await hideSessionLoading({ waitForTransition: true });
      enterApp("student", authenticatedStudent);
      showToast(`${localized("Welcome back", "欢迎回来")}，${authenticatedStudent.name}`);
    } else {
      hideSessionLoading();
    }
    submitButton.disabled = false;
    return;
  }
  const student = getStudents().find((item) => item.name === name && item.className === className && item.year === year);
  if (!student) {
    $("#student-login-error").textContent = localized("Student account not found. Check the details or register first.", "找不到这个学生账号，请检查资料或先完成注册。");
    return;
  }
  if (student.status === "disabled") {
    $("#student-login-error").textContent = localized("This account has been disabled. Contact your teacher.", "此账号已停用，请联系老师。");
    return;
  }
  if (student.password !== password) {
    $("#student-login-error").textContent = localized("The student password is incorrect.", "学生密码不正确。");
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
$("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = $("#current-password").value;
  const next = $("#new-password").value;
  const confirmation = $("#confirm-password").value;
  const error = $("#password-error");
  if (!Cloud?.enabled && current !== getTeacherPassword()) {
    error.textContent = localized("The current password is incorrect.", "目前密码不正确。");
    return;
  }
  if (next.length < 6) {
    error.textContent = localized("The new password must contain at least 6 characters.", "新密码至少需要 6 个字符。");
    return;
  }
  if (next !== confirmation) {
    error.textContent = localized("The new passwords do not match.", "两次输入的新密码不一致。");
    return;
  }
  if (Cloud?.enabled) {
    const submitButton = event.currentTarget.querySelector("button[type='submit']");
    submitButton.disabled = true;
    try {
      await Cloud.signInTeacher(SUPERADMIN_EMAIL, current);
      await Cloud.updateOwnPassword(next);
      $("#password-dialog").close();
      showToast(localized("Cloud password updated. Use the new password next time.", "云端密码已更新，下次登入请使用新密码。"));
    } catch (cloudError) {
      error.textContent = localized("The current cloud password is incorrect.", "目前的云端密码不正确。 ");
    } finally {
      submitButton.disabled = false;
    }
    return;
  }
  localStorage.setItem(PASSWORD_KEY, next);
  $("#password-dialog").close();
  showToast(localized("Password updated. Use the new password next time.", "密码已更新，下次登入请使用新密码"));
});

async function copyVerificationCode() {
  const code = Cloud?.enabled ? cloudRegistrationCode : getHourlyCode();
  if (!code) {
    showToast(localized("The cloud registration code is still loading.", "云端验证码仍在载入中。"));
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    showToast(`${localized("Verification code", "验证码")} ${code} ${localized("copied", "已复制")}`);
  } catch {
    showToast(`${localized("Current verification code", "本小时验证码")}：${code}`);
  }
}

function openVerificationCodeDialog() {
  updateVerificationCode();
  $("#verification-code-dialog").showModal();
}

function closeVerificationCodeDialog() {
  $("#verification-code-dialog").close();
}

$("#copy-code").addEventListener("click", copyVerificationCode);
$("#copy-code-large").addEventListener("click", copyVerificationCode);
$("#expand-code").addEventListener("click", openVerificationCodeDialog);
$("#close-verification-code").addEventListener("click", closeVerificationCodeDialog);
$("#verification-code-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeVerificationCodeDialog();
});

$("#logout-button").addEventListener("click", async () => {
  clearInterval(codeTimer);
  stopTeacherProgressRealtime();
  clearTimeout(quizCloudProgressTimer);
  saveCurrentQuizProgress();
  clearTimeout(quizCloudProgressTimer);
  quizCloudProgressTimer = null;
  activeQuizStudentKey = "";
  questions = [];
  answers = [];
  draftAnswers = [];
  isQuizReviewMode = false;
  activeQuizResultData = null;
  currentQuestion = 0;
  $("#quiz-view").classList.remove("active");
  if (Cloud?.enabled) {
    await flushCloudSync();
    await Cloud.signOut().catch(() => {});
  }
  cloudProfile = null;
  cloudDataLoaded = false;
  cloudSubmissions = [];
  cloudRegistrationCode = "";
  cloudRegistrationCodeExpiresAt = "";
  activeStudent = null;
  localStorage.removeItem(SESSION_KEY);
  $("#teacher-password").value = "";
  showPublicScreen("landing");
});

window.addEventListener("pagehide", () => {
  saveCurrentQuizProgress();
  saveSession();
});

$("#class-form").addEventListener("submit", async (event) => {
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
  if (Cloud?.enabled) {
    try {
      const createdClass = await Cloud.addClass(className);
      if (createdClass?.id) cloudClasses = [...cloudClasses.filter((item) => item.name !== className), createdClass];
    } catch (error) {
      console.error("Unable to add cloud class", error);
      showToast(localized("The class could not be saved to the cloud.", "班级无法储存到云端。"));
      return;
    }
  }
  classes.push(className);
  saveClasses(classes);
  input.value = "";
  showToast(`${className} ${localized("was added to the registration list", "已加入学生注册列表")}`);
});

$("#class-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-class]");
  if (!button) return;
  const className = button.dataset.removeClass;
  const studentCount = getStudents().filter((student) => student.className === className).length;
  const assignmentCount = assignments.filter((assignment) => (
    assignment.className === className
    || (assignment.classId && cloudClasses.find((item) => item.id === assignment.classId)?.name === className)
  )).length;
  const confirmed = confirmDestructiveAction(
    localized(`Delete class “${className}”?`, `要删除班级“${className}”吗？`),
    localized(
      `Final confirmation: this class has ${studentCount} students and ${assignmentCount} assignments. Existing accounts will lose this class link. Continue?`,
      `最终确认：此班级目前有 ${studentCount} 名学生及 ${assignmentCount} 份作业；现有账号会失去班级关联。确定继续吗？`
    )
  );
  if (!confirmed) return;
  if (Cloud?.enabled) {
    try {
      await Cloud.deleteClass(className);
    } catch (error) {
      console.error("Unable to remove cloud class", error);
      showToast(localized("The class could not be removed from the cloud.", "无法从云端移除班级。"));
      return;
    }
  }
  const classes = getClasses().filter((item) => item !== className);
  saveClasses(classes);
  showToast(`${className} ${localized("was removed", "已从列表移除")}`);
});

$("#close-note").addEventListener("click", closeNoteDialog);
$("#cancel-note").addEventListener("click", closeNoteDialog);
$("#note-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const noteId = $("#edit-note-id").value;
  const title = $("#note-title").value.trim();
  const content = $("#note-content").value.trim();
  if (!title || !content) {
    $("#note-error").textContent = localized("Enter both a title and note content.", "请输入笔记标题与内容。");
    return;
  }
  const now = new Date().toISOString();
  const existing = teacherNotes.find((note) => note.id === noteId);
  if (existing) {
    existing.title = title;
    existing.content = content;
    existing.updatedAt = now;
  } else {
    teacherNotes.unshift({ id: createRecordId("note"), title, content, createdAt: now, updatedAt: now });
  }
  teacherNotes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  saveTeacherNotes();
  closeNoteDialog();
  showToast(existing ? localized("Note updated.", "笔记已更新。") : localized("Note published for students.", "笔记已发布给学生。"));
});

$("#ai-chat-launcher").addEventListener("click", toggleAIChat);
$("#resize-ai-chat").addEventListener("click", toggleAIChatSize);
$("#close-ai-chat").addEventListener("click", closeAIChat);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#ai-chat-popover")?.classList.contains("open")) closeAIChat();
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
    const messageBody = copyButton.closest(".message-body");
    const message = messageBody?.dataset.rawMessage || messageBody?.querySelector(".message-markdown, p")?.textContent || "";
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
$("#open-question").addEventListener("click", () => openQuestionDialog());
$("#open-ai-settings").addEventListener("click", () => openAISettings());
$("#quick-upload").addEventListener("click", openUpload);
$("#mobile-add").addEventListener("click", () => role === "teacher" ? openUpload() : startQuiz());
$("#file-input").addEventListener("change", (event) => loadFiles(event.target.files));
$("#material-extra-images").addEventListener("change", (event) => loadSupplementalVisuals(event.target.files));
$("#upload-topic").addEventListener("change", () => syncSubjectWithMainCategory("#upload-topic", "#upload-subject"));
$("#edit-paper-topic").addEventListener("change", () => syncSubjectWithMainCategory("#edit-paper-topic", "#edit-paper-subject"));
$("#upload-material-type").addEventListener("change", syncUploadGenerationOptions);
$("#upload-question-count").addEventListener("change", syncUploadGenerationOptions);
$("#upload-dialog").addEventListener("cancel", (event) => { if (isGeneratingQuestions) event.preventDefault(); });
$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
$("#dropzone").addEventListener("drop", (event) => { event.preventDefault(); event.currentTarget.classList.remove("dragging"); loadFiles(event.dataTransfer.files); });
$("#process-upload").addEventListener("click", async (event) => {
  event.preventDefault();
  const actionButton = $("#process-upload");
  if (actionButton.dataset.setupAi === "true") {
    actionButton.dataset.setupAi = "";
    openAISettingsFromUpload();
    return;
  }
  if (actionButton.dataset.complete === "true") {
    $("#upload-dialog").close();
    pendingUploadFile = null;
    pendingUploadVisuals = [];
    $("#file-input").value = "";
    $("#material-extra-images").value = "";
    $("#file-preview").innerHTML = "";
    $("#material-extra-images-preview").innerHTML = "";
    resetGenerationUI();
    return;
  }
  if (!pendingUploadFile) {
    showToast(localized("Choose a learning material first.", "请先选择学习资料。"));
    return;
  }
  if (isGeneratingQuestions) return;
  isGeneratingQuestions = true;
  actionButton.disabled = true;
  $("#change-gemini-key").disabled = true;
  $("#close-upload").disabled = true;
  $("#cancel-upload").disabled = true;
  $("#file-input").disabled = true;
  $("#material-extra-images").disabled = true;
  $("#upload-material-type").disabled = true;
  $("#upload-question-count").disabled = true;
  $("#upload-topic").disabled = true;
  $("#upload-subject").disabled = true;
  $("#generation-progress").classList.remove("success", "error");
  const year = $("#upload-year").value;
  const topic = $("#upload-topic").value;
  const subject = $("#upload-subject").value;
  const generationOptions = getUploadGenerationOptions();
  generationOptions.subject = subject;
  generationOptions.extraVisuals = pendingUploadVisuals.slice();
  const sourceFile = pendingUploadFile;
  const title = sourceFile.name.replace(/\.[^.]+$/, "").trim() || `${year} 学习资料`;
  const now = new Date();
  const paperId = createRecordId("material");
  lastCloudSyncError = null;
  try {
    const generated = await generateQuestionsFromFile(sourceFile, paperId, topic, generationOptions);
    setGenerationProgress(93, localized("Saving the question set…", "正在储存题目练习……"), "save");
    const paper = {
      id: paperId,
      year,
      title,
      titleEn: title,
      mainCategory: topic,
      mainCategoryEn: MAIN_CATEGORY_EN[topic],
      subject,
      subjectEn: SUBJECT_EN[subject],
      topic,
      topicEn: MAIN_CATEGORY_EN[topic] || topic,
      count: generated.questions.length,
      status: "已整理",
      statusEn: "Organized",
      fileName: sourceFile.name,
      fileSize: sourceFile.size,
      sourceType: sourceFile.type || sourceFile.name.split(".").pop()?.toUpperCase() || "Document",
      generationMode: generated.mode,
      materialType: generationOptions.materialType,
      requestedQuestionCount: generationOptions.questionCount,
      createdAt: now.toISOString()
    };
    if (Cloud?.enabled && cloudProfile) {
      setGenerationProgress(90, localized("Uploading the source file securely…", "正在安全上传原始文件……"), "save");
      paper.storagePath = await Cloud.uploadMaterialFile(paperId, sourceFile);
    }
    papers.unshift(paper);
    questionBank.push(...generated.questions);
    assignments.unshift({
      id: createRecordId("assignment"),
      paperId,
      questionIds: generated.questions.map((question) => question.id),
      questionCount: generated.questions.length,
      icon: "✦",
      title,
      titleEn: title,
      detail: `${generated.questions.length} 题 · 可开始`,
      detailEn: `${generated.questions.length} questions · Ready`,
      action: "开始练习",
      actionEn: "Start Practice",
      done: false
    });
    savePapers();
    saveQuestions();
    saveAssignments();
    await flushCloudSync({ throwOnError: true });
    renderPapers();
    renderAssignments();
    if (activeWorkspaceView === "library") renderWorkspaceView("library");
    const result = localized(
      `${generated.questions.length} questions generated after Gemini understood the material. The practice is ready for students.`,
      `Gemini 理解资料后已生成 ${generated.questions.length} 道题目，学生端现在可以开始练习。`
    );
    setGenerationProgress(100, localized("Question generation complete", "题目生成完成"), "save", result);
    $("#generation-progress").classList.add("success");
    showToast(localized(`${generated.questions.length} questions generated successfully.`, `已成功生成 ${generated.questions.length} 道题目。`));
    actionButton.dataset.complete = "true";
    actionButton.textContent = localized("Done", "完成");
    actionButton.disabled = false;
  } catch (error) {
    console.error("Material question generation failed", error);
    $("#generation-progress").hidden = false;
    $("#generation-progress").classList.add("error");
    $("#generation-status").textContent = localized("Generation could not be completed", "题目生成未完成");
    $("#generation-result").textContent = error?.message || localized("Try another file or a clearer scan.", "请尝试其他文件或更清晰的扫描。 ");
    const shouldOpenAISettings = error?.code === "AI_NOT_CONFIGURED" || error?.source === "gemini-direct";
    actionButton.dataset.setupAi = shouldOpenAISettings ? "true" : "";
    actionButton.textContent = error?.code === "AI_NOT_CONFIGURED"
      ? localized("Set Up AI", "设置 AI")
      : error?.source === "gemini-direct"
        ? localized("Change API Key", "更换 API Key")
        : localized("Try Again", "重新尝试");
    actionButton.disabled = false;
  } finally {
    isGeneratingQuestions = false;
    $("#close-upload").disabled = false;
    $("#cancel-upload").disabled = false;
    $("#file-input").disabled = false;
    $("#change-gemini-key").disabled = false;
    $("#upload-material-type").disabled = false;
    $("#upload-question-count").disabled = false;
    $("#upload-topic").disabled = false;
    $("#upload-subject").disabled = false;
  }
});
$("#change-gemini-key").addEventListener("click", openAISettingsFromUpload);

$("#close-edit-paper").addEventListener("click", () => $("#edit-paper-dialog").close());
$("#cancel-edit-paper").addEventListener("click", () => $("#edit-paper-dialog").close());
$("#delete-paper").addEventListener("click", () => deletePaper($("#edit-paper-id").value));
$("#manage-paper-questions").addEventListener("click", () => {
  const paperId = $("#edit-paper-id").value;
  $("#edit-paper-dialog").close();
  openQuestionManager(paperId);
});
$("#edit-paper-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const paper = papers.find((item) => item.id === $("#edit-paper-id").value);
  const title = $("#edit-paper-title").value.trim();
  if (!paper || !title) {
    $("#edit-paper-error").textContent = localized("Enter a material title.", "请输入资料名称。 ");
    return;
  }
  const classTargets = getSelectedPaperClassTargets();
  if (!classTargets.length) {
    $("#edit-paper-classes-error").textContent = localized("Select at least one class or All Classes.", "请至少选择一个班级或“所有班级”。");
    return;
  }
  const removedAssignments = getRemovedPaperAssignments(paper, classTargets);
  if (removedAssignments.length) {
    const removedClasses = removedAssignments.map((assignment) => (
      assignment.className
      || cloudClasses.find((item) => item.id === assignment.classId)?.name
      || localized("All Classes", "所有班级")
    )).join("、");
    const confirmed = confirmDestructiveAction(
      localized(
        `Remove ${removedAssignments.length} assignment allocation(s) from: ${removedClasses}?`,
        `要删除以下班级的 ${removedAssignments.length} 份作业吗：${removedClasses}？`
      ),
      localized(
        "Final confirmation: the selected assignments and their student progress will be permanently deleted. Continue?",
        "最终确认：所选作业及学生作答进度会永久删除。确定继续吗？"
      )
    );
    if (!confirmed) return;
  }
  $("#edit-paper-classes-error").textContent = "";
  paper.title = title;
  paper.titleEn = title;
  paper.year = $("#edit-paper-year").value;
  paper.mainCategory = $("#edit-paper-topic").value;
  paper.mainCategoryEn = MAIN_CATEGORY_EN[paper.mainCategory];
  paper.subject = $("#edit-paper-subject").value;
  paper.subjectEn = SUBJECT_EN[paper.subject];
  paper.topic = paper.mainCategory;
  paper.topicEn = paper.mainCategoryEn;
  paper.status = $("#edit-paper-status").value;
  paper.statusEn = paper.status === "已整理" ? "Organized" : "Needs review";
  assignments.filter((assignment) => assignment.paperId === paper.id).forEach((assignment) => {
    assignment.title = title;
    assignment.titleEn = title;
  });
  questionBank.filter((question) => question.paperId === paper.id).forEach((question) => {
    question.topic = paper.mainCategory;
    question.updatedAt = new Date().toISOString();
  });
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  submitButton.disabled = true;
  lastCloudSyncError = null;
  try {
    await updatePaperClassAssignments(paper, classTargets);
    savePapers();
    saveQuestions();
    saveAssignments();
    await flushCloudSync({ throwOnError: true });
    renderPapers(activePaperFilter);
    renderAssignments();
    renderTeacherMetrics();
    if (activeWorkspaceView === "library") renderWorkspaceView("library");
    $("#edit-paper-error").textContent = "";
    $("#edit-paper-dialog").close();
    showToast(localized("Material details and class assignments saved.", "学习资料与班级分配已储存。"));
  } catch (error) {
    console.error("Unable to save material class assignments", error);
    $("#edit-paper-error").textContent = error?.message || localized("Class assignments could not be saved.", "无法储存班级分配，请稍后再试。 ");
  } finally {
    submitButton.disabled = false;
  }
});

$("#edit-paper-classes").addEventListener("change", (event) => {
  const allClasses = $("[data-paper-class-all]", event.currentTarget);
  if (event.target.matches("[data-paper-class-all]") && event.target.checked) {
    $$("[data-paper-class]", event.currentTarget).forEach((input) => { input.checked = false; });
  } else if (event.target.matches("[data-paper-class]") && event.target.checked && allClasses) {
    allClasses.checked = false;
  }
  $("#edit-paper-classes-error").textContent = "";
});

$("#close-student-account").addEventListener("click", closeStudentAccountEditor);
$("#cancel-student-account").addEventListener("click", closeStudentAccountEditor);
$("#student-account-form").addEventListener("submit", saveStudentAccount);
$("#delete-student-account").addEventListener("click", deleteStudentAccount);

$(".filters").addEventListener("click", (event) => {
  const button = event.target.closest(".filter");
  if (!button) return;
  $$(".filter", event.currentTarget).forEach((item) => item.classList.remove("active"));
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
$("#create-set").addEventListener("click", () => openQuestionDialog());
function closeQuestionEditor() {
  const returnPaperId = $("#question-return-paper-id").value;
  const wasEditing = Boolean($("#editing-question-id").value);
  $("#question-dialog").close();
  if (wasEditing && returnPaperId) openQuestionManager(returnPaperId);
}
$("#close-question-dialog").addEventListener("click", closeQuestionEditor);
$("#cancel-question-dialog").addEventListener("click", closeQuestionEditor);
$("#question-type").addEventListener("change", toggleQuestionTypeFields);
$("#manual-question-image").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    $("#question-form-error").textContent = localized("Choose an image smaller than 8 MB.", "请选择小于 8MB 的照片。");
    event.target.value = "";
    return;
  }
  try {
    pendingQuestionImageData = await compressImageData(await fileToDataUrl(file), 1400, 0.76);
    pendingQuestionImagePath = "";
    pendingQuestionImageAlt = file.name.replace(/\.[^.]+$/, "") || "题目图表";
    $("#question-form-error").textContent = "";
    renderManualQuestionImagePreview();
  } catch (error) {
    console.error("Unable to read question image", error);
    $("#question-form-error").textContent = localized("The image could not be read.", "照片无法读取。");
  }
});
$("#remove-manual-question-image").addEventListener("click", () => {
  pendingQuestionImageData = "";
  pendingQuestionImagePath = "";
  $("#manual-question-image").value = "";
  renderManualQuestionImagePreview();
});
$("#question-material").addEventListener("change", (event) => {
  const paper = papers.find((item) => item.id === event.target.value);
  if (paper) $("#manual-question-topic").value = paper.topic;
});
$("#question-form").addEventListener("submit", saveManualQuestion);
$("#close-question-list").addEventListener("click", () => $("#question-list-dialog").close());
$("#back-to-paper").addEventListener("click", () => {
  const paperId = $("#question-list-paper-id").value;
  $("#question-list-dialog").close();
  openPaperEditor(paperId);
});
$("#material-question-list").addEventListener("click", (event) => {
  const paperId = $("#question-list-paper-id").value;
  const moveButton = event.target.closest("[data-move-question]");
  if (moveButton) {
    const item = moveButton.closest(".material-question-item[data-question-id]");
    if (item) void moveQuestionInMaterial(item.dataset.questionId, moveButton.dataset.moveQuestion, paperId);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-question]");
  if (deleteButton) {
    void deleteQuestionFromMaterial(deleteButton.dataset.deleteQuestion, paperId);
    return;
  }
  const button = event.target.closest("[data-edit-question]");
  if (!button) return;
  $("#question-list-dialog").close();
  openQuestionDialog({ questionId: button.dataset.editQuestion, paperId });
});
let draggedQuestionId = "";
$("#material-question-list").addEventListener("dragstart", (event) => {
  const item = event.target.closest(".material-question-item[data-question-id]");
  if (!item) return;
  draggedQuestionId = item.dataset.questionId || "";
  item.classList.add("dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedQuestionId);
  }
});
$("#material-question-list").addEventListener("dragover", (event) => {
  const item = event.target.closest(".material-question-item[data-question-id]");
  if (!item || item.dataset.questionId === draggedQuestionId) return;
  event.preventDefault();
  item.classList.add("drop-target");
});
$("#material-question-list").addEventListener("dragleave", (event) => {
  const item = event.target.closest(".material-question-item[data-question-id]");
  if (item && !item.contains(event.relatedTarget)) item.classList.remove("drop-target");
});
$("#material-question-list").addEventListener("drop", (event) => {
  const item = event.target.closest(".material-question-item[data-question-id]");
  if (!item || !draggedQuestionId || item.dataset.questionId === draggedQuestionId) return;
  event.preventDefault();
  const container = $("#material-question-list");
  const ids = [...container.querySelectorAll(".material-question-item[data-question-id]")].map((entry) => entry.dataset.questionId);
  const fromIndex = ids.indexOf(draggedQuestionId);
  const toIndex = ids.indexOf(item.dataset.questionId);
  if (fromIndex < 0 || toIndex < 0) return;
  ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, draggedQuestionId);
  void persistQuestionOrder($("#question-list-paper-id").value, ids);
});
$("#material-question-list").addEventListener("dragend", () => {
  draggedQuestionId = "";
  $$(".material-question-item[data-question-id]", $("#material-question-list")).forEach((item) => item.classList.remove("dragging", "drop-target"));
});
function closeAISettings() {
  resumeUploadAfterAISetup = false;
  $("#ai-settings-dialog").close();
}
$("#close-ai-settings").addEventListener("click", closeAISettings);
$("#cancel-ai-settings").addEventListener("click", closeAISettings);
$("#clear-ai-key").addEventListener("click", () => {
  localStorage.removeItem(GEMINI_KEY);
  localStorage.removeItem(GEMINI_KEY_STATUS_KEY);
  $("#gemini-api-key").value = "";
  updateAIConfigStatus();
  showToast(localized("Gemini API key cleared.", "Gemini API Key 已清除。"));
});
$("#ai-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const apiKey = $("#gemini-api-key").value.trim();
  const model = normalizeGeminiModel($("#gemini-model").value);
  if (!apiKey || !model) {
    $("#ai-settings-error").textContent = localized("Enter the Gemini API key and model.", "请输入 Gemini API Key 与模型名称。");
    return;
  }
  localStorage.setItem(GEMINI_KEY, apiKey);
  localStorage.setItem(GEMINI_MODEL_KEY, model);
  localStorage.setItem(GEMINI_KEY_STATUS_KEY, "untested");
  $("#ai-settings-error").textContent = "";
  $("#ai-settings-dialog").close();
  updateAIConfigStatus();
  showToast(localized(
    "The new API key has replaced the previous key. Try generation again to verify it.",
    "新的 API Key 已取代旧 Key，请重新生成题目以完成验证。"
  ));
  if (resumeUploadAfterAISetup && pendingUploadFile) {
    resumeUploadAfterAISetup = false;
    const actionButton = $("#process-upload");
    actionButton.dataset.setupAi = "";
    actionButton.textContent = localized("Try Again", "重新尝试");
    $("#upload-dialog").showModal();
  }
});
$("#invite-students").addEventListener("click", () => {
  const code = Cloud?.enabled ? cloudRegistrationCode : getHourlyCode();
  if (!code) {
    showToast(localized("The cloud registration code is still loading.", "云端验证码仍在载入中。"));
    return;
  }
  navigator.clipboard?.writeText(code).catch(() => {});
  showToast(`${localized("Student verification code", "学生注册验证码")} ${code} ${localized("copied", "已复制")}`);
});
$("#export-report").addEventListener("click", downloadReport);
$("#notification-button").addEventListener("click", () => showToast(localized("No new notifications", "目前没有新通知")));
$("#workspace-primary-action").addEventListener("click", (event) => {
  const action = event.currentTarget.dataset.action;
  if (action === "upload") openUpload();
  else if (action === "start-practice") startQuiz();
  else if (action === "export") downloadReport();
  else if (action === "new-note") openNoteDialog();
  else if (action === "dashboard-classes") {
    showView("dashboard");
    $("#new-class-name")?.focus();
  }
});
$("#workspace-content").addEventListener("click", async (event) => {
  const categoryButton = event.target.closest("[data-library-category]");
  if (categoryButton) {
    activeLibraryCategoryFilter = categoryButton.dataset.libraryCategory || "全部";
    renderWorkspaceView("library");
    return;
  }
  const editNoteButton = event.target.closest("[data-edit-note]");
  if (editNoteButton) {
    openNoteDialog(editNoteButton.dataset.editNote);
    return;
  }
  const deleteNoteButton = event.target.closest("[data-delete-note]");
  if (deleteNoteButton) {
    const note = teacherNotes.find((item) => item.id === deleteNoteButton.dataset.deleteNote);
    if (!note || !window.confirm(localized(`Delete “${note.title}”?`, `确定删除“${note.title}”吗？`))) return;
    if (Cloud?.enabled) {
      try {
        await flushCloudSync();
        await Cloud.deleteNote(note.id);
      } catch (error) {
        console.error("Unable to delete cloud note", error);
        showToast(localized("The note could not be deleted from the cloud.", "无法从云端删除笔记。"));
        return;
      }
    }
    teacherNotes = teacherNotes.filter((item) => item.id !== note.id);
    saveTeacherNotes();
    showToast(localized("Note deleted.", "笔记已删除。"));
    return;
  }
  const studentButton = event.target.closest("[data-manage-student-id]");
  if (studentButton) {
    openStudentAccountEditor(studentButton.dataset.manageStudentId);
    return;
  }
  const paperButton = event.target.closest("[data-workspace-paper-id]");
  if (paperButton) {
    openPaperEditor(paperButton.dataset.workspacePaperId);
    return;
  }
  const assignmentButton = event.target.closest("[data-start-assignment]");
  if (assignmentButton) {
    const index = Number(assignmentButton.dataset.startAssignment);
    startQuiz(index, { review: Boolean(assignments[index]?.done) });
  }
});
$("#assignment-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-assignment]");
  if (!button) return;
  const index = Number(button.dataset.assignment);
  startQuiz(index, { review: Boolean(assignments[index]?.done) });
});
$("#last-unfinished-assignment").addEventListener("click", (event) => {
  const button = event.target.closest("[data-resume-assignment]");
  if (button) startQuiz(Number(button.dataset.resumeAssignment));
});
$("#continue-quiz").addEventListener("click", () => startQuiz());
$("#exit-quiz").addEventListener("click", () => {
  if (!$("#quiz-result").hidden) {
    resetQuizResultView();
    showView("dashboard");
    return;
  }
  if (isQuizReviewMode) {
    renderQuizResult(activeQuizResultData);
    showView("quiz");
    return;
  }
  saveCurrentQuizProgress();
  resetQuizResultView();
  renderAssignments();
  showView("dashboard");
  showToast(localized("Progress saved. You can continue later.", "作答进度已保存，可稍后继续。"));
});
$("#quiz-options").addEventListener("click", (event) => {
  const option = event.target.closest(".option");
  if (isQuizReviewMode || hasAnswer(answers[currentQuestion]) || !option || option.disabled) return;
  selectedOption = Number(option.dataset.option);
  draftAnswers[currentQuestion] = selectedOption;
  $$(".option").forEach((item) => item.classList.remove("selected"));
  option.classList.add("selected");
  $("#submit-answer").disabled = false;
  saveCurrentQuizProgress();
});
$("#fill-answer-input").addEventListener("input", (event) => {
  if (isQuizReviewMode || hasAnswer(answers[currentQuestion])) return;
  selectedOption = event.target.value;
  draftAnswers[currentQuestion] = selectedOption;
  $("#submit-answer").disabled = !hasAnswer(selectedOption);
  saveCurrentQuizProgress();
});
$("#fill-answer-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !$("#submit-answer").disabled) {
    event.preventDefault();
    submitAnswer();
  }
});
$("#submit-answer").addEventListener("click", submitAnswer);
$("#next-question").addEventListener("click", async () => {
  if (isQuizReviewMode) {
    if (currentQuestion === questions.length - 1) {
      renderQuizResult(activeQuizResultData);
      showView("quiz");
    } else {
      currentQuestion += 1;
      renderQuestion();
    }
    return;
  }
  if (currentQuestion === questions.length - 1) {
    const assignment = assignments[activeAssignmentIndex];
    if (!assignment) return;
    const completedAt = new Date().toISOString();
    const correctCount = answers.filter((answer, index) => isQuestionAnswerCorrect(questions[index], answer)).length;
    assignment.done = true;
    assignment.action = "查看解析";
    assignment.actionEn = "Review Answers";
    assignment.detail = `${questions.length} 题 · 已完成`;
    assignment.detailEn = `${questions.length} questions · Completed`;
    saveCompletedQuizReview(assignment, completedAt);
    clearTimeout(quizCloudProgressTimer);
    quizCloudProgressTimer = null;
    let completionSavedToCloud = !Cloud?.enabled;
    if (Cloud?.enabled) {
      localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
      const nextButton = $("#next-question");
      nextButton.disabled = true;
      nextButton.textContent = localized("Saving result…", "正在保存成绩…");
      try {
        // Finish any earlier autosave first, then persist the completed result
        // directly so closing or refreshing the page cannot cancel it.
        await flushCloudSync();
        const saved = await Cloud.saveSubmission(assignment, questions, answers, { startedAt: quizStartedAt, completedAt });
        if (!saved?.id || saved.status !== "completed") throw new Error("Completed submission was not confirmed by Supabase.");
        completionSavedToCloud = true;
        lastCloudSyncError = null;
        const answersByQuestionId = {};
        const correctnessByQuestionId = {};
        questions.forEach((question, index) => {
          if (!hasAnswer(answers[index])) return;
          answersByQuestionId[question.id] = answers[index];
          correctnessByQuestionId[question.id] = isQuestionAnswerCorrect(question, answers[index]);
        });
        cloudSubmissions = [
          ...cloudSubmissions.filter((submission) => !(submission.assignmentId === assignment.id && submission.studentId === cloudProfile?.id)),
          {
            id: saved?.id || `local:${assignment.id}`,
            assignmentId: assignment.id,
            studentId: cloudProfile?.id || activeStudent?.id || "",
            score: correctCount,
            totalQuestions: questions.length,
            answeredQuestions: questions.length,
            status: "completed",
            answersByQuestionId,
            correctnessByQuestionId,
            startedAt: quizStartedAt,
            submittedAt: completedAt,
            createdAt: completedAt,
            updatedAt: completedAt
          }
        ];
      } catch (error) {
        console.error("Unable to save the completed result to Supabase", error);
      } finally {
        nextButton.disabled = false;
      }
    } else {
      saveAssignments();
    }
    if (completionSavedToCloud) clearQuizProgress(assignment.id);
    renderAssignments();
    renderQuizResult({ correctCount, total: questions.length, startedAt: quizStartedAt, completedAt });
    showView("quiz");
    if (!completionSavedToCloud) {
      showToast(localized(
        "The result is safely stored on this device and will sync automatically after the next sign-in.",
        "成绩已安全保存在此装置，下次登入后会自动补传云端。"
      ));
    }
  } else {
    currentQuestion += 1;
    saveCurrentQuizProgress();
    renderQuestion();
  }
});
$("#quiz-result-back").addEventListener("click", () => {
  resetQuizResultView();
  showView("dashboard");
});
$("#quiz-result-review").addEventListener("click", () => {
  if (!answers.some(hasAnswer)) return;
  isQuizReviewMode = true;
  currentQuestion = 0;
  $("#quiz-layout").hidden = false;
  $("#quiz-result").hidden = true;
  renderQuestion();
});
$("#previous-question").addEventListener("click", () => {
  if (isQuizReviewMode && currentQuestion > 0) {
    currentQuestion -= 1;
    renderQuestion();
  }
});
$("#question-dots").addEventListener("click", (event) => {
  const button = event.target.closest("[data-jump]");
  if (!isQuizReviewMode || !button || button.disabled) return;
  currentQuestion = Number(button.dataset.jump);
  renderQuestion();
});

window.addEventListener("beforeunload", saveCurrentQuizProgress);

window.addEventListener("keydown", (event) => {
  if (!isQuizReviewMode && $("#quiz-view").classList.contains("active") && /^[1-4]$/.test(event.key)) {
    const button = $(`[data-option="${Number(event.key) - 1}"]`);
    if (button && !button.disabled) button.click();
  }
});

setSessionLoadingInteractionBlocked(true);
initializeAppSession();

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
