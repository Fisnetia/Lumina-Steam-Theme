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

- **Backdrop**: what shows behind the glass. *Wallpaper* (default) takes a picture, a video or a Wallpaper Engine scene; *Aurora* is an animated gradient in the accent color; *Acrylic* is the Windows blur and needs the dwmx plugin.
- **Wallpaper**: a picture or video file, or an item from the Wallpaper Engine library. Scenes run live in Steam; other windows show a still of them.
- **Blur**: how much the backdrop is blurred (default 4 px).

**Glass**

- **Opacity**: how dark the panels are; lower is clearer.
- **Corner radius**: rounding of panels, buttons and menus.
- **Game list**: *Classic* is a full-height panel; *Liquid glass* floats the list with edges that bend the backdrop, and turns the menus and the bottom bar into liquid glass as well.
- **Liquid opacity** and **Refraction** (Liquid glass only): the tint of the floating panes, and how far in from the edges the backdrop bends.
- **Accent** and **Glass tint**: the selection color and the base color of the panels.

**Motion**

- **Menu animation**: *Cascade* unrolls menus item by item and unfolds collections row by row; *Fade* fades them in; *Off* disables the animations.
- **Nav menu**: *Morph* uses one panel that slides between Store, Library, Community and profile, shared with the title bar and account menus; *Native* keeps Steam's popups.
- **Smooth scrolling**: mouse-wheel smoothing in the game list.
- **Wallpaper mouse**: Wallpaper Engine scenes follow the mouse (parallax and cursor effects).

The Lumina Extended plugin reads the Wallpaper Engine library in place (no copying, web wallpapers included) and shows the current wallpaper behind the Store and Community pages.

---

Not affiliated with Valve, Steam or Wallpaper Engine. The default wallpaper is third-party artwork. Scenes are rendered with [webwallgl](https://github.com/oneincase/webwallgl) (MIT).
