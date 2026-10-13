// The public website and APK use the Cloudflare Worker as their shared API.
// Gemini and Supabase secret keys remain server-side Cloudflare secrets.
window.PERSONAL_AI_CONFIG = Object.freeze({
  cloudEnabled: true,
  aiEndpoint: "https://my-tutorialsite.judewong95.workers.dev/api/chat",
  generationEndpoint: "https://my-tutorialsite.judewong95.workers.dev/api/chat",
  cloudApiEndpoint: "https://my-tutorialsite.judewong95.workers.dev",
  supabaseUrl: "https://hwnqqwnqfivykwrmcnml.supabase.co",
  supabasePublishableKey: "sb_publishable_1BpJAI1lQu9099mENDRT1Q_L2iCTOpK"
});
