# ISOLATE / LOVE MOVIE

私人影视、人物与角色档案。黑色画廊界面，响应式海报网格，无依赖全栈 Web App。

## 功能

- IMDb 实时检索电影、剧集和人物；中文通过 Wikidata 辅助匹配 IMDb ID。
- 影视已看 / 想看、人物与角色关注、偏爱、0–10 分私人评分、日期及笔记。
- 全部 / 电影 / 剧集 / 已看 / 想看 / 偏爱筛选，年代、评分、最近记录排序。
- 以 IMDb ID 为主键；Wikidata 关联必须与 P345 精确匹配，才补充中文名和豆瓣链接。
- 豆瓣有已验证标识时直达，无标识时搜索；不绕过登录、验证码或访问限制。
- 私人云端账户存储 + 本机副本；每分钟、回到页面及联网时同步，ETag 防止覆盖并发更新。
- JSON 备份导入导出，导入按修改时间合并。
- 角色关系为人工整理，角色图像使用饰演者肖像，并标明来源。

目录中的作品是浏览内容，初始已看、评分、笔记均为空。平台评分不作推测。

## 本地运行

需要 Node.js 22+；无需安装依赖。

```sh
npm start
```

打开 http://127.0.0.1:3000 。本地服务仅监听回环地址，记录写入被 Git 忽略的 `.data/`。本地服务模拟单人账户，不应暴露到公网。

```sh
npm test
npm run build
```

构建产生 `dist/server/index.js`，是标准 Cloudflare Worker ESM，包含页面和图片；`.openai/hosting.json` 保存私人 Sites 的绑定配置。生产访问由 Sites 的私人账户登录保护，记录以平台注入的用户 ID 隔离，生产不接受浏览器自行指定账户。

## 数据与更新

- IMDb suggestion：`v3.sg.media-imdb.com/suggestion/x/{query}.json`，搜索缓存 5 分钟。
- Wikidata MediaWiki API：中文检索和精确 IMDb 关联，实体缓存 30 分钟。
- 豆瓣：从 Wikidata P4529 / P5284 获取关联 ID。没有官方密钥，不提供持续抓取或假实时评分。
- 初始目录的 `fetchedAt` 标注 IMDb 获取时间；「刷新数据」会刷新精选影视的 IMDb 元数据，其余条目在搜索时实时读取。
- `scripts/seed.py` / `scripts/enrich-seed.py` 可重新抓取初始目录，需要 Python 3 和网络。
- 画面来自 MetaHub，海报和人物肖像来自 IMDb；作品与图像版权归原权利人。

不需要 API 密钥。不将私人记录写入公开 GitHub 仓库。云端不可用时界面会明确显示「本机存储 / 云端待同步」，此时可通过 JSON 备份迁移记录。

## API

| 路径 | 作用 |
| --- | --- |
| `GET /api/search?q=&type=all` | IMDb 检索，中文名由 Wikidata 辅助 |
| `GET /api/detail?id=&title=` | 精确核对辅助关联 |
| `POST /api/refresh` | 刷新精选目录 |
| `GET /api/library` | 读取当前账户私人档案及 ETag |
| `PUT /api/library` | 带 `If-Match` 的条件更新 |

生产记录需要 `BUCKET` R2 绑定。无此绑定时仅本机存储，API 明确返回 `available: false`。
