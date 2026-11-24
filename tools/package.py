"""Build the theme and zip it with the plugin and install notes for sharing.

  python tools/package.py     ->  release/Lumina-<version>.zip
"""
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PLUGIN = os.path.join(ROOT, "plugin", "lumina-extended")
OUT_DIR = os.path.join(ROOT, "release")
SKIP = {".lumina-install", "__pycache__"}

NOTES = """Lumina {version}（Steam 主题，需要 Millennium）

安装
1. 先安装 Millennium：https://steambrew.app
2. 关闭 Steam，把压缩包里的两个文件夹复制到 Steam 的 millennium 目录下：
     lumina            -> Steam\\millennium\\themes\\lumina
     lumina-extended   -> Steam\\millennium\\plugins\\lumina-extended
   （Steam 默认装在 C:\\Program Files (x86)\\Steam）
3. 启动 Steam，在 Millennium 设置里：
     主题：选择 Lumina
     插件：启用 Lumina Extended（可选，见下）

插件 Lumina Extended（可选）
  直接读取 Wallpaper Engine 的壁纸库：Scene、视频、网页壁纸都不用复制文件；
  在商店、社区页面后显示当前壁纸；背景选“桌面亚克力”时让 Steam 窗口透出桌面。
  不装也能用：图片、视频和 Scene 壁纸可以在主题设置里手动选择。

设置
  在 Millennium 的主题设置里，分为背景 / 界面 / 动效三个标签页。
  默认背景是壁纸模式，用自带的默认壁纸；可以换成自己的图片、视频或 WE 壁纸。

说明
  与 Valve、Steam、Wallpaper Engine 无关联；Steam 或 Millennium 更新后可能失效。
  默认壁纸为第三方插画，版权归原作者所有。
"""


def add_tree(z, src, arc_root):
    for base, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for f in files:
            if f in SKIP:
                continue
            path = os.path.join(base, f)
            z.write(path, os.path.join(arc_root, os.path.relpath(path, src)))


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    build = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build.py"), "--offline", "--no-install"])
    if build.returncode != 0:
        sys.exit("build failed")
    version = json.load(open(os.path.join(DIST, "skin.json"), encoding="utf-8"))["version"]
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"Lumina-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        add_tree(z, DIST, "lumina")
        add_tree(z, PLUGIN, "lumina-extended")
        z.writestr("安装说明.txt", NOTES.format(version=version).replace("\n", "\r\n").encode("utf-8-sig"))
    print(f"packaged {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
