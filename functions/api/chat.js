const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const QUESTION_RESPONSE_SCHEMA = {
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
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function systemPrompt(mode, language) {
  const style = mode === "study"
    ? "Teach step by step, ask useful follow-up questions, and help the learner reason instead of merely giving an answer."
    : mode === "creative"
      ? "Offer original ideas, useful alternatives, and polished drafts when requested."
      : "Be a capable general-purpose assistant for learning, writing, planning, coding, and everyday questions.";
  return `You are the Personal AI Assistant for secondary-school students. ${style} Answer in ${language === "zh" ? "Simplified Chinese" : "English"} unless the user asks for another language. Be clear, age-appropriate, and honest about uncertainty. Never claim to have performed an action you did not perform.`;
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
  const messageLimit = body.task === "question-generation" ? 18000 : 6000;
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      model,
      input: body.task === "question-generation" ? message : conversation.join("\n\n"),
      system_instruction: systemPrompt(body.mode, body.language),
      store: false,
      generation_config: {
        temperature: body.task === "question-generation" ? 0.3 : body.mode === "creative" ? 0.9 : 0.55,
        max_output_tokens: body.task === "question-generation" ? 6000 : 1200,
        thinking_level: body.task === "question-generation" ? "medium" : "low"
      },
      ...(body.task === "question-generation" ? {
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: QUESTION_RESPONSE_SCHEMA
        }
      } : {})
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Gemini API error", response.status, data?.error?.message || "Unknown error");
    return json({ error: "The AI service is temporarily unavailable." }, 502);
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
  return json({ reply, provider: "gemini", model });
}

export function onRequestGet({ env }) {
  return json({ ready: Boolean(env.GEMINI_API_KEY), provider: "gemini" });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
