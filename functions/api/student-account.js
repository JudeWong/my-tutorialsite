import { json, listAuthUsers, options, publicError, readJson, requireTeacher, supabaseFetch } from "./_cloud.js";

function studentProfileFromAuth(user, classesByName) {
  const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
  const name = String(metadata.full_name || "").trim();
  const className = String(metadata.class_name || "").trim();
  const year = Number(metadata.year);
  if (metadata.role !== "student" || !/^[\u3400-\u9fff·]{2,12}$/u.test(name) || className.length < 2 || !Number.isInteger(year)) return null;
  return {
    id: user.id,
    full_name: name,
    role: "student",
    class_id: classesByName.get(className)?.id || null,
    class_name: className,
    year,
    status: "active"
  };
}

export async function onRequestGet({ request, env }) {
  try {
    await requireTeacher(request, env);
    const [authUsers, profiles, classes] = await Promise.all([
      listAuthUsers(env),
      supabaseFetch(env, "/rest/v1/profiles?select=id"),
      supabaseFetch(env, "/rest/v1/classes?select=id,class_name")
    ]);
    const profileIds = new Set((profiles || []).map((profile) => profile.id));
    const classesByName = new Map((classes || []).map((item) => [String(item.class_name || "").trim(), item]));
    const missingProfiles = authUsers
      .filter((user) => user?.id && !profileIds.has(user.id))
      .map((user) => studentProfileFromAuth(user, classesByName))
      .filter(Boolean);

    if (missingProfiles.length) {
      await supabaseFetch(env, "/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: missingProfiles
      });
    }
    return json(request, env, { repaired: missingProfiles.length });
  } catch (error) {
    return publicError(request, env, error, "Student account records could not be repaired.");
  }
}

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
