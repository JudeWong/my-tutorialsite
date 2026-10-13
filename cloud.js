(function initializePersonalAICloud() {
  const config = globalThis.PERSONAL_AI_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const publishableKey = String(config.supabasePublishableKey || "").trim();
  const sdk = globalThis.supabase;
  const enabled = Boolean(config.cloudEnabled === true && supabaseUrl && publishableKey && sdk?.createClient);
  document.documentElement.dataset.cloudClient = enabled ? "enabled" : (sdk?.createClient ? "standby" : "unavailable");
  let session = null;

  const client = enabled ? sdk.createClient(supabaseUrl, publishableKey, {
    auth: {
      storageKey: "personal-ai-cloud-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }) : null;

  if (client) {
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
    });
  }

  function requireClient() {
    if (!client) throw new Error("Supabase cloud connection is not configured.");
    return client;
  }

  function unwrap(result, label = "Cloud request") {
    if (result?.error) {
      const error = new Error(result.error.message || `${label} failed.`);
      error.code = result.error.code;
      error.details = result.error.details;
      throw error;
    }
    return result?.data;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function newUuid() {
    return crypto.randomUUID();
  }

  function apiBase() {
    const configured = String(config.cloudApiEndpoint || "").trim().replace(/\/$/, "");
    if (configured) return configured;
    const aiEndpoint = String(config.aiEndpoint || "").trim();
    if (/^https:\/\//i.test(aiEndpoint)) {
      try { return new URL(aiEndpoint).origin; } catch { /* Use same origin below. */ }
    }
    return location.origin;
  }

  async function apiRequest(path, { method = "GET", body, authenticated = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    const activeSession = session || unwrap(await requireClient().auth.getSession(), "Read session")?.session;
    if (authenticated && activeSession?.access_token) headers.Authorization = `Bearer ${activeSession.access_token}`;
    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Cloud request failed (${response.status}).`);
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function hashStudentIdentity(name, className, year) {
    const normalized = [name, className, year].map((value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase()).join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function studentEmail(name, className, year) {
    return `student+${(await hashStudentIdentity(name, className, year)).slice(0, 32)}@chms3.edu.my`;
  }

  async function getSession() {
    if (!client) return null;
    session = unwrap(await client.auth.getSession(), "Read session")?.session || null;
    return session;
  }

  async function getProfile(userId = session?.user?.id) {
    if (!userId) return null;
    return unwrap(await requireClient().from("profiles").select("*").eq("id", userId).maybeSingle(), "Load profile") || null;
  }

  function normalizeProfile(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.full_name || "",
      className: row.class_name || "",
      classId: row.class_id || "",
      year: String(row.year || ""),
      role: row.role || "student",
      status: row.status || "active",
      createdAt: row.created_at || ""
    };
  }

  async function authenticate(email, password, expectedRole) {
    const data = unwrap(await requireClient().auth.signInWithPassword({ email, password }), "Sign in");
    session = data.session;
    const profile = normalizeProfile(await getProfile(data.user.id));
    if (!profile || profile.role !== expectedRole || profile.status === "disabled") {
      await requireClient().auth.signOut();
      session = null;
      const error = new Error(profile?.status === "disabled" ? "This account has been disabled." : "This account does not have access to the selected portal.");
      error.code = profile?.status === "disabled" ? "ACCOUNT_DISABLED" : "ROLE_MISMATCH";
      throw error;
    }
    return profile;
  }

  async function signInTeacher(email, password) {
    return authenticate(email, password, "teacher");
  }

  async function signInStudent(name, className, year, password) {
    return authenticate(await studentEmail(name, className, year), password, "student");
  }

  async function registerStudent(payload) {
    const data = await apiRequest("/api/student-register", { method: "POST", body: payload, authenticated: false });
    unwrap(await requireClient().auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    }), "Start student session");
    session = (await getSession());
    return normalizeProfile(data.profile);
  }

  function mapMaterial(row) {
    return {
      id: row.id,
      year: String(row.year || new Date(row.created_at || Date.now()).getFullYear()),
      title: row.title || "未命名学习资料",
      titleEn: row.title_en || row.title || "Untitled Material",
      topic: row.topic || "综合试卷",
      topicEn: row.topic_en || row.topic || "General Paper",
      count: Number(row.count ?? row.question_count) || 0,
      status: row.status || "待校对",
      statusEn: row.status_en || "Needs review",
      fileName: row.file_name || "",
      fileSize: Number(row.file_size) || 0,
      storagePath: row.storage_path || row.file_url || "",
      sourceType: row.source_type || "Document",
      generationMode: row.generation_mode || "cloud",
      materialType: row.material_type || "past-paper",
      requestedQuestionCount: Number(row.requested_question_count) || 0,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString()
    };
  }

  function mapQuestion(row) {
    const options = Array.isArray(row.options) ? row.options : [];
    const correctIndex = Number.isInteger(row.correct_index)
      ? row.correct_index
      : Math.max(0, options.findIndex((option) => String(option) === String(row.correct_answer)));
    return {
      id: row.id,
      paperId: row.material_id || "manual",
      position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
      type: row.question_type || (options.length ? "mcq" : "fill"),
      topic: row.topic || "综合试卷",
      level: row.difficulty || "中等",
      title: row.question_text || "",
      titleEn: row.title_en || row.question_text || "",
      code: row.code || "",
      options,
      optionsEn: Array.isArray(row.options_en) ? row.options_en : options,
      correct: correctIndex < 0 ? 0 : correctIndex,
      correctAnswer: options.length ? "" : String(row.correct_answer || ""),
      acceptedAnswers: Array.isArray(row.accepted_answers) ? row.accepted_answers : (row.correct_answer ? [String(row.correct_answer)] : []),
      explanation: row.explanation || "",
      explanationEn: row.explanation_en || row.explanation || "",
      mistake: row.common_mistakes || "",
      mistakeEn: row.common_mistakes_en || row.common_mistakes || "",
      imagePath: row.image_path || "",
      imageAlt: row.image_alt || "题目图表",
      imageUrl: "",
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString()
    };
  }

  function mapAssignment(row, questionIds, completedAssignmentIds) {
    return {
      id: row.id,
      paperId: row.material_id || "manual",
      classId: row.class_id || "",
      questionIds,
      questionCount: questionIds.length,
      icon: row.icon || "✦",
      title: row.title || "互动练习",
      titleEn: row.title_en || row.title || "Interactive Practice",
      detail: row.description || `${questionIds.length} 题 · 可开始`,
      detailEn: row.description_en || `${questionIds.length} questions · Ready`,
      action: completedAssignmentIds.has(row.id) ? "查看解析" : "开始练习",
      actionEn: completedAssignmentIds.has(row.id) ? "Review Answers" : "Start Practice",
      done: completedAssignmentIds.has(row.id),
      createdAt: row.created_at || new Date().toISOString()
    };
  }

  async function loadSnapshot(profile) {
    const db = requireClient();
    const results = await Promise.all([
      db.from("profiles").select("*").order("created_at", { ascending: true }),
      db.from("classes").select("*").order("created_at", { ascending: true }),
      db.from("materials").select("*").order("created_at", { ascending: false }),
      db.from("questions").select("*").order("position", { ascending: true }).order("created_at", { ascending: true }),
      db.from("notes").select("*").order("created_at", { ascending: false }),
      db.from("assignments").select("*").order("created_at", { ascending: false }),
      db.from("assignment_questions").select("*").order("position", { ascending: true }),
      db.from("submissions").select("*")
    ]);
    const [profiles, classes, materials, questions, notes, assignments, links, submissions] = results.map((result, index) => unwrap(result, ["profiles", "classes", "materials", "questions", "notes", "assignments", "assignment questions", "submissions"][index]));
    const questionIdsByAssignment = new Map();
    for (const link of links || []) {
      if (!questionIdsByAssignment.has(link.assignment_id)) questionIdsByAssignment.set(link.assignment_id, []);
      questionIdsByAssignment.get(link.assignment_id).push(link.question_id);
    }
    const mappedQuestions = (questions || []).map(mapQuestion);
    const questionCounts = mappedQuestions.reduce((counts, question) => {
      if (question.paperId && question.paperId !== "manual") {
        counts.set(question.paperId, (counts.get(question.paperId) || 0) + 1);
      }
      return counts;
    }, new Map());
    const mappedMaterials = (materials || []).map(mapMaterial).map((paper) => ({
      ...paper,
      // Some existing Supabase projects do not have a material count column.
      // Derive it from the question rows so the UI stays correct after reload.
      count: questionCounts.get(paper.id) || paper.count || 0
    }));
    await Promise.all(mappedQuestions.map(async (question) => {
      if (!question.imagePath) return;
      const signed = await db.storage.from("learning-materials").createSignedUrl(question.imagePath, 3600);
      if (!signed.error) question.imageUrl = signed.data?.signedUrl || "";
    }));
    const completed = new Set((submissions || [])
      .filter((item) => profile.role === "student" && item.student_id === profile.id && item.status === "completed")
      .map((item) => item.assignment_id));
    return {
      students: (profiles || []).filter((item) => item.role === "student").map(normalizeProfile),
      classes: (classes || []).map((item) => ({ id: item.id, name: item.class_name || item.name || "", year: item.year || "", active: item.active !== false })),
      papers: mappedMaterials,
      questions: mappedQuestions,
      notes: (notes || []).map((item) => ({ id: item.id, title: item.title || "", content: item.content || "", createdAt: item.created_at, updatedAt: item.updated_at || item.created_at })),
      assignments: (assignments || []).map((item) => mapAssignment(item, questionIdsByAssignment.get(item.id) || [], completed))
    };
  }

  async function loadPublicClasses() {
    if (!client) return [];
    const rows = unwrap(await client.from("classes").select("class_name").order("class_name", { ascending: true }), "Load classes") || [];
    return rows.map((item) => ({ id: "", name: item.class_name || "", active: true })).filter((item) => item.name);
  }

  function materialRow(paper, userId) {
    return {
      id: paper.id,
      teacher_id: userId,
      title: paper.title,
      title_en: paper.titleEn || paper.title,
      year: Number(paper.year) || new Date().getFullYear(),
      topic: paper.topic || "综合试卷",
      topic_en: paper.topicEn || "General Paper",
      file_url: paper.storagePath || "",
      file_name: paper.fileName || "",
      file_size: Number(paper.fileSize) || 0,
      storage_path: paper.storagePath || "",
      source_type: paper.sourceType || "Document",
      material_type: paper.materialType || "past-paper",
      requested_question_count: Number(paper.requestedQuestionCount) || 0,
      status: paper.status || "待校对",
      status_en: paper.statusEn || "Needs review",
      generation_mode: paper.generationMode || "cloud",
      updated_at: paper.updatedAt || new Date().toISOString()
    };
  }

  function questionRow(question, userId, position = 0) {
    const options = Array.isArray(question.options) ? question.options : [];
    return {
      id: question.id,
      material_id: isUuid(question.paperId) ? question.paperId : null,
      created_by: userId,
      position,
      question_type: question.type === "fill" ? "fill" : "mcq",
      topic: question.topic || "综合试卷",
      difficulty: question.level || "中等",
      question_text: question.title,
      title_en: question.titleEn || question.title,
      code: question.code || "",
      options,
      options_en: Array.isArray(question.optionsEn) ? question.optionsEn : options,
      correct_index: question.type === "fill" ? null : Number(question.correct) || 0,
      correct_answer: question.type === "fill" ? question.correctAnswer : (options[Number(question.correct) || 0] || ""),
      accepted_answers: question.type === "fill" ? (question.acceptedAnswers || [question.correctAnswer].filter(Boolean)) : [],
      explanation: question.explanation || "",
      explanation_en: question.explanationEn || question.explanation || "",
      common_mistakes: question.mistake || "",
      common_mistakes_en: question.mistakeEn || question.mistake || "",
      image_path: question.imagePath || "",
      image_alt: question.imageAlt || "题目图表",
      updated_at: question.updatedAt || new Date().toISOString()
    };
  }

  async function upsertPapers(papers) {
    if (!session?.user?.id) return;
    const rows = papers.filter((item) => isUuid(item.id)).map((item) => materialRow(item, session.user.id));
    if (rows.length) unwrap(await requireClient().from("materials").upsert(rows, { onConflict: "id" }), "Save materials");
  }

  async function upsertQuestions(questions) {
    if (!session?.user?.id) return;
    const positions = new Map();
    const rows = questions.filter((item) => isUuid(item.id)).map((item) => {
      const group = item.paperId || "manual";
      const position = positions.get(group) || 0;
      positions.set(group, position + 1);
      return questionRow(item, session.user.id, position);
    });
    if (rows.length) unwrap(await requireClient().from("questions").upsert(rows, { onConflict: "id" }), "Save questions");
  }

  async function upsertAssignments(assignments) {
    if (!session?.user?.id) return;
    const valid = assignments.filter((item) => isUuid(item.id));
    const rows = valid.map((item) => ({
      id: item.id,
      teacher_id: session.user.id,
      material_id: isUuid(item.paperId) ? item.paperId : null,
      class_id: isUuid(item.classId) ? item.classId : null,
      title: item.title || "互动练习",
      title_en: item.titleEn || item.title || "Interactive Practice",
      description: item.detail || "",
      description_en: item.detailEn || "",
      icon: item.icon || "✦",
      published: true,
      updated_at: new Date().toISOString()
    }));
    if (rows.length) unwrap(await requireClient().from("assignments").upsert(rows, { onConflict: "id" }), "Save assignments");
    for (const assignment of valid) {
      unwrap(await requireClient().from("assignment_questions").delete().eq("assignment_id", assignment.id), "Update assignment questions");
      const links = (assignment.questionIds || []).filter(isUuid).map((questionId, index) => ({ assignment_id: assignment.id, question_id: questionId, position: index }));
      if (links.length) unwrap(await requireClient().from("assignment_questions").insert(links), "Save assignment questions");
    }
  }

  async function upsertNotes(notes) {
    if (!session?.user?.id) return;
    const rows = notes.filter((item) => isUuid(item.id)).map((item) => ({ id: item.id, teacher_id: session.user.id, title: item.title, content: item.content, updated_at: item.updatedAt || new Date().toISOString() }));
    if (rows.length) unwrap(await requireClient().from("notes").upsert(rows, { onConflict: "id" }), "Save notes");
  }

  async function addClass(className) {
    if (!session?.user?.id) return;
    unwrap(await requireClient().from("classes").upsert({ class_name: className, teacher_id: session.user.id, active: true }, { onConflict: "class_name" }), "Save class");
  }

  async function deleteClass(className) {
    unwrap(await requireClient().from("classes").delete().eq("class_name", className), "Delete class");
  }

  async function updateStudents(students) {
    const rows = students.filter((item) => isUuid(item.id)).map((item) => ({ id: item.id, full_name: item.name, class_name: item.className, class_id: isUuid(item.classId) ? item.classId : null, year: Number(item.year), role: "student", status: item.status || "active" }));
    if (rows.length) unwrap(await requireClient().from("profiles").upsert(rows, { onConflict: "id" }), "Save students");
  }

  async function updateStudent(student, password = "") {
    unwrap(await requireClient().from("profiles").update({ full_name: student.name, class_name: student.className, class_id: isUuid(student.classId) ? student.classId : null, year: Number(student.year), status: student.status }).eq("id", student.id), "Update student");
    if (password) await apiRequest("/api/student-account", { method: "PATCH", body: { id: student.id, password } });
  }

  async function deleteStudent(studentId) {
    return apiRequest("/api/student-account", { method: "DELETE", body: { id: studentId } });
  }

  async function uploadMaterialFile(paperId, file) {
    if (!session?.user?.id || !file) return "";
    // Supabase Storage object keys are kept ASCII-only for compatibility with
    // S3 gateways. The original filename is still stored in materials.file_name.
    const originalName = String(file.name || "material").normalize("NFKC");
    const extension = originalName.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() || "bin";
    const stem = originalName
      .replace(/\.[^.]+$/, "")
      .replace(/[^\x00-\x7F]/g, "-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "material";
    const safeName = `${stem}.${extension}`;
    const path = `${session.user.id}/${paperId}/${Date.now()}-${safeName}`;
    unwrap(await requireClient().storage.from("learning-materials").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined }), "Upload material");
    return path;
  }

  async function uploadQuestionImage(questionId, blob) {
    if (!session?.user?.id || !blob) return "";
    const path = `question-images/${session.user.id}/${questionId}-${Date.now()}.jpg`;
    unwrap(await requireClient().storage.from("learning-materials").upload(path, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: "image/jpeg"
    }), "Upload question image");
    return path;
  }

  async function deleteQuestionImage(path) {
    if (path) await requireClient().storage.from("learning-materials").remove([path]);
  }

  async function deleteQuestion(questionId) {
    if (!session?.user?.id || !isUuid(questionId)) return;
    const db = requireClient();
    unwrap(await db.from("assignment_questions").delete().eq("question_id", questionId), "Delete question links");
    unwrap(await db.from("student_answers").delete().eq("question_id", questionId), "Delete question answers");
    unwrap(await db.from("questions").delete().eq("id", questionId), "Delete question");
  }

  async function deleteMaterial(paper) {
    if (paper?.storagePath) await requireClient().storage.from("learning-materials").remove([paper.storagePath]);
    unwrap(await requireClient().from("materials").delete().eq("id", paper.id), "Delete material");
  }

  async function deleteNote(noteId) {
    unwrap(await requireClient().from("notes").delete().eq("id", noteId), "Delete note");
  }

  async function saveSubmission(assignment, questions, answers) {
    if (!session?.user?.id || !isUuid(assignment?.id)) return;
    const score = questions.reduce((total, question, index) => total + (isCorrectAnswer(question, answers[index]) ? 1 : 0), 0);
    const submission = unwrap(await requireClient().from("submissions").insert({ assignment_id: assignment.id, student_id: session.user.id, score, total_questions: questions.length, status: "completed", submitted_at: new Date().toISOString() }).select("id").single(), "Save submission");
    const rows = questions.filter((question) => isUuid(question.id)).map((question, index) => ({ submission_id: submission.id, question_id: question.id, student_answer: answers[index] === null ? null : JSON.stringify(answers[index]), is_correct: isCorrectAnswer(question, answers[index]) }));
    if (rows.length) unwrap(await requireClient().from("student_answers").insert(rows), "Save student answers");
  }

  async function saveChatConversation(threadId, messages, title = "AI 对话") {
    if (!session?.user?.id || !Array.isArray(messages) || !messages.length) return threadId || "";
    const id = isUuid(threadId) ? threadId : newUuid();
    const db = requireClient();
    unwrap(await db.from("chat_threads").upsert({ id, user_id: session.user.id, title: String(title || "AI 对话").slice(0, 120) }, { onConflict: "id" }), "Save chat thread");
    unwrap(await db.from("chat_messages").delete().eq("thread_id", id), "Replace chat messages");
    const rows = messages
      .filter((item) => item && typeof item.content === "string" && ["user", "assistant"].includes(item.role))
      .map((item, index) => ({
        id: newUuid(),
        thread_id: id,
        sender: item.role === "assistant" ? "assistant" : "user",
        message: item.content,
        created_at: new Date(Date.now() + index).toISOString()
      }));
    if (rows.length) unwrap(await db.from("chat_messages").insert(rows), "Save chat messages");
    return id;
  }

  function isCorrectAnswer(question, answer) {
    if (question.type === "fill") {
      const normalize = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
      return (question.acceptedAnswers?.length ? question.acceptedAnswers : [question.correctAnswer]).some((candidate) => normalize(candidate) === normalize(answer));
    }
    return Number(answer) === Number(question.correct);
  }

  async function migrateLocalSnapshot(snapshot) {
    if (!session?.user?.id) return null;
    const materialIds = new Map();
    const questionIds = new Map();
    const assignmentIds = new Map();
    const noteIds = new Map();
    const papers = (snapshot.papers || []).map((item) => ({ ...item, id: isUuid(item.id) ? item.id : newUuid() }));
    (snapshot.papers || []).forEach((item, index) => materialIds.set(item.id, papers[index].id));
    const questions = (snapshot.questions || []).map((item) => ({ ...item, id: isUuid(item.id) ? item.id : newUuid(), paperId: materialIds.get(item.paperId) || (isUuid(item.paperId) ? item.paperId : "manual") }));
    (snapshot.questions || []).forEach((item, index) => questionIds.set(item.id, questions[index].id));
    const assignments = (snapshot.assignments || []).map((item) => ({ ...item, id: isUuid(item.id) ? item.id : newUuid(), paperId: materialIds.get(item.paperId) || (isUuid(item.paperId) ? item.paperId : "manual"), questionIds: (item.questionIds || []).map((id) => questionIds.get(id) || id).filter(isUuid) }));
    (snapshot.assignments || []).forEach((item, index) => assignmentIds.set(item.id, assignments[index].id));
    const notes = (snapshot.notes || []).map((item) => ({ ...item, id: isUuid(item.id) ? item.id : newUuid() }));
    (snapshot.notes || []).forEach((item, index) => noteIds.set(item.id, notes[index].id));
    for (const className of snapshot.classes || []) await addClass(className);
    await upsertPapers(papers);
    await upsertQuestions(questions);
    await upsertAssignments(assignments);
    await upsertNotes(notes);
    return { papers, questions, assignments, notes, skippedStudents: (snapshot.students || []).length };
  }

  async function getRegistrationCode() {
    try {
      return await apiRequest("/api/registration-code");
    } catch (apiError) {
      // GitHub Pages is static and cannot run the registration-code Function.
      // Fall back to the authenticated teacher's Supabase session so the code
      // still exists in registration_codes and remains visible to the teacher.
      if (!session?.user?.id) throw apiError;
      const db = requireClient();
      const now = new Date().toISOString();
      const active = unwrap(await db.from("registration_codes")
        .select("id,code,expires_at")
        .gt("expires_at", now)
        .order("expires_at", { ascending: false })
        .limit(1), "Load registration code") || [];
      if (active[0]?.code) return { code: String(active[0].code), expiresAt: active[0].expires_at };
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      const code = String(100000 + (values[0] % 900000));
      const expires = new Date();
      expires.setMinutes(60, 0, 0);
      const row = unwrap(await db.from("registration_codes")
        .insert({ code, class_name: "全校", expires_at: expires.toISOString(), created_by: session.user.id })
        .select("id,code,expires_at")
        .single(), "Create registration code");
      return { code: String(row.code), expiresAt: row.expires_at };
    }
  }

  async function checkSchema() {
    if (!client) return false;
    const checks = await Promise.all([
      client.from("profiles").select("id,class_id,updated_at").limit(0),
      client.from("classes").select("id,teacher_id,class_name,active,updated_at").limit(0),
      client.from("registration_codes").select("id,code,class_name,expires_at,created_by").limit(0),
      client.from("materials").select("id,storage_path,material_type,requested_question_count,updated_at").limit(0),
      client.from("questions").select("id,material_id,question_type,correct_index,image_path,updated_at").limit(0),
      client.from("notes").select("id,title,content,updated_at").limit(0),
      client.from("assignments").select("id,material_id,class_id,published,updated_at").limit(0),
      client.from("assignment_questions").select("id,assignment_id,question_id,position").limit(0),
      client.from("submissions").select("id,assignment_id,student_id,status,submitted_at").limit(0),
      client.from("student_answers").select("id,submission_id,question_id,student_answer,is_correct").limit(0),
      client.from("chat_threads").select("id,user_id,title,created_at").limit(0),
      client.from("chat_messages").select("id,thread_id,sender,message,created_at").limit(0)
    ]);
    const storageCheck = await client.storage.from("learning-materials").list("", { limit: 1 });
    return [...checks, storageCheck].every((result) => !result.error);
  }

  async function updateOwnPassword(password) {
    unwrap(await requireClient().auth.updateUser({ password }), "Update password");
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    session = null;
  }

  globalThis.personalAICloud = Object.freeze({
    enabled,
    client,
    isUuid,
    newUuid,
    getSession,
    getProfile,
    normalizeProfile,
    signInTeacher,
    signInStudent,
    registerStudent,
    signOut,
    loadPublicClasses,
    loadSnapshot,
    migrateLocalSnapshot,
    upsertPapers,
    upsertQuestions,
    upsertAssignments,
    upsertNotes,
    addClass,
    deleteClass,
    updateStudents,
    updateStudent,
    deleteStudent,
    uploadMaterialFile,
    uploadQuestionImage,
    deleteQuestionImage,
    deleteQuestion,
    deleteMaterial,
    deleteNote,
    saveSubmission,
    saveChatConversation,
    getRegistrationCode,
    checkSchema,
    updateOwnPassword
  });
})();
