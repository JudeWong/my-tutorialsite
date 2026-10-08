# Your Personal AI Assistant

面向独中电脑科老师与学生的响应式互动学习平台。网页预设为 English，可随时切换中文；老师端与学生端均使用明亮工作区，首页保留科技感动画。

## 已实现

- 英文预设、中英即时切换、Arial 英文字体与楷体中文字体
- Superadmin 老师登入、修改密码、班级管理、每小时注册验证码
- 学生以中文姓名、老师建立的班级、年份及验证码注册／登入
- 上传试卷、讲义、图片、Word、PowerPoint 或文字档，显示整理进度并自动建立互动题目
- 老师可查看并逐题修改 AI 生成的题干、选项、答案、解析与常见错误
- 老师与学生登入状态保留，刷新页面不会自动登出
- 学习资料筛选、练习建立、班级进度与 CSV 报告
- 互动题目、即时批改、解释与常见错误
- 类 ChatGPT／Gemini 的连续 AI 对话；通过 Gemini 3.8 Flash 与 Interactions API 理解上传资料并生成题目，不以本机规则拼接假题目
- 可安装 PWA、桌面／平板／手机响应式界面
- Capacitor Android 工程及可直接测试的 APK

## 本机预览

```powershell
pnpm install
pnpm run serve
```

打开 `http://127.0.0.1:8000/`。

老师账号：`wsl@chms3.edu.my`  
初始密码：`0000`

## Android

现成测试 APK：`downloads/Personal-AI-Assistant.apk`

重新构建：

```powershell
pnpm run android:build
```

构建产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。GitHub Actions 也会自动产生可下载的 APK artifact。

## 免费上线

完整 Gemini AI 版建议使用 Cloudflare Pages；GitHub Pages 版可由老师在页面内设置自己的 Gemini API Key。未连接 AI 时系统会停止生成并显示设置提示，不会产生不合逻辑的本机拼接题目。详细步骤请看 [ONLINE_SETUP.md](ONLINE_SETUP.md)。

## 上线前须知

目前老师密码、班级、学生账号和练习状态保存在浏览器 `localStorage`，适合原型与单机试用，但不会在不同装置间同步。学校正式使用时应接入数据库、服务器端身份验证、文件储存、权限规则与速率限制。正式部署时建议把 AI 密钥放在 serverless 环境变量中；GitHub Pages 原型也可由老师在页面内输入并仅保存在该浏览器，但切勿把密钥写入 `config.js` 或 APK。
