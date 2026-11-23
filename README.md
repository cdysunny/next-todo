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
# 课表和手机上课提醒

登录后打开「课表 → 导入课表」，选择教务系统原始 `.xls`，填入学校第 1 周周一的日期。先按周核对，再确认保存；重新导入同学期会替换原课表。文件只在浏览器读取，不会上传原文件、学号或班级。预览会单独列出已排除的智慧树课程。

导入后可以展开「设置当前周」，把北京时间本周设为学校的指定周次。系统会调整该学期的上课日期和提醒，下周一自动递进。用「上一周／下一周」查看课表不会改变提醒。

## 部署课表功能

1. 在 Supabase SQL Editor 按顺序执行 `supabase/migrations/202611230001_schedule.sql` 和 `supabase/migrations/20261123130933_set_schedule_current_week.sql`。已建好课表的项目只执行第二份脚本；不要重跑已应用的迁移。如果使用 CLI 管理迁移，请先确认项目的迁移历史与现有待办表状态一致。
2. 用可信终端运行 `npx --yes web-push@3.6.7 generate-vapid-keys --json` 创建密钥对。用密码管理器生成独立的高熵随机值作为调度令牌。用 Supabase Dashboard 的 Edge Function Secrets 设置以下变量（不得提交到 GitHub）：

   | 变量 | 值 |
   | --- | --- |
   | `COURSE_VAPID_PUBLIC_KEY` / `COURSE_VAPID_PRIVATE_KEY` | 上一步生成的公钥／私钥 |
   | `COURSE_VAPID_SUBJECT` | 维护者的 `mailto:` 地址 |
   | `COURSE_CRON_TOKEN` | 调度专用随机令牌 |
   | `COURSE_WEB_ORIGINS` | `https://cdysunny.github.io`；需要测试本地版时逗号分隔加上 `http://127.0.0.1:4173` |

3. 登录 Supabase CLI 后，在仓库根目录运行 `supabase functions deploy course-push --project-ref <项目引用 ID> --no-verify-jwt`。函数对网页请求自行验证 Supabase 用户 JWT；定时请求使用单独的调度令牌。不要把服务角色密钥交给前端。
4. 在 Supabase Dashboard 启用 **Cron** 和 **pg_net**，确认 **Vault** 可用。在 Vault 创建 `course_push_url`（值为项目的 `/functions/v1/course-push` 完整 HTTPS URL）和 `course_cron_token`（值与上面的 Edge Function Secret 相同）。然后在 SQL Editor 执行一次：

   ```sql
   select cron.schedule('course-push-every-minute', '* * * * *', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'course_push_url'),
       headers := jsonb_build_object('Content-Type', 'application/json', 'X-Course-Cron',
         (select decrypted_secret from vault.decrypted_secrets where name = 'course_cron_token')),
       body := '{}'::jsonb,
       timeout_milliseconds := 25000
     );
   $$);
   ```

5. 运行原有 GitHub Pages 部署流程。用手机打开课表，在「手机上课提醒」启用本机权限并发送测试通知。iPhone 先用 Safari 添加到主屏幕，再从桌面打开。测试时关闭网页、锁屏，并另外用一条即将开始的测试课程确认定时链路；测试按钮只能验证推送通道，不能验证 Cron。可以在 Supabase 的 Cron 历史和 Edge Function 日志查看执行结果。

每分钟检查一次，只发送开始时间已到且距离开课不足 5 分钟的课程。系统对每场课、每台设备最多尝试一次；已给推送平台的消息不能撤回，临时发送失败不重试以避免重复通知。关闭本机提醒或主动退出本机账号时取消本机订阅。不要频繁更换 VAPID 密钥，更换后设备要重新订阅。学校调课不会自动同步，请重新导入更新后的课表。
