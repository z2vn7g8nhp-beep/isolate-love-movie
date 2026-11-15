# ISOLATE / LOVE MOVIE

运行在 **GitHub Pages** 的影视、人物与角色档案 Web App。页面、图像资产和公开目录由本仓库构建发布，不依赖 Sites 或自建后端。

预计地址：https://z2vn7g8nhp-beep.github.io/isolate-love-movie/

## 开启 GitHub Pages

仓库 → **Settings → Pages → Build and deployment → Source → GitHub Actions**。

自动发布工作流：[Publish GitHub Web App](../../actions/workflows/pages.yml)。每次推送 `main`、手动运行以及每小时会执行。流程检查应用、尝试更新公开 IMDb 目录、构建静态文件，然后部署到 GitHub Pages。数据源不可用时保留缓存。GitHub 定时任务可能延迟，长期无提交的公共仓库可能被 GitHub 暂停定时任务。

GitHub App 连接若没有 Pages 管理权限，无法代替仓库所有者首次开启 Pages；在设置里选择 GitHub Actions 后，重新运行工作流即可。无需 API key 或仓库密钥。

## 功能

- 黑色画廊界面、海报档案墙、人物肖像、响应式布局。
- 默认 18px 阅读字号；右上角 Aa 可选择大号 / 特大，偏好会保留。
- 卡片直接标记已看 / 想看 / 关注，支持档案内即时筛选和可记忆的列表视图。
- IMDb 电影 / 剧集 / 人物检索，中文通过 Wikidata 精确匹配 IMDb ID。
- 已看、想看、人物与角色关注、偏爱、私人评分、日期、笔记。
- 自建角色档案，关联作品与饰演者。
- 电影 / 剧集 / 已看 / 想看 / 偏爱筛选，年代、评分和记录时间排序。
- JSON 导入导出，按修改时间合并；离线应用外壳。

个人观影记录仅保存在**当前浏览器 localStorage**，不上传到公开仓库或 GitHub Pages。跨设备使用请导出 / 导入 JSON。清理浏览器网站数据会删除本机记录，建议定期备份。此前在其他域名产生的记录可导出后导入这里。

## 数据

- IMDb 是主索引。浏览器使用 IMDb 官方 `sg.media-imdb.com/suggests/` JSONP 搜索入口，解决静态页面的 CORS 限制；公开目录由 GitHub Actions 从 IMDb JSON 接口定时获取。
- Wikidata 使用带 `origin=*` 的开放 MediaWiki API，补充中文名与外部标识。IMDb 关联必须与 P345 一致。
- 豆瓣使用 Wikidata 已关联的 P4529 / P5284 标识直达，无关联时提供搜索；不声称实时抓取豆瓣评分。
- 「刷新数据」获取最近一次 GitHub 部署的目录，并尝试即时更新精选影视。搜索是在使用时直接读取公开数据；抓取失败会显示状态。
- 角色关系由人工整理或由使用者建立，角色图像使用饰演者肖像。海报来自 IMDb，首屏图像来自 MetaHub，版权归原权利人。
- 初始目录仅供浏览，已看记录与私人评分从空白开始。

## 本地开发

Node.js 22+，无需安装依赖。

```sh
npm start       # http://127.0.0.1:3000
npm test        # 数据适配与静态部署检查
npm run build   # 生成 dist/，可部署到任何静态主机
npm run refresh # 更新公开 IMDb 目录，需要网络
```

`public/` 是应用源码与资产；`scripts/build.mjs` 将其构建到 `dist/`；`.github/workflows/pages.yml` 负责 GitHub Pages 发布与定时刷新。所有路径均相对引用，兼容 `/isolate-love-movie/` 仓库子路径。
