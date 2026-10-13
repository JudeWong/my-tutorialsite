# 免费上线与 APK 设置

## Supabase 云端资料（目前的正式迁移流程）

项目已内建 Supabase Auth、Postgres、Storage 和 Cloudflare API 连接层。为了避免半完成配置影响现有网站，`config.js` 的 `cloudEnabled` 会在数据库与服务器密钥完成前保持 `false`。

1. 在 Supabase Dashboard 打开 **SQL Editor**。
2. 完整执行 [`supabase/cloud_schema.sql`](supabase/cloud_schema.sql)。这个升级会保留现有资料、加入网站需要的栏位、建立私人 `learning-materials` bucket，并以安全的 RLS 规则取代原型规则。
3. 在 Cloudflare Workers 的 **Settings → Variables and Secrets** 新增以下加密变量：
   - `SUPABASE_SECRET_KEY`：Supabase 的 Secret key；也可暂时使用旧版 `service_role` key。绝对不能写进前端或 GitHub。
   - `GEMINI_API_KEY`：Gemini API key。
   - `GEMINI_MODEL`：可选，只填写该 Gemini 账号目前可用的模型。
   - `ALLOWED_ORIGINS`：建议填写正式网站与 APK 会使用的来源，以逗号分隔。
4. Cloudflare Worker 的普通环境变量可选填写：
   - `SUPABASE_URL=https://hwnqqwnqfivykwrmcnml.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY=sb_publishable_1BpJAI1lQu9099mENDRT1Q_L2iCTOpK`
5. 目前 `config.js` 已连接 `https://my-tutorialsite.judewong95.workers.dev`。部署成功后，GitHub Pages、Cloudflare 网站与 APK 都会共用这个后端。
6. 重新部署网站并构建 APK。老师第一次云端登入时，系统会在云端尚无学习资料的情况下，把这台装置现有的试卷、题目、作业、笔记和班级迁移到 Supabase。旧的本机学生密码不会上传；学生需要使用云端注册流程重新建立安全账号。

前端只能使用 Publishable key。`SUPABASE_SECRET_KEY` 和 `GEMINI_API_KEY` 必须只存在于 Cloudflare Secret。
新版 `sb_secret_...` key 会作为 `apikey` 发送；旧版 `service_role` JWT 仍受兼容支持。请优先使用 Supabase 建议的新版 Secret key。

`cloud_schema.sql` 也包含 GitHub Pages 所需的学生注册触发器。执行最新版后，学生注册会直接通过 Supabase Auth 验证老师的一小时验证码、检查班级并建立学生资料，不再向 GitHub Pages 的 `/api/student-register` 发送 POST 请求，因此不会再出现 405。已经执行过旧版 SQL 的项目，需要重新完整执行最新版一次；这项升级不会清除现有资料。

## 推荐：Cloudflare Workers（包含真正的生成式 AI）

1. 把此项目推送到一个 GitHub 仓库。
2. 在 Cloudflare Dashboard 选择 **Workers & Pages → Create → Import a repository**。
3. 选择仓库，并设置：
   - Build command：`pnpm run prepare:web`
   - Deploy command：`npx wrangler deploy`
4. 部署完成后，到 Worker 的 **Settings → Variables and Secrets** 新增加密变量：
   - `GEMINI_API_KEY`：Google AI Studio 产生的 API key
   - `GEMINI_MODEL`：可选；未设置时使用 `gemini-3.8-flash`，如果该模型暂时不可用，系统会依序尝试目前仍受支持的 Gemini 3.x Flash 模型，不再回退至新账号不可用的 `gemini-2.5-flash`
5. 重新部署。网页会通过 `/api/chat` 使用 `functions/api/chat.js`，密钥不会传到浏览器。

Cloudflare Pages 和 Gemini 的免费额度均有限，学校大量使用前应查看当时的额度、加入身份验证与速率限制。

## GitHub Pages（纯静态免费版）

项目已包含 `.github/workflows/deploy-pages.yml`。把代码推送到 `main` 后，在 GitHub 仓库的 **Settings → Pages** 将 Source 设为 **GitHub Actions**。GitHub Pages 不能运行 Gemini serverless 接口，因此老师必须在老师端点击 **Gemini AI 设置**，填入自己的 Google AI Studio API Key。密钥只保存在该装置的浏览器 `localStorage`，不会写入 GitHub 仓库。未连接 Gemini 时，系统不会以本机规则冒充 AI 生成题目。

## 让 APK 连接线上 AI

推荐取得 Cloudflare Pages 地址后，把 [config.js](config.js) 中的 `aiEndpoint` 改成完整地址，例如：

```js
window.PERSONAL_AI_CONFIG = Object.freeze({
  aiEndpoint: "https://your-project.pages.dev/api/chat",
  generationEndpoint: "https://your-project.pages.dev/api/chat"
});
```

然后重新运行 `pnpm run android:build`，并把新的 `android/app/build/outputs/apk/debug/app-debug.apk` 分发给学生。不要把 Gemini API key 放进这个文件。若没有 Cloudflare 后端，也可以在 APK 的老师端 **Gemini AI 设置** 中输入密钥。

## APK 类型

`downloads/Personal-AI-Assistant.apk` 是 debug-signed 测试 APK，可免费侧载安装。若要发布 Google Play，必须另建 release keystore、生成 release-signed AAB，并拥有 Google Play 开发者账号。

## 正式学校系统仍需的后端

当前账号、班级、题库清单和作答进度使用每台装置各自的 `localStorage`。若要老师上传一次后所有学生都能看到，需再接入 Supabase、Firebase 或自建后端，并迁移以下资料：

- 老师与学生身份验证
- 班级、验证码与学生名册
- PDF／图片文件储存及题目资料
- 作业、答案、进度与报告
- 权限控制、备份与审计记录
