#!/usr/bin/env bash
# data dalı yardımcıları. Kullanım: data-branch.sh pull | push "<mesaj>"
# Dal her seferinde tek commit'e sıkıştırılır (force push) — depo şişmez.
set -euo pipefail
DIR="${DATA_DIR:-data-out}"
URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
case "${1:-}" in
  pull)
    rm -rf "$DIR"
    if git clone --quiet --depth 1 --branch data "$URL" "$DIR" 2>/dev/null; then echo "data dalı alındı"; else mkdir -p "$DIR"; echo "data dalı yok — yeni oluşturulacak"; fi
    ;;
  push)
    cd "$DIR"
    if [ -d .git ] && [ -z "$(git status --porcelain)" ]; then echo "Değişiklik yok — push atlandı"; exit 0; fi
    rm -rf .git
    git init --quiet -b data
    git config user.name "strateji-bot"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add -A
    git commit --quiet -m "${2:-veri} $(date -u +%Y-%m-%dT%H:%MZ)"
    git remote add origin "$URL"
    for i in 1 2 3; do git push --quiet -f origin data && break || sleep $((i * 5)); done
    echo "data dalı güncellendi"
    ;;
  *) echo "kullanım: $0 pull|push"; exit 1 ;;
esac
