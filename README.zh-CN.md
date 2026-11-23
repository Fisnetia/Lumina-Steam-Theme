# Lumina · 流光

基于 [Millennium](https://steambrew.app) 的 Steam 桌面客户端主题：半透明的玻璃面板和菜单，背后是动态壁纸。

[English](README.md)

![库](docs/screenshots/library.jpg)

![变形导航菜单](docs/screenshots/nav-menu.gif)

![标题栏菜单](docs/screenshots/title-menus.gif)

![游戏详情页](docs/screenshots/game.jpg)

![商店](docs/screenshots/store.jpg)

安装 Millennium 后，从 [Releases](../../releases) 下载，把 `lumina` 放进 `Steam\millennium\themes`；插件 `lumina-extended` 可选，放进 `Steam\millennium\plugins`。

## 设置项

**背景**

- **背景**：玻璃后面的内容。*壁纸*（默认）可用图片、视频或 Wallpaper Engine 的 Scene；*极光*是跟随强调色的流动渐变；*亚克力*是 Windows 自带的模糊，需要 dwmx 插件。
- **壁纸**：选择图片或视频，或从 Wallpaper Engine 壁纸库中挑选。Scene 在 Steam 里实时渲染，其他窗口显示它的静态画面。
- **模糊**：背景的模糊程度（默认 4 px）。

**玻璃**

- **不透明度**：面板的深浅，数值越低越通透。
- **圆角**：面板、按钮和菜单的圆角大小。
- **游戏栏**：*经典*为贴满左侧的面板；*液态玻璃*让游戏栏悬浮，边缘折射背后的画面，菜单也随之变为液态玻璃。
- **液态玻璃不透明度**、**折射强度**（仅液态玻璃）：悬浮玻璃的着色深浅，以及背景从边缘向内弯折的范围。
- **强调色**、**玻璃着色**：选中项的颜色和面板的底色。

**动效**

- **菜单动画**：*级联*使菜单逐项展开、分类逐行展开；*淡入*为淡入效果；*关闭*则不播放动画。
- **导航菜单**：*变形*由一个面板在商店、库、社区、个人资料之间滑动切换，标题栏菜单和账户菜单同样使用；*原生*保留 Steam 自带的弹窗。
- **平滑滚动**：游戏列表的鼠标滚轮平滑。
- **壁纸鼠标响应**：Wallpaper Engine 的 Scene 跟随鼠标（视差、光标特效）。

插件 Lumina Extended 直接读取本机的 Wallpaper Engine 壁纸库（不复制文件，支持网页壁纸），并在商店、社区页面后显示当前壁纸。

---

与 Valve、Steam、Wallpaper Engine 无关联。默认壁纸为第三方插画。Scene 由 [webwallgl](https://github.com/oneincase/webwallgl)（MIT）渲染。
