#!/bin/bash
cd "$(dirname "$0")"
echo "🏗️  正在构建天脈知識庫..."
node build.mjs && npx serve dist -p 3000 &
sleep 2
open http://localhost:3000
echo "✅ 已启动，浏览器应自动打开 http://localhost:3000"
echo "关闭此窗口即可停止服务"
wait
