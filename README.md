# Lumina

A glass theme for the Steam desktop client, built on [Millennium](https://steambrew.app): translucent panels and menus over a live wallpaper.

[中文](README.zh-CN.md)

![Library](docs/screenshots/library.jpg)

![Morphing nav menu](docs/screenshots/nav-menu.gif)

![Title bar menus](docs/screenshots/title-menus.gif)

![Game page](docs/screenshots/game.jpg)

![Store](docs/screenshots/store.jpg)

Install Millennium, then put `lumina` from a [release](../../releases) in `Steam\millennium\themes`; the optional `lumina-extended` plugin goes in `Steam\millennium\plugins`.

## Settings

**Backdrop**

- **Backdrop**: what shows behind the glass. *Aurora* (default) is a live, code-drawn aurora in the accent color; *Wallpaper* takes a picture, a video or a Wallpaper Engine scene; *Acrylic* is Windows desktop blur and requires the Lumina Extended plugin.
- **Wallpaper**: a picture or video file, or an item from the Wallpaper Engine library. Scenes run live in Steam; other windows show a still of them.
- **Blur**: how much the backdrop is blurred (default 0 px).
- **Wallpaper mouse**: Wallpaper Engine scenes follow the mouse (parallax and cursor effects).
- **Desktop blur** (Acrylic backdrop only): *Soft* (default) uses lighter Windows DWM blur that keeps desktop shapes clearer; *Strong* uses heavier frosted acrylic.

**Interface**

- **Game list**: *Liquid glass* (default) refracts the backdrop with colour dispersion along the edges (WebGL-accelerated for library panes); *Acrylic* uses frosted blur with fine grain. Both share the same floating cards, capsules and bottom bar.
- **Liquid opacity** and **Refraction** (Liquid glass only): the tint of the floating panes (default 30%), and how far in from the edges the backdrop bends (default 55%).
- **Blur** (Acrylic only): how much the panels and menus blur what's behind them (default 2 px); capsules blur a little less.
- **Opacity**: how dark the panels are; lower is clearer.
- **Corner radius**: rounding of panels, buttons and menus.
- **Nav position**: where the Store / Library / Community capsule sits. *Center* puts it in the title bar (on a second row when the window is too narrow); *Left* and *Right* put it on a second row, which on web pages it shares with the URL bar at the other end.
- **URL bar**: *Always* (default) keeps Steam's URL bar on library and other Steam pages too, showing the page's path (such as `steam://library/home`; clicking copies it), so the layout doesn't shift between pages; *Web pages* shows it on Store and Community pages only.
  A pencil button at the end of the URL bar turns the address into an input: type a web address or a `steam://` link and press Enter to go there.
- **Accent** and **Glass tint**: the selection color and the base color of the panels.

**Motion**

- **Menu animation**: *Cascade* unrolls menus item by item and unfolds collections row by row; *Fade* fades them in; *Off* disables the animations.
- **Nav menu**: *Morph* uses one panel that slides between Store, Library, Community and profile, shared with the title bar and account menus; *Native* keeps Steam's popups.
- **Smooth scrolling**: mouse-wheel smoothing in the library (game list and right pane).

The Lumina Extended plugin reads the Wallpaper Engine library in place (no copying, web wallpapers included), shows the current wallpaper behind the Store and Community pages, and enables Windows desktop acrylic (no separate dwmx plugin needed). Enable it under Plugins in Millennium's settings. If *Wallpaper Engine…* still opens a folder picker, the wallpaper card says why; `Steam\millennium\logs\lumina-extended_log.log` lists the library folders it found.

---

Not affiliated with Valve, Steam or Wallpaper Engine. The default wallpaper is third-party artwork. Scenes are rendered with [webwallgl](https://github.com/oneincase/webwallgl) (MIT).
