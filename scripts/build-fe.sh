#!/bin/sh
# Đóng gói FE tĩnh vào dist/ để deploy (Vercel).
# Chỉ copy theo danh sách cho phép: ảnh CCCD trong repo (images/, BE/test_images/,
# FE/images/portrait_test.jpg) KHÔNG được public ra URL.
set -eu

# Báo rõ file nào thiếu (ví dụ bị .vercelignore loại) thay vì lỗi cp khó hiểu.
for required in FE/index.html FE/config.js FE/css FE/js FE/data FE/images/anviet-logo-512h.png; do
  if [ ! -e "$required" ]; then
    echo "Thiếu $required. Kiểm tra .vercelignore và các file trong FE/." >&2
    exit 1
  fi
done

rm -rf dist
mkdir -p dist/images

cp FE/index.html dist/
cp -R FE/css FE/js FE/data dist/
cp FE/images/anviet-logo-512h.png dist/images/

# FE/config.js: địa chỉ BE. Có biến môi trường API_BASE (đặt trên Vercel) thì ghi đè.
if [ -n "${API_BASE:-}" ]; then
  printf 'window.APP_CONFIG = { apiBase: "%s" };\n' "$API_BASE" > dist/config.js
else
  cp FE/config.js dist/
fi

echo "Đã build FE vào dist/"
