# 本地开发

The workspace packages six clients: Claude Code, Codex, Grok Build, pi, OpenCode and dsh.
Remote MCP and OAuth run in the Hub. For project-local tunnel setup and
`pnpm dev:mcp`, see [Remote MCP development](web-mcp-development.md).

## 准备环境

使用 Node.js 22.19+（也可使用 Node 24）和 pnpm 10.28.0。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 检查 protocol，分别构建六个客户端（Claude Code、Codex、Grok Build、pi、OpenCode、dsh），并导出
`.local/marketplace/`。它不包含网站构建。

## 配置 Hub

`pnpm dev` creates `packages/hub/.dev.vars` on first startup with a random
authentication secret and `DEV_EMAIL_OTP=console`. No Resend or OAuth setup is
needed for local email login. Existing files are left unchanged; add
`DEV_EMAIL_OTP=console` manually to enable this mode in an existing setup.
For manual setup, use `packages/hub/.dev.vars.example`. The actual file is ignored by Git.

- `BETTER_AUTH_URL=http://127.0.0.1:4173`
- `BETTER_AUTH_SECRET`：至少 32 字符的随机密钥，不能使用示例占位符。
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`：开发用 GitHub OAuth 应用。
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：开发用 Google OAuth Web Client。
- `DEV_EMAIL_OTP=console`：本地免邮件登录，验证码打印在 Hub 终端，不需要 Resend。
- `RESEND_API_KEY` / `RESEND_FROM`：邮箱验证码登录的 API key 和发件地址，例如
  `Tandry <login@tandry.io>`；发件域名必须在 Resend 验证通过。

未配置的登录方式会在页面上禁用。只改公开页面时，可以暂不配置 OAuth；
需要浏览器登录、创建房间或插件授权时，至少配置一个登录方式。
推荐本地设置 `DEV_EMAIL_OTP=console`：在页面输入测试邮箱、点击发送验证码，
然后从 Hub 面板的 `[dev email OTP] 邮箱: 123456` 日志复制验证码。
此模式默认只接受 HTTP loopback 登录地址（`127.0.0.1`、`localhost`、`[::1]`）。
`pnpm dev:mcp` 复用同一配置，并通过 `DEV_EMAIL_OTP_ORIGIN` 显式允许配置的 HTTPS
开发隧道地址打印验证码；该配置不能用于部署环境。
移除该配置后，邮箱登录使用 Resend 发送真实邮件。
验证码为 6 位、10 分钟有效；首次验证自动创建账号，相同邮箱登录已有账号。
不要把 OAuth 密钥放进网站环境变量或提交到仓库。

开发用 OAuth 回调地址分别为：

```text
http://127.0.0.1:4173/api/auth/callback/github
http://127.0.0.1:4173/api/auth/callback/google
```

Google Web Client 的 JavaScript origin 使用 `http://127.0.0.1:4173`；
若应用处于 Testing 状态，将自己的 Google 账号加入测试用户。
推荐单独创建开发客户端。只有 `https://tandry.io/...` 生产回调的客户端
不能直接用于本地登录。浏览器地址和配置统一使用 `127.0.0.1`，不要混用 `localhost`。

初始化本地 D1：

```sh
pnpm --filter @tandryio/hub db:local
```

这是本地数据库操作，不需要创建新的云端数据库，也不要运行 `db:remote`。

`0001_initial.sql` 一次建立首版账户、房间目录和 OAuth 结构。
日常更新运行 `db:local` 应用新增迁移即可，未来结构变更应新增迁移。
只有曾使用历史旧版 `0001` 的开发库才需要下面的重置；这会删除本地测试账户和登录态，
不适用于生产数据库。Wrangler 不会自动重跑已应用但内容被改动的迁移：

```sh
rm -rf packages/hub/.wrangler/state/v3/d1
pnpm --filter @tandryio/hub db:local
```

否则会出现旧约束导致的写入失败，例如登录时返回 500。

## 启动网站和 Hub

安装依赖后，在仓库根目录一键启动：

```sh
pnpm dev
```

The script creates `packages/hub/.dev.vars` only when missing, with a random
authentication secret and console email login enabled. It prints the configuration
path and explains where to find verification codes. Existing configuration is
preserved. It applies local D1 migrations, then starts the Hub and website through
mprocs in the same terminal, with separate logs.
不需要全局安装 mprocs，它已作为项目开发依赖安装。

- `↑` / `↓`：在左侧选择 Hub 或 Website。
- `Ctrl+A`：切换进程列表与终端输入焦点；进入终端后可操作 Wrangler 等交互界面。
- 在进程列表中按 `r` 重启选中的服务、`x` 停止、`s` 启动。
- `Ctrl+Q`：在任一面板停止全部服务并退出。列表中也可按 `q` 或 `Ctrl+C`。
  终端面板中的 `Ctrl+C` 只发送给当前服务。

服务退出后保留日志，另一个服务继续运行，可单独重启失败的服务。
配置位于根目录 `mprocs.yaml`。`pnpm dev` 需要在交互终端中运行，不支持管道或重定向输出。
端口被占用时直接报错，不自动换端口。
For a fresh setup, sign in by email and copy the code from the Hub panel's
`[dev email OTP]` log. Existing setups can enable `DEV_EMAIL_OTP=console` as
described above, or use Resend or development OAuth clients. This command does
not build or install host plugins.

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
```

两项应分别返回健康状态和已配置的登录方式。
如果默认端口被占用，先处理旧服务；变更网站端口时也必须同步 OAuth 回调和认证 origin。

## 联调宿主插件

推荐使用统一启动器，在仓库根目录运行：

```sh
# 先在一个终端运行 pnpm dev，再在其他终端按需启动：
pnpm agent claude
pnpm agent codex
pnpm agent grok
```

宿主 CLI 需要预先安装并配置好模型账号。启动器检查 Hub 连通性、执行 `pnpm build`，
加载本地插件，然后进入宿主。默认 Hub 为 `http://127.0.0.1:8799`，
数据和登录凭据位于 `~/.tandry-dev`。用 `TANDRY_HUB` 和 `TANDRY_HOME` 覆盖。
宿主额外参数直接追加，例如 `pnpm agent claude --resume`。

- Claude 使用 `--plugin-dir`；保留宿主的其他扩展。
- Codex 自动注册构建生成的 `.local/marketplace`，移除旧安装缓存并重新安装 `tandry`，
  再开启会话；安装会保留在 Codex 中。首次使用仍需在 `/hooks` 检查并信任 hooks。
  如果同名 marketplace 指向其他目录，启动器会报错说明如何处理，不覆盖其他来源。迁移前曾注册源码根目录时，也需要先移除旧来源。
- Grok Build 用 `grok plugin install <clients/grok> --trust` 安装本地插件副本并 `enable`，每次启动先卸载旧副本；
  安装会保留在 Grok 中。加入房间后由对话自己用 `monitor` 工具启动收件箱监视器。

每次启动都重新构建；代码修改后退出宿主，再运行同一条命令即可。
这些命令启动本地 CLI，不会给已打开的桌面窗口注入环境变量。

如需手动启动，在启动宿主的终端设置：

```sh
export TANDRY_HUB=http://127.0.0.1:8799
export TANDRY_HOME="$HOME/.tandry-dev"
```

这会把测试账号凭据、会话状态和消息与日常 `~/.tandry` 分开。
环境变量必须传给宿主和它启动的插件进程，仅设置在 Hub 终端没有作用。

使用仓库里的本地插件包，参考各宿主安装说明：
[Codex](codex.md)、[Claude](../clients/claude/README.md)、
[Pi](../clients/pi/README.md)、[OpenCode](../clients/opencode/README.md)、
[DSH](../clients/dsh/README.md)。本地修改不会自动出现在 GitHub marketplace 安装的版本里。

让 Agent 调用 `tandry.login`，打开返回的本地网址，核对授权码并由用户批准。
随后创建或加入房间。网页登录不会自动授权插件。
修改 bridge/protocol 或插件 src/*.ts 后重新执行 `pnpm build` 并重启相关插件进程；
修改共享指令后执行 `pnpm generate:commands`，再重新构建。

## 检查与测试

网站默认英文，顶部可切换简体中文。文案和 Profile 入口见 [i18n 开发说明](i18n.md)。

```sh
pnpm website:build
pnpm typecheck
pnpm build
pnpm --filter @tandryio/bridge test
```

网站构建会生成路由类型，首次运行类型检查前先执行它。
测试使用临时目录、模拟宿主和本地 Hub，无需真实 OAuth 凭据，也不调用生产服务或付费模型。
构建后可单独验证解压到仓库外的发布包：

```sh
pnpm test:marketplace
```

只运行一个测试文件，例如：

```sh
pnpm --filter @tandryio/bridge exec tsx --test test/bridge.test.ts
```

前端格式化使用 `pnpm format:web`。不要直接修改生成的插件 bundle 或 `routeTree.gen.ts`。
部署和生产 Secrets 配置另见[认证与部署](authentication.md)，不属于日常本地启动步骤。

## 联调私有云端

公开仓库的 `pnpm dev` 继续用于自部署版本。要测试订阅策略，先安装公开仓库依赖，
然后在相邻的私有仓库执行：

```sh
pnpm dev:setup ../tandry
pnpm dev
```

这会链接公开源码，并启动 cloud Hub（8799）和网站 Vite（4173）。
公开仓库中的 `pnpm agent pi`、`pnpm agent claude` 等命令照旧运行。
不要同时启动两套同端口的 Hub。链接配置和开发锁文件仅保存在私有仓库的忽略目录中，
日常修改不再需要打包、复制 vendor 或导入产物。

私有 `pnpm dev --mock-billing` 使用模拟订阅、真实登录，适合没有 Stripe 测试配置时
联调 Agent；它不模拟 Checkout/Portal。配置 Resend 后可正常邮箱登录，已有 Resend 配置
会保留。protocol、hub、web 不发布到 npm；私有仓库按 `core.json` 钉住的公开提交从源码构建。
见 [公开包与依赖流程](public-artifacts.md)。
