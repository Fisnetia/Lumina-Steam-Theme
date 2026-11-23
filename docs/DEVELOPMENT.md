# 开发说明

面向修改 Lumina 的人：构建方式、调试工具、各功能的实现细节和踩过的坑。用户说明见 [README](../README.zh-CN.md)，进度见 [PROGRESS.md](../PROGRESS.md)。

## 构建

Steam 的界面类名都是哈希值（比如 `._3mz8wQ6Q44B8P7pzPP4Iyw`），而且会随 Steam 更新变化。所以 `src/` 里的 CSS 和 JS 只写可读的名字，交给构建脚本替换：

```css
{{GameListEntryContainer.Selected}}   /* 同时定义了 GameListEntryContainer 的模块里的 Selected 类 */
{{TopBar}}                            /* 定义了 TopBar 的模块里的 TopBar 类 */
```

构建脚本读取本机 Steam 的 `steamui` 文件，提取当前版本的类名对照表，把占位符换成真实类名，输出到 `dist/`。某个名字在当前 Steam 里找不到时，构建直接报错，不会悄悄失效。

```powershell
python tools/build.py                  # 构建到 dist/ 并安装进 Millennium 的 themes 目录
python tools/build.py --plugin         # 同时安装插件；旧名 lumina-we 的安装目录会被删除
python tools/build.py --offline        # 复用 tools/classmap.json，不重新解析 Steam
python tools/package.py                # 打包成 release/Lumina-<版本>.zip（主题 + 插件 + 安装说明）
python tools/classmap.py find PlayBar          # 按可读名搜索类名
python tools/classmap.py hash _3mz8wQ6Q44B8P   # 反查哈希类名
```

**Steam 更新后主题坏了**：重新跑一次 `python tools/build.py`。报错列出的就是被 Steam 改名或删掉的类名，用 `classmap.py find` 找到新名字替换即可。

## 调试

用 `-dev` 或 `-cef-enable-debugging` 参数启动 Steam，会在本机 8080 端口开放调试接口（正常启动不开）。

```powershell
python tools/cdp.py shot shots/now.png         # 截主窗口
python tools/cdp.py eval "<js>"                # 在主窗口执行 JS；--title 指定其他窗口
python tools/opaque.py                         # 列出遮住玻璃效果的不透明层（带可读类名）
python tools/menutest.py 社区 3                 # 悬停打开顶部导航菜单 3 次，检查动画
```

- CSS 可以热重载：给主题的 `<link>` 的 href 加上 `?v=时间戳`。JS 改动要重启 Steam。
- `Page.captureScreenshot` 带 `clip: { x, y, width, height, scale }` 可以按倍数重新渲染某块区域，用来截高清特写。窗口隐藏时截图会卡住。
- 调试接口注入的鼠标事件不经过 Windows 的窗口命中测试，拖动区域、独立弹窗窗口挡鼠标这类问题要用真实鼠标复现。

各功能的测试脚本（都会先备份当前壁纸，测完还原）：

| 脚本 | 测试内容 |
|---|---|
| `wallpapertest.py [--video]` | 存储和换背景（图片、视频） |
| `scenetest.py <壁纸文件夹>` | 用 `DOM.setFileInputFiles` 交给页面 `scene.pkg`，检查渲染帧率 |
| `plugintest.py [--use <id>] [--gpu]` | 插件的 `Status` / `List`、文件服务；`--gpu` 量 Steam 的 GPU 占用 |
| `closetest.py`、`firstopen.py`、`inpagemenu.py` | 菜单收回动画、首次打开、主窗口内菜单 |
| `expandtest.py`、`collapsetest.py`、`dblclicktest.py` | 库分类展开、折叠、双击 |
| `scrolltest.py`、`perftest.py` | 平滑滚动、性能对比 |
| `morphtest.py` | 变形导航菜单（商店页和游戏库各一遍） |

## 文件结构

```
src/skin.json                    主题清单：窗口补丁 + 设置项
src/css/root-colors.css          取色器（强调色、玻璃着色）
src/css/base.css                 所有窗口共用：变量、滚动条、菜单、变形菜单面板
src/css/library.css              主窗口：标题栏、库、游戏详情页
src/css/friends.css              好友列表和聊天窗口
src/css/conditions/              各设置项对应的 CSS（背景、菜单动画、游戏栏等）
src/js/menu-anim.js              菜单动画补丁：补播首次打开的动画、延迟隐藏弹窗播收回动画
src/js/library-anim.js           库分类展开、折叠动画，切换游戏和打开分类页时的进场动画
src/js/smooth-scroll.js          库游戏列表的鼠标滚轮平滑滚动
src/js/morph-nav.js              变形菜单：导航、标题栏菜单、账户菜单
src/js/url-bar.js                URL 栏胶囊换地址时的宽度动画
src/js/liquid-glass.js           液态玻璃的折射滤镜（游戏栏、菜单面板）
src/js/wallpaper.js              壁纸设置卡片、WE 预览图墙，各窗口的图片 / 视频 / Scene / 网页壁纸
src/js/i18n.js                   中文界面下的设置页文字
src/vendor/webwallgl/            Wallpaper Engine 场景渲染引擎（MIT，第三方，原样复制）
plugin/lumina-extended/          可选配套插件：壁纸库列表、本机文件服务、共享背景静态图
tools/                           构建、打包、调试和测试脚本
```

## 设置

- Millennium 的主题设置只支持下拉、开关、滑块（`"slider": { cssVariable, min, max, step, unit }`，值直接写成 `:root` 上的 CSS 变量）和取色器。键名和选项值是英文（也是配置键），中文由 `i18n.js` 在中文界面下改写显示文字。改键名会重置用户的设置。
- 设置页画在主窗口里，每个设置项是 Steam 的 Field 组件，带 `data-condition="设置项名"`。Millennium 没有按条件显示设置项的功能：液态玻璃的两个滑块由"经典"对应的条件样式隐藏。
- 下拉项通过条件 CSS 生效，脚本读条件 CSS 里的变量（如 `--lm-morph-nav`、`--lm-liquid`、`--lm-wall-mouse`）。主题样式表重载期间变量会短暂读不到，这时沿用上一次的值。
- 标题栏等深色面板的不透明度是"不透明度 + 17%"，主窗口内的菜单面板是"不透明度 + 24%"；液态玻璃模式下两者改用"液态玻璃不透明度"。

## 壁纸

- 主题写不了自己的文件夹，所以不装插件时，壁纸存在 IndexedDB 里（所有 Steam 窗口同源），单个文件上限 600 MB，用 BroadcastChannel 通知各窗口刷新。`wallpaper.js` 复制一个滑块行（`InlineWrapShiftsChildrenBelow`）作为模板，在"背景"后面插入壁纸卡片。
- 视频壁纸是在背景层（主窗口的外框、好友窗口的 body）最前面插一个 `<video class="lm-video-layer">`，所以 JS 里也要用到 Steam 的类名，`build.py` 同样替换 JS 里的占位符。
- Scene 用 webwallgl 渲染，只在用到时加载，只在主窗口渲染；按模糊程度降低渲染分辨率（模糊 ≥16px 时一半），30 帧。
- 其他窗口显示静态画面：主窗口渲染约 2.5 秒后，从画布截一帧（webwallgl 的画布保留绘制缓冲，可以直接复制）存进 IndexedDB 的 `frame`（换壁纸时清空）并广播；截到之前用预览图的第一帧，所以 GIF 预览不会在背景里循环。动图只在主窗口里动。
- Steam 界面盖在画布上，画布收不到鼠标，所以主窗口的鼠标移动每帧转发一次给它；设置关闭时把指针放回中心；点击属于界面，不转发。
- 挂载过程中窗口可能从隐藏变为可见，所以挂载完成时如果窗口已经可见，要主动恢复播放。
- 视频、Scene、网页壁纸在窗口最小化或隐藏时暂停。实测（3D 引擎占用，8 秒平均）：静态图片 0%，Scene 约 2%，视频约 2%（视频解码不算在内）。液态玻璃开启后多几个百分点。

## 配套插件 lumina-extended

- 后端是 Lua：读 Steam 的 `libraryfolders.vdf` 找到所有 `steamapps/workshop/content/431960`（以及 Wallpaper Engine 的 `projects/myprojects`），提供 `Status`、`List`、`SetStill`。主题通过 `Millennium.callServerMethod` 调用（主窗口里它在 `window.opener`，也就是 SharedJSContext 上）。
- 文件由后端用 Windows API 隐藏启动的 `backend/server.ps1`（PowerShell `HttpListener`）提供：只监听 `localhost`，网址必须带 128 位随机令牌，只允许访问壁纸库目录和共享目录内的文件，支持 Range；插件进程退出时它也退出。
- 商店、社区是另一个网站，读不到客户端的 IndexedDB。主窗口每次换背景静态图时，通过 `SetStill` 把它交给插件，存在临时文件夹的 `lumina-extended-share`（文件服务的最后一个根目录）；网页从 `Status().still` 取地址，作为模糊加深的背景（至少 12px，只在壁纸模式下）。

## 菜单

- 下拉菜单、托盘菜单都是单独的透明小窗口。`ContextMenuPopup` 是这个窗口 `<html>` 上的类，不能给它或外层容器涂底色，否则整个方形窗口都会被涂实，圆角后面露出方角。只给 `.contextMenu` 这一层上色。独立窗口模糊不到背后，所以底色接近不透明。
- Steam 会复用菜单窗口和里面的元素，普通 CSS 动画只播第一次。每次打开时 Steam 给 `.contextMenu` 加上 `ready` 类，动画绑在它上面。
- 收回动画纯 CSS 做不了：去掉 `ready` 后约 30ms，Steam 就调用弹窗的 `SteamClient.Window.HideWindow`。`menu-anim.js` 包住这个调用：先加 `lm-closing` 播收回动画，等 `--lm-menu-close` 的时长过去再隐藏；途中再次打开就取消隐藏。
- 画在主窗口内部的菜单（库的筛选、游戏右键菜单）关闭时节点直接被删。`menu-anim.js` 在删除的那一刻（绘制之前）原位放回一个副本播收回动画。阴影很深，裁剪范围要比菜单框多出 60px。
- 菜单窗口在 Steam 启动时预先建好。第一次打开时，Chromium 偶尔只算出了动画样式却没启动动画，`menu-anim.js` 在显示后的第一帧检查并重新触发。
- Steam 测量弹出菜单尺寸的时机不固定，热重载 CSS 后窗口可能还是旧尺寸；改了菜单尺寸要重启 Steam 再看。

### 变形菜单（morph-nav.js）

用一个共用的玻璃面板替代 Steam 的导航弹窗，打开时选择绘制位置：

- Steam 自绘的页面（库、设置等）：面板是主窗口里的元素，用 `backdrop-filter` 真实模糊。
- 网页视图页面（商店、社区，判断依据是面板区域下有可见的 `.BrowserWrapper`）：网页视图盖在主窗口之上，所以面板画在 Store 导航弹窗里，用 `SteamClient.Window.MoveTo/ResizeTo` 移到导航栏下方，用接近不透明的底色。这个弹窗是真实窗口，显示着就会截走鼠标（即使内容透明），所以下一次打开改用主窗口面板时立即隐藏它，不等淡出。

导航项的悬停在 window 捕获阶段拦下（包括 relatedTarget 指向导航项的 mouseout），原生弹窗不会打开；菜单项从 SharedJSContext 的 `g_PopupManager` 里对应的隐藏弹窗读出，点击时转发给原生菜单项，由 Steam 完成跳转；读不到时退回原生弹窗。万一原生弹窗仍被打开（导航项上带 `MenuOpen`），鼠标移到别处时补发一个 mouseout 让 Steam 关掉它。位置和尺寸由一个 rAF 补间驱动，变量用 `--lm-m*`（`--x` / `--y` 在 Steam 里不生效）。

同一个面板也接管了标题栏菜单（Steam、视图、好友、游戏、帮助）和账户菜单，这些是点击打开：标题栏菜单打开后划过相邻菜单名会切换；点面板外、Esc 或窗口失焦时关闭。打开期间窗口的拖动区域临时失效，否则在标题栏空白处按下鼠标会被系统当成拖动窗口，网页收不到。Add a Game 的菜单是 Steam 每次点击时临时生成的，接管要等它生成才能读到内容，比原生慢一拍，所以保留原生菜单。

## 液态玻璃（liquid-glass.js）

- 折射是 SVG `feDisplacementMap`，作为 `backdrop-filter: url(#id)` 使用，位移图按面板尺寸和圆角用 canvas 生成：边缘一圈（折射带）里的像素从更靠内的位置取样，越靠边越强。
- 位移必须小于折射带宽度的一半左右（平方衰减时边缘位移 ≤ 0.45 × 宽度），否则取样位置不再单调，画面会在折射带里对折，出现一条接缝。往外取样不可行：`backdrop-filter` 取不到元素外的画面，只会拉长边缘像素。
- 游戏栏在尺寸稳定后重新生成；菜单面板很小，变形时每帧重新生成。另有每秒一次的检查，补上窗口隐藏期间错过的尺寸变化。

## 库

- 游戏列表是 react-virtualized 虚拟列表：每行绝对定位，只渲染看得到的部分，行会复用。展开分类时 `library-anim.js` 监听分类标题去掉 `SingleLine` 类的那一刻，给下面的行加 `lm-row-in`。
- 折叠分两段：Steam 响应折叠图标上的 `click`，脚本先拦下点击让游戏淡出，再重放点击；折叠后下面的行从原位置（`--lm-shift`）滑上来。
- 双击：原生 Steam 双击图标会触发 click、click、dblclick，切换三次。主题只吞掉图标上的 `dblclick`；不能按点击计数（`detail` ≥ 2）去吞，鼠标不动时计数会一直累加。
- 平滑滚动：Steam 的鼠标滚轮一格直接跳 100px，`smooth-scroll.js` 接管游戏列表的滚轮，每帧把 `scrollTop` 往目标推一段；用 `wheelDelta` 是否为 120 的倍数区分滚轮和触控板。连续滚动时主线程耗时约为原生的 2 倍多（几乎都是 Steam 的样式重算），但掉帧更少。
- 切换游戏、打开分类页时，Steam 会在路由变化后的一帧或更久才渲染完，所以先把页面藏起来（`lm-page-wait`），等内容变化后连续两帧按时再播放进场动画。
