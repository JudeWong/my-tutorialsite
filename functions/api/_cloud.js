const DEFAULT_SUPABASE_URL = "https://hwnqqwnqfivykwrmcnml.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_1BpJAI1lQu9099mENDRT1Q_L2iCTOpK";

export function cloudConfig(env) {
  return {
    url: String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ""),
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY),
    secretKey: String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "")
  };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return "*";
  const requestOrigin = new URL(request.url).origin;
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const defaults = [requestOrigin, "https://judewong.github.io", "capacitor://localhost", "http://localhost", "http://127.0.0.1:8000"];
  return [...configured, ...defaults].includes(origin) ? origin : "null";
}

export function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) }
  });
}

export function options(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export async function supabaseFetch(env, path, { method = "GET", body, prefer = "", usePublishable = false, bearer = "" } = {}) {
  const config = cloudConfig(env);
  const key = usePublishable ? config.publishableKey : config.secretKey;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured in Cloudflare Pages.");
  const headers = {
    apikey: key,
    "Content-Type": "application/json"
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  // New sb_secret_ keys are opaque API keys, not JWTs. Legacy service_role
  // keys still need the Bearer header for backward compatibility.
  else if (!usePublishable && !key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error_description || data?.error || `Supabase request failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function requireTeacher(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    const error = new Error("Teacher authentication is required.");
    error.status = 401;
    throw error;
  }
  const user = await supabaseFetch(env, "/auth/v1/user", { usePublishable: true, bearer: accessToken });
  const profiles = await supabaseFetch(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`);
  const profile = profiles?.[0];
  if (!profile || profile.role !== "teacher" || profile.status === "disabled") {
    const error = new Error("Teacher access is required.");
    error.status = 403;
    throw error;
  }
  return { user, profile };
}

export function publicError(request, env, error, fallback = "Cloud request failed.") {
  console.error(fallback, error?.message || error);
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? fallback : error?.message || fallback;
  return json(request, env, { error: message }, status);
}
