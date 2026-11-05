# KARARLAR — varsayılanlar ve belirsiz kurallar

> MASTERPROMPT §0: "Belirsiz bir kural görürsen varsayılanı uygula, parametre yap, Ayarlar'dan değiştirilebilir bırak ve buraya not düş."
> Parametrelerin çoğu `config/params.json`'dadır; Ayarlar → Parametreler ekranı bu dosya için kopyalanabilir öneri üretir.

## Genel
| # | Konu | Karar | Nerede değişir |
|---|---|---|---|
| 1 | Trend sayımı | CHoCH yönü çevirir ve BOS sayacını **0**'a indirir; sonraki her BOS +1. İlk kırılım (yön bilinmiyorken) BOS=1. Trend ≥2, güçlü ≥3. | `trend.minBos/strongBos` |
| 2 | Swing fraktalı | Sol `n` mumdan kesin büyük, sağ `n` mumdan büyük/eşit (eşit tepelerde ilki swing). Swing, sağdaki `n` mum kapanınca "onaylı" sayılır. | `swing` |
| 3 | MSS | Kırılım bacağında (bacak başlangıcı → kırılım mumu) en az bir displacement mumu olan CHoCH. | `displacementMult` |
| 4 | Order block | Displacement'lı BOS/CHoCH bacağının başlangıcından geriye en fazla 5 mum içindeki son ters renkli mum + bitişik en fazla 2 ters renkli mum. | — |
| 5 | Mitigasyon | Bölgeye **ilk temas** (fiyatın bölgeye girmesi) = mitige; **kapanışla** uzak kenarın ötesine geçiş = kırıldı/silindi. | — |
| 6 | Breaker / mitigation block | Kırılan OB daha önce likidite aldıysa → breaker; almadıysa ve kıran mum displacement ise → ICT mitigation block. | — |
| 7 | FVG minimum boyutu | ATR(14)×0.05'ten küçük boşluklar yok sayılır. | `fvgMinAtr` |
| 8 | "Güçlü gövde" (A çıkış/dönüş, D2 momentum) | Displacement (gövde ≥ 1.5× son 20 mum ort. gövdesi) **ve** gövde/boy ≥ %50. | `strongBodyRatio` |
| 9 | En yakın likidite (hedef) | 15m/1H/4H alınmamış swing'ler + eşit tepe/dipler + önceki gün/hafta H/L + son 4H mum H/L. Girişe ATR(15m)×0.3'ten yakın seviyeler gürültü sayılır. | `targetMinAtr15m` |
| 10 | RR kontrolü | A/B/D1/E: TP1'e göre. C: TP1 veya TP2'den (STDV −2) biri ≥2. D2 dönüş: TP2'ye göre (kural gereği). | `risk.minRR` |
| 11 | Stop tamponu | Stop = yapısal uç ± (tampon + spread). Varsayılan spread: XAU 0.20, XAG 0.02, EUR 0.8 pip, GBP 1.2 pip, BTC %0.02, ETH %0.03, US100 1 puan. Uygulama kendi Ayarlar'daki tamponla yeniden hesaplar; RR 2'nin altına düşerse kartta uyarı. | `symbols.json`, Ayarlar → Enstrüman |
| 12 | US100 tampon/lot | QQQ ↔ US100 oranı varsayılan **41** (Ayarlar'da US100 fiyatı girilirse gerçek oran). Lot hesabında QQQ stop mesafesi US100 puanına çevrilir. | `us100PerQqq` |
| 13 | Günlük mum (1D) | 5m'den NY gün sınırıyla üretilir; 5m geçmişinden eski günler için Twelve Data `1day` mumu (UTC gün sınırı — 5 saatlik fark kabul edildi). | — |
| 14 | Geçersiz/eskimiş TAM | A: 3×5m, B: 24 onay-TF mumu sonra sinyal "kullanıldı". Stop/TP görülünce senaryo biter (stop → ⛔ iptal bildirimi). | `A/B.signalValidityBars` |
| 15 | Veri yetersiz şartlar | ❌ değil ⏳ işaretlenir (uydurulmaz, §13). | — |

## Kurulum A
- **Çizgi ömrü:** §3'te "son tamamlanmış 4H mumu" ve "en geç 2. mumda alınmazsa silinir" birlikte geçiyor. Karar: X mumunun çizgisi X+1 ve X+2 mumları boyunca aktiftir; bu yüzden aynı anda son **iki** kapanmış 4H mumunun çizgileri değerlendirilir (en yeni önce). `A.lineLifeCandles = 2`.
- Zayıf gövdeli dışarı kapanış sayılmaz, güçlü kapanış beklenmeye devam edilir; zayıf **içeri** dönüş çizgiyi geçersiz kılar.
- Giriş varsayılanı kapanışta piyasa emri; alternatif "çizgi retest limiti".

## Kurulum B
- HTF bölgeler: 4H ve 1H (`B.zoneTfs`). Günlük/haftalık bölge tablosu destekleniyor ama 5m'den üretilen geçmiş kısa olduğundan varsayılan kapalı (`"1d"` eklenebilir → 1H onay).
- Bölge adayı: fiyata 4×ATR içinde, mitige edilmemiş veya teması onay penceresi içinde olan en yakın 3 bölge (TF başına).
- Onay: yalnız **CHoCH** (displacement'lıysa MSS etiketi), temas (veya likidite süpürmesi) zamanından itibaren 12 onay-TF mumu içinde; yapı ucu bölgeye 1×ATR yakın; yapı yüksekliği ≤ 1.5×ATR.
- Varsayılan giriş breaker retest; RR<2 ise sırayla FVG, LTF OB denenir (§5 "daha iyi RR veren temiz yapı").
- RSI uyumsuzluğu (★) için RSI 14 kullanıldı.

## Kurulum C
- **"NY 10:00'da açılan 4H mum":** 4H hizalaması 00/04/08/12/16/20 olduğundan 10:00'da 4H mumu açılmaz. Karar: varsayılan **10:00–14:00 özel penceresi** (`C.tnmCandleMode = "from10"`); OTE 0.5 bu mumun o ana kadarki aralığının ortası. `"aligned"` seçilirse 08:00–12:00 mumu kullanılır.
- Manipülasyon: 10:00'dan sonra bias'a ters bir likiditeye (5m/15m swing, eşit tepe/dip, PDH/PDL, NY 18:00/00:00 açılışı) iğne + gövdeyle geri dönüş **veya** bias yönlü PD array'e temas.
- QQQ sadece seans saatlerinde işlem gördüğü için NY 18:00/00:00 açılışları çoğunlukla "—" görünür.
- Rejection block girişi C'de ayrıca aranmaz (FVG → breaker/OB → MSS seviyesi sırası).

## Kurulum D
- **D1 red mumu:** dokunma toleransı 0.5×ATR(1m); iğne ≥ gövde; ters renkli kapanışa yalnızca iğne ≥ 2×gövde ise izin.
- **D1 hedef:** 5m/15m likidite, günün (açılış öncesi) high/low'u ve tam sayılar (adım = 10^(basamak−2): XAU 10, EUR 0.01, BTC 1000…).
- **D2 range tespiti:** son 12–60 mum, iki uçta da uç bölgesinde (uç mumun gövde–iğne arası, en az 0.25×ATR) en az 2 ayrı swing; en güncel aralık tercih edilir.
- D2 kırılım: momentum kapanışı → ters renkli geri çekilme mumu → geri çekilme öncesi ucun ötesinde kapanış; giriş flip limit, hedef range yüksekliği projeksiyonu.
- D2 dönüş onayı: 1H → 5m, 4H → 15m CHoCH, süpürmeden sonra 12 LTF mumu içinde (`D.d2.confirmMaxBars`).

## Kurulum E
- Günlük bias = son daily kırılım yönü; PDH/PDL alınma bilgisi gösterilir ama bias'ı değiştirmez.
- PD array teması: 4H RB için 1D+4H bölgeleri, 1H RB için 4H+1D+1H; ayrıca NY 00:00 / hafta açılışı ve son daily swing'in 78.6–88.6 Fib bandı. **Opening gap henüz hesaplanmıyor.**
- Kırılım: RB TF'si veya bir altında MSS/BOS ya da CISD (RB öncesi aynı yönlü mum serisinin açılışının kapanışla geçilmesi).
- Durum: kırılım sonrası gövde seviyesine **dönüş** son şarttır → "1 şart kaldı" = limit beklemede; dönüş olunca TAM. Dönüp ≥1 ATR uzaklaşıp tekrar gelirse "kullanılmış".
- "RB içinde RB" inceltmesi kartta ayrı yöntem (gövde kenarından %15 içeri limit) olarak verilir; alt TF'de küçük RB taraması henüz otomatik değil.

## Haber
- Forex Factory saat başı (`news.yml`, :07). Takvim 2 saatten eskiyse "takvim eski" uyarısı.
- Büyük teknoloji bilançoları (FMP) yalnız US100'e bağlanır; saati belirsizse NY 16:05 (seans dışı) kabul edildi.
- Haber riski bildirimi: kırmızı habere ≤30 dk kala bir kez.

## Kredi ve tarama
- Artımlı çekimde `outputsize` son mumdan bu yana boşluk kadar (en az 6, en çok 600): Twelve Data kredisi istek başına sayıldığından ek maliyet yok, Actions gecikmelerinde mum kaybı olmaz.
- Bütçe: her sembole (bu istek + günün kalan taramaları) öncelik sırasıyla ayrılır; sığmayan atlanır. Test: tam iş günü **767 kredi** (< 790).
- QQQ için 16:30–20:00 TR penceresi spec'teki gibi; kış saatinde ABD seansı 17:30'da açıldığı için ilk ~12 çekim boş/eski veri döndürebilir (kredi harcar). İstenirse `scan.qqqTR` `["17:30","20:00"]` yapılabilir.
- Cron 07:00–16:55 UTC her gün; hafta sonu çalışmalar kod içinde hemen çıkar (kripto hafta sonu açıksa BTC/ETH taranır).

## Bildirim
- Strateji×sembol, "Hazırlan", sessiz saat tercihleri **abonelik kodunun içinde** (`prefs`) taşınır ve sunucuda uygulanır (Chrome, gösterilmeyen push'a izin vermediği için cihazda filtreleme yapılmadı). Tercih değişince kod yeniden kopyalanmalı.
- Bildirimdeki lot, abonelik kodundaki bakiye/risk ile hesaplanır.
- "Test bildirimi gönder" butonu cihazda yerel bildirim gösterir; gerçek sunucu testi Actions → scan → `push_test`.
- VAPID anahtarı Ayarlar'da tarayıcıda üretilebilir (hiçbir yere gönderilmez). Actions loglarında anahtar yazdırılmaz (public depo).

## Uygulama
- Günlük işlem / kayıp limiti (§20 açık nokta): Ayarlar'da opsiyonel; doluysa günlüğe göre tüm setuplar YOK gösterilir (sadece uygulamada; tarayıcı günlüğü görmez).
- Vanilla JS (framework yok), toplam uygulama JS ≈ 92 KB.

## Geriye dönük kuru çalıştırma (§18)
- Komut: `cd scanner && DATA_DIR=<veri> npm run backtest -- 10` veya Actions → scan → `backtest: true` (sonuç `data` dalında `backtest.md` / `backtest.json`).
- **Gerçek verili 10 günlük çalıştırma henüz yapılamadı:** geliştirme ortamından Twelve Data'ya erişim yoktu ve depoda henüz kayıtlı mum yok. `TWELVE_DATA_KEY` eklendikten ve birkaç gün tarama biriktikten sonra `backtest` girdisiyle çalıştırın; bulunan setuplar grafikte kontrol edilebilir.
- Altyapı sentetik veriyle denendi (rastgele yürüyüş, 5 iş günü, 580 tarama, ~15 sn). Örnek çıktı (gerçek piyasa DEĞİL):

| Tarih (TR) | Strateji | Sembol | Yön | Model | Giriş | Stop | TP1 | RR | Sonuç |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-02 10:00 | D | GBPUSD | LONG | D2 · 1H range dönüşü | 1.35646 | 1.35575 | 1.35925 | 3.90 | TP |
| 2026-11-02 10:00 | D | XAGUSD | LONG | D2 · 1H range dönüşü | 47.251 | 47.164 | 47.649 | 4.56 | DOLMADI |
| 2026-11-04 18:15 | D | XAUUSD | LONG | D1 · ORB | 3970.36 | 3969.56 | 3973.38 | 3.80 | açık |

Rastgele veride A/B/C/E (temiz trend ve yapı gerektirir) setup üretmedi; bu kurulumlar elle hazırlanmış mum dizileriyle birim testlerinde doğrulandı (`scanner/test/strategies.test.ts`).

## Gerçek veriyle ilk tarama sonrası (05.11.2026)
- **XAG/USD Twelve Data ücretsiz planında yok** ("Grow plan" hatası). Plan hatası alınan sembol `credits.json → unavailable` listesine yazılır, **7 gün boyunca istenmez** (kredi yakılmaz), arayüzde uyarı gösterilir. Plan yükseltilirse 7 gün sonra kendiliğinden yeniden denenir.
- Kredi bütçesi, kalan taramaları artık **pencere başlangıcından** (10:00 TR) sayar; pencere öncesi elle çalıştırmada semboller gereksiz yere atlanmaz.
- **D2 geçerlilik süresi (05.11.2026 düzeltmesi):** Dönüş setupı, onaydan sonra fiyat TP1'e (EQ) ulaşırsa ("giriş fırsatı geçti, kovalanmaz") veya onay 24 LTF mumundan eskiyse biter (`D.d2.signalValidityBars`). Kırılım setupı stop/projeksiyon görülünce veya 6 TF mumundan sonra biter (`D.d2.breakoutValidityBars`). Önceden eski bir BTC dönüş sinyali fiyat 4% uzaklaşmışken TAM görünüyordu.
- Özet kartı ve bildirimde TP2 varsa RR ikisiyle birlikte gösterilir ("RR 1.2 / TP2 3.4"); D2 dönüşünde kural TP2'ye göredir.
- **Ortak bayat sinyal kontrolü (tüm stratejiler, 05.11.2026):** Sinyal oluştuktan sonra stop veya TP1 görüldüyse, sinyal 6 saatten eskiyse (`general.maxSignalAgeHours`) ya da fiyat girişten 3R'den fazla uzaklaştıysa (`general.maxEntryDistR`) setup YOK olur ("Sinyal güncel mi ❌"). E'de kırılımdan sonra 24 mum içinde gövdeye dönüş olmazsa ya da dönüş olmadan hedef görülürse RB biter (`E.returnMaxBars`). Kayıtlı 7 günlük gerçek veride 673 tarama yeniden oynatıldı; bayat TAM kalmadı.
- **Kripto hafta sonu açıldı (05.11.2026, kullanıcı isteği):** Cumartesi–Pazar 10:00–20:00 TR yalnız BTC/ETH çekilir ve değerlendirilir (~240 kredi/gün, hafta içi bütçesini etkilemez). Diğer semboller hafta sonu değerlendirilmez (Cuma verisiyle eski sinyal üretmesin). D1 hafta sonu da NY 09:30 range'ini kullanır.
