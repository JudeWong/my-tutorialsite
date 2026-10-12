import { json, options, publicError, requireTeacher, supabaseFetch } from "./_cloud.js";

function endOfCurrentHour() {
  const date = new Date();
  date.setUTCMinutes(60, 0, 0);
  return date.toISOString();
}

function randomSixDigitCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

export async function onRequestGet({ request, env }) {
  try {
    const { user } = await requireTeacher(request, env);
    const now = new Date().toISOString();
    let rows = await supabaseFetch(env, `/rest/v1/registration_codes?expires_at=gt.${encodeURIComponent(now)}&select=id,code,expires_at&order=expires_at.desc&limit=1`);
    if (!rows?.length) {
      rows = await supabaseFetch(env, "/rest/v1/registration_codes", {
        method: "POST",
        prefer: "return=representation",
        body: { code: randomSixDigitCode(), expires_at: endOfCurrentHour(), created_by: user.id }
      });
    }
    return json(request, env, { code: rows[0].code, expiresAt: rows[0].expires_at });
  } catch (error) {
    return publicError(request, env, error, "The registration code is temporarily unavailable.");
  }
}

export function onRequestOptions({ request, env }) {
  return options(request, env);
}
