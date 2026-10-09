const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function questionResponseSchema(body) {
  const isTeachingMaterial = body.materialType === "teaching-material";
  const requestedCount = Math.max(10, Math.min(50, Number(body.questionCount) || 10));
  const schema = {
    type: "array",
    minItems: isTeachingMaterial ? requestedCount : 1,
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
  };
  if (isTeachingMaterial) schema.maxItems = requestedCount;
  return schema;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function systemPrompt(mode, language, task) {
  if (task === "question-generation") {
    return "Produce accurate, source-grounded UEC computer science assessment questions. Every user-visible natural-language question, option, explanation, and common mistake must be in Simplified Chinese. English is allowed only for source code, identifiers, abbreviations, and unavoidable standard computing terms. Return JSON only.";
  }
  const style = mode === "study"
    ? "Teach step by step, ask useful follow-up questions, and help the learner reason instead of merely giving an answer."
    : mode === "creative"
      ? "Offer original ideas, useful alternatives, and polished drafts when requested."
      : "Be a capable general-purpose assistant for learning, writing, planning, coding, and everyday questions.";
  return `You are the Personal AI Assistant for secondary-school students. ${style} Answer in ${language === "zh" ? "Simplified Chinese" : "English"} unless the user asks for another language. Be clear, age-appropriate, and honest about uncertainty. Never claim to have performed an action you did not perform.`;
}

function isTransientGeminiError(status, message = "") {
  return status >= 500
    || status === 408
    || status === 429
    || /high demand|temporar|overload|unavailable|try again|deadline|timeout/i.test(message);
}

function waitForRetry(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: "AI is not configured. Add the GEMINI_API_KEY secret in Cloudflare Pages." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const messageLimit = body.task === "question-generation" ? 520000 : 6000;
  if (!message || message.length > messageLimit) {
    return json({ error: `Message must contain between 1 and ${messageLimit} characters.` }, 400);
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const conversation = history
    .filter((item) => item && typeof item.content === "string" && ["user", "assistant"].includes(item.role))
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content.slice(0, messageLimit)}`);
  if (!conversation.length || history.at(-1)?.role !== "user") conversation.push(`User: ${message}`);

  const configuredModel = String(env.GEMINI_MODEL || "").trim().replace(/^models\//i, "");
  const model = !configuredModel || configuredModel === "gemini-2.5-flash" ? "gemini-3.8-flash" : configuredModel;
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const fallbackModels = ["gemini-3.7-flash", "gemini-3.1-flash-lite"].filter((item) => item !== model);
  const attemptModels = [model, model, ...fallbackModels];
  let response;
  let data = {};
  let usedModel = model;
  for (let attempt = 0; attempt < attemptModels.length; attempt += 1) {
    usedModel = attemptModels[attempt];
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          model: usedModel,
          input: body.task === "question-generation" ? message : conversation.join("\n\n"),
          system_instruction: systemPrompt(body.mode, body.language, body.task),
          store: false,
          generation_config: {
            temperature: body.task === "question-generation" ? 0.3 : body.mode === "creative" ? 0.9 : 0.55,
            max_output_tokens: body.task === "question-generation"
              ? body.materialType === "past-paper" ? 32768 : Math.min(24000, Math.max(10000, (Number(body.questionCount) || 10) * 700))
              : 1200,
            thinking_level: body.task === "question-generation" ? "medium" : "low"
          },
          ...(body.task === "question-generation" ? {
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: questionResponseSchema(body)
            }
          } : {})
        })
      });
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
    if (isTransientGeminiError(response.status, providerMessage) && attempt < attemptModels.length - 1) {
      await waitForRetry(700 * (2 ** attempt));
      continue;
    }
    if (isTransientGeminiError(response.status, providerMessage)) {
      return json({ error: "Gemini is temporarily busy. Automatic retries and backup models were unsuccessful. Please try again shortly." }, 503);
    }
    return json({ error: "The AI service rejected the request. Check the configured API key and model." }, 502);
  }

  const interaction = data?.interaction || data;
  if (interaction?.status && interaction.status !== "completed") {
    return json({ error: "The AI service did not complete the request." }, 502);
  }
  const reply = interaction?.steps
    ?.filter((step) => step?.type === "model_output")
    .flatMap((step) => Array.isArray(step.content) ? step.content : [])
    .filter((content) => content?.type === "text")
    .map((content) => content.text || "")
    .join("\n")
    .trim() || interaction?.output_text?.trim();
  if (!reply) return json({ error: "The AI service returned an empty response." }, 502);
  return json({ reply, provider: "gemini", model: usedModel, fallback: usedModel !== model });
}

export function onRequestGet({ env }) {
  return json({ ready: Boolean(env.GEMINI_API_KEY), provider: "gemini" });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
