import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const web = join(project, "web");
const files = ["index.html", "styles.css", "config.js", "cloud.js", "app.js", "arena.js", "arena-scene.js", "battle-engine.js", "manifest.webmanifest", "sw.js"];
const includeDownloads = !process.argv.includes("--android");
const supabaseBundle = join(project, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");

await rm(web, { recursive: true, force: true });
await mkdir(web, { recursive: true });
for (const file of files) await cp(join(project, file), join(web, file));
await mkdir(join(web, "assets", "icons"), { recursive: true });
await cp(join(project, "assets", "icons"), join(web, "assets", "icons"), { recursive: true });
await mkdir(join(web, "assets", "models"), { recursive: true });
await cp(join(project, "assets", "models"), join(web, "assets", "models"), { recursive: true });
await mkdir(join(web, "assets", "vendor"), { recursive: true });
await cp(supabaseBundle, join(web, "assets", "vendor", "supabase.js"));
if (includeDownloads) await cp(join(project, "downloads"), join(web, "downloads"), { recursive: true });
console.log(`Copied ${files.length} web files, Supabase client, and public icons${includeDownloads ? ", including downloads" : ", excluding downloads for Android"} to ${web}`);
