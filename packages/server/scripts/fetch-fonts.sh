#!/usr/bin/env bash
# 下载标签 PDF 用的中文字体（约 16MB，不进 git）
set -e
cd "$(dirname "$0")"
mkdir -p fonts
[ -f fonts/NotoSansSC-Regular.otf ] || curl -sSL -o fonts/NotoSansSC-Regular.otf "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"
echo "font ready: fonts/NotoSansSC-Regular.otf"
