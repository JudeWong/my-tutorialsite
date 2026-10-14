import { cloudConfig, json, listAuthUsers, options, publicError, readJson, supabaseFetch } from "./_cloud.js";

function isChineseName(value) {
  return /^[\u3400-\u9fff·]{2,12}$/u.test(String(value || "").trim());
}

async function studentEmail(name, className, year) {
  const normalized = [name, className, year].map((value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase()).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `student+${hash.slice(0, 32)}@chms3.edu.my`;
}

async function signInStudent(env, email, password) {
  const config = cloudConfig(env);
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(session.error_description || session.msg || "Student sign-in failed."), { status: response.status });
  return session;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);
    const name = String(body?.name || "").trim();
    const className = String(body?.className || "").trim();
    const year = Number(body?.year);
    const password = String(body?.password || "");
    const code = String(body?.code || "").trim();
    if (!isChineseName(name) || className.length < 2 || !Number.isInteger(year) || !/^\d{6}$/.test(code)) {
      return json(request, env, { error: "Registration details are incomplete or invalid." }, 400);
    }
    if (password.length < 6) {
      return json(request, env, { error: "The password must contain at least 6 characters.", code: "WEAK_PASSWORD" }, 400);
    }

    const classes = await supabaseFetch(env, `/rest/v1/classes?class_name=eq.${encodeURIComponent(className)}&active=eq.true&select=id,class_name&limit=1`);
    if (!classes?.length) return json(request, env, { error: "This class is not available for registration." }, 400);

    const now = new Date().toISOString();
    const codes = await supabaseFetch(env, `/rest/v1/registration_codes?code=eq.${encodeURIComponent(code)}&expires_at=gt.${encodeURIComponent(now)}&select=id&limit=1`);
    if (!codes?.length) return json(request, env, { error: "The verification code is incorrect or expired." }, 400);

    const email = await studentEmail(name, className, year);
    let authUser;
    let restoredMissingProfile = false;
    try {
      authUser = await supabaseFetch(env, "/auth/v1/admin/users", {
        method: "POST",
        body: { email, password, email_confirm: true, user_metadata: { full_name: name, class_name: className, year, role: "student", registration_code: code } }
      });
    } catch (error) {
      const authCode = String(error?.data?.code || error?.data?.error_code || "").toLowerCase();
      const duplicateAccount = ["email_exists", "user_already_exists"].includes(authCode)
        || /already (?:been )?registered|already exists|user.*exists/i.test(error?.message || "");
      if (duplicateAccount) {
        const existingUser = (await listAuthUsers(env)).find((user) => String(user?.email || "").toLowerCase() === email.toLowerCase());
        if (!existingUser?.id) {
          return json(request, env, { error: "This student account already exists. Use Existing Account to sign in.", code: "STUDENT_ALREADY_EXISTS" }, 409);
        }
        const existingProfiles = await supabaseFetch(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(existingUser.id)}&select=id&limit=1`);
        if (existingProfiles?.length) {
          return json(request, env, { error: "This student account already exists. Use Existing Account to sign in.", code: "STUDENT_ALREADY_EXISTS" }, 409);
        }
        authUser = existingUser;
        restoredMissingProfile = true;
      } else {
        throw error;
      }
    }

    try {
      await supabaseFetch(env, "/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: {
          id: authUser.id,
          full_name: name,
          role: "student",
          class_id: classes[0].id,
          class_name: className,
          year,
          status: "active"
        }
      });
    } catch (error) {
      if (!restoredMissingProfile) {
        await supabaseFetch(env, `/auth/v1/admin/users/${authUser.id}`, { method: "DELETE" }).catch(() => {});
      }
      throw error;
    }

    let session;
    try {
      session = await signInStudent(env, email, password);
    } catch (error) {
      if (restoredMissingProfile) {
        return json(request, env, {
          error: "The missing student record was restored. Ask the teacher to reset the password in Student Management, then use Existing Account to sign in.",
          code: "STUDENT_PROFILE_RESTORED"
        }, 409);
      }
      throw Object.assign(new Error("Student account was created but sign-in failed."), { status: 502, cause: error });
    }
    return json(request, env, {
      session: { access_token: session.access_token, refresh_token: session.refresh_token },
      profile: { id: authUser.id, full_name: name, role: "student", class_id: classes[0].id, class_name: className, year, status: "active" }
    }, 201);
  } catch (error) {
    return publicError(request, env, error, "Student registration could not be completed.");
  }
}

export function onRequestOptions({ request, env }) {
  return options(request, env);
}
