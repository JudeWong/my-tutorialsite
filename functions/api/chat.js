const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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
  if (!message || message.length > 6000) {
    return json({ error: "Message must contain between 1 and 6000 characters." }, 400);
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const contents = history
    .filter((item) => item && typeof item.content === "string" && ["user", "assistant"].includes(item.role))
    .map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content.slice(0, 6000) }] }));
  if (!contents.length || contents.at(-1)?.role !== "user") {
    contents.push({ role: "user", parts: [{ text: message }] });
  }

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(body.mode, body.language) }] },
      contents,
      generationConfig: { temperature: body.mode === "creative" ? 0.9 : 0.55, maxOutputTokens: 1200 }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Gemini API error", response.status, data?.error?.message || "Unknown error");
    return json({ error: "The AI service is temporarily unavailable." }, 502);
  }

  const reply = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!reply) return json({ error: "The AI service returned an empty response." }, 502);
  return json({ reply, provider: "gemini", model });
}

export function onRequestGet({ env }) {
  return json({ ready: Boolean(env.GEMINI_API_KEY), provider: "gemini" });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}
