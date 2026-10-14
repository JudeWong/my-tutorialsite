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
  let progressChannel = null;

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

  async function refreshSession() {
    if (!client) return null;
    const refreshed = unwrap(await client.auth.refreshSession(), "Refresh session");
    session = refreshed?.session || null;
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

  async function registerStudentDirect(payload) {
    const db = requireClient();
    try {
      const ready = unwrap(await db.rpc("student_registration_ready"), "Check registration setup");
      if (ready !== true) throw new Error("Student registration is not ready in Supabase.");
    } catch (error) {
      const setupError = new Error("Student registration needs the latest Supabase cloud_schema.sql upgrade. Ask the teacher to run it once in Supabase SQL Editor.");
      setupError.code = "REGISTRATION_SCHEMA_REQUIRED";
      setupError.cause = error;
      throw setupError;
    }

    const email = await studentEmail(payload.name, payload.className, payload.year);
    let authData;
    let existingAccount = false;
    try {
      authData = unwrap(await db.auth.signUp({
        email,
        password: payload.password,
        options: {
          data: {
            role: "student",
            full_name: payload.name,
            class_name: payload.className,
            year: Number(payload.year),
            registration_code: payload.code
          }
        }
      }), "Create student account");
    } catch (error) {
      if (/already|registered|exists/i.test(error?.message || "")) {
        existingAccount = true;
      } else if (/database error|saving new user|verification|code/i.test(error?.message || "")) {
        const invalidCode = new Error("The verification code is incorrect or expired, or the selected class is unavailable.");
        invalidCode.code = "INVALID_REGISTRATION_CODE";
        throw invalidCode;
      } else {
        throw error;
      }
    }

    const silentDuplicate = Boolean(authData?.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0);
    session = existingAccount || silentDuplicate ? null : (authData?.session || null);
    if (!session) {
      try {
        const signedIn = unwrap(await db.auth.signInWithPassword({ email, password: payload.password }), "Start student session");
        authData = signedIn;
        session = signedIn?.session || null;
      } catch (error) {
        if (existingAccount || silentDuplicate || /invalid login credentials/i.test(error?.message || "")) {
          const duplicate = new Error("This student account already exists. Use Existing Account to sign in, or ask the teacher to reset its password.");
          duplicate.code = "STUDENT_ALREADY_EXISTS";
          throw duplicate;
        }
        throw error;
      }
    }
    const userId = session?.user?.id || authData?.user?.id;
    try {
      unwrap(await db.rpc("complete_student_registration", {
        student_name: payload.name,
        student_class: payload.className,
        student_year: Number(payload.year),
        registration_code: payload.code
      }), "Create student profile");
    } catch (error) {
      await db.auth.signOut().catch(() => {});
      session = null;
      if (/verification|code|expired|class/i.test(error?.message || "")) {
        const invalidCode = new Error("The verification code is incorrect or expired, or the selected class is unavailable.");
        invalidCode.code = "INVALID_REGISTRATION_CODE";
        throw invalidCode;
      }
      throw error;
    }
    const profile = normalizeProfile(await getProfile(userId));
    if (!profile || profile.role !== "student") {
      await db.auth.signOut().catch(() => {});
      session = null;
      throw new Error("The student profile could not be created. Ask the teacher to check the Supabase registration setup.");
    }
    return profile;
  }

  async function registerStudent(payload) {
    const configuredApi = Boolean(String(config.cloudApiEndpoint || "").trim());
    const staticHost = location.hostname.endsWith("github.io") || globalThis.Capacitor?.isNativePlatform?.();
    if (!configuredApi && staticHost) return registerStudentDirect(payload);
    try {
      const data = await apiRequest("/api/student-register", { method: "POST", body: payload, authenticated: false });
      unwrap(await requireClient().auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token
      }), "Start student session");
      session = (await getSession());
      return normalizeProfile(data.profile);
    } catch (error) {
      if ([404, 405].includes(Number(error?.status))) return registerStudentDirect(payload);
      throw error;
    }
  }

  async function repairStudentProfiles() {
    return apiRequest("/api/student-account");
  }

  function mapMaterial(row) {
    const category = ["高一", "高二", "高三", "初中"].includes(row.topic) ? row.topic : "高一";
    const storedSubject = ["高中资讯科技", "初中电脑与资讯工艺"].includes(row.topic_en) ? row.topic_en : "";
    const subject = storedSubject || (category === "初中" ? "初中电脑与资讯工艺" : "高中资讯科技");
    return {
      id: row.id,
      year: String(row.year || new Date(row.created_at || Date.now()).getFullYear()),
      title: row.title || "未命名学习资料",
      titleEn: row.title_en || row.title || "Untitled Material",
      mainCategory: category,
      subject,
      topic: category,
      topicEn: row.topic_en || category,
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
      db.from("submissions").select("*"),
      db.from("student_answers").select("id,submission_id,question_id,is_correct,created_at")
    ]);
    const [profiles, classes, materials, questions, notes, assignments, links, submissions, studentAnswers] = results.map((result, index) => unwrap(result, ["profiles", "classes", "materials", "questions", "notes", "assignments", "assignment questions", "submissions", "student answers"][index]));
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
    const answeredCounts = (studentAnswers || []).reduce((counts, item) => {
      if (item.submission_id) counts.set(item.submission_id, (counts.get(item.submission_id) || 0) + 1);
      return counts;
    }, new Map());
    const mappedSubmissions = (submissions || []).map((item) => ({
      id: item.id,
      assignmentId: item.assignment_id,
      studentId: item.student_id,
      score: Number(item.score) || 0,
      totalQuestions: Number(item.total_questions) || 0,
      answeredQuestions: item.status === "in_progress"
        ? Math.min(Number(item.total_questions) || 0, Number(item.score) || 0)
        : answeredCounts.get(item.id) || Number(item.total_questions) || 0,
      status: item.status || "completed",
      startedAt: item.started_at || item.created_at || "",
      submittedAt: item.submitted_at || "",
      createdAt: item.created_at || "",
      updatedAt: item.updated_at || item.created_at || ""
    }));
    return {
      students: (profiles || []).filter((item) => item.role === "student").map(normalizeProfile),
      classes: (classes || []).map((item) => ({ id: item.id, name: item.class_name || item.name || "", year: item.year || "", active: item.active !== false })),
      papers: mappedMaterials,
      questions: mappedQuestions,
      notes: (notes || []).map((item) => ({ id: item.id, title: item.title || "", content: item.content || "", createdAt: item.created_at, updatedAt: item.updated_at || item.created_at })),
      assignments: (assignments || []).map((item) => mapAssignment(item, questionIdsByAssignment.get(item.id) || [], completed)),
      submissions: mappedSubmissions
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
      topic: paper.mainCategory || paper.topic || "高一",
      topic_en: paper.subject || "高中资讯科技",
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

  async function getQuestionImageUrl(path) {
    if (!path) return "";
    const signed = await requireClient().storage.from("learning-materials").createSignedUrl(path, 3600);
    if (signed.error) throw signed.error;
    return signed.data?.signedUrl || "";
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

  async function findLatestSubmission(assignmentId) {
    if (!session?.user?.id || !isUuid(assignmentId)) return null;
    const rows = unwrap(await requireClient().from("submissions")
      .select("id,status,started_at,created_at")
      .eq("assignment_id", assignmentId)
      .eq("student_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1), "Load submission") || [];
    return rows[0] || null;
  }

  async function saveSubmissionAnswers(submissionId, questions, answers) {
    const db = requireClient();
    const rows = questions.map((question, index) => ({ question, index, answer: answers[index] }))
      .filter(({ question, answer }) => isUuid(question.id) && answer !== null && answer !== undefined && String(answer).trim() !== "")
      .map(({ question, answer }) => {
        return {
          submission_id: submissionId,
          question_id: question.id,
          student_answer: JSON.stringify(answer),
          is_correct: isCorrectAnswer(question, answer)
        };
      });
    if (rows.length) unwrap(await db.from("student_answers").insert(rows), "Save student answers");
  }

  async function saveQuizProgress(assignment, questions, answers, { startedAt = "" } = {}) {
    if (!session?.user?.id || !isUuid(assignment?.id) || !Array.isArray(questions) || !questions.length) return;
    const now = new Date().toISOString();
    const existing = await findLatestSubmission(assignment.id);
    const answeredCount = answers.filter((answer) => answer !== null && answer !== undefined && String(answer).trim() !== "").length;
    const payload = {
      assignment_id: assignment.id,
      student_id: session.user.id,
      // While a submission is in progress, score stores the number answered.
      // The final correct score replaces it when the student finishes.
      score: answeredCount,
      total_questions: questions.length,
      status: "in_progress",
      started_at: startedAt || existing?.started_at || now,
      updated_at: now
    };
    const submission = existing
      ? unwrap(await requireClient().from("submissions").update(payload).eq("id", existing.id).select("id").single(), "Update quiz progress")
      : unwrap(await requireClient().from("submissions").insert(payload).select("id").single(), "Save quiz progress");
  }

  async function saveSubmission(assignment, questions, answers, { startedAt = "", completedAt = "" } = {}) {
    if (!session?.user?.id || !isUuid(assignment?.id)) return;
    const now = new Date().toISOString();
    const existing = await findLatestSubmission(assignment.id);
    const score = questions.reduce((total, question, index) => total + (isCorrectAnswer(question, answers[index]) ? 1 : 0), 0);
    const payload = {
      assignment_id: assignment.id,
      student_id: session.user.id,
      score,
      total_questions: questions.length,
      status: "completed",
      submitted_at: completedAt || now,
      started_at: startedAt || existing?.started_at || now,
      updated_at: now
    };
    const submission = existing
      ? unwrap(await requireClient().from("submissions").update(payload).eq("id", existing.id).select("id").single(), "Update submission")
      : unwrap(await requireClient().from("submissions").insert(payload).select("id").single(), "Save submission");
    if (existing?.status !== "completed") await saveSubmissionAnswers(submission.id, questions, answers);
  }

  function subscribeToProgress(callback) {
    if (!client) return () => {};
    if (progressChannel) {
      void client.removeChannel(progressChannel);
      progressChannel = null;
    }
    const channel = client.channel(`teacher-progress-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions" }, callback)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("Supabase realtime progress channel unavailable:", status);
      });
    progressChannel = channel;
    return () => {
      if (progressChannel === channel) {
        void client.removeChannel(channel);
        progressChannel = null;
      }
    };
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
        // The existing Supabase constraint stores AI messages as `ai`.
        // Keep the browser conversation role as `assistant`, but translate it
        // at the database boundary so chat sync works with existing projects.
        sender: item.role === "assistant" ? "ai" : "user",
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
    if (progressChannel) {
      await client?.removeChannel(progressChannel);
      progressChannel = null;
    }
    if (client) await client.auth.signOut();
    session = null;
  }

  globalThis.personalAICloud = Object.freeze({
    enabled,
    client,
    isUuid,
    newUuid,
    getSession,
    refreshSession,
    getProfile,
    normalizeProfile,
    signInTeacher,
    signInStudent,
    registerStudent,
    repairStudentProfiles,
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
    getQuestionImageUrl,
    deleteQuestionImage,
    deleteQuestion,
    deleteMaterial,
    deleteNote,
    saveQuizProgress,
    saveSubmission,
    subscribeToProgress,
    saveChatConversation,
    getRegistrationCode,
    checkSchema,
    updateOwnPassword
  });
})();
