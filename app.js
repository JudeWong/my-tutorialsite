const PAPERS_KEY = "tixi_papers_v1";
const ASSIGNMENTS_KEY = "tixi_assignments_v1";
const QUESTIONS_KEY = "tixi_questions_v1";
const SESSION_KEY = "tixi_session_v1";

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

papers = papers.map((paper, index) => ({
  id: paper.id || `paper-${paper.createdAt || Date.now()}-${index}`,
  title: paper.title || paper.fileName || "Untitled Paper",
  titleEn: paper.titleEn || paper.title || paper.fileName || "Untitled Paper",
  year: String(paper.year || new Date().getFullYear()),
  topic: TOPIC_ZH[paper.topic] || paper.topic || "综合试卷",
  topicEn: paper.topicEn || TOPIC_EN[TOPIC_ZH[paper.topic] || paper.topic] || "General Paper",
  count: Number(paper.count) || 0,
  status: paper.status || "待校对",
  statusEn: paper.statusEn || "Needs review",
  fileName: paper.fileName || "",
  fileSize: Number(paper.fileSize) || 0,
  createdAt: paper.createdAt || new Date().toISOString()
}));

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
    id: question.id || `question-${Date.now()}-${index}`,
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
let answers = [];
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
const GEMINI_KEY = "tixi_gemini_api_key";
const GEMINI_MODEL_KEY = "tixi_gemini_model";
const GEMINI_KEY_STATUS_KEY = "tixi_gemini_key_status";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const LEVEL_TARGETS = [2, 5, 8];
let currentLanguage = "en";
let lastAIQuestion = "";
let aiReplyTimer;
let aiConversation = [];
let activeWorkspaceView = null;
let activePaperFilter = "全部";
let isGeneratingQuestions = false;
let resumeUploadAfterAISetup = false;
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

function saveQuestions() {
  localStorage.setItem(QUESTIONS_KEY, JSON.stringify(questionBank));
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    role,
    student: role === "student" ? activeStudent : null
  }));
}

function restoreSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (session?.role === "teacher") {
      enterApp("teacher");
      return true;
    }
    if (session?.role === "student" && session.student?.name) {
      const registeredStudent = getStudents().find((student) => (
        student.name === session.student.name
        && student.className === session.student.className
        && student.year === session.student.year
      ));
      if (registeredStudent) {
        enterApp("student", registeredStudent);
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
  const questionCount = questionBank.length;
  const completedAssignments = assignments.filter((assignment) => assignment.done).length;
  const completionRate = assignments.length ? Math.round((completedAssignments / assignments.length) * 100) : 0;
  const students = getStudents();
  const classes = getClasses();
  $("#teacher-question-count").textContent = questionCount.toLocaleString();
  $("#teacher-paper-count").textContent = localized(`${papers.length} materials uploaded`, `${papers.length} 份资料已上传`);
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
  saveSession();
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
      <div class="paper-meta"><span>${escapeHTML(currentLanguage === "en" ? paper.topicEn : paper.topic)}</span><button data-paper-id="${escapeHTML(paper.id)}">${localized("Edit Material →", "编辑资料 →")}</button></div>
    </article>`).join("") || `<div class="data-empty"><strong>${localized("No learning materials uploaded", "尚未上传学习资料")}</strong><p>${localized("Upload a paper, handout, image, or document to generate interactive questions.", "上传试卷、讲义、图片或文件即可生成互动题目。")}</p><button type="button" data-empty-upload>${localized("Upload Learning Material", "上传学习资料")}</button></div>`;
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
  const completedQuestionCount = assignments.filter((assignment) => assignment.done).reduce((total, assignment) => total + (Number(assignment.questionCount) || 0), 0);
  $("#student-question-count").textContent = completedQuestionCount;
  $("#student-rank").textContent = "—";
  $("#student-weekly-count").textContent = completed;
  $("#student-weekly-total").textContent = `/ ${assignments.length}`;
  $("#student-hero-summary").textContent = assignments.length
    ? localized(`${completed} of ${assignments.length} assignments completed.`, `已完成 ${completed} / ${assignments.length} 份练习。`)
    : localized("No assignments have been assigned yet.", "老师尚未布置练习。 ");
  $("#continue-quiz").disabled = !assignments.some((assignment) => (
    Array.isArray(assignment.questionIds) && assignment.questionIds.some((id) => questionBank.some((question) => question.id === id))
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
    title.textContent = localized("Learning Materials", "学习资料题库");
    description.textContent = role === "teacher"
      ? localized("Review uploaded materials, edit their details, or generate more question sets.", "查看已上传资料、编辑内容，或继续生成更多题目。")
      : localized("Choose a practice set and start an interactive exercise.", "选择练习套题并开始互动式作答。 ");
    action.textContent = role === "teacher" ? localized("＋ Upload Material", "＋ 上传资料") : localized("Start Practice →", "开始练习 →");
    action.dataset.action = role === "teacher" ? "upload" : "start-practice";
    content.innerHTML = role === "teacher" ? `
      <section class="panel workspace-panel">
        <div class="workspace-summary"><strong>${papers.length}</strong><span>${localized("materials uploaded", "份资料已上传")}</span></div>
        <div class="workspace-table" role="table">
          ${papers.length ? papers.map((paper) => `<article role="row"><span class="workspace-year">${escapeHTML(paper.year)}</span><div><strong>${escapeHTML(currentLanguage === "en" ? paper.titleEn : paper.title)}</strong><small>${escapeHTML(currentLanguage === "en" ? paper.topicEn : paper.topic)} · ${paper.count} ${localized("questions", "题")}</small></div><span class="status-pill">${escapeHTML(currentLanguage === "en" ? paper.statusEn : paper.status)}</span><button type="button" data-workspace-paper-id="${escapeHTML(paper.id)}">${localized("Edit Material", "编辑资料")}</button></article>`).join("") : `<div class="data-empty"><strong>${localized("No learning materials uploaded", "尚未上传学习资料")}</strong><p>${localized("Upload your first paper, handout, or document to generate questions.", "上传第一份试卷、讲义或文件以生成题目。")}</p></div>`}
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
    ["Metric", "Value"], ["Questions in library", questionBank.length],
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
      ? ["Overview", "Learning Materials", "Class Progress", "Learning Analytics"][index]
      : ["总览", "学习资料", "班级进度", "学习分析"][index];
  });
}

function openUpload() {
  pendingUploadFile = null;
  $("#file-input").value = "";
  $("#file-preview").innerHTML = "";
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
  const pageLimit = Math.min(pdf.numPages, 40);
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => item.str).join(" "));
    setGenerationProgress(18 + (pageNumber / pageLimit) * 35, localized(`Reading PDF page ${pageNumber} of ${pageLimit}`, `正在读取 PDF 第 ${pageNumber} / ${pageLimit} 页`), "extract");
  }
  let text = chunks.join("\n").trim();
  if (text.replace(/\s/g, "").length < 100) {
    const ocrChunks = [];
    const ocrLimit = Math.min(pdf.numPages, 3);
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
  return text;
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
  return chunks.join("\n");
}

async function extractMaterialText(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  setGenerationProgress(8, localized("Reading the uploaded file…", "正在读取上传文件……"), "read");
  if (extension === "pdf") return extractPdfText(file);
  if (/^(png|jpe?g|webp)$/.test(extension)) return recognizeImageText(file);
  if (/^(docx|pptx|xlsx)$/.test(extension)) return extractOfficeText(file, extension);
  const raw = await file.text();
  if (/^(html?|xml)$/.test(extension)) {
    const parsed = new DOMParser().parseFromString(raw, extension === "xml" ? "application/xml" : "text/html");
    return parsed.documentElement?.textContent || raw;
  }
  setGenerationProgress(52, localized("Text content extracted", "文字内容读取完成"), "extract");
  return raw;
}

function normalizeMaterialText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeGeneratedQuestion(item, index, paperId, topic) {
  const title = String(item?.question || item?.title || "").trim();
  const options = Array.isArray(item?.options) ? item.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 4) : [];
  const clozePattern = /_{2,}|填(?:入|写).{0,8}(?:空格|横线)|(?:fill|complete).{0,12}(?:blank|gap)|missing\s+(?:word|term)/iu;
  if (!title || options.length !== 4 || clozePattern.test(title) || new Set(options.map((option) => option.toLocaleLowerCase())).size !== 4) return null;
  let correct = Number(item.correct);
  if (!Number.isInteger(correct) && typeof item.correct === "string") correct = Math.max(0, "ABCD".indexOf(item.correct.toUpperCase()));
  correct = Math.max(0, Math.min(Number.isInteger(correct) ? correct : 0, options.length - 1));
  const explanation = String(item.explanation || localized("Review the source material for the supporting detail.", "请对照原始资料中的重点内容。"));
  const mistake = String(item.mistake || localized("A common mistake is choosing a related term without checking the exact wording.", "常见错误：只凭相似词作答，没有核对资料中的准确叙述。"));
  const levelMap = { Basic: "基础", Intermediate: "中等", Advanced: "进阶", "基础": "基础", "中等": "中等", "进阶": "进阶" };
  return {
    id: `question-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
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
  return !model || model === "gemini-2.5-flash" ? DEFAULT_GEMINI_MODEL : model;
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

function buildQuestionGenerationPrompt(text, fileName, topic) {
  return `You are an experienced Malaysian Independent Chinese Secondary School computer science teacher and UEC examination setter. Read and understand the supplied learning material before writing any question.

Create exactly 6 single-best-answer multiple-choice questions in the same level and reasoning style as Malaysian UEC senior middle computer science questions.

Strict quality rules:
1. Every correct answer must be directly supported by the supplied material. Do not invent facts, definitions, numbers, program output, or technical requirements.
2. Each question must be logically complete and answerable without seeing this instruction. Use a clear scenario, program fragment, table, network situation, database situation, or concept comparison when the material supports it.
3. Provide exactly four concise and plausible options. There must be one and only one correct answer. Distractors must reflect realistic student misconceptions, not absurd claims or generic statements.
4. Never create cloze, missing-word, fill-in-the-blank, underscore, or simple sentence-copy questions.
5. Avoid repeatedly asking “according to the material”. Test understanding, application, output tracing, comparison, or reasoning instead.
6. The explanation must state why the correct option is correct. The common mistake must identify a realistic misunderstanding.
7. Use the main language of the material. Keep standard English computing terms where appropriate.
8. Return only a JSON array with this exact schema:
[{"question":"...","code":"optional code or empty string","options":["A text","B text","C text","D text"],"correct":0,"level":"Basic|Intermediate|Advanced","explanation":"...","mistake":"..."}]
The correct value is a zero-based integer from 0 to 3.

Category: ${TOPIC_EN[topic] || topic}
Source file: ${fileName}

LEARNING MATERIAL:
${text.slice(0, 14000)}`;
}

function parseAIQuestionResponse(raw, paperId, topic) {
  if (typeof raw !== "string") throw new Error("Question generation response was empty");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Question generation response did not contain JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Question generation response was not an array");
  return parsed.map((item, index) => normalizeGeneratedQuestion(item, index, paperId, topic)).filter(Boolean).slice(0, 8);
}

function isTransientGeminiError(status, message = "") {
  return status >= 500
    || status === 408
    || status === 429
    || /high demand|temporar|overload|unavailable|try again|deadline|timeout/i.test(message);
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
  const fallbacks = ["gemini-3.7-flash", "gemini-3.1-flash-lite"].filter((model) => model !== preferred);
  return [preferred, preferred, ...fallbacks];
}

async function requestQuestionsFromProxy(endpoint, prompt, paperId, topic, signal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ message: prompt, messages: [{ role: "user", content: prompt }], mode: "study", task: "question-generation", language: currentLanguage })
  });
  if (!response.ok) throw new Error(`Question generation endpoint returned ${response.status}`);
  const data = await response.json();
  const raw = Array.isArray(data.questions) ? JSON.stringify(data.questions) : data.reply;
  return parseAIQuestionResponse(raw, paperId, topic);
}

async function requestQuestionsFromGemini(apiKey, model, prompt, paperId, topic, signal) {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const preferredModel = normalizeGeminiModel(model);
  const attemptModels = getGeminiAttemptModels(preferredModel);
  for (let attempt = 0; attempt < attemptModels.length; attempt += 1) {
    const attemptedModel = attemptModels[attempt];
    let response;
    let data = {};
    try {
      response = await fetchWithGeminiAttemptTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model: attemptedModel,
          input: prompt,
          system_instruction: "Produce accurate, source-grounded UEC computer science assessment questions. Return JSON only.",
          store: false,
          generation_config: {
            temperature: 0.2,
            max_output_tokens: 6000,
            thinking_level: "medium"
          },
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: {
              type: "array",
              minItems: 6,
              maxItems: 6,
              items: {
                type: "object",
                required: ["question", "code", "options", "correct", "level", "explanation", "mistake"],
                properties: {
                  question: { type: "string" },
                  code: { type: "string" },
                  options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
                  correct: { type: "integer", minimum: 0, maximum: 3 },
                  level: { type: "string", enum: ["Basic", "Intermediate", "Advanced"] },
                  explanation: { type: "string" },
                  mistake: { type: "string" }
                }
              }
            }
          }
        })
      }, signal);
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
      if (isTransientGeminiError(response.status, providerMessage)) {
        if (attempt < attemptModels.length - 1) {
          const nextModel = attemptModels[attempt + 1];
          setGenerationProgress(
            Math.min(88, 78 + (attempt * 3)),
            localized(`Gemini is busy. Retrying with ${nextModel}…`, `Gemini 目前繁忙，正在使用 ${nextModel} 重试……`),
            "generate"
          );
          await waitForGeminiRetry(700 * (2 ** attempt), signal);
          continue;
        }
        const transientError = new Error(localized("Gemini is temporarily busy. Automatic retries and backup models were unsuccessful. Please try again shortly.", "Gemini 目前繁忙，自动重试及备用模型仍未成功，请稍后再试。"));
        transientError.code = "GEMINI_TEMPORARILY_UNAVAILABLE";
        transientError.source = "gemini-transient";
        transientError.httpStatus = response.status;
        throw transientError;
      }
      const messages = {
        400: localized("The API key or Gemini model was rejected. Replace the key or check the model name.", "API Key 或 Gemini 模型被拒绝，请更换 Key 或检查模型名称。"),
        401: localized("The Gemini API key is invalid. Please replace it with a new key.", "Gemini API Key 无效，请更换新的 Key。"),
        403: localized("This Gemini API key is not authorized. Please replace it with another key.", "这个 Gemini API Key 没有使用权限，请更换其他 Key。")
      };
      const error = new Error(messages[response.status] || providerMessage || `Gemini returned ${response.status}`);
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
      const questions = parseAIQuestionResponse(raw, paperId, topic);
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

async function requestAIQuestions(text, fileName, paperId, topic) {
  const configuredEndpoint = globalThis.PERSONAL_AI_CONFIG?.generationEndpoint?.trim()
    || globalThis.PERSONAL_AI_CONFIG?.aiEndpoint?.trim();
  const apiKey = getGeminiApiKey();
  const prompt = buildQuestionGenerationPrompt(text, fileName, topic);
  const controller = new AbortController();
  let generationTimedOut = false;
  const timeout = setTimeout(() => {
    generationTimedOut = true;
    controller.abort(new DOMException("Question generation timed out", "TimeoutError"));
  }, 300000);
  try {
    if (configuredEndpoint) return await requestQuestionsFromProxy(configuredEndpoint, prompt, paperId, topic, controller.signal);
    if (apiKey) {
      try {
        return await requestQuestionsFromGemini(apiKey, getGeminiModel(), prompt, paperId, topic, controller.signal);
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
      return await requestQuestionsFromProxy("./api/chat", prompt, paperId, topic, controller.signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw createAISetupError();
    }
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

async function generateQuestionsFromFile(file, paperId, topic) {
  const extractedText = normalizeMaterialText(await extractMaterialText(file));
  if (extractedText.replace(/\s/g, "").length < 30) {
    throw new Error(localized("Not enough readable text was found. Try a clearer scan or a text-based document.", "无法辨识足够文字，请尝试更清晰的扫描或含文字的文件。"));
  }
  setGenerationProgress(66, localized("Organizing key concepts…", "正在整理重点内容……"), "generate");
  setGenerationProgress(76, localized("Gemini is understanding the material and writing questions…", "Gemini 正在理解资料并编写题目……"), "generate");
  const aiQuestions = await requestAIQuestions(extractedText, file.name, paperId, topic);
  if (aiQuestions.length < 4) {
    throw new Error(localized(
      "AI did not return enough valid questions. Please try again.",
      "AI 没有返回足够的有效题目，请重新尝试。"
    ));
  }
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
  } else {
    $("#question-dialog-title").textContent = localized("Create an Interactive Question", "建立互动题目");
    $("#question-dialog-intro").textContent = localized(
      "Create an MCQ or fill-in question. It will be added to student practice immediately.",
      "自行建立选择题或填充题。储存后会立即加入学生练习。"
    );
    $("#save-question-button").textContent = localized("Save and Publish", "储存并发布");
    if (paperId) $("#question-material").value = paperId;
  }
  toggleQuestionTypeFields();
  $("#question-dialog").showModal();
  $("#manual-question-title").focus();
}

function addQuestionToAssignment(question, paper) {
  const assignmentId = paper ? `material-assignment-${paper.id}` : "manual-question-set";
  let assignment = paper
    ? assignments.find((item) => item.paperId === paper.id)
    : assignments.find((item) => item.id === assignmentId || item.paperId === "manual");
  if (!assignment) {
    assignment = {
      id: assignmentId,
      paperId: paper?.id || "manual",
      questionIds: [],
      icon: paper ? "✦" : "✎",
      title: paper?.title || "老师自行出题",
      titleEn: paper?.titleEn || "Teacher-Created Questions",
      done: false
    };
    assignments.unshift(assignment);
  }
  if (!Array.isArray(assignment.questionIds)) assignment.questionIds = [];
  if (!assignment.questionIds.includes(question.id)) assignment.questionIds.push(question.id);
  assignment.questionCount = assignment.questionIds.length;
  assignment.detail = `${assignment.questionCount} 题 · 可开始`;
  assignment.detailEn = `${assignment.questionCount} questions · Ready`;
  assignment.action = "开始练习";
  assignment.actionEn = "Start Practice";
  assignment.done = false;
}

function saveManualQuestion(event) {
  event.preventDefault();
  const editingId = $("#editing-question-id").value;
  const existingQuestion = editingId ? questionBank.find((item) => item.id === editingId) : null;
  const type = $("#question-type").value === "fill" ? "fill" : "mcq";
  const title = $("#manual-question-title").value.trim();
  const explanation = $("#manual-explanation").value.trim();
  const mistake = $("#manual-mistake").value.trim() || localized(
    "A common mistake is answering before checking every condition in the question.",
    "常见错误：还没有检查题目中的所有条件就作答。"
  );
  const materialId = existingQuestion?.paperId || $("#question-material").value;
  const paper = papers.find((item) => item.id === materialId);
  const options = type === "mcq" ? Array.from({ length: 4 }, (_, index) => $("#manual-option-" + index).value.trim()) : [];
  const correctAnswer = type === "fill" ? $("#manual-correct-answer").value.trim() : "";
  const error = $("#question-form-error");

  if (!title || !explanation) {
    error.textContent = localized("Enter the question and answer explanation.", "请输入题目与答案解析。");
    return;
  }
  if (type === "mcq" && (options.some((option) => !option) || new Set(options.map((option) => option.toLocaleLowerCase())).size !== 4)) {
    error.textContent = localized("Enter four different answer options.", "请输入四个不同的答案选项。");
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
    id: existingQuestion?.id || `manual-question-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
    createdAt: existingQuestion?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (existingQuestion) questionBank[questionBank.indexOf(existingQuestion)] = { ...existingQuestion, ...question };
  else questionBank.push(question);
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
}

function openQuestionManager(paperId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) return;
  const materialQuestions = questionBank.filter((question) => question.paperId === paper.id);
  $("#question-list-paper-id").value = paper.id;
  $("#question-list-title").textContent = `${currentLanguage === "en" ? paper.titleEn : paper.title} · ${localized("Edit Questions", "编辑题目")}`;
  $("#material-question-list").innerHTML = materialQuestions.length ? materialQuestions.map((question, index) => {
    const answer = question.type === "fill"
      ? question.correctAnswer
      : `${String.fromCharCode(65 + question.correct)}. ${question.options?.[question.correct] || ""}`;
    return `<article class="material-question-item">
      <span class="material-question-number">${index + 1}</span>
      <div class="material-question-copy"><strong>${escapeHTML(question.title)}</strong><small>${localized(question.type === "fill" ? "Fill in the Answer" : "Multiple Choice", question.type === "fill" ? "填充题" : "选择题")} · ${localized("Answer", "答案")}: ${escapeHTML(answer)}</small></div>
      <button type="button" data-edit-question="${escapeHTML(question.id)}">${localized("Edit Question", "编辑题目")}</button>
    </article>`;
  }).join("") : `<div class="data-empty"><strong>${localized("No questions in this material", "这份资料还没有题目")}</strong></div>`;
  $("#question-list-dialog").showModal();
}

function openPaperEditor(paperId) {
  const paper = papers.find((item) => item.id === paperId);
  if (!paper) {
    showToast(localized("Material not found", "找不到这份学习资料"));
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
  const materialQuestionCount = questionBank.filter((question) => question.paperId === paper.id).length;
  $("#manage-paper-questions").textContent = localized(
    `View and Edit Questions (${materialQuestionCount})`,
    `查看与编辑题目（${materialQuestionCount}）`
  );
  $("#manage-paper-questions").disabled = materialQuestionCount === 0;
  $("#edit-paper-dialog").showModal();
}

function startQuiz(index = 0) {
  if (!assignments.length) {
    showToast(localized("No interactive questions are available yet.", "目前还没有可作答的互动题目。"));
    return;
  }
  activeAssignmentIndex = Math.max(0, Math.min(index, assignments.length - 1));
  const assignment = assignments[activeAssignmentIndex];
  const questionIds = Array.isArray(assignment.questionIds) ? new Set(assignment.questionIds) : null;
  questions = questionIds
    ? questionBank.filter((question) => questionIds.has(question.id))
    : questionBank.filter((question) => question.paperId && question.paperId === assignment.paperId);
  if (!questions.length) {
    showToast(localized("This assignment does not contain generated questions yet.", "这份练习还没有生成题目。"));
    return;
  }
  answers = Array(questions.length).fill(null);
  currentQuestion = 0;
  renderQuestion();
  showView("quiz");
}

function hasAnswer(answer) {
  return answer !== null && answer !== undefined && String(answer).trim() !== "";
}

function normalizeAnswer(answer) {
  return String(answer ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
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
  const level = question.level === "进阶"
    ? localized("Advanced", "进阶")
    : question.level === "中等" ? localized("Intermediate", "中等") : localized("Basic", "基础");
  const isFill = question.type === "fill";
  const options = currentLanguage === "en" ? question.optionsEn : question.options;
  selectedOption = answers[currentQuestion];
  $("#current-number").textContent = currentQuestion + 1;
  $("#question-total").textContent = questions.length;
  $("#quiz-progress-bar").style.width = `${((currentQuestion + 1) / questions.length) * 100}%`;
  $("#question-topic").textContent = topic;
  $("#question-level").textContent = level;
  $("#question-type-label").textContent = isFill ? localized("Fill in the Answer", "填充题") : localized("Multiple Choice", "选择题");
  $("#question-title").textContent = currentLanguage === "en" ? question.titleEn : question.title;
  $("#code-block code").textContent = question.code;
  $("#code-block").style.display = question.code ? "block" : "none";
  $("#quiz-options").innerHTML = isFill ? "" : options.map((option, index) => `
    <button class="option ${selectedOption === index ? "selected" : ""}" data-option="${index}">
      <span class="letter">${String.fromCharCode(65 + index)}</span><span>${escapeHTML(option)}</span>
    </button>`).join("");
  $("#quiz-options").classList.toggle("hidden", isFill);
  $("#fill-answer").classList.toggle("hidden", !isFill);
  const fillInput = $("#fill-answer-input");
  fillInput.value = isFill && hasAnswer(selectedOption) ? selectedOption : "";
  fillInput.disabled = false;
  fillInput.classList.remove("correct", "wrong");
  $("#answer-feedback").className = "answer-feedback";
  $("#answer-feedback").innerHTML = "";
  $("#submit-answer").classList.remove("hidden");
  $("#submit-answer").disabled = !hasAnswer(selectedOption);
  $("#next-question").classList.add("hidden");
  $("#previous-question").disabled = currentQuestion === 0;
  renderQuestionMap();
  refreshLanguage();
}

function renderQuestionMap() {
  $("#question-dots").innerHTML = questions.map((_, index) => `<button data-jump="${index}" class="${index === currentQuestion ? "current" : ""} ${hasAnswer(answers[index]) ? "answered" : ""}">${index + 1}</button>`).join("");
}

function submitAnswer() {
  if (!hasAnswer(selectedOption)) return;
  const question = questions[currentQuestion];
  if (!question) return;
  answers[currentQuestion] = selectedOption;
  const isCorrect = isQuestionAnswerCorrect(question, selectedOption);
  if (question.type === "fill") {
    const fillInput = $("#fill-answer-input");
    fillInput.disabled = true;
    fillInput.classList.add(isCorrect ? "correct" : "wrong");
  } else {
    $$(".option").forEach((option, index) => {
      option.disabled = true;
      option.classList.remove("selected");
      if (index === question.correct) option.classList.add("correct");
      if (index === selectedOption && index !== question.correct) option.classList.add("wrong");
    });
  }
  const explanation = currentLanguage === "en" ? question.explanationEn : question.explanation;
  const mistakeSource = currentLanguage === "en" ? question.mistakeEn : question.mistake;
  const mistake = String(mistakeSource || "").replace("常见错误：", "");
  const correctAnswerNote = question.type === "fill" && !isCorrect
    ? `<div><strong>${localized("Correct answer:", "正确答案：")}</strong> ${escapeHTML(question.correctAnswer)}</div>`
    : "";
  $("#answer-feedback").innerHTML = `<h3>${isCorrect ? localized("Correct!", "回答正确！") : localized("Take another look", "再留意一下")}</h3>${correctAnswerNote}<div>${escapeHTML(explanation)}</div><div class="mistake"><strong>${localized("Common mistake:", "易错提醒：")}</strong> ${escapeHTML(mistake)}</div>`;
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
updateAIConfigStatus();

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
  updateAIConfigStatus();
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
  localStorage.removeItem(SESSION_KEY);
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
$("#open-question").addEventListener("click", () => openQuestionDialog());
$("#open-ai-settings").addEventListener("click", () => openAISettings());
$("#quick-upload").addEventListener("click", openUpload);
$("#mobile-add").addEventListener("click", () => role === "teacher" ? openUpload() : startQuiz());
$("#file-input").addEventListener("change", (event) => loadFiles(event.target.files));
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
    $("#file-input").value = "";
    $("#file-preview").innerHTML = "";
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
  $("#generation-progress").classList.remove("success", "error");
  const year = $("#upload-year").value;
  const topic = $("#upload-topic").value;
  const sourceFile = pendingUploadFile;
  const title = sourceFile.name.replace(/\.[^.]+$/, "").trim() || `${year} Learning Material`;
  const now = new Date();
  const paperId = `material-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const generated = await generateQuestionsFromFile(sourceFile, paperId, topic);
    setGenerationProgress(93, localized("Saving the question set…", "正在储存题目练习……"), "save");
    const paper = {
      id: paperId,
      year,
      title,
      titleEn: title,
      topic,
      topicEn: TOPIC_EN[topic] || topic,
      count: generated.questions.length,
      status: "已整理",
      statusEn: "Organized",
      fileName: sourceFile.name,
      fileSize: sourceFile.size,
      sourceType: sourceFile.type || sourceFile.name.split(".").pop()?.toUpperCase() || "Document",
      generationMode: generated.mode,
      createdAt: now.toISOString()
    };
    papers.unshift(paper);
    questionBank.push(...generated.questions);
    assignments.unshift({
      id: `assignment-${now.getTime()}`,
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
  }
});
$("#change-gemini-key").addEventListener("click", openAISettingsFromUpload);

$("#close-edit-paper").addEventListener("click", () => $("#edit-paper-dialog").close());
$("#cancel-edit-paper").addEventListener("click", () => $("#edit-paper-dialog").close());
$("#manage-paper-questions").addEventListener("click", () => {
  const paperId = $("#edit-paper-id").value;
  $("#edit-paper-dialog").close();
  openQuestionManager(paperId);
});
$("#edit-paper-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const paper = papers.find((item) => item.id === $("#edit-paper-id").value);
  const title = $("#edit-paper-title").value.trim();
  if (!paper || !title) {
    $("#edit-paper-error").textContent = localized("Enter a material title.", "请输入资料名称。 ");
    return;
  }
  paper.title = title;
  paper.titleEn = title;
  paper.year = $("#edit-paper-year").value;
  paper.topic = $("#edit-paper-topic").value;
  paper.topicEn = TOPIC_EN[paper.topic] || paper.topic;
  paper.status = $("#edit-paper-status").value;
  paper.statusEn = paper.status === "已整理" ? "Organized" : "Needs review";
  assignments.filter((assignment) => assignment.paperId === paper.id).forEach((assignment) => {
    assignment.title = title;
    assignment.titleEn = title;
  });
  savePapers();
  saveAssignments();
  renderPapers(activePaperFilter);
  if (activeWorkspaceView === "library") renderWorkspaceView("library");
  $("#edit-paper-error").textContent = "";
  $("#edit-paper-dialog").close();
  showToast(localized("Material details saved.", "学习资料已储存。"));
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
  const button = event.target.closest("[data-edit-question]");
  if (!button) return;
  const paperId = $("#question-list-paper-id").value;
  $("#question-list-dialog").close();
  openQuestionDialog({ questionId: button.dataset.editQuestion, paperId });
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
$("#fill-answer-input").addEventListener("input", (event) => {
  selectedOption = event.target.value;
  $("#submit-answer").disabled = !hasAnswer(selectedOption);
});
$("#fill-answer-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !$("#submit-answer").disabled) {
    event.preventDefault();
    submitAnswer();
  }
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
      `Practice complete: ${answers.filter((answer, index) => isQuestionAnswerCorrect(questions[index], answer)).length} of ${questions.length} correct.`,
      `练习完成，答对 ${answers.filter((answer, index) => isQuestionAnswerCorrect(questions[index], answer)).length} / ${questions.length} 题。`
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

restoreSession();

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
