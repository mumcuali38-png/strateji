#!/usr/bin/env bash
# Tarama döngüsü: GitHub'ın zamanlanmış görevleri */5 ayarını saatte bire kadar geciktirebildiği için
# tetiklenen iş, tarama penceresi boyunca kendi içinde 5 dakikada bir tarar (mum kapanışından ~20 sn sonra).
# - WAIT_MAX_MIN > 0 ise (scan-f'in pencereden önce tetiklediği iş) pencere açılana kadar bekler; beklerken
#   15 dk'da bir F taraması yapar ve tam açılışta (08:00 / 10:00 TR) taramaya başlar.
# - Süre sınırına gelince pencere hâlâ açıksa kendini yeniden tetikler (zamanlanmış tetiği beklemez).
# Haber takvimi döngü içinde saatte bir çekilir (news iş akışı sadece pencere dışında çalışır).
# ⭐ kurulumlar (config/star.json enabled): döngü 7/24 sürer. Pencere dışında A–H taranmaz; ⭐ her 5 dk, F 15 dk'da bir.
set -uo pipefail
WAIT_MAX="${WAIT_MAX_MIN:-0}"
STAR=$(node -e "try{console.log(require('./config/star.json').enabled?1:0)}catch{console.log(0)}")
waited=0
news_if_stale() {
  age=$(node -e "try{const j=require(process.env.DATA_DIR+'/news.json');console.log(Math.round((Date.now()-j.fetchedAt)/60000))}catch{console.log(9999)}")
  if [ "$age" -ge 55 ]; then ( cd scanner && npm run --silent news ) || echo "::warning::Haber çekilemedi"; fi
}
if [ "$WAIT_MAX" -gt 0 ] && [ "$STAR" != 1 ]; then # ⭐ açıkken döngü zaten 7/24 — beklemeye gerek yok
  m=$(cd scanner && npx --no-install tsx src/next-window.ts)
  if [ "$m" -gt 0 ] && [ "$m" -le "$WAIT_MAX" ]; then
    echo "Pencere $m dk sonra açılıyor — bekleniyor (bu sırada 15 dk'da bir F taraması)"
    start_at=$(( $(date +%s) + m * 60 + 20 ))
    while [ "$(date +%s)" -lt "$start_at" ]; do
      ( cd scanner && FORCE=1 npm run --silent scan-f ) || echo "::warning::F taraması hata verdi"
      news_if_stale
      bash scripts/data-branch.sh push "F taraması (bekleme)" || true
      left=$(( start_at - $(date +%s) ))
      [ "$left" -le 0 ] && break
      sleep $(( left < 900 ? left : 900 ))
    done
    waited=$m
  elif [ "$m" -gt "$WAIT_MAX" ]; then echo "Pencere $m dk sonra — beklenmeyecek kadar uzak, çıkılıyor"; exit 0; fi
fi
# İş süresi sınırı 360 dk: bekleme süresi döngüden düşülür
MAX_MIN="${LOOP_MAX_MIN:-330}"
MAX_MIN=$(( MAX_MIN - waited ))
[ "$MAX_MIN" -lt 30 ] && MAX_MIN=30
end=$(( $(date +%s) + MAX_MIN * 60 ))
first=1
PT="${PUSH_TEST:-0}"
while :; do
  echo "::group::Tarama $(date -u +%H:%M:%S) UTC"
  if [ "$first" = 1 ]; then FORCE="${FORCE_FIRST:-0}"; else FORCE=0; fi
  ( cd scanner && FORCE="$FORCE" PUSH_TEST="$PT" npm run --silent scan ); code=$?
  first=0; PT=0
  if [ "$code" = 3 ] && [ "$STAR" != 1 ]; then echo "Tarama penceresi kapandı — döngü bitti"; echo "::endgroup::"; break; fi
  if [ "$code" = 3 ]; then
    # Pencere dışı: F (Binance) 15 dk'da bir — scan-f ana pencere açıksa kendiliğinden çıkar
    if [ $(( 10#$(date -u +%M) % 15 )) -lt 5 ]; then ( cd scanner && npm run --silent scan-f ) || echo "::warning::F taraması hata verdi"; fi
  elif [ "$code" != 0 ]; then echo "::warning::Tarama hata kodu $code — sonraki turda tekrar denenecek"; fi
  if [ "$STAR" = 1 ]; then ( cd scanner && npm run --silent scan-star ) || echo "::warning::⭐ taraması hata verdi"; fi
  news_if_stale
  bash scripts/data-branch.sh push "tarama" || echo "::warning::data dalına yazılamadı"
  echo "::endgroup::"
  now=$(date +%s)
  if [ "$now" -ge "$end" ]; then
    m=$(cd scanner && npx --no-install tsx src/next-window.ts)
    if { [ "$m" = 0 ] || [ "$STAR" = 1 ]; } && [ -n "${GH_TOKEN:-}" ]; then
      # Zamanlanmış tetik saatlerce gecikebiliyor: pencere açıkken döngüyü kendimiz devam ettiriyoruz
      gh workflow run scan.yml --ref "${GITHUB_REF_NAME:-main}" -f force=false && echo "Süre sınırı — döngü yeniden tetiklendi" || echo "::warning::Yeniden tetiklenemedi — zamanlanmış tetik devam ettirecek"
    else echo "Süre sınırı — pencere dışında, döngü bitti"; fi
    break
  fi
  sleep $(( 300 - now % 300 + 20 ))
done
exit 0
