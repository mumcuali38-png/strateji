#!/usr/bin/env bash
# Tarama döngüsü: GitHub'ın zamanlanmış görevleri */5 ayarını saatte bire kadar geciktirebildiği için
# tetiklenen iş, tarama penceresi boyunca kendi içinde 5 dakikada bir tarar (mum kapanışından ~20 sn sonra).
# Pencere kapanınca (scan çıkış kodu 3) veya süre sınırına gelince biter; bir sonraki tetik devam ettirir.
# Haber takvimi döngü içinde saatte bir çekilir (news iş akışı sadece pencere dışında çalışır).
set -uo pipefail
MAX_MIN="${LOOP_MAX_MIN:-330}"
end=$(( $(date +%s) + MAX_MIN * 60 ))
first=1
PT="${PUSH_TEST:-0}"
while :; do
  echo "::group::Tarama $(date -u +%H:%M:%S) UTC"
  if [ "$first" = 1 ]; then FORCE="${FORCE_FIRST:-0}"; else FORCE=0; fi
  ( cd scanner && FORCE="$FORCE" PUSH_TEST="$PT" npm run --silent scan ); code=$?
  first=0; PT=0
  if [ "$code" = 3 ]; then echo "Tarama penceresi kapandı — döngü bitti"; echo "::endgroup::"; break; fi
  [ "$code" != 0 ] && echo "::warning::Tarama hata kodu $code — sonraki turda tekrar denenecek"
  # Haber: news.json 55 dk'dan eskiyse (Forex Factory saatte bir, daha sık değil)
  age=$(node -e "try{const j=require(process.env.DATA_DIR+'/news.json');console.log(Math.round((Date.now()-j.fetchedAt)/60000))}catch{console.log(9999)}")
  if [ "$age" -ge 55 ]; then ( cd scanner && npm run --silent news ) || echo "::warning::Haber çekilemedi"; fi
  bash scripts/data-branch.sh push "tarama" || echo "::warning::data dalına yazılamadı"
  echo "::endgroup::"
  now=$(date +%s)
  if [ "$now" -ge "$end" ]; then echo "Süre sınırı — sonraki tetik devam ettirecek"; break; fi
  sleep $(( 300 - now % 300 + 20 ))
done
exit 0
