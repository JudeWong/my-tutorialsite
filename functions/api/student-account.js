import { json, options, publicError, readJson, requireTeacher, supabaseFetch } from "./_cloud.js";

export async function onRequestPatch({ request, env }) {
  try {
    await requireTeacher(request, env);
    const body = await readJson(request);
    const id = String(body?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, env, { error: "Invalid student account." }, 400);
    if (body.password) {
      if (String(body.password).length < 4) return json(request, env, { error: "The new password must contain at least four characters." }, 400);
      await supabaseFetch(env, `/auth/v1/admin/users/${id}`, { method: "PUT", body: { password: String(body.password) } });
    }
    return json(request, env, { updated: true });
  } catch (error) {
    return publicError(request, env, error, "The student account could not be updated.");
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    await requireTeacher(request, env);
    const body = await readJson(request);
    const id = String(body?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, env, { error: "Invalid student account." }, 400);
    await supabaseFetch(env, `/auth/v1/admin/users/${id}`, { method: "DELETE" });
    return json(request, env, { deleted: true });
  } catch (error) {
    return publicError(request, env, error, "The student account could not be deleted.");
  }
}

export function onRequestOptions({ request, env }) {
  return options(request, env);
}
