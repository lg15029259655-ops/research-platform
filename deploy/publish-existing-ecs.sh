#!/usr/bin/env bash
# Publish a source bundle on the existing Alibaba Cloud ECS. Run as root.
set -Eeuo pipefail

base=/opt/research-platform
service_front=research-platform-frontend.service
service_back=research-platform-backend.service
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
old=$(readlink -f "$base/current")

[[ $EUID -eq 0 ]] || { echo '请以 root 运行' >&2; exit 1; }
[[ $old == "$base"/releases/* && -f "$old/frontend/server.js" && -d "$old/backend/app" ]] || {
  echo '线上发布结构与预期不同，已停止；当前版本未修改。' >&2; exit 1;
}
[[ -f "$source_dir/frontend/pnpm-lock.yaml" && -d "$source_dir/backend/app" ]] || {
  echo '发布包缺少前后端源码。' >&2; exit 1;
}

build_dir=$(mktemp -d /tmp/medread-build.XXXXXX)
new=
switched=0
cleanup() {
  status=$?
  if [[ $status -ne 0 && $switched -eq 1 ]]; then
    echo '健康检查失败，正在恢复上一版本…' >&2
    ln -s "$old" "$base/.current-rollback-$$"
    mv -Tf "$base/.current-rollback-$$" "$base/current"
    systemctl restart "$service_back" "$service_front" || true
  fi
  rm -rf -- "$build_dir"
}
trap cleanup EXIT

cp -a "$source_dir/frontend/." "$build_dir/"
cd "$build_dir"
pnpm install --frozen-lockfile
NEXT_PUBLIC_API_URL='' DEPLOY_STANDALONE=1 pnpm build
[[ -f .next/standalone/server.js && -d .next/static ]] || {
  echo 'Next.js standalone 构建不完整。' >&2; exit 1;
}

new="$base/releases/$(date +%Y%m%d%H%M%S)-medread-fix"
[[ ! -e $new ]] || { echo '发布目录已存在，请稍后重试。' >&2; exit 1; }
cp -a "$old" "$new"
mv "$new/frontend" "$new/frontend-previous"
mkdir "$new/frontend"
cp -a "$build_dir/.next/standalone/." "$new/frontend/"
mkdir -p "$new/frontend/.next/static"
cp -a "$build_dir/.next/static/." "$new/frontend/.next/static/"
if [[ -d "$build_dir/public" ]]; then
  mkdir -p "$new/frontend/public"
  cp -a "$build_dir/public/." "$new/frontend/public/"
fi
cp -a "$source_dir/backend/app/." "$new/backend/app/"
chown -R researchplatform:researchplatform "$new"

ln -s "$new" "$base/.current-next-$$"
mv -Tf "$base/.current-next-$$" "$base/current"
switched=1
systemctl restart "$service_back" "$service_front"
for attempt in {1..15}; do
  if systemctl is-active --quiet "$service_back" &&
     systemctl is-active --quiet "$service_front" &&
     curl -fsS --max-time 5 http://127.0.0.1:8100/api/health >/dev/null &&
     curl -fsS --max-time 5 http://127.0.0.1:3100/ >/dev/null; then
    switched=0
    echo "PUBLISHED $new"
    echo "PREVIOUS $old"
    exit 0
  fi
  sleep 2
done
echo '服务未通过健康检查。' >&2
exit 1
