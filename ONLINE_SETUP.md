# 免费上线与 APK 设置

## 推荐：Cloudflare Pages（包含真正的生成式 AI）

1. 把此项目推送到一个 GitHub 仓库。
2. 在 Cloudflare Dashboard 选择 **Workers & Pages → Create → Pages → Connect to Git**。
3. 选择仓库，并设置：
   - Build command：`pnpm run prepare:web`
   - Build output directory：`web`
4. 部署完成后，到项目的 **Settings → Variables and Secrets** 新增加密变量：
   - `GEMINI_API_KEY`：Google AI Studio 产生的 API key
   - `GEMINI_MODEL`：可选；未设置时使用 `gemini-3.8-flash`
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
