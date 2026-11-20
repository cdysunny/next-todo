# 先做哪件事

一个中文跨设备个人待办。暖纸与松绿界面，按重要程度和截止时间自动排序；支持快速录入、原地展开、响应式编辑面板、完成撤销和环形图筛选。

## 本地预览

安装 Node.js 22.12+（推荐 22 LTS）后，在项目目录运行：

```powershell
npm ci
npm run dev
```

打开终端显示的本地地址（默认 `http://127.0.0.1:5173/`）。未填写 Supabase 配置的开发服务会进入明确标记的本地演示；用的是样例数据，刷新会重置。普通生产构建不会静默使用演示数据。只想检查演示构建时，可运行 `npm run build -- --mode demo` 再执行 `npm run preview`。

## 接入 Supabase

1. 创建专用于本项目的 Supabase 项目。在 SQL Editor 执行 [`supabase/migrations/202611200001_tasks.sql`](supabase/migrations/202611200001_tasks.sql) 一次。它创建任务表、列级写入权限及账号隔离策略。
2. 把 `.env.example` 复制成 `.env.local`，填入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。只使用可发布密钥（也兼容旧版 `anon` 密钥），不要填服务端或 `service_role` 密钥。修改后重启开发服务。
3. 在 Auth 启用邮箱密码、允许注册、启用邮箱确认，并把最短密码长度设为 8。把下列地址加入 Auth 的允许回跳列表；生产 Site URL 使用正式站点地址。若实际端口或路径不同，示例地址也要相应调整：
   - `http://127.0.0.1:5173/`
   - `http://127.0.0.1:5173/?view=reset`
   - `https://<账号>.github.io/<仓库>/`
   - `https://<账号>.github.io/<仓库>/?view=reset`
4. 使用包含 Supabase 确认链接的邮件模板。公开注册前配置自己的 SMTP；在测试项目上用两个独立账号验证注册、邮箱确认、登录和密码重置。

## 验证与发布

```powershell
npm test
npm run build
```

自动化测试覆盖优先级边界、稳定排序、统计与截止表单，并用本地 PostgreSQL（PGlite）执行迁移、验证匿名权限和两个账号的隔离。真实后端验收按[项目书](项目书.md)执行，尤其是双设备同步、邮箱回跳与网络故障恢复。数据不写进 GitHub，只上传应用源码和静态站点产物。

准备正式上站时，先确认目标仓库和可见性，再提交及推送。到仓库 Settings → Pages，把 Source 设为 GitHub Actions；在仓库的 Actions Variables 中写入两个 `VITE_SUPABASE_*` 变量，再手动运行 **Deploy to GitHub Pages**。工作流不会在普通推送时部署。部署后用正式地址重测确认、重置和两台设备写入 / 读取。

界面和动效取值见[视觉与交互动效设计](视觉与交互动效设计.md)，核心流程和范围见[项目书](项目书.md)。
