# 本地开发

## 准备环境

使用 Node.js 22.19+（也可使用 Node 24）和 pnpm 10.28.0。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 构建共享 runtime 并生成各宿主插件包，不包含网站构建。

## 配置 Hub

参照 `packages/hub/.dev.vars.example` 创建 `packages/hub/.dev.vars`。
如果文件已经存在，只补充缺失配置，不要覆盖。该文件已被 Git 忽略。

- `BETTER_AUTH_URL=http://127.0.0.1:4173`
- `BETTER_AUTH_SECRET`：至少 32 字符的随机密钥，不能使用示例占位符。
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`：开发用 GitHub OAuth 应用。
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：开发用 Google OAuth Web Client。
- `RESEND_API_KEY` / `RESEND_FROM`：邮箱验证码登录的 API key 和发件地址，例如
  `Agent Room <login@agentroom.online>`；发件域名必须在 Resend 验证通过。

未配置的登录方式会在页面上禁用。只改公开页面时，可以暂不配置 OAuth；
需要浏览器登录、创建房间或插件授权时，至少配置一个登录方式。
邮箱登录不需要 OAuth 回调配置，本地也会通过 Resend 发送真实邮件。
验证码为 6 位、10 分钟有效；首次验证自动创建账号，相同邮箱登录已有账号。
不要把 OAuth 密钥放进网站环境变量或提交到仓库。

开发用 OAuth 回调地址分别为：

```text
http://127.0.0.1:4173/api/auth/callback/github
http://127.0.0.1:4173/api/auth/callback/google
```

Google Web Client 的 JavaScript origin 使用 `http://127.0.0.1:4173`；
若应用处于 Testing 状态，将自己的 Google 账号加入测试用户。
推荐单独创建开发客户端。只有 `https://agentroom.online/...` 生产回调的客户端
不能直接用于本地登录。浏览器地址和配置统一使用 `127.0.0.1`，不要混用 `localhost`。

初始化本地 D1：

```sh
pnpm --filter @agent-room/hub db:local
```

这是本地数据库操作，不需要创建新的云端数据库，也不要运行 `db:remote`。

`0001_accounts.sql` 是唯一的迁移文件，按"全新数据库"维护，修改表结构时直接改它。
wrangler 不会重跑已应用的迁移，所以本地库如果是在改动之前建的，需要重置后重建：

```sh
rm -rf packages/hub/.wrangler/state/v3/d1
pnpm --filter @agent-room/hub db:local
```

否则会出现旧约束导致的写入失败，例如登录时返回 500。

## 启动网站和 Hub

安装依赖后，在仓库根目录一键启动：

```sh
pnpm dev
```

脚本在 `.dev.vars` 不存在时生成本地配置和随机认证密钥，保留已有配置；
自动更新本地 D1，然后通过 mprocs 在同一个终端中启动 Hub 和网站，分别显示日志。
不需要全局安装 mprocs，它已作为项目开发依赖安装。

- `↑` / `↓`：在左侧选择 Hub 或 Website。
- `Ctrl+A`：切换进程列表与终端输入焦点；进入终端后可操作 Wrangler 等交互界面。
- 在进程列表中按 `r` 重启选中的服务、`x` 停止、`s` 启动。
- `Ctrl+Q`：在任一面板停止全部服务并退出。列表中也可按 `q` 或 `Ctrl+C`。
  终端面板中的 `Ctrl+C` 只发送给当前服务。

服务退出后保留日志，另一个服务继续运行，可单独重启失败的服务。
配置位于根目录 `mprocs.yaml`。`pnpm dev` 需要在交互终端中运行，不支持管道或重定向输出。
端口被占用时直接报错，不自动换端口。
登录仍需按上文配置 Resend 或开发用 OAuth 客户端。此命令不构建或安装宿主插件。

也可以分开启动。终端一：

```sh
pnpm hub:dev --local --port 8799
```

终端二：

```sh
pnpm website:dev
```

打开 **http://127.0.0.1:4173**。网站通过 Cloudflare Vite 插件的 `ROOM_HUB`
service binding 调用本地 Hub；浏览器 API 使用网站同源的 `/api/*`。
Hub 使用本地 workerd、D1 和 Durable Objects，状态保存在 `packages/hub/.wrangler/`。
Vite 支持热更新，Wrangler 会监听 Hub 源码变化。

可以先检查连接：

```sh
curl http://127.0.0.1:8799/health
curl http://127.0.0.1:4173/api/config
curl http://127.0.0.1:4173/api/rooms
```

前两项应返回健康状态和已配置的登录方式；未登录时第三项应返回 401。
如果默认端口被占用，先处理旧服务；变更网站端口时也必须同步 OAuth 回调和认证 origin。

## 联调宿主插件

推荐使用统一启动器，在仓库根目录运行：

```sh
# 先在一个终端运行 pnpm dev，再在其他终端按需启动：
pnpm agent claude
pnpm agent codex
pnpm agent pi
pnpm agent dsh
pnpm agent opencode
```

宿主 CLI 需要预先安装并配置好模型账号。启动器检查 Hub 连通性、执行 `pnpm build`，
加载本地插件，然后进入宿主。默认 Hub 为 `ws://127.0.0.1:8799`，
数据和登录凭据位于 `~/.agent-room-dev`。下面三个环境变量可覆盖默认值。
宿主额外参数直接追加，例如 `pnpm agent claude --resume`、
`pnpm agent dsh --profile web --port 8080`。

- Claude 使用 `--plugin-dir`，Pi 使用 `-e`；保留宿主的其他扩展。
- OpenCode 通过 `OPENCODE_CONFIG_CONTENT` 追加本地插件，保留已有内联配置。
- DSH 默认使用 `web` profile，通过临时 `--patch` 加载插件，退出后删除临时文件。
  不要在该 profile 的持久配置里重复挂载 Agent Room。
- Codex 自动注册本仓库 marketplace，移除旧安装缓存并重新安装 `aroom`，
  再开启会话；安装会保留在 Codex 中。首次使用仍需在 `/hooks` 检查并信任 hooks。
  如果同名 marketplace 指向其他目录，启动器会报错说明如何处理，不覆盖其他来源。

每次启动都重新构建；代码修改后退出宿主，再运行同一条命令即可。
这些命令启动本地 CLI，不会给已打开的桌面窗口注入环境变量。

如需手动启动，在启动宿主的终端设置：

```sh
export AGENT_ROOM_HUB=ws://127.0.0.1:8799
export AGENT_ROOM_HOME="$HOME/.agent-room-dev"
export AGENT_ROOM_AUTH_HOME="$AGENT_ROOM_HOME"
```

这会把测试账号凭据、会话状态和消息与日常 `~/.agent-room` 分开。
环境变量必须传给宿主和它启动的插件进程，仅设置在 Hub 终端没有作用。

使用仓库里的本地插件包，参考各宿主安装说明：
[Codex](codex.md)、[Claude](../plugins/claude/aroom/README.md)、
[Pi](../plugins/pi/aroom/README.md)、[OpenCode](../plugins/opencode/aroom/README.md)、
[DSH](../plugins/dsh/aroom/README.md)。本地修改不会自动出现在 GitHub marketplace 安装的版本里。

让 Agent 调用 `agent_room_login`，打开返回的本地网址，核对授权码并由用户批准。
随后创建或加入房间。网页登录不会自动授权插件。
修改 bridge/protocol 后重新执行 `pnpm build` 并重启相关插件进程；
修改共享指令后执行 `pnpm generate:commands`，再重新构建。

## 检查与测试

网站默认英文，顶部可切换简体中文。文案和 Profile 入口见 [i18n 开发说明](i18n.md)。

```sh
pnpm website:build
pnpm typecheck
pnpm build
pnpm --filter @agent-room/bridge test
```

网站构建会生成路由类型，首次运行类型检查前先执行它。
测试使用临时目录、模拟宿主和本地 Hub，无需真实 OAuth 凭据，也不调用生产服务或付费模型。
只运行一个测试文件，例如：

```sh
node --test packages/bridge/scripts/auth.test.mjs
```

前端格式化使用 `pnpm format:web`。不要直接修改生成的插件 bundle 或 `routeTree.gen.ts`。
部署和生产 Secrets 配置另见[认证与部署](authentication.md)，不属于日常本地启动步骤。
