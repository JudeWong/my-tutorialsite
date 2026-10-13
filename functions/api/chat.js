import { cloudConfig } from "./_cloud.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function questionResponseSchema(body) {
  const schema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          required: ["question", "code", "options", "correct", "level", "explanation", "mistake"],
          properties: {
            question: { type: "string" },
            code: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            correct: { type: "integer" },
            level: { type: "string", enum: ["Basic", "Intermediate", "Advanced"] },
            explanation: { type: "string" },
            mistake: { type: "string" }
          }
        }
      }
    },
    required: ["questions"]
  };
  return schema;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function systemPrompt(mode, language, task, materialType, questionCount) {
  if (task === "question-generation") {
    const taskInstruction = materialType === "teaching-material"
      ? `For teaching material, create exactly ${Math.max(10, Math.min(50, Number(questionCount) || 10))} distinct questions.`
      : "For a past-year paper, return at least 40 items by including every top-level question and separately numbered sub-question or part; never return only a short sample.";
    return `Produce accurate, source-grounded UEC computer science assessment questions. ${taskInstruction} Every user-visible natural-language question, option, explanation, and common mistake must be in Simplified Chinese. Numeric or symbolic options such as 0, 16, 3.14, 1010, -1, and 50% are valid as written and must not be padded with unnecessary Chinese words. Inspect every supplied page image so visual questions are recognized and never skipped, but do not attach or return images with generated questions; the teacher will add required question images manually. Preserve combination choices and Roman-numeral choices such as I, II, III, IV, V, ①, and ② exactly; do not skip a question because an option uses these symbols. English is allowed only for source code, identifiers, abbreviations, and unavoidable standard computing terms. Return JSON only.`;
  }
  const style = mode === "study"
    ? "Teach step by step, check the learner's reasoning, use concrete examples, and include a useful practice prompt when appropriate."
    : mode === "creative"
      ? "Generate polished, original ideas and drafts, offering useful alternatives when that improves the result."
      : "Act as a capable general-purpose conversational assistant comparable to a modern generative AI. Answer the user's actual question directly and thoroughly.";
  return `You are the Personal AI Assistant for secondary-school students and teachers. ${style}
You are not limited to uploaded school material. Help across computing, mathematics, science, languages, writing, planning, coding, current concepts, and everyday knowledge.
Answer in ${language === "zh" ? "Simplified Chinese" : "English"} unless the user asks for another language. Preserve important English technical terms when useful.
For calculations and code, reason carefully and verify the result. Do not give a generic topic overview when the user asked a specific question. If a request is ambiguous, state a useful assumption or ask one concise clarification question.
Be clear, age-appropriate, and honest about uncertainty. Never claim to have browsed, verified live information, or performed an action you did not perform.`;
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

function waitForRetry(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Gemini request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function generateContentSchema(value) {
  if (Array.isArray(value)) return value.map(generateContentSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === "type" && typeof item === "string" ? item.toUpperCase() : generateContentSchema(item)
  ]));
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: "AI is not configured. Add the GEMINI_API_KEY secret in Cloudflare Pages." }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json({ error: "Sign in before using the AI service." }, 401);
  const supabase = cloudConfig(env);
  const authResponse = await fetch(`${supabase.url}/auth/v1/user`, {
    headers: { apikey: supabase.publishableKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!authResponse.ok) return json({ error: "Your cloud session is invalid or expired. Sign in again." }, 401);
  const authUser = await authResponse.json().catch(() => ({}));
  const profileResponse = await fetch(`${supabase.url}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id || "")}&select=status&limit=1`, {
    headers: { apikey: supabase.publishableKey, Authorization: `Bearer ${accessToken}` }
  });
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok || profiles[0]?.status === "disabled") {
    return json({ error: "This cloud account is disabled or unavailable." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const messageLimit = body.task === "question-generation" ? 600000 : 6000;
  if (!message || message.length > messageLimit) {
    return json({ error: `Message must contain between 1 and ${messageLimit} characters.` }, 400);
  }

  // Keep chat requests responsive even after a long conversation. Question
  // generation keeps its larger context separately.
  const isChat = body.task !== "question-generation";
  const history = Array.isArray(body.messages) ? body.messages.slice(isChat ? -8 : -12) : [];
  const conversation = history
    .filter((item) => item && typeof item.content === "string" && ["user", "assistant"].includes(item.role))
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content.slice(0, isChat ? 1800 : messageLimit)}`);
  if (!conversation.length || history.at(-1)?.role !== "user") conversation.push(`User: ${message}`);

  const configuredModel = String(env.GEMINI_MODEL || "").trim().replace(/^models\//i, "");
  // Use a dedicated fast model for general chat. GEMINI_CHAT_MODEL can be set
  // later without changing the higher-capacity question-generation model.
  const configuredChatModel = String(env.GEMINI_CHAT_MODEL || "").trim().replace(/^models\//i, "");
  const model = isChat
    ? (configuredChatModel || "gemini-3.5-flash-lite")
    : (!configuredModel || configuredModel === "gemini-2.5-flash" ? "gemini-3.8-flash" : configuredModel);
  const fallbackModels = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ].filter((item) => item !== model);
  const fastFallbackModels = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.7-flash"
  ].filter((item) => item !== model);
  const attemptModels = !isChat
    ? [model, model, ...fallbackModels]
    // Limit chat to one fast request and one fast fallback instead of a long
    // chain of retries that makes the interface look frozen.
    : [model, ...fastFallbackModels.slice(0, 1)];
  let response;
  let data = {};
  let usedModel = model;
  const visuals = [];
  let visualChars = 0;
  if (Array.isArray(body.visuals)) {
    for (const item of body.visuals.slice(0, 12)) {
      if (!item || typeof item.data !== "string" || item.data.length >= 2500000) continue;
      if (visualChars + item.data.length > 9000000) break;
      visuals.push(item);
      visualChars += item.data.length;
    }
  }
  const contents = body.task === "question-generation"
    ? [{
      role: "user",
      parts: [
        { text: message },
        ...visuals.flatMap((item, index) => [
          { text: `这是供辨识的第 ${Number(item.page) || index + 1} 页图像。` },
          { inlineData: { data: item.data, mimeType: item.mime_type || "image/jpeg" } }
        ])
      ]
    }]
    : [{ role: "user", parts: [{ text: conversation.join("\n\n") }] }];
  for (let attempt = 0; attempt < attemptModels.length; attempt += 1) {
    usedModel = attemptModels[attempt];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(usedModel)}:generateContent`;
    try {
      response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(body.mode, body.language, body.task, body.materialType, body.questionCount) }] },
          contents,
          generationConfig: {
            temperature: body.task === "question-generation" ? 0.3 : body.mode === "creative" ? 0.9 : 0.55,
            maxOutputTokens: body.task === "question-generation"
              ? body.materialType === "past-paper" ? 32768 : Math.min(20000, Math.max(8000, (Number(body.questionCount) || 10) * 600))
              : (body.mode === "creative" ? 3072 : 2048),
            ...(body.task === "question-generation" ? {
              responseMimeType: "application/json",
              responseSchema: generateContentSchema(questionResponseSchema(body))
            } : {})
          }
        })
      }, !isChat ? 60000 : 12000);
      data = await response.json().catch(() => ({}));
    } catch (error) {
      console.error("Gemini network error", error?.message || "Unknown error");
      if (attempt < attemptModels.length - 1) {
        await waitForRetry(700 * (2 ** attempt));
        continue;
      }
      return json({ error: "Gemini is temporarily busy. Automatic retries and backup models were unsuccessful. Please try again shortly." }, 503);
    }
    if (response.ok) break;
    const providerMessage = data?.error?.message || "Unknown error";
    console.error("Gemini API error", response.status, providerMessage, usedModel);
    const modelRejected = isGeminiModelError(response.status, providerMessage);
    if ((isTransientGeminiError(response.status, providerMessage) || modelRejected) && attempt < attemptModels.length - 1) {
      await waitForRetry(700 * (2 ** attempt));
      continue;
    }
    if (isTransientGeminiError(response.status, providerMessage)) {
      return json({ error: "Gemini is temporarily busy. Automatic retries and backup models were unsuccessful. Please try again shortly." }, 503);
    }
    const detail = String(providerMessage || "").replace(/AIza[\w-]+/gi, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 360);
    return json({ error: detail ? `The AI service rejected the request: ${detail}` : "The AI service rejected the request. Check the configured API key and model." }, 502);
  }

  const reply = data?.candidates
    ?.flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("\n")
    .trim();
  if (!reply) return json({ error: "The AI service returned an empty response." }, 502);
  return json({ reply, provider: "gemini", model: usedModel, fallback: usedModel !== model });
}

export function onRequestGet({ env }) {
  return json({ ready: Boolean(env.GEMINI_API_KEY), provider: "gemini" });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
