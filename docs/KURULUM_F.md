# Kurulum F — BTCUSD Wyckoff (Spring / UTAD) — Uygulama Şartnamesi

Bu belge, Kurulum F'nin uygulamaya eklenmesi için gereken tüm kuralları, eşikleri ve algoritmaları içerir.
Diğer kurulumlardan (A, B, C, D, E) tamamen bağımsız bir modüldür. Sadece **BTCUSD** için çalışır.
Tüm saatler **UTC** olarak hesaplanır; kullanıcıya **TR saati (UTC+3)** olarak gösterilir.

---

## 1. Veri kaynakları

### 1.1 Ana kaynak: Binance (herkese açık, API anahtarı gerekmez)
- Endpoint: `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval={iv}&limit={n}`
- Dönen dizi elemanları: `[openTime(ms, UTC), open, high, low, close, volume(BTC), closeTime, quoteVolume, trades, ...]`
- Kullanılan zaman dilimleri ve en az mum sayısı:

| interval | limit | Kullanım |
|---|---|---|
| `1d` | 120 | Günlük talep/arz bölgeleri |
| `4h` | 300 | 50 EMA filtresi, 4H bölgeler, 4H TR |
| `1h` | 300 | Ana TR, spring/UTAD, ATR, göreli hacim |
| `15m` | 300 | CHoCH ve giriş bölgesi (varsayılan) |
| `5m` | 300 | CHoCH alternatifi (daha hassas) |

- **Sadece kapanmış mumlar kullanılır.** Son eleman `closeTime > now` ise açık mumdur, hesaplardan çıkarılır (sadece "canlı fiyat" için kullanılabilir).
- Binance'in istek limitleri bu kullanım için fazlasıyla yeterli. Twelve Data kredisi bu modülde **hiç harcanmaz**.

### 1.2 Yedek kaynak
- Binance erişilemezse: Coinbase `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity={60|300|900|3600|21600|86400}`
  - Dönen format: `[time(s), low, high, open, close, volume]` (sıra farklı, dikkat). 4H granularity yok: 1H'ten 4H üretilir (UTC 00/04/08/12/16/20 sınırları).
- İkisi de yoksa durum: **"VERİ YOK"** (analiz yapılmaz, tahmin üretilmez).

### 1.3 Haber
- Diğer kurulumlarla aynı haber modülü (Forex Factory takvimi). F için ilgili olaylar: **USD kırmızı** olaylar (CPI, Core CPI, FOMC kararı + basın toplantısı, NFP, PCE, GDP öncü). Kripto özel olaylar (ETF, borsa, regülasyon) manşet olarak gösterilir ama otomatik blok koymaz.

### 1.4 Tarama zamanlaması
- 1H ve 4H değerlendirmesi: her saat başı mum kapanışından **10 sn sonra**.
- 15m/5m değerlendirmesi: ilgili mum kapanışından 10 sn sonra, **sadece aktif bir spring/UTAD/SOS adayı varken** (gereksiz istek yok).
- Günlük bölgeler: günde 1 kez, 00:00:10 UTC.

---

## 2. Göstergeler (kesin formüller)

| Ad | Formül |
|---|---|
| **EMA50 (4H)** | Standart EMA, `k = 2/(50+1)`, ilk değer = ilk 50 kapanışın SMA'sı. En az 300 mum ile hesapla (ısınma). |
| **ATR14 (1H, 4H)** | Wilder: `TR = max(H−L, |H−Cprev|, |L−Cprev|)`, ilk ATR = ilk 14 TR ortalaması, sonra `ATR = (ATRprev×13 + TR)/14`. |
| **Göreli hacim RV** | `RV(i) = volume(i) / SMA20(volume, i−20 … i−1)` (mevcut mum hariç önceki 20 mum). |
| **Kapanış konumu CP** | `CP = (close − low) / (high − low)`; `high == low` ise `CP = 0.5`. |
| **Pivot (swing) tepe/dip** | Pivot tepe: `high(i)` hem önceki `N` hem sonraki `N` mumun high'ından büyük. Pivot dip: tersi. `N = 3` (1H, 4H), `N = 2` (15m, 5m). Pivot ancak `N` mum sonra kesinleşir. |
| **Tolerans tol** | `tol = 0.25 × ATR14(1H)` (1H TR için); 4H TR için `0.25 × ATR14(4H)`. |

---

## 3. Yön filtresi

- `bias = LONG` eğer son kapanmış 4H kapanış > EMA50(4H) **ve** EMA50 eğimi (son 5 mum farkı) ≥ 0.
- `bias = SHORT` eğer kapanış < EMA50 **ve** eğim ≤ 0.
- Diğer durumlar: `bias = NÖTR` → **YOK** ("yön net değil").
- Long kurulumlar sadece `LONG`, short kurulumlar sadece `SHORT` iken aranır.

---

## 4. HTF ilgi bölgesi (zorunlu)

Şema boşlukta işlem görmez. TR, bir Günlük veya 4H bölgenin içinde/kenarında olmalı.

### 4.1 Talep bölgesi (long için) — 4H ve 1D ayrı ayrı taranır
Aşağıdakilerden herhangi biri:
1. **OB (order block):** Son düşüş mumu (close < open) ve hemen ardından gelen yükseliş hareketi: `(hareketin tepesi − OB mumunun low'u) ≥ 1.5 × ATR14(o TF)` ve bu hareket önceki pivot tepeyi kapanışla kırmış (BOS). Bölge = `[OB.low, OB.open]`.
2. **Bullish FVG:** 3 mumluk yapıda `low(i+1) > high(i−1)`. Bölge = `[high(i−1), low(i+1)]`.
3. **HTF eşit dipler:** En az 2 pivot dip birbirine `0.25 × ATR(o TF)` mesafede. Bölge = `[min dip − 0.25×ATR, max dip]`.

**Geçerlilik (mitigasyon):** Oluştuktan sonra hiçbir mum bölgenin alt sınırının **altında kapanmamış** olmalı. Altında kapanış = bölge silinir.

### 4.2 Arz bölgesi (short için)
Ayna kurallar: son yükseliş mumu + aşağı BOS (`[OB.open, OB.high]`), bearish FVG (`high(i+1) < low(i−1)`), HTF eşit tepeler. Bölge üst sınırının **üstünde kapanış** = bölge silinir.

### 4.3 Çakışma şartı
- Long: `TR.low` (bkz. §5) bir talep bölgesinin içinde **veya** bölgeye `0.5 × ATR14(4H)` mesafede.
- Short: `TR.high` bir arz bölgesinin içinde veya `0.5 × ATR14(4H)` mesafede.
- Hiç bölge yoksa: **YOK** ("HTF bölge yok").
- Kalite etiketi: Günlük bölge = "güçlü", 4H bölge = "normal". İkisi birden = "çok güçlü".

---

## 5. Yatay bölge (TR) tespiti — 1H (birincil), 4H (ikincil)

### 5.1 Algoritma (1H)
1. Son 300 kapanmış 1H mumdan pivot tepe ve dipleri çıkar (N=3).
2. **Önceki trend şartı:** TR başlangıcından önceki 48 mum içinde en az `3 × ATR14` büyüklüğünde tek yönlü hareket olmalı (birikim için düşüş, dağıtım için yükseliş).
3. Son 120 mum içinde aday sınırlar:
   - **Alt bant:** fiyat seviyeleri `tol` içinde kümelenen pivot dipler. En az **2** dip.
   - **Üst bant:** aynı şekilde kümelenen pivot tepeler. En az **2** tepe.
   - `TR.low = alt kümedeki en düşük pivot dip` (SC/ST bölgesi), `TR.high = üst kümedeki en yüksek pivot tepe` (AR bölgesi).
4. Geçerlilik şartları (hepsi):
   - Süre: ilk temas ile son temas arası **≥ 12 mum**.
   - Yükseklik: `1.5 × ATR14 ≤ TR.high − TR.low ≤ 8 × ATR14`.
   - Mumların en az **%70'i** `[TR.low, TR.high]` içinde kapanmış.
5. `TR.eq = (TR.high + TR.low) / 2`.
6. Birden fazla aday varsa: en son temas tarihi en yeni olan, eşitse temas sayısı fazla olan seçilir.
7. **Eskime:** TR'nin son temasından 72 mum (3 gün) geçtiyse TR "eski" etiketi alır ve puanı düşer (destek/direnç zamanla zayıflar). 168 mum sonra TR silinir.

### 5.2 Wyckoff olay etiketleri (gösterim + kalite puanı için)
| Olay | Tespit |
|---|---|
| **SC** (satış doruğu) | TR öncesi düşüşün en düşük 1H mumu; `RV ≥ 1.5` (tercihen ≥ 2). |
| **AR** (otomatik toparlanma) | SC'den sonra, ilk ST'den önceki en yüksek pivot tepe. TR.high'ı tanımlar. |
| **ST** (ikinci test) | SC low'una `tol` içinde dönen pivot dip; bu mumun `RV < SC mumunun RV'si`. |
| **BC / AR / ST** (dağıtım) | Ayna. BC = yükselişin en yüksek mumu, `RV ≥ 1.5`. |

Eksik olaylar TR'yi geçersiz yapmaz; ama SC + AR + ST'nin üçü de varsa kalite "+1".

### 5.3 Ek güç işaretleri (puan, zorunlu değil)
- **İtki kısalması:** TR içindeki son 3 düşüş bacağının uzunluğu art arda kısalıyor.
- **Sıkışma:** Spring'den önceki son 4 mumun `(high−low)` ortalaması, TR içi ortalama mum boyunun %60'ından az.
- **Eşit dipler:** Alt bantta en az 2 dip birbirine `tol/2` içinde → likidite havuzu, spring hedefi.

---

## 6. Faz durumu

| Faz | Koşul |
|---|---|
| **A** | SC (veya BC) ve AR oluştu, ST henüz yok. |
| **B** | TR geçerli, fiyat TR içinde, spring/UTAD yok. |
| **C** | Son 12 kapanmış 1H mum içinde geçerli spring (long) veya UTAD (short). |
| **D** | Spring/UTAD sonrası SOS (bkz. §9) gerçekleşti. |
| **E** | Fiyat TR dışında, TR yüksekliğinin %50'sinden fazla uzaklaştı. Yeni giriş yok. |

---

## 7. Spring (long) tespiti — 1H kapanmış mum

Bir 1H mum (`s`) spring sayılır eğer:
1. `s.low < TR.low` (alt bandı ya da eşit dipleri delmiş),
2. `s.low ≥ TR.low − 1.5 × ATR14` (çok derin değil; daha derin = kırılım, spring değil),
3. `s.close > TR.low` (içeri kapanmış),
4. `CP(s) ≥ 0.5` (mumun üst yarısında kapanış; zayıf kapanış = şüpheli).

Hacim tipi:
| Tip | Koşul | Sonuç |
|---|---|---|
| **Düşük hacimli spring** | `RV(s) ≤ 0.7` | ✅ |
| **Emilim spring'i** | `RV(s) ≥ 1.5` **ve** `CP(s) ≥ 0.6` | ✅ |
| **Kararsız** | Diğer durumlar | ⏳ ("hacim kararsız" → EKSİK, test hacmi belirleyici olur) |

**Spring 2 mumda da olabilir:** `s` delip zayıf kapanır (CP < 0.5), bir sonraki mum `s.low`'un altına inmeden TR içinde ve `CP ≥ 0.5` kapanırsa, spring = iki mumun birleşimi (low = ikisinin en düşüğü, RV = yüksek olanı).

### 7.1 Başarısız spring (iptal)
Spring'den sonraki ilk 3 kapanmış 1H mum içinde herhangi biri:
- Kapanış `< s.low`, **veya**
- Art arda 2 mum `CP < 0.3` ve kapanış `< TR.low`, **veya**
- Kapanış `< TR.low` ve `RV ≥ 1.5`.

→ Kurulum **iptal** ("başarısız spring"). Açık işlem varsa uygulama **"ÇIKIŞ"** uyarısı verir.

### 7.2 Kolay hareket kontrolü (uyarı)
Spring'den sonraki 6 mum içinde en az bir mum `close > s.high` ve `RV ≥ 1.0` değilse uyarı: "spring sonrası tepki zayıf". Durumu düşürmez, sadece not.

---

## 8. Giriş (long, spring'den)

### 8.1 Standart giriş (varsayılan)
1. **LTF seçimi:** 15m (varsayılan). Kullanıcı ayarından 5m seçilebilir.
2. **CHoCH:** Spring mumunun açılışından önceki son pivot tepe (LTF'de, N=2) = `lh`. Spring'den sonra bir LTF mum `close > lh` → CHoCH ✅. Spring'den sonra **24 adet 1H mum** içinde gelmezse kurulum zaman aşımı ile iptal.
3. **Giriş bölgesi (talep):** CHoCH'u yapan yükselişin başladığı son düşüş mumu (LTF): `zone = [mum.low, mum.open]`. Bu hareket içinde bullish FVG varsa ve OB'den yüksekteyse, zone = FVG.
4. **Emir:** Limit alış = `zone.top` (proximal kenar).
5. **Test şartı:** Fiyat zone'a geri döndüğünde, o anı içeren 1H mumun hacmi **spring 1H mumunun hacminden düşük** olmalı. Değilse ⏳ ("test hacmi yüksek") → giriş tetiklenmez, sonraki 1H mumda tekrar bakılır.
6. Zone, giriş gerçekleşmeden kapanışla altına kırılırsa: kurulum iptal.

### 8.2 Alternatif giriş (agresif, sadece "güçlü" veya "çok güçlü" HTF bölgede)
- Eşit diplerin hemen altında (≤ `1 × ATR14`) bir 1H/4H talep bölgesi varsa: limit = o bölgenin üst kenarı, CHoCH beklenmez.
- Uygulamada **"AGRESİF"** etiketiyle ayrı gösterilir; bildirim metninde de yazar.

### 8.3 SOS kırılımından giriş YASAK
TR.high'ın kapanışla kırıldığı mumda giriş yapılmaz (stop çok geniş). Bu durumda §9 (LPS) beklenir.

---

## 9. LPS girişi (long, spring kaçtıysa)

1. **SOS:** 1H kapanış `> TR.eq` ve `RV ≥ 1.5`, ardından 12 mum içinde kapanış `> TR.high`. (Ya da direkt `> TR.high` + `RV ≥ 1.5`.)
2. **LPS:** SOS'tan sonra geri çekilme:
   - Geri çekilmedeki 1H mumların hepsi `RV ≤ 0.7` (düşük hacim),
   - Geri çekilme dibi `≥ TR.high − 0.25 × ATR14` (eski direnç destek oldu) veya en kötü `≥ TR.eq`,
   - Dipte LTF CHoCH (§8.1 adım 2-4'ün aynısı).
3. Stop: LPS dibi `− 0.5 × ATR14(1H)`.
4. Hedefler: T1 = SOS tepesi, T2 = `TR.high + (TR.high − TR.low)`.
5. RR şartı: T2'ye `RR ≥ 3`.

---

## 10. Stop, hedef, RR (spring girişi)

| Öğe | Formül |
|---|---|
| **Stop** | `spring.low − 0.5 × ATR14(1H)` |
| **T1** | `TR.eq` → pozisyonun %50'si kapatılır, stop girişe (BE) çekilir |
| **T2** | `TR.high` → %30 kapatılır |
| **T3** | `TR.high + (TR.high − TR.low)` (ölçülen hareket) → kalan %20 |
| **RR** | `RR(Tx) = (Tx − entry) / (entry − stop)` |
| **Şart** | `RR(T3) ≥ 3.0` **ve** `RR(T2) ≥ 1.5`. Sağlanmazsa YOK ("RR yetersiz"). |

---

## 11. Short tarafı (UTAD / LPSY) — sadece `bias = SHORT`

Long kurallarının aynası, ama daha sıkı (al sinyalleri istatistiksel olarak daha güçlü):

| Öğe | Kural |
|---|---|
| UTAD | `u.high > TR.high`, `u.high ≤ TR.high + 1.5×ATR14`, `u.close < TR.high`, `CP(u) ≤ 0.5` |
| Hacim | `RV(u) ≥ 1.5` ve `CP(u) ≤ 0.4` (efor var, sonuç yok) **veya** `RV(u) ≤ 0.7`. Kararsız hacim = YOK (long'daki gibi ⏳ değil). |
| HTF bölge | Arz bölgesi **zorunlu** ve en az "normal" kalite; agresif alternatif giriş **yok**. |
| Giriş | LTF CHoCH (`close < son pivot dip`) + arz bölgesine geri çekilmede limit (`zone.bottom`). Test 1H hacmi < UTAD 1H hacmi. |
| LPSY (tercih edilen) | SOW: kapanış `< TR.eq` ve `RV ≥ 1.5`; sonra toparlanma mumlarının hepsi `RV ≤ 0.7`, tepe `≤ TR.eq`; LTF CHoCH ile giriş. |
| Stop | `UTAD.high + 0.5×ATR14` (LPSY'de LPSY tepesi + 0.5×ATR) |
| Hedefler | T1 `TR.eq`, T2 `TR.low`, T3 `TR.low − (TR.high − TR.low)` |
| Başarısız UTAD | Sonraki 3 mumda kapanış `> u.high` → iptal / ÇIKIŞ |

---

## 12. Zaman ve ortam filtreleri

| Filtre | Kural | Etki |
|---|---|---|
| **En iyi pencere** | 12:30–16:00 UTC (15:30–19:00 TR) | Dışında: kurulum geçerli, sadece "pencere dışı" notu |
| **Funding** | 00:00, 08:00, 16:00 UTC (03:00, 11:00, 19:00 TR) ±15 dk | Bu aralıkta yeni giriş/limit tetiklenmez (blok) |
| **Cumartesi** | Cumartesi 00:00–23:59 UTC | Yeni giriş yok (blok). Analiz yapılır, durum "HAFTA SONU" |
| **Pazar** | Spring/UTAD veya CHoCH Pazar UTC'de oluştuysa | "Pazar teyidi" şartı eklenir: Pazartesi 00:00 UTC sonrası, spring low'unun üstünde yeni bir 1H pivot dip (long) / UTAD high'ın altında pivot tepe (short). Gelene kadar ⏳ |
| **Likidasyon dalgası** | `ATR14(1H) > 2 × SMA20(ATR14(1H))` **veya** son kapanmış 1H mum boyu `> 3 × ATR14` | Blok: "likidasyon dalgası – bekle". Koşul kalkınca 2 mum daha beklenir |
| **Haber** | USD kırmızı olaya ≤ 30 dk | Blok + "HABER RİSKİ" |
| **Haber sonrası** | Olaydan sonraki ilk 15 dk | Yeni giriş yok |
| **TR ortası** | Giriş fiyatı `TR.low + 0.35×(TR.high−TR.low)` üstünde (long) / `TR.high − 0.35×…` altında (short) | YOK ("TR ortası") — LPS hariç |

---

## 13. Risk ve pozisyon

- Risk: hesap bakiyesinin **%0,5**'i.
- `miktar(BTC) = (0.005 × bakiye) / |entry − stop|`
- Kaldıraç sınırı **3x**: `miktar × entry ≤ 3 × bakiye`. Aşarsa miktar bu sınıra düşürülür ve "risk %0,5'in altında kaldı" notu yazılır.
- Aynı anda en fazla 1 açık F işlemi.

---

## 14. Durum mantığı (TAM / EKSİK / YOK)

Şart listesi (her biri ✅ / ❌ / ⏳):

| # | Şart | Bağımlı olduğu bölüm |
|---|---|---|
| 1 | Yön filtresi (bias) | §3 |
| 2 | HTF ilgi bölgesi | §4 |
| 3 | Geçerli TR | §5 |
| 4 | Spring / UTAD (veya SOS → LPS) | §7, §9, §11 |
| 5 | Hacim şartı (spring/UTAD mumu) | §7, §11 |
| 6 | LTF CHoCH | §8 |
| 7 | Giriş bölgesine test + test hacmi | §8 |
| 8 | RR şartı | §10 |
| 9 | Zaman/ortam filtreleri | §12 |

- **TAM:** 1–8 ✅ ve 9'da blok yok. Limit emir seviyesi aktif / fiyat bölgede.
- **EKSİK:** 1–3 ✅ ve 4–9 arasında en az biri ⏳ (henüz oluşmadı), hiçbiri ❌ değil.
  - **"1 şart kaldı"** bildirimi: tam olarak 1 şart ⏳, diğerleri ✅.
- **YOK:** 1, 2 veya 3'ten biri ❌, **veya** herhangi bir iptal koşulu (başarısız spring, zaman aşımı, RR yetersiz, TR ortası, Faz E).
- **Blok durumu:** Kurulum TAM ama §12'de blok varsa durum **"TAM – BEKLE ({sebep})"**; blok kalkınca tekrar değerlendirilir.

### 14.1 Bildirim tetikleri
| Olay | Bildirim |
|---|---|
| Spring/UTAD oluştu | "F: BTC spring adayı {fiyat} – CHoCH bekleniyor" |
| 1 şart kaldı | "F: BTC 1 şart kaldı: {şart}" |
| TAM | "F: BTC LONG/SHORT TAM – giriş {e}, stop {s}, T1/T2/T3, RR {r}" |
| İptal / başarısız spring | "F: BTC kurulum iptal – {sebep}" (açık işlemde "ÇIKIŞ") |
| T1 vuruldu | "F: T1 – %50 kapat, stop girişe" |

---

## 15. Çıktı şeması (JSON)

```json
{
  "setup": "F",
  "symbol": "BTCUSD",
  "evaluated_at_utc": "2026-11-05T09:00:10Z",
  "source": "binance",
  "status": "TAM | EKSİK | YOK | TAM_BEKLE | VERI_YOK",
  "direction": "LONG | SHORT | null",
  "entry_type": "SPRING | LPS | UTAD | LPSY | AGRESIF | null",
  "bias": {"value": "LONG", "ema50_4h": 78950.2, "close_4h": 80453.0},
  "htf_zone": {"tf": "4h", "type": "OB | FVG | EQUAL_LOWS", "low": 79100, "high": 79600, "quality": "güçlü | normal | çok güçlü"},
  "tr": {"tf": "1h", "low": 79952, "high": 80752, "eq": 80352, "touches_low": 3, "touches_high": 2,
         "bars": 18, "stale": false, "events": {"SC": "...", "AR": "...", "ST": "..."}, "phase": "B"},
  "trigger": {"time_utc": "...", "low": 79810, "close": 80020, "cp": 0.62, "rv": 0.55, "volume_type": "DUSUK | EMILIM | KARARSIZ"},
  "choch": {"tf": "15m", "level": 80210, "confirmed": true, "time_utc": "..."},
  "entry_zone": {"low": 79980, "high": 80060},
  "order": {"entry": 80060, "stop": 79620, "t1": 80352, "t2": 80752, "t3": 81552,
            "rr_t2": 1.57, "rr_t3": 3.39, "size_btc": 0.0, "leverage": 0.0},
  "conditions": [
    {"id": 1, "name": "Yön filtresi", "state": "OK | FAIL | WAIT", "note": "4H EMA50 üstü"}
  ],
  "blocks": ["FUNDING", "CUMARTESI", "LIKIDASYON", "HABER", "PAZAR_TEYIDI"],
  "notes": ["pencere dışı", "spring sonrası tepki zayıf"],
  "news": [{"time_tr": "16:30", "event": "US NFP", "impact": "red"}]
}
```

---

## 16. Ekranda gösterim (F bölümü)

1. Üst satır: **Durum rozeti** (TAM yeşil, EKSİK sarı, YOK gri, TAM-BEKLE turuncu) + yön + giriş tipi.
2. **Şart tablosu:** §14'teki 9 şart, her biri ✅ / ❌ / ⏳ ve kısa not.
3. TAM ise: giriş, stop, T1/T2/T3, RR, BTC miktarı, kaldıraç.
4. EKSİK ise: eksik şart(lar) ve "nasıl tamamlanır" metni (örn. "15m'de 80.210 üstü kapanış bekleniyor").
5. YOK ise: sebep ve neyi beklediğimiz (örn. "TR yok – 1H'te en az 2 dip + 2 tepe temaslı yatay bölge bekleniyor").
6. **Mini grafik (1H):** TR bantları (low / eq / high), HTF bölge kutusu, spring/UTAD işareti, CHoCH seviyesi, giriş-stop-hedef çizgileri; altında hacim çubukları ve RV ≥ 1.5 olanlar vurgulu.
7. **Haber tablosu:** USD kırmızı olaylar (TR saati), 30 dk kala "HABER RİSKİ".
8. Saat bilgisi: sonraki funding saati, hafta sonu durumu, "en iyi pencere" içinde mi.

---

## 17. Kesin olarak YAPILMAYACAKLAR

- Grid stratejisi yok (trend bilgisi olmadan beklenen değer sıfır).
- Tek başına indikatör sinyaliyle işlem yok (EMA sadece filtre).
- SOS kırılım mumunda giriş yok.
- 3x üzeri kaldıraç yok.
- Kapanmamış mum üzerinden spring/CHoCH onayı yok.
- Veri gelmezse tahmini değer üretilmez.

---

## 18. Test senaryoları (geliştirici için)

| # | Girdi | Beklenen |
|---|---|---|
| 1 | 4H kapanış EMA50 altında, eğim negatif, mükemmel spring | Long aranmaz → YOK ("yön ters") |
| 2 | Spring `low = TR.low − 2×ATR` | Spring değil (kırılım) |
| 3 | Spring `CP = 0.4`, sonraki mum `CP = 0.7` ve dip altına inmedi | 2 mumlu spring ✅ |
| 4 | Spring sonrası 2. mum kapanış < spring.low | Başarısız spring → iptal |
| 5 | Spring `RV = 1.1` | Hacim ⏳ → EKSİK |
| 6 | CHoCH 24 adet 1H mum içinde gelmedi | Zaman aşımı → YOK |
| 7 | Test anındaki 1H hacmi > spring 1H hacmi | Giriş tetiklenmez (⏳) |
| 8 | RR(T3) = 2.6 | YOK ("RR yetersiz") |
| 9 | Her şey ✅, saat 15:55 UTC | TAM_BEKLE (FUNDING) |
| 10 | Her şey ✅, Cumartesi | TAM_BEKLE (CUMARTESI) |
| 11 | Spring Pazar 14:00 UTC | PAZAR_TEYIDI ⏳ ta ki Pazartesi'de spring low üstünde pivot dip oluşana kadar |
| 12 | `ATR14 = 2.3 × SMA20(ATR)` | Blok LIKIDASYON |
| 13 | Binance ve Coinbase cevap vermiyor | VERI_YOK |

---

## 19. Kaynak özeti (gerekçe)

- Wyckoff Method tutorial (StockCharts) ve Huobi Research BTC/ETH Wyckoff analizi: olaylar, fazlar, hacim kuralları, 1:3 hedef.
- Videolar: Wyckoff Analytics BTC (Pazar/CME kapalı hareketler şüpheli), "UTAD and Spring Entries" (HTF bölge şartı, LTF CHoCH girişi, SOS'tan giriş yok), "Wyckoff Springs Walkthrough" (kapanış konumu, düşük/yüksek hacimli spring, başarısız spring, kolay hareket).
- Periyodiklik makalesi: funding saatleri (00/08/16 UTC) ve hafta sonu düşük likidite.
- Kaiko ve likidasyon/marj makalesi: likidasyon dalgaları, kaldıraç sınırı (long 3x).
- Corbet; Hudson-Urquhart: al sinyalleri daha güçlü, indikatörler BTC'de tek başına örneklem dışı çalışmıyor → sadece filtre.
- Destek/direnç makalesi: çok temaslı seviyeler daha güçlü, zamanla zayıflar (eskime kuralı).
- Grid makalesi: grid yok.
