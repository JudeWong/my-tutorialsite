import * as chat from "./functions/api/chat.js";
import * as registrationCode from "./functions/api/registration-code.js";
import * as studentAccount from "./functions/api/student-account.js";
import * as studentRegister from "./functions/api/student-register.js";

const API_ROUTES = new Map([
  ["/api/chat", chat],
  ["/api/registration-code", registrationCode],
  ["/api/student-account", studentAccount],
  ["/api/student-register", studentRegister]
]);

const HANDLER_BY_METHOD = Object.freeze({
  GET: "onRequestGet",
  POST: "onRequestPost",
  PATCH: "onRequestPatch",
  DELETE: "onRequestDelete",
  OPTIONS: "onRequestOptions"
});

function apiResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      ...extraHeaders
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = API_ROUTES.get(url.pathname.replace(/\/$/, ""));
    if (route) {
      const handlerName = HANDLER_BY_METHOD[request.method];
      const handler = handlerName && route[handlerName];
      if (!handler) return apiResponse({ error: "Method not allowed." }, 405);
      try {
        return await handler({ request, env, ctx });
      } catch (error) {
        console.error("Unhandled API error", error?.message || error);
        return apiResponse({ error: "The cloud service is temporarily unavailable." }, 500);
      }
    }

    if (url.pathname.startsWith("/api/")) return apiResponse({ error: "API route not found." }, 404);
    return env.ASSETS.fetch(request);
  }
};
