# Chrome 视频导出插件

这是一个分成两部分的项目：

- `extension/`：Chrome 插件。它会在支持的网站里找视频，在 side panel 里给你看列表，并把导出任务发给本地服务。
- `local-server/`：本地服务。它负责下载源视频、处理图片片头、裁剪片段、输出最终文件。

当前仓库已经不只是最初的 MVP 了，包含了后面陆续补上的站点适配、导出规则、Windows 打包流程和新的 side panel 界面。

英文版说明见 [README_EN.md](./README_EN.md)。

## 当前支持的网站

- `https://www.xfree.com/*`
- `https://fyptt.to/*`
- `https://www.redgifs.com/*`

说明：

- `xfree` 走通用页面检测。
- `fyptt` 走详情页专用解析。
- `redgifs` 走专用列表同步和详情解析，不跟别的站混用逻辑。

## 项目结构

```text
downloadVideo/
├── .github/
│   └── workflows/
│       └── build-local-server-win.yml
├── README.md
├── README_EN.md
├── extension/
│   ├── build.mjs
│   ├── manifest.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── content-script.ts
│   │   ├── service-worker.ts
│   │   ├── sidepanel.css
│   │   ├── sidepanel.html
│   │   ├── sidepanel.ts
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   └── icons/
│   └── dist/
└── local-server/
    ├── build-executable.mjs
    ├── build-win.mjs
    ├── package.json
    ├── tsconfig.json
    ├── src/
    ├── dist/
    └── bin/
```

## 环境要求

### 日常开发

- macOS
- Node.js 20+
- Google Chrome
- 系统已安装 `ffmpeg` 和 `ffprobe`

### 给 Windows 朋友使用

- 不需要安装 Node
- 可以通过 GitHub Actions 打包出 Windows 可执行版本
- 现在这条流程会把 `ffmpeg` 和 `ffprobe` 一起打进去

## 安装 ffmpeg

如果你本机还没有：

```bash
brew install ffmpeg
```

确认是否安装成功：

```bash
ffmpeg -version
ffprobe -version
```

## 安装依赖

```bash
cd extension && npm install
cd ../local-server && npm install
```

## 构建扩展

```bash
cd extension
npm run build
```

Chrome 里加载的是：

```text
extension/dist
```

## 启动本地服务

开发模式：

```bash
cd local-server
npm run dev
```

生产模式：

```bash
cd local-server
npm run build
npm start
```

默认地址：

```text
http://127.0.0.1:37891
```

可选并发配置（批量导出）：

```bash
VIDEO_EXPORT_BATCH_CONCURRENCY=5 npm start
```

说明：

- 默认值是 `5`
- 不传环境变量就按默认值
- 建议根据机器性能调整，比如 `3`、`5`、`8`

健康检查：

```bash
curl http://127.0.0.1:37891/health
```

## 加载扩展

1. 打开 `chrome://extensions`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `extension/dist`
5. 把扩展固定到工具栏
6. 点击扩展图标打开 side panel

## 使用方法

1. 先启动本地服务
2. 打开支持的网站页面
3. 打开 side panel
4. 等插件检测视频，必要时点“刷新检测”
5. 勾选要导出的项目
6. 上传一张图片
7. 填开始秒数和结束秒数，比如 `0` 和 `8`
8. 点击“导出”
9. 等待结果出现在 side panel 下方

## 多封面冻结导出（新流程）

当你需要多个封面、重叠区间、批量任务时，建议用冻结流程：

1. 在 side panel 勾选视频，点击 `锁定已选`
2. 跳转到独立 `selection` 页面后，上传多个封面
3. 点击“自动分配范围”或手动修改每个封面的 `from/to`
4. 可以让一个视频命中多个封面（会展开成多条任务）
5. 设置开始/结束秒数后执行批量导出
6. 查看任务级结果（成功/失败、输出路径）

特性说明：

- side panel 刷新不会清空冻结数据
- 只有手动点“清空”或重新锁定时才会重置
- 同一视频 + 不同封面会生成独立输出文件

输出目录固定为：

```text
~/Downloads/cutVideo/
```

## 当前导出规则

- 现在不是“导出总时长”，而是“按开始秒数和结束秒数裁一段”
- 上传的图片会放在视频最前面，作为一个很短的开头画面
- 原视频如果本来就是竖版，导出仍然是竖版
- 原视频如果是横版，会裁成竖版后再导出
- 最终输出统一是竖版 mp4

### 裁剪规则

- 开始秒数小于视频总时长，结束秒数也小于总时长：正常裁剪
- 开始秒数小于视频总时长，结束秒数大于总时长：自动裁到视频结尾
- 结束秒数小于等于开始秒数：直接提示
- 开始秒数大于或等于视频总时长：直接提示

## side panel 现在的样子

- 使用 side panel，不用 popup
- 视频区是竖版卡片流
- hover 时预览播放
- 同一时间只保留一个在播
- 顶部区域固定，不跟着滚动
- 自动每 5 秒刷新一次
- 界面已经改成新的一套黑色风格

## 本地服务接口

### `GET /health`

返回服务和转码工具状态：

```json
{
  "ok": true,
  "ffmpeg": true,
  "ffprobe": true
}
```

### `POST /export`

表单字段：

- `cover`: 图片文件
- `startTime`: 开始秒数
- `endTime`: 结束秒数
- `pageUrl`: 页面 URL
- `videos`: JSON 字符串数组

示例：

```bash
curl -X POST http://127.0.0.1:37891/export \
  -F "cover=@/path/to/cover.jpg" \
  -F "startTime=0" \
  -F "endTime=8" \
  -F "pageUrl=https://www.redgifs.com/watch/demo" \
  -F 'videos=["https://example.com/video.mp4"]'
```

### `POST /export/batch`

用于多封面批量导出。表单字段：

- `startTime`: 开始秒数
- `endTime`: 结束秒数
- `pageUrl`: 页面 URL
- `cover-{n}`: 多个封面文件（例如 `cover-1`、`cover-2`）
- `tasks`: JSON 字符串数组，每项包含：
  - `taskId`
  - `videoIndex`
  - `videoSrc`
  - `coverIndex`
  - `coverUploadField`（如 `cover-1`）

服务端行为：

- 并发池执行，默认并发 `5`
- 单个任务失败不会中断整批
- 输出命名包含 `video-{n}` 和 `cover-{n}`，避免冲突

## Windows 打包

仓库里已经带了 GitHub Actions 流程：

- `Build Windows Local Server`

它会做这些事：

- 安装依赖
- 安装 `ffmpeg`
- 打包 Windows 版本地服务
- 把 `ffmpeg.exe` 和 `ffprobe.exe` 一起带上
- 检查 `/health`
- 生成 zip 并上传到构建产物

拿 Windows 包的方式：

1. 打开仓库的 `Actions`
2. 运行 `Build Windows Local Server`
3. 等它完成
4. 在运行详情页底部下载 `VideoExportLocalServer-win-x64`

解压后，发给朋友的就是那一套文件。

## 这套分工为什么这么做

### 为什么页面检测放在 content script

因为它最接近真实页面，能直接看到浏览器已经解析出来的视频信息。

### 为什么要有 service worker

因为 side panel 不能直接碰页面内容，需要一个中间层按标签页缓存和转发数据。

### 为什么重处理放在本地服务

因为浏览器里做大视频处理又慢又不稳，本地服务调用系统 ffmpeg 更实用。

### 为什么不只靠一种检测方式

因为不同网站藏视频的方式不一样：

- 有的直接在页面里
- 有的是后面动态插进去
- 有的是浏览器资源里已经出现了，但页面上看不到
- 有的是列表页和详情页完全两套结构

所以现在是按网站拆逻辑，不再强行一套通吃。

## 已知限制

- 当前真正支持导出的还是 `mp4`
- `m3u8`、`blob`、`dash` 会出现在列表里，但还不能直接导出
- `redgifs`、`fyptt`、`xfree` 都是单独适配的，后面新增站点也建议继续按站点拆开做
- `xxxtik` 已经确认“有机会接进来”，但目前还没正式加进支持列表

## 常见问题

### side panel 显示连不上本地服务

- 确认本地服务已经启动
- 确认端口还是 `37891`
- 打开 `http://127.0.0.1:37891/health` 看能不能访问

### 健康检查说缺少 ffmpeg

- 确认本机装了 `ffmpeg` 和 `ffprobe`
- 如果刚装完，重开终端再启动服务

### 为什么列表里有些项目不能导出

- 因为当前只正式支持 `mp4`
- 其他类型先保留在列表里，方便后续继续扩展

### 为什么某个视频失败了，其他视频还在继续

- 因为服务端是逐条处理
- 单条失败不会把整批一起打断

### Redgifs 之前为什么最多只显示一百多个

- 之前代码里确实有写死上限
- 现在这个限制已经去掉了

## 开发建议

- 新增站点时，不要把所有站点揉成一套逻辑
- 优先按“站点专用检测 + 通用兜底”来做
- 测试导出后，记得清掉测试产物，避免误提交
