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

## Kurulum F — BTC Wyckoff (05.11.2026, docs/KURULUM_F.md)
| # | Konu | Karar | Nerede değişir |
|---|---|---|---|
| F1 | Tarama zamanlaması | Spec "mum kapanışından 10 sn sonra" der; GitHub Actions saniye hassasiyeti vermez. Hafta içi 10–20 TR ana tarama ile 5 dk'da bir, diğer tüm saatlerde `scan-f` ile 15 dk'da bir (:01/:16/:31/:46 UTC). Her seferinde 5 TF birden çekilir (Binance ücretsiz, kredi yok). Sadece kapanmış mumlar kullanılır. | `.github/workflows/scan-f.yml` |
| F2 | Short tarafı | Long kurallarının fiyat-aynası (fiyat × −1, hacim aynı). Spec'teki farklar: kararsız hacim = YOK (long'da ⏳), agresif giriş yok. | `src/f/setup.ts` |
| F3 | LPSY hedefleri | Spec short hedeflerini genel verir (T1 TR.eq); LPSY girişi zaten EQ'nun altında olduğundan LPSY için T1 = TR.low, T2 = TR.low − yükseklik (LPS'in aynası), RR(T2) ≥ 3. | — |
| F4 | 4H TR (ikincil) | 1H TR bulunamazsa 4H TR denenir; spring/UTAD yine 1H mumunda, 1H ATR ile aranır. | — |
| F5 | TR ve spring | TR, spring adayı mumundan **önceki** mumlarla hesaplanır (spring dibi TR alt bandını aşağı çekmesin). Spring son 30 adet 1H mum içinde aranır; 2 mumlu spring tek mumluya tercih edilir. | `F.springLookback1h` |
| F6 | 1D pivot N | Spec 1H/4H için N=3 der, 1D için belirtmez: 1D bölgelerde N=2. | — |
| F7 | Test anı | Test hacmi, fiyatın zone'a ilk dokunduğu saatin (kapanmış) 1H mumundan okunur; sinyal/dolum zamanı o saatteki ilk dokunan LTF mumudur. Ortak bayat kontrol dolum mumunun kendisini saymaz. | — |
| F8 | TAM – BEKLE | Şart 9 (zaman/ortam) blokluyken diğer 8 şart ✅ ise durum BEKLE (turuncu), bir kez bildirim. Blok kalkınca TAM bildirimi ayrıca gelir. | — |
| F9 | Hatalı sinyal koruması | **Dolum sonrası** (ortak kural): stop/T1 görülürse, 6 saat geçerse veya fiyat girişten 3R uzaklaşırsa YOK; T1'de "T1 – %50 kapat, stop girişe", stopta "ÇIKIŞ" bildirimi. **Dolum öncesi** (F'ye özel): CHoCH sonrası limit dolmadan T1 görülürse veya fiyat limitten 3R'den fazla uzaklaşırsa YOK — kovalanmaz (spring ve LPS; agresif limit bilerek uzakta beklediği için sadece dolum sonrası kontrol). **Veri tazeliği:** son kapanmış 1H mum 2 saatten eskiyse VERİ ESKİ, sinyal üretilmez. | `general.*`, `F.maxDataAgeMin` |
| F10 | 1 açık F işlemi | Tarayıcı günlüğü göremez; uygulama günlükte sonucu girilmemiş bir F işlemi varsa F setuplarını YOK gösterir. | uygulama |
| F11 | Miktar / kaldıraç | Miktar BTC = (bakiye × risk%) / |giriş − stop|; nominal 3 × bakiyeyi aşarsa düşürülür ve "risk %0,5'in altında kaldı" notu yazılır. Stop'a spread/tampon eklenmez (spec ATR payı içerir). | `F.maxLeverage` |
| F12 | Veri farkı | F fiyatları Binance BTCUSDT'dir; diğer stratejilerdeki BTC/USD (Twelve Data) ile birkaç dolar fark olabilir. Geçmiş değerlendirmesi de Binance 5m ile yapılır. | — |
| F13 | Kripto manşetleri | "ETF, borsa, regülasyon manşetleri gösterilir, blok koymaz": FMP başlıkları Haber → Son dakika'da zaten görünüyor; ayrı kripto filtresi yok. | — |

Doğrulama: §18'deki 13 senaryonun hepsi + temel TAM ve short (UTAD) senaryosu birim testinde (`scanner/test/f.test.ts`, sentetik veri). Geliştirme ortamından Binance/Coinbase'e erişim yoktu; gerçek veriyle ilk deneme Actions'ta `scan-f` elle çalıştırılarak yapılacak.

## Tarama zamanlaması (05.11.2026 düzeltmesi)
- **Sorun:** GitHub `*/5` zamanlamasını ilk gün yaklaşık **saatte bire** düşürdü (11:07, 12:00, 12:54, 13:48 TR). GitHub zamanlanmış görevleri yoğunlukta geciktirebilir; yeni/az hareketli depolarda bu sık olur.
- **Çözüm:** Tetiklenen `scan` işi, tarama penceresi boyunca kendi içinde **5 dakikada bir** tarar (`scripts/scan-loop.sh`; 5 dk sınırından ~20 sn sonra). Pencere kapanınca (tarayıcı çıkış kodu 3) ya da 5,5 saatte biter; sonraki zamanlanmış tetik (sırada bekleyen) döngüyü devam ettirir.
- Haber takvimi pencere içinde döngüde saatte bir çekilir; `news` ve `scan-f` iş akışları yalnız pencere dışında zamanlanır (aynı kuyrukta tarama döngüsünü engellemesinler).
- Actions sekmesinde "cancelled" görünen tarama çalışmaları normaldir: döngü çalışırken sıraya giren yeni tetikler birbirinin yerini alır.
- Pencere dışında `scan-f` (F) GitHub'ın zamanlayıcısına bağlıdır (15 dk planlı, pratikte 15–60 dk). F 1H/4H mumlarına dayandığı için kabul edildi.

## Kurulum G — XAU Judas (05.11.2026, docs/KURULUM_G.md)
| # | Konu | Karar | Nerede değişir |
|---|---|---|---|
| G1 | Veri / kredi | Spec kendi çağrı planını önerir; uygulama zaten XAU 5m'yi 5 dk'da bir çektiği için G **ek istek açmaz**: 15m/1H bu 5m'den, uzun geçmiş günde 1 kez `1h × 1200` (1 kredi) ile. Ortak kredi sayacı. | `scan.bootstrap1h*` |
| G2 | Ön pencere | Hafta içi 08:00–10:00 TR sadece XAU taranır (≈24 kredi). Sebep: GitHub'ın sabah ilk tetiği gecikebiliyor; G'nin 10:00–12:00 süpürme penceresi kaçmasın, "08:00 seviyeler hazır" bildirimi zamanında gitsin. Tam gün simülasyonu 676 kredi. | `scan.preWindowTR/Symbols` |
| G3 | Seri sınırları | 4H: 02/06/10/14/18/22, gün 18:00→17:00, hafta Pazar 18:00→Cuma 17:00 (strateji saati). Eksik saatli 4H ve 10 saatten kısa günler atılır. EMA50 için ≥150 4H mum; yoksa ⏳. | — |
| G4 | Bias | 00:00 NY'de kapanmış 4H mumlarla yazılır, gün içinde değişmez. B3: PDH (veya hafta tepesi) MO'nun üstünde ve 18:00→00:00 arasında alınmamış olmalı. | — |
| G5 | TAM anı | Spec: "1–10 ✅ → limit emir seviyesi aktif". TAM limit kurulduğunda verilir; dolum ayrıca "Giriş doldu" bildirimiyle. Dolum 5m mumlarla sırayla simüle edilir (her mumda o ana kadarki en yeni FVG CE → iFVG → OB); bu yüzden limit deterministik. | — |
| G6 | Hatalı sinyal koruması | **Dolum öncesi:** T1 (Asya karşı tarafı) dolumdan önce görülürse, süpürme ucunun ötesinde 5m kapanış olursa, 05:00 NY'ye kadar dolmazsa veya fiyat limitten 3R'den uzaksa YOK. **Dolum sonrası:** ortak kural (stop/T1 → YOK, 6 saat, 3R). Hafta sonu G çalışmaz. | `general.*` |
| G7 | Aynı tarafta iki delinme | 02:00 sonrası ilk delinen mum iki tarafı da delmişse "bias tarafı önce alındı" sayılır (temkinli). | — |
| G8 | B ile çakışma | Aynı gün B aynı yönde TAM ise G "B ile birleşik" işaretlenir, ayrı TAM bildirimi gitmez (tek işlem). | `engine.mergeGB` |
| G9 | SMT | Varsayılan kapalı (spec), hesaplanmıyor; kalite puanı likidite kümesi, FVG+OB ve A+ ile. | `G.smt` |
| G10 | Haber çıkışı / 20:00 | Dolmuş ve açık pozisyon için haberden 15 dk önce (T1 yoksa) ve 19:50 TR'de "kalan pozisyonu kapat" bildirimi. Tarama 20:00 TR'de bittiği için 20:00 bildirimi 10 dk erken gider. | `G.newsExitMin` |
| G11 | Saat dışı | 05:00 NY (13:00 TR) sonrası dolmamış kurulum "bugün için bitti" (YOK), ertesi gün 08:00 TR yeniden. | — |

Doğrulama: §15'teki 18 senaryonun hepsi + temel TAM + short (ayna) + 3 koruma testi (`scanner/test/g.test.ts`, sentetik veri). Gerçek veride ilk tam gün, `1h × 1200` geçmişi yarın sabahki ilk taramada çekildikten sonra.

## XAG/USD kaldırıldı (05.11.2026)
Twelve Data ücretsiz planında yok; `config/symbols.json`, öncelik ve 1m listeleri, uygulama menüsü ve ızgaradan çıkarıldı (MASTERPROMPT §23). Plan yükseltilirse sembol satırı geri eklenebilir.

## Gecikme (05.11.2026)
- Ölçüm: 5m mum kapanışı → tarama +20 sn → GitHub'a yazım +2 sn → bildirim ≈ +25 sn. 20 sn pay, Twelve Data'nın kapanan mumu kesinleştirmesi için (daha erken çekilirse yarım mum "kapanmış" sanılabilir).
- **Asıl gecikme `raw.githubusercontent.com`'daydı:** dal içeriğini ~5 dk önbellekte tutuyor, `?t=` bunu aşmıyor (ölçüm: 17:05:21 taraması raw'da 17:10:11'de göründü). Tarama aralığıyla birleşince ekranda ~10 dk eski veri.
- **Çözüm:** `state.json` GitHub API'den (`/contents/state.json?ref=data`, anında güncel) okunur — ama sadece taramanın beklendiği anda: her 5 dakikanın 23. saniyesinden itibaren, veri gelene kadar 10 sn arayla en fazla 3 deneme; ayrıca açılışta, ekrana dönüşte ve aşağı çekerek yenilemede. API, IP başına saatte 60 istek sınırı olduğu için sürekli yoklanmaz (≈12–36/saat). API sınıra takılırsa 10 dk raw adrese düşer. Haber/geçmiş/grafikler raw'dan, dakikada bir.
- Üst çubukta "sonraki" tarama saati gösterilir.
- 5 dakikadan sık tarama ücretsiz planda mümkün değil: 1 dakikalık tarama 5 sembolde ≈ 3000 kredi/gün (sınır 800).

## Ek Özellikler v1 — Aşama 1 (renk, ayarlar, enstrüman tablosu, kredi)

- **Renkler:** yeşil/kırmızı artık sadece yön (▲ LONG / ▼ SHORT, kartın sol kenarı). TAM 🔵 mavi `#2563EB`, EKSİK sarı `#EAB308`, YOK gri, TAM–BEKLE turuncu `#F97316`. Haber riski bandı kırmızı kalır.
- **Kredi:** uygulama sınırı dakikada 7, günde 760 (ücretsiz plan 8/800). Simülasyon tam iş günü ≈ 677.
- **Bakiye zorunlu:** girilmeden kartta lot "—" ve "AYAR GEREKLİ" yazar; bildirimde lot yazılmaz. Varsayılan bakiye 10000 kaldırıldı.
- **Enstrüman tablosu:** sembol başına broker sembolü, "1 birim hareketin 1 lottaki değeri", lot adımı, min lot, tipik spread (config/symbols.json varsayılanları, Ayarlar'dan düzeltilir). "Değerleri doğruladım"a basılmadan lot hesaplanmaz; bir değer değişirse doğrulama sıfırlanır. Eski "kontrat / lot" alanı yerine bu tablo kullanılır.
- **Lot formülü (EK §3.1):** `lot = floor( riskUSD / (stop/birim × birimDeğeri) / lotAdımı ) × lotAdımı`. US100'de QQQ mesafesi US100 puanına çevrilir. Hesaplanan lot min lotun altındaysa min lot gösterilir ve gerçek risk % uyarısı çıkar. F için kaldıraç ≤ 3× bakiye korunur; F de artık "lot" olarak gösterilir (BTCUSD 1 lot = 1 BTC varsayılanı).
- **Para birimi:** USD dışıysa kur günde 1 kez çekilir (TRY: USD/TRY Twelve Data, 1 kredi; EUR: mevcut EURUSD fiyatı, ek kredi yok). Risk tutarı USD'ye çevrilerek hesaplanır; kur yoksa lot gösterilmez. Sunucuya (abonelik tercihleri) bakiye USD'ye çevrilmiş gider.
- **Varsayılanlar:** günlük maks. zarar %2, aynı anda maks. toplam risk %1,5 (toplam risk kilidi Aşama 2'de), sessiz saatler 00:00–07:00 TR. Eski ayarlarda boş olan bu alanlar bir kereliğine bu değerlere çekilir (schema 2 göçü).
- **Sessiz saatler:** bildirim artık düşürülmez, sessiz gelir; 🔵 TAM, ⛔ iptal/ÇIKIŞ ve test bildirimi sesli.
- **Günlük kayıp limiti** bakiye girilmemişse veya bugün zarar yoksa tetiklenmez.
- **Broker bağlantısı:** şimdilik sadece "Kapalı" seçilebilir (MetaApi / EA köprüsü sonraki aşamalarda).

## Ek Özellikler v1 — Aşama 2 (emir kartı, risk kilidi, son giriş)

- **Emir kartı** TAM ve TAM–BEKLE setup kartının altında. Emir tipi limit setupta fiyatın konumuna göre **LIMIT** (giriş fiyatın iyi tarafında) veya **STOP** (giriş fiyatın ötesinde) yazılır. "Piyasa" sadece fiyat girişe 0,3R'den yakınsa seçilebilir.
- **Lot bölme:** %50 TP1 / %50 TP2. Lot adımı korunur, tek kalan TP1 parçasına eklenir (0,41 → 0,21 + 0,20). Min lot tek parçaysa bölünmez.
- **Risk** satırı, yuvarlanmış lotun stoptaki gerçek zararını gösterir (hedef riskten küçükse yanında "hedef $X").
- **Kopyala formatı:** `XAUUSD BUY LIMIT 4056.85 SL 4045.60 TP1 4071.20 TP2 4088.00 LOT 0.06 (2×0.03)`. Sembol olarak broker sembolü kullanılır. US100'de seviyeler QQQ × oran ile US100'e çevrilir; Ayarlar'da US100 fiyatı yoksa tahmini oran kullanılır ve kartta uyarı çıkar.
- **Spread kontrolü:** ayarlardaki tipik spread girişe eklenir (long +, short −). Strateji minimum RR'sinin altına düşerse "Spread ile RR yetersiz". Minimumlar: A–E TP1 ≥ 2; G T1 ≥ 1 ve T2 ≥ 2; F T2 ≥ 1,5 ve T3 ≥ 3.
- **Risk kilidi:** "BUGÜN DUR" (bugünkü zarar ≥ günlük maks. zarar %, tüm setuplar YOK) ve "RİSK DOLU" (sonucu girilmemiş işlemlerin riski + bu işlem > maks. toplam risk %; kartta kırmızı kilit, setup durumu değişmez). Hesaplar USD'ye çevrilmiş bakiyeyle yapılır.
- **Aynı fikir:** aynı paritede aynı yönde başka bir stratejide TAM varsa kartta "tek işlem aç" uyarısı (B+G birleşimi önceki gibi sunucuda da işaretlenir).
- **Son giriş (sunucuda, `lastEntry`):**
  - G: 13:00 TR.
  - C ve D1: 11:00 NY (19:00 TR).
  - F: spring/UTAD + 24 saat.
  - A, B, E: sinyalin oluştuğu killzone'un bitişi.
  - D2 ve killzone dışı sinyaller: sinyal + 6 saat (bayat sinyal sınırı).
- **Süre dolunca:** dolmamış TAM setup YOK'a düşer ("SÜRE DOLDU"). TAM bildirimi gitmişse tek seferlik orta öncelikli "⏰ SÜRE DOLDU" bildirimi gider; iptal bildirimiyle karışmaz. Dolmuş G limiti etkilenmez. Kartta geri sayım 15 sn'de bir güncellenir.
- **Haber bandı:** kart açıkken ilgili kırmızı habere ≤ 30 dk kaldıysa (veya haberden sonraki 15 dk) kırmızı "HABER RİSKİ" bandı.
- **MT5'e Gönder:** soluk ve pasif. Dokununca "MT5 bağlantısı henüz aktif değil…" mesajı çıkar. `app/broker.js`'te BrokerAdapter arayüzü, `DisabledAdapter`, magic numaraları (A=1001 … G=1007) ve yorum formatı (`G-LONG-20261106`) hazır.
- **Girdim:** gerçek giriş fiyatı ve lot sorulur (varsayılan önerilen), önerilen değerlerle birlikte günlüğe kaydedilir.
- **Girmedim:** sebep seçilir (Geç gördüm / Korktum / Kurala uymadı / Haber / Risk dolu / Spread / Diğer + not), tablette saklanır. Sanal sonuç takibi Aşama 3'te.

## Ek Özellikler v1 — Aşama 3 (canlı işlem, yönetim, ÇIKIŞ, otomatik günlük)

- **Sunucu tüm TAM sinyalleri takip eder** (`history.json` → `track`), girildi mi bilmeden; işlemler tablette (IndexedDB) kalır. Mumlardan sırayla dolum → TP1 → TP2 / BE ya da SL hesaplanır. Ek kredi harcanmaz.
- **Varsayılan yönetim:** TP1'de %50 kapat + SL girişe. Sonuç: TP2 = 0,5×RR1 + 0,5×RR2; BE = 0,5×RR1; TP1 öncesi SL = −1R; TP2 yoksa TP1'de tamamı kapanır. Aynı mumda stop ve hedef varsa stop sayılır (temkinli). Limit son giriş zamanına kadar dolmazsa DOLMADI.
- **Bildirimler:** TP1, TP2, Stop, BE ve "açık işlemde habere 15 dk" (varsayılan kural: "TP1 alınmadıysa çık ya da stop girişe çek"; G kendi kuralını, F kendi T1'ini gönderir).
  - Sadece TAM bildirimi gitmiş sinyaller için gönderilir.
  - Olay en fazla 20 dk önce olmuş olmalı; böylece ilk çalıştırmada eski olay yağmuru olmaz.
  - Telefonda o sinyale "Girdim" ile açılmış işlem yoksa bildirim **sessiz** ve "(girmedin)" etiketiyle gösterilir (service worker kontrol eder).
- **ÇIKIŞ:** dolmuş (açık) sinyal iptal olursa (bölge tükendi, stop vb.) "⛔ ÇIKIŞ" bildirimi gider; sessiz saatleri deler. Dolmamışsa eskisi gibi "İptal".
- **Canlı işlem ekranı** (menü → 💼 İşlemler): anlık fiyat (son tarama), anlık R, SL/TP'ye kalan mesafe, geçen süre, MAE/MFE, yönetim adımları. "TP1 alındı", "BE yapıldı", "Kapattım…" (çıkış fiyatı + kurallara uyuldu mu + not) butonları var. "Girdim"den sonra bu ekran açılır.
- **Otomatik günlük:** tarama takibi KAPANDI olunca işlem kendiliğinden kapanır ("oto" etiketi). R kullanıcının gerçek girişine göre yeniden hesaplanır, $ sonucu = R × risk. Kullanıcı sonradan düzeltebilir.
- **Girmediklerim:** tarama sonucu "sanal sonuç" olarak yazılır, "Kaçan R" toplamı ve sebebe göre dağılım gösterilir.
- **Bildirim merkezi** 7 günden 30 güne çıktı.
- **Hata düzeltmesi:** gece/hafta sonu F taraması geçmişteki XAU/EUR/GBP/US100 sinyallerini BTC mumlarıyla değerlendiriyordu (yanlış TP/SL). Artık sadece F olayları değerlendirilir. Takibi olmayan eski olaylar mumlar yetiyorsa bir kez yeniden değerlendirilir.

## Ek Özellikler v1 — Aşama 4 (Piyasa Yönü)

- **Kaynak erişimi** GitHub Actions sunucusundan ölçüldü (05.11.2026):
  - Binance vadeli 451 ve Bybit 403 veriyor (ABD konumu engelli). Türev verisi **OKX**'ten alınır: funding, büyük trader L/S (pozisyon), tüm hesaplar L/S, açık pozisyon 24 sa.
  - Binance spot, alternative.me, DefiLlama ve CFTC çalışıyor.
  - Farside tabloyu her istekte döndürmüyor: alınamazsa ETF parçası "veri yok" olur, ağırlık stablecoin'e kayar.
- **Kredi:** forex skorları saatlik ek kredi harcamaz. Kayıtlı mumlar kullanılır: günlük 1day×300 (önceden 60, aynı kredi), 1h×1200 (EUR, GBP, US100 eklendi, +3/gün), güncel saat ise 5m akışından. UUP ve IEF günlük 1day×300 (+2/gün). Toplam ≈ +5 kredi/gün. Kredi %90'ı geçerse Piyasa Yönü 4 saatte bir çalışır.
- **Kripto:** Binance spot 1h×1000, 4h×300 ve 1d×300 (BTCUSDT, ETHUSDT), ücretsiz.
- **Ne zaman çalışır:** saatte bir; pencere içinde ana taramada, dışında F taramasında (15 dk'da bir kontrol). Pencere dışında forex son kayıtlı mumlarla hesaplanır.
- **COT:** CFTC Legacy (sadece vadeli) non-commercial net. Kodlar: EUR 099741, GBP 096742, XAU 088691, XAG 084691, Nasdaq-100 E-mini 209742. Günde bir kez güncellenir.
- **Myfxbook (perakende %)** isteğe bağlı: `MYFXBOOK_EMAIL` ve `MYFXBOOK_PASSWORD` secret'ları eklenirse kullanılır. Yoksa pozisyonlanma sadece COT'tan hesaplanır.
- **US100:** haber sürprizi uygulanmaz (şartname yalnız EUR, GBP, XAU, XAG için tanımlıyor); ağırlığı diğer bileşenlere dağıtılır. XAG kartı "VERİ YOK" gösterir ve Forex Genel'e katılmaz.
- **Yapı (pivot N=3):** eşit tepe/dip pivotu bozmaz (eşitlik pivot sayılır).
- **Bileşen dökümünde** çubuk s değerini (−1…+1), sağdaki "p" ise skora katkıyı (puan) gösterir.
- **Etiket değişimi bildirimi:** sessiz, günde en fazla 3. Ayarlar → Bildirim'den kapatılabilir.
- **Kayıt:** skorlar saatlik olarak `direction-history.json`'a yazılır (30 gün); 24 sa değişim ve 7 günlük çizgi buradan gelir.

## Ek Özellikler v1 — Aşama 5 (Başarılı Trader'lar)

- **Kaynak doğrulaması** (05.11.2026, GitHub Actions'tan):
  - eToro'nun resmi Public API'si (`public-api.etoro.com`) anahtarsız 401 döndürüyor. Gerekenler: `x-api-key` + `x-user-key` + `x-request-id`. Anahtarı kullanıcı eToro → Ayarlar → Trading → API Key Management'tan SMS doğrulamasıyla üretir.
  - Uç noktalar OpenAPI tanımından alındı: `/api/v2/market-data/instruments?symbols=`, `/api/v1/user-info/people/search`, `/api/v1/user-info/people/{username}/portfolio/live`. Limit: uç nokta başına 60 istek/dk; istemci istekler arasında 1,1 sn bekler.
  - eToro'nun belgelenmemiş iç uç noktası (`/sapi/rankings`) anahtarsız yanıt veriyor ama **kullanılmaz**: resmi değil ve kazıma sayılır.
  - Binance lider trader verisi resmi API'de yok, **kapalı** bırakıldı.
- **Anahtar yoksa** bölme sadece Myfxbook (varsa) + COT ile çalışır ve ekranda kurulum notu görünür (şartname test 18).
- **Filtre (params.json → traders):** ≥12 ay kayıt, maks. DD (peakToValley) ≤ %20, ≥100 işlem (12 ay), son 3 ay getirisi pozitif, aylık maks. risk ≤ 6, paritede son 90 günde ≥10 işlem. Son kriter "3 aylık işlem sayısı × paritedeki işlem payı" ile yaklaşık hesaplanır. Parite başına en çok kazanan 10 trader, toplam en fazla 45 portföy isteği.
- **Sıklık:** aday listesi ve enstrüman kimlikleri 6/24 saatte bir, açık pozisyonlar 15 dk'da bir güncellenir (ana tarama ve F taraması).
- **Pozisyonlar:** trader'ın aynı paritedeki pozisyonları yatırım payıyla toplanır, net yön alınır. Kopya (social) pozisyonlar sayılmaz.
- **Uyumsuzluk bildirimi:** bizim TAM sinyalimize karşı trader'ların ≥ %70'i ters yöndeyse (en az 3 trader) tek seferlik bildirim gider.
- **Uyum satırında** %60 ve üzeri aynı yön "uyumlu", %30 ve altı "uyumsuz", arası "karışık" sayılır. Kalabalık uyarısı Myfxbook'ta %70 ve üzeri tek yönde ise çıkar.
- **OKX (BTC/ETH), 05.11.2026 eki:** eToro'ya Türkiye'den erişilemediği için kripto tarafında Trader'lar bölmesine OKX oranları eklendi.
  - **Büyük trader'lar:** OKX'te en büyük hesapların pozisyon long/short oranı.
  - **Tüm hesaplar:** OKX'teki tüm hesapların long/short oranı (kalabalık göstergesi).
  - Oran long %'ye çevrilir: oran / (1 + oran).
  - Veri Piyasa Yönü'nün saatlik önbelleğinden okunur, ek istek yapılmaz.
  - eToro trader'ı yoksa uyum satırı ve uyumsuzluk bildirimi (≥ %70 ters yön) BTC/ETH için bu büyük trader oranını kullanır.
  - Uyum satırında %60 ve üzeri "uyumlu", %40 ve altı "uyumsuz" sayılır.

## Tarama başlangıcı — GitHub zamanlama gecikmesi (06.11.2026)

- **Sorun:** GitHub'ın zamanlanmış tetikleri bu depoda saatte bire kadar gecikiyor. 06.11'de 08:00 TR ön penceresi tetiklenmedi: gece F ve haber işleri ~saatte bir çalıştı, ana tarama hiç başlamadı.
- **Erken başlatma:** pencere dışında çalışan `scan-f` işi, bir sonraki pencereye ≤ 150 dk kaldıysa ve sırada ya da çalışan ana tarama yoksa `scan.yml`'yi `wait=true` ile tetikler. Bu iş pencere açılana kadar bekler, beklerken 15 dk'da bir F taraması yapar, tam açılışta (08:00 / 10:00 TR) taramaya başlar. İş süresi sınırı 360 dk; bekleme süresi döngüden düşülür.
- **Kendini devam ettirme:** döngü süre sınırına geldiğinde pencere hâlâ açıksa `scan.yml`'yi kendisi yeniden tetikler. Aynı concurrency grubunda sıraya girer ve hemen ardından başlar; zamanlanmış tetik beklenmez.
- **Kredi göstergesi:** günün ilk taramasından önce dünkü sayı yerine 0 gösterilir (sayaç UTC 00:00 = 03:00 TR'de sıfırlanır).
