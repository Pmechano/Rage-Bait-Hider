# Rage Bait Hider（油猴试用版 v0.2.1）

在 B 站普通视频页自动过滤评论、楼中楼和普通弹幕。使用 Jev 的一个 `should_hide` 含义的是非判断，默认概率达到 **0.30** 就隐藏。未完成判断、判断缺失、网络失败的内容也保持隐藏。

## 安装

1. 安装并启用 Tampermonkey。如果浏览器提示，请开启 Tampermonkey 所需的“允许运行用户脚本”权限。
2. 点击[安装脚本](https://raw.githubusercontent.com/Pmechano/Rage-Bait-Hider/main/rage-bait-hider.user.js)，在 Tampermonkey 中确认安装。如果浏览器只显示源码，可选择“添加新脚本”，复制完整内容替换默认模板并保存。
3. 刷新一个 B 站普通视频页。右下角会出现“净”按钮与设置面板。
4. 粘贴你自己的 Jev API Key，或点击 **导入 Key 文件** 选择本地保存 Key 的文本文件，然后点击 **保存并应用**。“测试连接”会发出一次小额真实 API 请求。

脚本安装后不能自行读取电脑上的文件，所以首次需要通过文件选择器导入。Key 不在可分享的脚本中，只保存在 Tampermonkey 的脚本存储里；不要分享 `jevapi.txt` 或含 Key 的油猴备份。

从旧版升级：在 Tampermonkey 中打开已安装的脚本，用本版完整内容替换并保存，再刷新视频页。脚本名称与存储标识未变，已保存的 Key 和设置会保留。

## 自动更新

从 v0.2.1 起，脚本的 `@updateURL` 和 `@downloadURL` 指向本仓库 `main` 分支的原始脚本文件。开启 Tampermonkey 的脚本更新检查后，会按检查周期获取新版；也可以手动检查更新。更新后刷新视频页即可运行新版。

此前通过复制源码安装的版本，需要先手动升级一次到 v0.2.1，才能获得更新地址。后续发布时，修改脚本、提高 `@version` 并推送到 `main`；仅推送代码但不提高版本号不会触发正常的版本更新。更新检查需能访问 `raw.githubusercontent.com`。

## 使用

- **隐藏阈值**越低越严格。`0.30` 是激进的试验起点，不代表已验证的准确率。
- **屏蔽标准**可以自行修改。每条内容只问一个问题，批量请求中的 `item_0` 等仅用来对应不同的评论/弹幕，并非多个分类维度。
- **暂停过滤**会显示原始评论和原生弹幕；恢复过滤后重新启用遮挡。
- **重试**用于接口失败后恢复。鉴权失败或连续请求失败会暂停新模型请求，避免无限重试。
- **查看与排查**中可临时显示本页全部评论，或主动查看最多 100 条已隐藏内容。
- 阈值变化复用已有概率；屏蔽标准、标题、正文或父评论变化会重新判断。缓存只保存内容摘要对应的概率，不持久保存评论原文，最多 5,000 条、有效期 14 天。

## 覆盖范围与限制

### 评论

支持已知的新式多层 Shadow DOM 评论结构和旧式评论结构；持续监听滚动加载、展开楼中楼及正文变化。所有**页面已加载**的评论都会处理，未加载的评论会在出现时自动处理。不会主动爬取视频的全部历史评论，也不会自动点击展开按钮。

在新版评论区，可取得一级评论作为回复的背景；不保证能还原完整对话或精确找到某条二级回复的被回复对象。仅分析文字及有文字说明的表情，不分析图片像素；纯图片、无法识别或超长评论默认隐藏。

### 弹幕

本版保留 B 站原生弹幕元素，由播放器负责时间、轨道、运动和显示设置。脚本只遮挡尚未判断或判定应隐藏的文字；判断通过后解除自身遮挡，不强制显示原生播放器已关闭或屏蔽的内容。已移除旧版独立绘制的弹幕层。

- 监听已知原生弹幕容器中元素的新增、移除、复用和文字变化。元素复用时先撤销旧判断的放行标记，旧异步结果不能放行新文字。
- 按视频 CID 请求 `web/view`，读取实际分段数量，再通过 `web/seg.so` 预取普通弹幕。优先读取当前播放段，随后处理其余段落；预取和页面出现的相同文字共用判断，避免重复请求模型。
- 只在判断通过后解除遮挡。若判断完成时弹幕仍在播放，会从当时的原生位置显示；若已经离场，不补发弹幕。
- 原生弹幕开关、字号、透明度、密度等设置继续由播放器处理。脚本不会另行重排轨道，也不会绕过原生屏蔽结果。
- Canvas 弹幕无法逐条通过 DOM 识别，因此已知容器内的 Canvas 保持隐藏。高级/BAS/互动层和无法识别的内容也保持隐藏；本版不切换播放器渲染方式，不挂接私有弹幕数据库。不支持直播、番剧及画中画弹幕。
- 弹幕接口可能因登录状态、风控或 B 站改版受限。预取失败时会在面板显示原因，仍可在原生 DOM 文字出现时判断；模型请求失败时，未取得有效判断的内容保持隐藏。接口返回的池子不等于全部历史弹幕。

面板分别显示原生显示层适配状态、预取状态和弹幕文本判断数量。弹幕数量按去重后的文字统计，不代表播放器显示次数。

默认在脚本开始运行后先遮挡再评估；浏览器未允许运行脚本、脚本注入过晚或网站结构发生变化时，不能保证无闪现或全覆盖。也不能保证语义判断零漏网。

## 数据与费用

发送到 `https://api.typesafe.ai/v1/systemone` 的内容：视频标题、目标正文、内容类型，以及可取得的父评论。不会主动发送 B 站账号、Cookie 或 API Key 给其他服务。B 站请求仅使用 B 站自己的接口。

Key 用于 TypeSafe 的 Authorization 请求头。脚本没有公共代理和远程依赖。默认每批最多 12 条内容、最多 2 个模型请求同时进行，并处理限流重试。热门视频可能有大量弹幕，自动判断会消耗你的 API 额度；可以随时暂停或关闭弹幕过滤。面板显示本页会话内累计请求及输入 tokens。

## 文件

- `rage-bait-hider.user.js`：安装到油猴的完整脚本。
- `jevapi.txt`：你的私有 API Key，已加入 `.gitignore`，不会被脚本读取或打包。
- `tests/rbh.test.cjs`：纯逻辑及浏览器夹具测试，不使用真实 Key、不调用真实 API。
- `tests/verify-api.py`：手动真实接口冒烟测试，会读取本目录的 Key 并产生一次 API 调用。

## 开发验证

只运行纯逻辑检查：

```bash
node --check rage-bait-hider.user.js
node tests/rbh.test.cjs
```

浏览器测试需要 Node.js 与兼容的 Playwright/Chromium。设置 `RBH_BROWSER_TESTS=1`，并在非标准安装位置时设置 `RBH_PLAYWRIGHT_PATH` 为 Playwright 包路径，再运行同一测试文件。测试使用本地模拟的视频页、Shadow DOM、弹幕二进制和 API 响应，不等同于真实 B 站页面的端到端验证。

真实 API 测试（会消耗额度，输出不含 Key）：

```bash
python3 tests/verify-api.py
```

## 接口参考

本版已通过 17 项纯逻辑/Chromium 夹具测试，覆盖原生样式与开关保留、节点复用、过期异步结果、分段数量、预取去重、接口失败、Canvas 遮挡和页面切换。旧版已完成一次真实 Jev 批量接口测试；本次未改变模型请求格式，也未重复付费接口测试。开发环境访问 B 站接口返回 HTTP 412，尚未完成登录状态下真实 B 站视频页的端到端验证；安装后请先查看面板中的弹幕状态。

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [Noul 是非判断](https://docs.typesafe.ai/primitives/noul)
- [Tampermonkey 文档](https://www.tampermonkey.net/documentation.php)
- [弹幕 protobuf 消息定义（社区整理）](https://github.com/Janson20/bilibili-api-collect-mirror/blob/master/grpc_api/bilibili/community/service/dm/v1/dm.proto)

## 设计参考

参考 Bilibili-Evolved 在提交 `9535fa6cade09148b817334e1e940ab1052759c5` 中的原生弹幕观察与分段读取方式，本项目独立实现，无该项目的运行时依赖：

- [原生弹幕元素观察与复用处理](https://github.com/the1812/Bilibili-Evolved/blob/9535fa6cade09148b817334e1e940ab1052759c5/src/components/video/video-danmaku.ts)
- [新版播放器弹幕容器](https://github.com/the1812/Bilibili-Evolved/blob/9535fa6cade09148b817334e1e940ab1052759c5/src/components/video/player-agent/bpx.ts)
- [弹幕信息及分段读取](https://github.com/the1812/Bilibili-Evolved/blob/9535fa6cade09148b817334e1e940ab1052759c5/registry/lib/components/video/danmaku/converter/danmaku-segment.ts)

## 版本管理

Git 已在本目录初始化，分支为 `main`。初始实现保存在提交 `88387be`；后续改动单独提交，可通过 `git log --oneline` 查看。`jevapi.txt`、私有脚本副本、依赖目录和测试输出均由 `.gitignore` 排除。
