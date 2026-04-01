# Chrome 视频导出 MVP

这是一个最小可运行项目，分成两部分：

- `extension/`：Chrome Manifest V3 插件，负责在页面里找视频、在 side panel 展示列表、把导出任务发给本地服务。
- `local-server/`：本地 Node.js 服务，负责下载源视频、调用系统里的 ffmpeg 处理、把结果输出到本地目录。

## 目录结构

```text
downloadVideo/
├── .gitignore
├── README.md
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
│   │       ├── icon16.png
│   │       ├── icon32.png
│   │       ├── icon48.png
│   │       └── icon128.png
│   └── dist/
└── local-server/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── config.ts
    │   ├── index.ts
    │   ├── routes/
    │   │   └── export.ts
    │   ├── services/
    │   │   ├── downloader.ts
    │   │   └── ffmpeg.ts
    │   ├── types.ts
    │   └── utils/
    │       ├── files.ts
    │       └── logger.ts
    ├── output/
    ├── tmp/
    └── dist/
```

## 环境要求

- macOS
- Node.js 20+
- Google Chrome
- 系统已安装 `ffmpeg` 和 `ffprobe`

## 先安装 ffmpeg

如果你本机还没有 ffmpeg，先执行：

```bash
brew install ffmpeg
```

确认是否安装成功：

```bash
ffmpeg -version
ffprobe -version
```

## 安装依赖

分别安装两个子项目依赖：

```bash
cd extension && npm install
cd ../local-server && npm install
```

## 构建扩展

```bash
cd extension
npm run build
```

构建完成后，Chrome 要加载的是：

```text
extension/dist
```

## 启动本地服务

开发模式：

```bash
cd local-server
npm run dev
```

生产构建：

```bash
cd local-server
npm run build
npm start
```

默认地址固定为：

```text
http://127.0.0.1:37891
```

健康检查：

```bash
curl http://127.0.0.1:37891/health
```

## 加载 Chrome 扩展

1. 打开 Chrome。
2. 进入 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `extension/dist` 目录。
6. 把扩展固定到工具栏，点击扩展图标即可打开 side panel。

## 使用说明

1. 先启动本地服务。
2. 打开以下任一页面：
   - `https://www.xfree.com/*`
   - `https://fyptt.to/*`
   - `https://www.redgifs.com/*`
3. 点击扩展图标，打开 side panel。
4. side panel 会显示当前标签页采集到的视频列表。
5. 如果页面是后加载内容，点“刷新检测”。
6. 勾选要导出的 mp4。
7. 上传一张图片。
8. 输入目标秒数。
9. 点击“导出”。
10. 处理完成后，结果会显示在 side panel，下方会列出成功或失败。
11. 输出文件统一写到 `local-server/output/`。

## 这套方案为什么这样分工

### 为什么用 content script + service worker + side panel

- 页面里的真实视频信息最容易在 content script 里拿到，因为它能直接看到 `video` 元素和 `currentSrc`。
- side panel 负责界面和用户操作，不直接碰页面 DOM，这样结构更稳。
- service worker 负责按 tab 缓存数据，把页面采集结果转给 side panel，符合 MV3 的常见做法。

### 为什么重型处理放到本地服务

- 浏览器扩展不适合做重型转码。
- ffmpeg.wasm 在大文件、长视频场景下更吃内存，也更慢。
- 本地服务调用系统 ffmpeg，稳定性和性能都更适合这个 MVP。

### 为什么同时用 4 种采集方式

- DOM 扫描：抓页面初始就存在的视频。
- MutationObserver：抓后续动态插入的视频。
- performance：补充浏览器已经请求过但不一定挂在 DOM 上的资源。
- webRequest：补充网络层直接出现的 mp4 地址。

这样做不是为了复杂，而是为了尽量把不同站点的常见情况都兜住。

## 本地服务接口

### `GET /health`

返回服务和 ffmpeg 状态。

示例：

```json
{
  "ok": true,
  "ffmpeg": true,
  "ffprobe": true
}
```

### `POST /export`

使用 `multipart/form-data`：

- `cover`: 图片文件
- `duration`: 目标秒数
- `pageUrl`: 页面 URL
- `videos`: JSON 字符串数组

示例：

```bash
curl -X POST http://127.0.0.1:37891/export \
  -F "cover=@/path/to/cover.jpg" \
  -F "duration=10" \
  -F "pageUrl=https://www.redgifs.com/watch/demo" \
  -F 'videos=["https://example.com/video.mp4"]'
```

## ffmpeg 处理规则

当前实现走“稳定优先”：

1. 先把上传图片做成一个约 1 秒的片头。
2. 再把原视频统一处理成兼容性更高的 mp4。
3. 最后把两段接起来。
4. 如果总长度超过目标秒数，就截断。
5. 如果总长度不够，就冻结最后一帧补足，并补静音音频。
6. 输出统一为 H.264 + AAC 的 mp4。

代码里实际调用的 ffmpeg 思路就是这三步：

- 生成图片片头
- 统一原视频格式
- 拼接并补足/截断到目标秒数

## 常见问题

### side panel 显示“未连接”

- 确认本地服务已经启动。
- 确认端口还是 `37891`。
- 打开 `http://127.0.0.1:37891/health` 看是否能访问。

### 健康检查说 ffmpeg 不可用

- 确认你装了 `ffmpeg` 和 `ffprobe`。
- 如果是用 Homebrew 安装，重开一次终端再启动服务。

### 列表里看到 m3u8、blob、dash，但不能导出

- 这是当前 MVP 的已知范围限制。
- 列表会保留这些资源，方便后面继续扩展。
- 当前真正支持导出的只有 mp4。

### 某个视频失败，为什么其他视频还能继续

- 服务端按单条分别处理。
- 单条失败会记到结果里，但不会让整批都中断。

### 为什么没有直接在浏览器里转码

- 为了稳定和可用性。
- 大文件转码放在本地 ffmpeg 更靠谱。

## 开发建议

扩展开发时，如果你改了 `extension/src` 下的文件，重新执行：

```bash
cd extension
npm run build
```

然后去 `chrome://extensions` 点击“重新加载”。

本地服务开发时，执行：

```bash
cd local-server
npm run dev
```

