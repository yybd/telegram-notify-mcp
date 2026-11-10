#!/bin/sh
# Builds telegram-notify-<version>.mcpb, the one-click Claude Desktop extension.
# The bundle holds manifest.json, the icon, dist/ and production node_modules only.
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
stage=build/mcpb
rm -rf build && mkdir -p "$stage"
npm run build --silent
cp -R manifest.json package.json package-lock.json LICENSE README.md dist "$stage"/
cp docs/assets/logo.png "$stage/icon.png"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --silent && rm package-lock.json)
npx -y @anthropic-ai/mcpb@2.1.2 validate "$stage/manifest.json"
npx -y @anthropic-ai/mcpb@2.1.2 pack "$stage" "telegram-notify-$version.mcpb"
