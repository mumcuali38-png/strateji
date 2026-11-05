# Kurulum G — XAUUSD Asya Range Süpürmesi (ICT Judas Swing) — Uygulama Şartnamesi

Bu belge Kurulum G'nin uygulamaya eklenmesi için gereken tüm kuralları, eşikleri, algoritmaları, veri çağrılarını ve çıktı biçimini içerir.
Diğer kurulumlardan bağımsız bir modüldür. Sadece **XAUUSD** için çalışır.

**Saat kuralı:** Strateji saati **sabit UTC-5**'tir (yaz saatinde de değişmez; kullanıcı kararı). Kodda bütün zamanlar UTC tutulur, `strateji_saati = UTC − 5 saat` ile hesaplanır, kullanıcıya **TR saati (UTC+3)** gösterilir. Sabit dönüşümler: `TR = strateji + 8 saat`.

> İstisna: Haber saatleri her zaman takvimdeki **gerçek** saatten alınır (yaz saatinde ABD 08:30 verisi strateji saatiyle 07:30'a denk gelir). Haber kuralları "08:30" sabitine değil, olayın gerçek zamanına göre çalışır.

---

## 0. Neden bu kadar sıkı? (tasarım gerekçesi)

- Altında 2 yıllık mekanik test: her Asya süpürmesini tersine almak **224 işlem, %27 kazanma, zarar**. Gece yarısı açılışı filtresi eklenince **102 işlem, %39, başa baş (PF 1,05)**.
- 26.125 günlük ölçüm: erken hareket günlerin sadece %43'ünde tersine dönmüş; **büyük erken hareketler %74 devam** etmiş.
- Sonuç: avantaj kalıbın kendisinde değil, filtrelerde (bias, gece yarısı açılışı, displacement, haber, range kalitesi). Bu yüzden aşağıdaki şartların **hepsi zorunludur**; "opsiyonel" yazanlar sadece kalite puanıdır.

---

## 1. Zaman çizelgesi (her işlem günü)

| Strateji saati (UTC-5) | TR | Olay |
|---|---|---|
| 18:00 (önceki gün) | 02:00 | İşlem günü başlar (altın seans günü 18:00–17:00) |
| 20:00–00:00 | 04:00–08:00 | **Asya range** oluşur (16 adet 15m mum) |
| 00:00 | 08:00 | **Gece yarısı açılışı (MO)**; seviyeler kilitlenir; bias yazılır |
| 00:00–02:00 | 08:00–10:00 | Erken hareket ölçülür (filtre) |
| 02:00–04:00 | 10:00–12:00 | **Süpürme penceresi** (Judas) |
| 02:00–05:00 | 10:00–13:00 | İçeri kapanış, MO kapanışı, MSS, giriş (son giriş 05:00 / 13:00 TR) |
| 08:15 | 16:15 | Haber günü kontrolü (gerçek haber saatinden 15 dk önce) |
| 12:00 | 20:00 | Kalan pozisyonun zorunlu kapanışı |

---

## 2. Veri

### 2.1 Kaynak: Twelve Data REST (uygulamanın kendi anahtarı)
- Endpoint: `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval={iv}&outputsize={n}&timezone=UTC&apikey=...`
- **`timezone=UTC` mutlaka gönderilir.** (Göndermezsen XAU zaman damgaları borsa saatinde gelir; geçmiş gözleme göre UTC+11 kaymalı. UTC isteyince dönüşüm hatası olmaz.)
- Sadece **kapanmış mumlar** kullanılır. Son mumun `datetime + interval > şimdi` ise açık mumdur, hesaplardan çıkarılır.

### 2.2 Çağrı planı ve kredi bütçesi (ücretsiz plan: 8 kredi/dk, 800/gün — asla aşılmaz)

| Zaman (strateji) | Çağrı | Adet/gün | Amaç |
|---|---|---|---|
| 00:01 | `1h`, `outputsize=1200` | 1 | ADR20, PDH/PDL, haftalık range, 4H mumlar + EMA50 |
| 00:01 | `15min`, `outputsize=40` | 1 | Asya range + MO |
| 00:15–04:45, her 15 dk (mum kapanışı + 10 sn) | `15min`, `outputsize=8` | 19 | Erken hareket, süpürme, içeri kapanış, MO kapanışı |
| 02:00–05:00, her 5 dk | `5min`, `outputsize=60` | 36 | MSS, displacement, FVG, giriş takibi |
| 05:00–12:00, her 15 dk (sadece açık işlem varsa) | `15min`, `outputsize=4` | ≤ 28 | T1/T2/stop takibi |
| Opsiyonel SMT | `EUR/USD 5min` | ≤ 36 | Varsayılan **kapalı** |

- Toplam ≈ 57–85 kredi/gün (SMT kapalı). Diğer kurulumlarla **ortak bir kredi sayacı** kullanılmalı; dakikada 8'e ulaşmadan kuyruklanmalı.
- Hafta sonu (Cuma 17:00 – Pazar 18:00 strateji saati) çağrı yapılmaz.

### 2.3 Türetilen seriler
- **4H mumlar:** 1h'den üretilir. Sınırlar strateji saatiyle **02, 06, 10, 14, 18, 22**. Eksik saatli 4H mum (hafta sonu, tatil) atılır.
- **Günlük mumlar:** 1h'den üretilir; gün = 18:00 → ertesi gün 17:00 (strateji saati). Hafta sonu yassı mumlar atılır.
- **Haftalık:** Pazar 18:00 → Cuma 17:00.

### 2.4 Veri kalitesi
- Asya range için 16 mumdan en az 12'si yoksa: **VERİ_YOK**.
- 5m serisinde ardışık 3+ mum eksikse o gün G değerlendirilmez.

---

## 3. Göstergeler ve seviyeler (kesin formüller)

| Ad | Formül |
|---|---|
| **ADR20** | Son 20 tamamlanmış günlük mumun `(high − low)` ortalaması |
| **PDH / PDL** | Bir önceki tamamlanmış günlük mumun high / low'u |
| **Haftalık range** | Önceki tamamlanmış haftanın `WH`, `WL`; `WEQ = (WH + WL)/2` |
| **EMA50 (4H)** | `k = 2/51`, ilk değer ilk 50 kapanışın SMA'sı, en az 150 adet 4H mumla ısınma |
| **Asya range** | 20:00–23:45 başlangıçlı 15m mumların `AH = max(high)`, `AL = min(low)`, `AR = AH − AL`, `AEQ = (AH+AL)/2` |
| **MO** | 00:00 başlangıçlı 15m mumun `open` değeri |
| **5m pivot** | Pivot tepe: `high(i)` önceki 2 ve sonraki 2 mumun high'ından büyük. Pivot dip: tersi. 2 mum sonra kesinleşir. |
| **Ortalama gövde (5m)** | `avgBody = SMA20(|close − open|)` (mevcut mum hariç önceki 20 mum) |
| **Bullish FVG** | 3 mumda `low(i+1) > high(i−1)` → bölge `[high(i−1), low(i+1)]` |
| **Bearish FVG** | `high(i+1) < low(i−1)` → bölge `[high(i+1), low(i−1)]` |
| **CE** | FVG orta noktası `(üst + alt)/2` |

---

## 4. Ön koşullar (00:00'da, 08:00 TR — günde bir kez)

### 4.1 Bias (üçü birden aynı yönde olmalı)
| # | LONG için | SHORT için |
|---|---|---|
| B1 — 4H EMA | Son kapanmış 4H kapanış > EMA50 **ve** EMA50 eğimi (son 5 mum farkı) ≥ 0 | Kapanış < EMA50 ve eğim ≤ 0 |
| B2 — Haftalık konum | `MO < WEQ` (discount) | `MO > WEQ` (premium) |
| B3 — Günlük hedef (DOL) | MO'nun üstünde bugün henüz alınmamış bir PDH (veya önceki hafta tepesi) var | MO'nun altında alınmamış PDL (veya önceki hafta dibi) var |

- Üçü LONG → `bias = LONG`; üçü SHORT → `bias = SHORT`; aksi halde **YOK** ("bias uyuşmazlığı").
- Bias 00:00'da yazılır ve **gün içinde değiştirilmez**.

### 4.2 Range kalitesi
- `0.15 × ADR20 ≤ AR ≤ 0.50 × ADR20` olmalı. Değilse **YOK** ("Asya range çok dar / çok geniş").

### 4.3 Haber
- 02:00–05:00 (gerçek saat → strateji saatine çevrilmiş) arasında **USD kırmızı** olay varsa → **YOK** ("pencere içinde kırmızı haber").
- Gün içinde (05:00–12:00 arası) USD kırmızı olay varsa → "haber günü" bayrağı (bkz. §9.3).

---

## 5. Erken hareket filtresi (02:00'de)

- `early = close(01:45 başlangıçlı 15m mum) − MO`
- `|early| > 0.25 × ADR20` ise:
  - `early > 0` (güçlü yukarı) → **SHORT kurulumu yok** (yukarı hareket tersine alınmaz).
  - `early < 0` (güçlü aşağı) → **LONG kurulumu yok**.
- Bias ile birleşince: örn. `bias = LONG` ve güçlü aşağı erken hareket → G o gün **YOK** ("büyük erken hareket — trend günü olabilir").

### 5.1 Erken süpürme
- 00:00–02:00 arasında bias'ın **ters** tarafı (LONG için `AL`) zaten delindiyse → o gün **YOK** ("süpürme pencere öncesi oldu").

---

## 6. Süpürme ve içeri kapanış (15m, 02:00–04:00)

Aşağıda LONG anlatılır; SHORT tam aynası (high/low, üst/alt, büyük/küçük ters).

### 6.1 İlk dokunuş kuralı
- 02:00'den itibaren 15m mumlarda **ilk** delinen taraf belirleyicidir.
- İlk delinen taraf bias tarafıysa (LONG'da `AH`) → **YOK** ("bias tarafı önce alındı — tuzak değil, bilgi").

### 6.2 Süpürme
- Pencere: başlangıç saati 02:00–03:45 olan 15m mumlar.
- `sweepBar` = `low < AL` olan ilk mum.
- `sweepExt` = süpürme başladığından MSS'e kadar görülen en düşük low (güncellenir).
- Derinlik: `AL − sweepExt ≤ AR` olmalı. Aşarsa **YOK** ("kırılım, süpürme değil").
- 04:00'ten sonra ilk delinme → **YOK** ("geç süpürme").

### 6.3 İçeri kapanış (1 saat kuralı)
- `sweepBar` dahil en fazla **4 adet 15m mum** içinde bir mum `close > AL` ile kapanmalı → `backInside = true`, zamanı `tBack`.
- Gelmezse → **YOK** ("1 saatte içeri kapanış yok — kırılım").

### 6.4 İptal
- `tBack`'ten sonra, MO kapanışından (§7) **önce** bir 15m mum `close < AL` → **YOK** ("süpürülen tarafta tekrar kapanış").

---

## 7. MO kapanışı (zorunlu)

- `tBack`'ten sonra, en geç başlangıç saati 04:45 olan 15m mumda `close > MO` → `moClose = true`.
- 05:00'e kadar gelmezse → **YOK** ("MO kapanışı yok").
- Not: MO normalde Asya range içindedir (Asya'nın son fiyatı). `MO < AL` ya da `MO > AH` olursa (Asya sonrası boşluk) bu gün G değerlendirilmez.

---

## 8. MSS + displacement + giriş (5m)

### 8.1 MSS
- `lh` = `sweepExt` oluşmadan önceki **son 5m pivot tepe** (Judas düşüşünün başladığı alçalan tepe).
- MSS: bir 5m mumun `close > lh`.
- Displacement şartı: MSS mumunun gövdesi `≥ 1.5 × avgBody` **ve** `sweepExt`'ten MSS mumuna kadar olan bacakta en az bir bullish FVG oluşmuş.
- Displacement yoksa (yavaş, küçük mumlarla kırılım) → MSS geçersiz; yeni bir MSS 05:00'e kadar beklenir.
- MSS ve MO kapanışı herhangi sırayla olabilir; **girişten önce ikisi de** olmalı.

### 8.2 Giriş bölgesi (öncelik sırası)
1. **FVG:** Displacement bacağındaki bullish FVG'lerden fiyatın altında kalan **en yenisi**. Limit = **CE**.
2. **iFVG:** FVG yoksa ya da fiyat CE'ye gelmeden yeni FVG'ler oluştuysa: manipülasyon (düşüş) bacağındaki bir bearish FVG, 5m kapanışla üstüne kırılmışsa → limit = o FVG'nin **üst kenarı**.
3. **OB:** İkisi de yoksa: displacement'tan önceki son düşüş 5m mumu → limit = `max(open, close)` (gövde üstü).
- Market emirle MSS mumunda giriş **yok**.
- Limit en geç **05:00**'e kadar dolmazsa iptal ("geri çekilme gelmedi").
- Dolmadan önce bir 5m mum `close < sweepExt` → iptal.

### 8.3 A+ işareti (zorunlu değil)
- `entry ≤ sweepExt + 0.5 × (mssHigh − sweepExt)` (Judas bacağının discount yarısı), `mssHigh` = MSS'ten sonraki ilk 5m pivot tepe veya MSS mumunun high'ı.

### 8.4 Stop
- `buffer = 0.0005 × fiyat` (≈ 4000'de $2)
- `stop = sweepExt − buffer`
- **Yuvarlak sayı kuralı:** `sweepExt`'in hemen altındaki $10 katı (`R = floor(sweepExt/10)×10`) için `sweepExt − R < 3` ise `stop = R − buffer`. (Stop emirleri yuvarlak sayıların hemen ötesinde kümelenir; bizimki o kümenin ötesinde olmalı.)
- SHORT: `R = ceil(sweepExt/10)×10`, `R − sweepExt < 3` ise `stop = R + buffer`.

---

## 9. Hedefler, RR, yönetim

### 9.1 Hedefler
- **T1** = `AH` (Asya range'in karşı tarafı).
- **STDV projeksiyonu:** manipülasyon bacağı `L = mh − sweepExt`, `mh` = 02:00'den süpürmeye kadarki en yüksek high. `S2 = sweepExt + 2L`, `S4 = sweepExt + 4L`.
- **T2 adayları** (yukarıda olanlar, yakından uzağa): `PDH`, `S2`, `S4`. RR(aday) ≥ 2.0 sağlayan **ilk** aday T2 olur.

### 9.2 RR şartları
- `risk = entry − stop`, `RR(x) = (x − entry)/risk`
- `RR(T1) ≥ 1.0` **ve** T2 bulunmuş olmalı (`RR(T2) ≥ 2.0`). Değilse **YOK** ("RR yetersiz").

### 9.3 Yönetim
| Olay | Aksiyon |
|---|---|
| T1 dokundu | %50 kapat, stop = entry (BE) |
| T2 dokundu | Kalan %50 kapat |
| Haber günü (§4.3) | Olayın gerçek saatinden 15 dk önce T1 alınmamışsa **tüm pozisyon kapatılır**; alındıysa stop BE'de kalır |
| 12:00 (20:00 TR) | Kalan pozisyon kapatılır |
| Stop | Tamamı kapanır, gün biter (aynı gün ikinci G yok) |

### 9.4 Pozisyon
- Risk: bakiyenin **%0,5**'i. `lot/ons = (0.005 × bakiye) / (entry − stop)`.
- Günde en fazla **1** G işlemi (günün ilk geçerli sinyali).
- Aynı gün **Kurulum B** aynı yönde tetiklenirse tek işlem sayılır (çift risk yok); uygulama ikincisini "aynı fikir — B ile birleşik" diye gösterir.

---

## 10. Opsiyonel güçlendiriciler (puan; durumu değiştirmez)

| Puan | Koşul |
|---|---|
| +1 SMT | Varsayılan kapalı. Açıksa: XAU `AL`'yi süpürürken aynı 15m aralığında EUR/USD kendi Asya dibini **almıyor** (XAU long için EUR/USD ile pozitif ilişki varsayılır; DXY tersi). |
| +1 Likidite kümesi | Süpürülen seviye Asya dibiyle birlikte eşit dipler (≥2 pivot, `0.1×AR` içinde) veya PDL ile çakışıyor |
| +1 FVG + OB | Giriş FVG'si bir 5m/15m OB ile aynı seviyede |
| +1 A+ | §8.3 |

Kalite: 0–1 = "normal", 2–3 = "güçlü", 4 = "A+".

---

## 11. Durum mantığı

Şart listesi (✅ / ❌ / ⏳):

| # | Şart | Bölüm |
|---|---|---|
| 1 | Veri tamam | §2.4 |
| 2 | Bias (B1+B2+B3) | §4.1 |
| 3 | Asya range kalitesi | §4.2 |
| 4 | Pencere içinde kırmızı haber yok | §4.3 |
| 5 | Erken hareket / erken süpürme filtresi | §5 |
| 6 | Doğru taraf süpürüldü (ilk dokunuş, derinlik, saat) | §6.1–6.2 |
| 7 | 1 saatte içeri kapanış | §6.3 |
| 8 | MO kapanışı | §7 |
| 9 | MSS + displacement | §8.1 |
| 10 | Giriş bölgesi + RR | §8.2, §9.2 |

- **TAM:** 1–10 ✅ → limit emir seviyesi aktif.
- **EKSİK:** hiçbiri ❌ değil, en az biri ⏳ (henüz zamanı gelmedi ya da oluşmadı).
- **"1 şart kaldı":** sadece bir şart ⏳, diğerleri ✅.
- **YOK:** herhangi biri ❌ veya iptal koşulu. YOK olunca o gün G kapanır (ertesi gün 00:00'da sıfırlanır).
- **Saat dışı:** 05:00–00:00 arası açık işlem yoksa durum "BUGÜN İÇİN BİTTİ" (sebebiyle) veya "YARIN 08:00 TR".

### 11.1 Bildirimler
| An | Metin |
|---|---|
| 08:00 TR | "G: Seviyeler hazır — AH {x}, AL {y}, MO {z}, bias {LONG/SHORT/YOK}" |
| Süpürme | "G: Asya {dibi/tepesi} süpürüldü {fiyat} — içeri kapanış bekleniyor" |
| 1 şart kaldı | "G: 1 şart kaldı: {şart}" |
| TAM | "G: XAU {LONG/SHORT} TAM — limit {e}, stop {s}, T1 {t1}, T2 {t2}, RR {r}, kalite {q}" |
| Dolum | "G: Giriş doldu {e}" |
| T1 | "G: T1 — %50 kapat, stop girişe" |
| Haber çıkışı | "G: Haber öncesi T1 yok — pozisyonu kapat" |
| İptal | "G: Bugün kurulum yok — {sebep}" |

---

## 12. Çıktı şeması (JSON)

```json
{
  "setup": "G",
  "symbol": "XAUUSD",
  "trade_date": "2026-11-06",
  "evaluated_at_utc": "2026-11-06T07:45:10Z",
  "status": "TAM | EKSİK | YOK | VERI_YOK | BITTI",
  "direction": "LONG | SHORT | null",
  "levels": {"AH": 4071.2, "AL": 4052.8, "AR": 18.4, "AEQ": 4062.0, "MO": 4060.1,
             "PDH": 4088.0, "PDL": 4031.5, "WH": 4120.9, "WL": 3866.0, "WEQ": 3993.5, "ADR20": 62.3},
  "bias": {"value": "LONG", "ema50_4h": 3990.4, "close_4h": 4060.0, "slope_ok": true,
           "weekly": "DISCOUNT | PREMIUM", "dol": "PDH 4088.0"},
  "filters": {"range_ok": true, "range_ratio": 0.30, "early_move": -4.2, "early_ratio": 0.07,
              "news_in_window": false, "news_day": {"time_tr": "16:30", "event": "US NFP"}},
  "sweep": {"side": "LOW", "bar_utc": "...", "ext": 4047.6, "depth": 5.2, "back_inside_utc": "...", "cancelled": false},
  "mo_close": {"done": true, "bar_utc": "..."},
  "mss": {"level": 4058.4, "bar_utc": "...", "body_ratio": 2.1, "fvg": [4055.9, 4057.8]},
  "order": {"type": "FVG_CE | IFVG | OB", "entry": 4056.85, "stop": 4045.6,
            "t1": 4071.2, "t2": 4088.0, "t2_source": "PDH | S2 | S4",
            "rr_t1": 1.28, "rr_t2": 2.78, "size": 0.0, "last_entry_tr": "13:00", "force_exit_tr": "20:00"},
  "quality": {"score": 2, "label": "güçlü", "flags": ["likidite kümesi", "A+"]},
  "conditions": [{"id": 1, "name": "Veri tamam", "state": "OK | FAIL | WAIT", "note": ""}],
  "conflicts": {"setup_B_same_direction": false}
}
```

---

## 13. Ekran (G bölümü)

1. Durum rozeti + yön + kalite.
2. **Günün seviyeleri kartı:** AH, AL, MO, PDH, PDL, ADR20, haftalık EQ ve bias'ın üç bileşeni (✅/❌).
3. **Zaman çubuğu (TR):** 04:00 Asya ▸ 08:00 MO ▸ 10:00 süpürme ▸ 12:00 süpürme son ▸ 13:00 son giriş ▸ 20:00 kapanış; şu anki konum işaretli.
4. **Şart tablosu:** §11'deki 10 şart, ✅ / ❌ / ⏳ + kısa not.
5. TAM ise: limit, stop, T1/T2 (kaynağıyla), RR, miktar.
6. EKSİK ise: sıradaki adım ve nasıl tamamlanır (örn. "15m'de 4060,1 (MO) üstü kapanış bekleniyor").
7. YOK ise: sebep (örn. "Bias tarafı önce alındı: Asya tepesi 10:15'te delindi").
8. **Mini grafik (15m/5m):** Asya kutusu, MO çizgisi, süpürme işareti, MSS seviyesi, FVG kutusu, giriş-stop-hedef çizgileri.
9. Haber tablosu (USD kırmızı, TR saati), 30 dk kala "HABER RİSKİ".

---

## 14. Kesin YAPILMAYACAKLAR

- Süpürme mumunda veya MSS mumunda market emirle giriş.
- Bias'ı gün içinde değiştirmek.
- Seviyeleri (AH/AL/MO) 00:00'dan sonra yeniden çizmek.
- 04:00'ten (12:00 TR) sonraki süpürmeyi Judas saymak.
- Aynı gün ikinci G işlemi.
- Kapanmamış mum üzerinden onay.
- Veri eksikken tahmini değer üretmek.

---

## 15. Test senaryoları

| # | Girdi | Beklenen |
|---|---|---|
| 1 | B1 LONG, B2 PREMIUM | YOK (bias uyuşmazlığı) |
| 2 | `AR = 0.10 × ADR20` | YOK (range dar) |
| 3 | `early = −0.30 × ADR20`, bias LONG | YOK (büyük erken hareket) |
| 4 | 01:30'da `AL` delindi | YOK (erken süpürme) |
| 5 | LONG günü, 02:15'te önce `AH` delindi | YOK (bias tarafı önce) |
| 6 | Süpürme 04:15'te | YOK (geç süpürme) |
| 7 | Süpürme derinliği `1.2 × AR` | YOK (kırılım) |
| 8 | Süpürmeden sonra 4 mumda içeri kapanış yok | YOK |
| 9 | İçeri kapandı, sonra MO'dan önce `close < AL` | YOK (iptal) |
| 10 | 05:00'e kadar `close > MO` yok | YOK |
| 11 | MSS gövdesi `1.2 × avgBody` | MSS geçersiz, ⏳ (05:00'e kadar) |
| 12 | FVG CE'ye 05:00'e kadar dönmedi | YOK (geri çekilme yok) |
| 13 | `sweepExt = 4052.4` | `R = 4050`, fark 2.4 < 3 → stop = 4050 − 2.0 = 4048.0 |
| 14 | PDH 1.6R, S2 2.3R | T2 = S2 |
| 15 | PDH, S2, S4 hepsi < 2R | YOK (RR yetersiz) |
| 16 | NFP günü, 16:15 TR'de T1 alınmamış | Tam kapanış |
| 17 | Aynı gün B aynı yönde TAM | Tek işlem, "B ile birleşik" |
| 18 | Asya'da sadece 10 mum var | VERI_YOK |

---

## 16. Kaynak özeti

- Kurallar: TradingFinder (TR kılavuz), FX Replay Judas ve AMD/PO3 (iFVG/kutu girişi, 2/4 STDV hedef), BestProps (ICT'nin orijinal Judas dersi özeti: önce HTF bias, Asya range + MO referansları, sıra tamamlanmazsa işlem yok), LuxAlgo Judas ve Session Profiles, ictkillzone (zamanlama, FVG CE girişi, T1 Asya karşı taraf), ProEA (1 saat içeri kapanış ve iptal kuralı), FXNX PO3, Tradestar (geniş overnight range uyarısı).
- Ölçümler: XAUUSD Global altın mekanik testi (MO filtresi, haber günü uyarısı, dar range uyarısı), CRTLAB 26.125 gün (büyük erken hareket devam eder), Quantex altın saatlik range (NY oturumu günlük aralığın çoğunu yapar).
- ICT 2022 Mentorship notları (süpürme + MSS + displacement + FVG = 2022 modeli), 2023 GEMS notları.
- Mikro yapı: Osler (stop emirleri yuvarlak sayıların hemen ötesinde kümelenir ve kaskad yaratır → stop yerleşimi), Ito–Hashimoto (seans açılışlarında aktivite zirvesi), Iwatsubo vd. (altında London/NY açılışlarında verimsizlik ve volatilite).
