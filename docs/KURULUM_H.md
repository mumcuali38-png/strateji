# Kurulum H — Trend Devam (Pullback) — Uygulama Şartnamesi

Enstrümanlar: **XAUUSD, US100, BTCUSD**. Diğer kurulumlardan bağımsız bir modül.
Mantık: Günlük/4H'te trend var → 1H'te sakin geri çekilme → 15m'de trend yönünde tetik → yarısı T1'de, yarısı trailing stop ile trend bitene kadar.

> **Bu kurulumda da diğer kurulumlardaki gibi:**
> - **5 dakikalık tarama** (§2) ve
> - **hatalı sinyal koruması** (§10)
>
> **zorunludur.** İkisi de bu şartnamede ayrı bölüm olarak tanımlıdır ve atlanamaz.

---

## 1. Veri

| Enstrüman | Kaynak | Not |
|---|---|---|
| XAUUSD | Twelve Data `XAU/USD`, `timezone=UTC` | Günlük ve 4H, 1h'ten türetilir (4H sınırları strateji saatiyle 02/06/10/14/18/22, günlük gün 18:00–17:00 UTC-5) |
| US100 | Twelve Data `QQQ`, `timezone=America/New_York` | Sadece seans içi (09:30–16:00 NY). US100 değeri = QQQ × oran (ayarlardan, varsayılan 41,05; haftada bir güncellenmesi önerilir). Ekranda iki değer de gösterilir. |
| BTCUSD | Binance `data-api.binance.vision` BTCUSDT | Kredi harcamaz. Yedek: Coinbase. |

- Sadece **kapanmış mumlar** hesaplara girer (§10.1).
- Twelve Data çağrıları uygulamanın **ortak kredi sayacından** geçer (8/dk, 800/gün asla aşılmaz).

---

## 2. Tarama motoru — 5 dakikalık tarama (zorunlu)

### 2.1 Tarama ritmi
- Motor **her 5 dakikada** bir çalışır, 5m mum kapanışından **10 sn sonra** (…:00:10, …:05:10, …).
- Her taramada enstrüman başına şu sırayla ilerlenir; bir adım ❌ ise sonraki adımlar o taramada çalıştırılmaz (kredi tasarrufu):

| Adım | Ne zaman çalışır | Veri |
|---|---|---|
| A. Trend filtreleri (§4) | Saat başı taramada (4H/Günlük kapanışları yakalanır) | 1h (XAU: `outputsize=1200` günde 1 + saatlik `outputsize=3` güncelleme; QQQ benzer; BTC: Binance 1h/4h/1d) |
| B. Geri çekilme (§5) | Her 5 dk, sadece A ✅ ise | Son 1h mumlar (önbellek) + **anlık fiyat** |
| C. Tetik (§6) | Her 5 dk, sadece fiyat değer bölgesindeyse veya bölgeden çıkalı ≤ 4 adet 15m mum olduysa | 15m (çeyrek saat kapanışlarında yeni mum) |
| D. Açık işlem takibi (§8) | Her 5 dk, açık H işlemi varsa | Anlık fiyat + 1h kapanışlarında trailing |

### 2.2 Anlık fiyat
- XAU / QQQ: Twelve Data `price` uç noktası (1 kredi). BTC: Binance `ticker/price` (ücretsiz).
- Anlık fiyat sadece **yakınlık ve geçerlilik kontrolü** içindir; koşulların ✅ olması için her zaman **kapanmış mum** gerekir.

### 2.3 Tarama pencereleri ve kredi tahmini (Twelve Data)

| Enstrüman | 5 dk tarama aktif (TR) | Tahmini kredi/gün |
|---|---|---|
| XAUUSD | 10:00–13:00 ve 15:00–18:00 (giriş pencereleri) + açık işlem varken sürekli | 72 (fiyat) + 24 (1h) + ≤ 24 (15m, bölgedeyken) ≈ **120** |
| US100 (QQQ) | NY seansı (kış: 17:30–24:00 TR, yaz: 16:30–23:00 TR) | 78 (fiyat) + 7 (1h) + ≤ 26 (15m) ≈ **110** |
| BTCUSD | 7/24 | **0** (Binance) |

- Ortak sayaç günlük %90'a ulaşırsa: H'nin 5 dk fiyat kontrolü **sadece fiyat değer bölgesine 1 ATR(1H) yakınken** yapılır; diğer zamanlar 15 dk'ya iner. Açık işlem takibi her zaman önceliklidir.

---

## 3. Göstergeler (kesin formüller)

| Ad | Formül |
|---|---|
| EMA(n) | `k = 2/(n+1)`, ilk değer ilk n kapanışın SMA'sı, ısınma ≥ 3n mum |
| ATR14 | Wilder: `TR = max(H−L, |H−Cp|, |L−Cp|)`; ilk = 14 TR ortalaması; sonra `(ATRp·13 + TR)/14` |
| RSI14 | Wilder ortalama kazanç/kayıp |
| ADX14 | Wilder: `+DM = H−Hp` (eğer > `Lp−L` ve > 0, değilse 0), `−DM = Lp−L` (eğer > `H−Hp` ve > 0); TR, +DM, −DM Wilder-14 ile yumuşatılır; `+DI = 100·+DM14/TR14`, `−DI = 100·−DM14/TR14`; `DX = 100·|+DI − −DI|/(+DI + −DI)`; `ADX` = DX'in Wilder-14 ortalaması |
| ADX yükseliyor | `ADX(0) > ADX(−3)` |
| 60 günlük getiri | `close_D(0) / close_D(−60) − 1` (60 işlem günü) |
| Pivot | Tepe: high(i) önceki N ve sonraki N mumdan büyük. 4H: N=3, 1H: N=2, 15m: N=2. Pivot N mum sonra kesinleşir |
| BOS (4H) | Kapanışın son kesinleşmiş 4H pivot tepesinin üstünde (yukarı BOS) / pivot dibinin altında (aşağı BOS) olması |

---

## 4. Trend filtreleri (hepsi zorunlu) — LONG anlatılır, SHORT aynası

| # | Şart | ✅ |
|---|---|---|
| T1 | Günlük | `close_D > EMA50_D > EMA200_D` **ve** 60 günlük getiri > 0 |
| T2 | 4H yapı | `close_4H > EMA50_4H` **ve** son 4H BOS yukarı |
| T3 | 4H güç | `ADX14_4H ≥ 25` **ve** yükseliyor. (≥ 30 → kalite +1) |

- **Histerezis (§10.6):** Aktif bir trend durumu, ADX 22'nin altına düşmedikçe ve kapanış EMA50'nin `0.1×ATR14_4H`'ten fazla altına geçmedikçe kaybedilmez. Trend yeni kurulurken giriş eşiği 25'tir.
- `ADX < 20` → trend yok (YOK).
- T1 LONG ama T2/T3 SHORT gibi karışık durumlar → YOK ("trend uyumsuz").

---

## 5. Geri çekilme (1H)

### 5.1 Trend bacağı ve geri çekilme sayacı
- `tBOS` = son yukarı 4H BOS zamanı. Sayaç `k` her yeni 4H BOS'ta 0'a döner.
- `H0` = geri çekilme başlamadan önceki son 1H pivot tepe (bacağın zirvesi).
- `L0` = bu itkinin başladığı 1H pivot dip (önceki geri çekilmenin dibi; ilk itkide BOS'u başlatan dip).
- Yeni bir geri çekilme şu an başlar: bir 1H mumun `low ≤ EMA20_1H` olması **ve** `H0`'ın bir önceki geri çekilmenin `H0`'ından yüksek olması. O an `k = k + 1`.
- **Sadece `k = 1` ve `k = 2` alınır.** `k ≥ 3` → YOK ("trend yorgun").

### 5.2 Değer bölgesi (biri yeterli)
- 1H mumun low'u EMA20_1H'ye dokunmuş, **veya**
- fiyat `[EMA50_1H, EMA20_1H]` aralığında.
- **OTE çakışması (kalite +1):** bölge `[H0 − 0.786·(H0−L0), H0 − 0.618·(H0−L0)]` ile kesişiyor.

### 5.3 Geri çekilmenin karakteri (hepsi zorunlu)
| # | Şart |
|---|---|
| P1 | Geri çekilme mumlarının ortalama `(H−L)` değeri < itki mumlarının ortalama `(H−L)` değeri |
| P2 | Geri çekilme boyunca `RSI14_1H` en düşük değeri > 40 |
| P3 | Derinlik `(H0 − pullbackLow)/(H0 − L0) ≤ 0.786` |
| P4 | Son kesinleşmiş 4H pivot dibinin (yükselen dip) altında 1H kapanış yok |

P3 veya P4 bozulursa: **iptal** (yapı bozuldu). P1/P2 bozulursa: ⏳ değil **YOK** (düzeltme sert, trend riskte).

---

## 6. Tetik (15m)

### 6.1 Varsayılan: mikro yapı kırılımı
- `lh` = geri çekilme içindeki son kesinleşmiş 15m pivot tepe.
- Tetik: bir 15m mumun `close > lh`, fiyat bu sırada `< H0` (zirveyi geçmişse kaçırılmış sayılır).
- **Giriş:** limit = `lh` (kırılan seviyenin retesti). Geçerlilik: tetikten sonraki **4 adet 15m mum**. Dolmazsa iptal ("retest gelmedi").

### 6.2 Alternatif: Holy Grail (ayarlardan seçilir, varsayılan kapalı)
- EMA20_1H'ye dokunan 1H mumun high'ı + `0.05×ATR14_1H` seviyesine buy stop. Geçerlilik: sonraki 3 adet 1H mum.

---

## 7. Stop, hedef, RR

| Öğe | Formül |
|---|---|
| Stop | `pullbackLow − 0.5 × ATR14_1H` |
| Maks. stop | `entry − stop ≤ 1.5 × ATR14_4H`; değilse YOK ("stop çok geniş") |
| T1 | `H0`. Eğer `RR(H0) < 1.0` ise T1 = `entry + 1.0R` |
| T2 (RR hesabı için) | `pullbackLow + (H0 − L0)` (itkinin %100 uzatımı) |
| Şart | `RR(T2) ≥ 2.0` |
| Pozisyon | Risk %0,5 (lot hesaplayıcı, ortak modül). BTC'de kaldıraç ≤ 3x |

---

## 8. İşlem yönetimi

| Olay | Aksiyon |
|---|---|
| T1 | %50 kapat, stop = entry |
| Trailing (kalan %50) | Her 1H kapanışta: `stop = max(stop, HH_since_entry − 3 × ATR14_1H)` |
| Trend sonu | 4H kapanış `< EMA50_4H` → kalan kapatılır |
| Ters 4H BOS | Kalan kapatılır |
| Haber | Kırmızı USD habere 15 dk kala bildirim. T1 alınmamışsa "risk azalt" önerisi; zorunlu çıkış yok (trend kurulumu) |
| T2 | Kapanış nedeni değildir; sadece RR şartı içindir |

---

## 9. Saatler ve ortam filtreleri

| Enstrüman | Yeni giriş penceresi | Not |
|---|---|---|
| XAUUSD | 10:00–13:00 ve 15:00–18:00 TR (strateji saati sabit UTC-5: 02:00–05:00 ve 07:00–10:00) | A/B killzone'larıyla aynı |
| US100 | NY borsa saatiyle **09:45–15:30** (ilk 15 dk hariç). TR: kışın 17:45–23:30, yazın 16:45–22:30 | QQQ borsa saatine bağlı olduğu için **NY yaz saati uygulanır** (diğer XAU kurulumlarındaki sabit UTC-5 kuralından farklı) |
| BTCUSD | 7/24 | Funding saatleri (00:00, 08:00, 16:00 UTC = 03:00, 11:00, 19:00 TR) ±15 dk giriş yok; **Cumartesi** yeni giriş yok; en iyi pencere 15:30–19:00 TR (bilgi notu) |

- Kırmızı USD haberine ≤ 30 dk → yeni giriş yok.
- Volatilite şoku: `ATR14_1H > 2 × SMA20(ATR14_1H)` → yeni giriş yok.
- Açık işlemler bu filtrelerden etkilenmez (§8 geçerli).

---

## 10. Hatalı sinyal koruması (zorunlu)

Bu bölüm diğer kurulumlardaki korumanın H'ye uyarlanmış halidir. Her TAM sinyal bildirimden önce **tüm** maddelerden geçer.

| # | Koruma | Kural |
|---|---|---|
| 10.1 | **Sadece kapanmış mum** | Hiçbir koşul açık mumla ✅ olmaz. Mumun `datetime + interval > şimdi` ise hesap dışı. |
| 10.2 | **Repaint yok** | Pivotlar N mum sonra kesinleşir; kesinleşmemiş pivot kullanılmaz. Gösterilen bir sinyal sonradan geçmişte değiştirilmez; durumu "iptal" olarak güncellenir ve kayıtta kalır. |
| 10.3 | **Çift tarama teyidi** | TAM koşulları **iki ardışık 5 dk taramada** sağlanmalı. İkinci taramada veri yeniden çekilir; tetik hâlâ geçerli, fiyat stopun üstünde ve `< H0` olmalı. Sonra bildirim gönderilir (en fazla ~5 dk gecikme, buna karşılık sahte tetik elenir). |
| 10.4 | **Veri tazeliği** | Son kapanmış mumun zamanı beklenenden **2 interval'den** eskiyse "VERİ GECİKMESİ" → o enstrümanda sinyal üretilmez, ekranda sarı uyarı. |
| 10.5 | **Kötü tick / sıçrama filtresi** | Tek mum aralığı `> 5 × ATR14` ise **ve** sonraki mum bu hareketin %50'sinden fazlasını geri almışsa o mum hesaplardan çıkarılır. Anlık fiyat ile son kapanış arasındaki fark `> %0,3` (XAU, QQQ) veya `> %1` (BTC) ise bir sonraki taramayı bekle. |
| 10.6 | **Histerezis** | ADX: giriş 25, çıkış 22. EMA filtreleri: kapanışın EMA'nın doğru tarafında en az `0.1 × ATR` uzaklıkta olması. Böylece eşik etrafında ✅/❌ titremesi olmaz. |
| 10.7 | **Eksik mum** | Hesap penceresinde eksik mum varsa (veri boşluğu) gösterge hesaplanmaz → ⏳ "veri eksik". Hafta sonu ve seans dışı boşlukları beklenen boşluk sayılır. |
| 10.8 | **Açılış boşluğu (gap)** | US100: QQQ ilk mumu önceki kapanıştan `> 1 × ATR14_1H` uzaktaysa ilk **30 dk** H sinyali yok. XAU/BTC hafta açılışı boşluğu `> 1 × ATR14_1H` ise ilk 1H mum kapanana kadar sinyal yok. |
| 10.9 | **Haber mumu** | Kırmızı haber anının ±15 dk'sı içinde kapanan 15m/1H mumlar **tetik mumu sayılmaz**. |
| 10.10 | **Son kontrol (gönderim öncesi)** | Bildirimden hemen önce anlık fiyat alınır: fiyat stopa `≤ 0.25R` yakınsa veya T1'i geçmişse sinyal "KAÇTI" olarak işaretlenir, TAM bildirimi **gönderilmez**. |
| 10.11 | **Tekrar ve soğuma** | Her sinyalin benzersiz kimliği var (`H-{sembol}-{tBOS}-{k}`); aynı kimlik ikinci kez bildirilmez. İptal edilen sinyalden sonra aynı enstrümanda **2 adet 1H mum** boyunca yeni H sinyali yok. "1 şart kaldı" bildirimi aynı şart için en fazla **60 dk'da bir**. |
| 10.12 | **Çakışma kontrolü** | Aynı enstrümanda ters yönde TAM bir dönüş kurulumu (A/B/D/E/F/G) varsa H sinyali "ÇAKIŞMA" etiketiyle gösterilir, emir kartı ikisinden birinin seçilmesini ister. Aynı yönde TAM başka kurulum varsa "aynı fikir" — tek işlem. |
| 10.13 | **Kaynaklar arası tutarlılık** | US100: QQQ × oran ile ayarlardaki son elle girilen US100 değeri arasında `> %1` fark varsa "oran güncelle" uyarısı (sinyal engellenmez, seviyeler QQQ üzerinden doğru kalır). |

Koruma tetiklendiğinde ekranda hangi maddenin sinyali durdurduğu yazılır (örn. "10.3 — teyit bekleniyor", "10.10 — sinyal kaçtı").

---

## 11. Durum mantığı

| # | Şart | Bölüm |
|---|---|---|
| 1 | Veri tamam ve taze | §10.4, §10.7 |
| 2 | Günlük trend (T1) | §4 |
| 3 | 4H yapı (T2) | §4 |
| 4 | 4H güç (T3) | §4 |
| 5 | Geri çekilme sayısı (1. veya 2.) | §5.1 |
| 6 | Değer bölgesinde | §5.2 |
| 7 | Düzeltme karakteri (P1–P4) | §5.3 |
| 8 | 15m tetik | §6 |
| 9 | Stop ve RR | §7 |
| 10 | Saat ve ortam | §9 |
| 11 | Hatalı sinyal koruması | §10 |

- **TAM:** 1–11 ✅ → emir kartı + bildirim.
- **EKSİK:** hiçbiri ❌ değil, en az biri ⏳ (örn. trend var, geri çekilme bekleniyor).
- **"1 şart kaldı":** tek ⏳ (çoğunlukla 8 = tetik).
- **YOK:** herhangi biri ❌.
- **TAM – BEKLE:** 1–9 ✅ ama 10 veya 11'de blok (örn. funding, haber, teyit bekleniyor).

### 11.1 Bildirimler
| An | Metin |
|---|---|
| Trend oluştu | "H: {sembol} {LONG/SHORT} trend aktif — geri çekilme bekleniyor" (günde en fazla 1) |
| Değer bölgesine giriş | "H: {sembol} değer bölgesinde ({k}. geri çekilme) — 15m tetik bekleniyor" |
| 1 şart kaldı | "H: {sembol} 1 şart kaldı: {şart}" |
| TAM | "H: {sembol} {yön} TAM — limit {e}, stop {s}, T1 {t1}, RR(T2) {r}, kalite {q}" |
| T1 | "H: T1 — %50 kapat, stop girişe; kalan trailing" |
| Trailing güncellendi | Sadece ekranda (bildirim yok) |
| Trend sonu | "H: 4H EMA50 kırıldı — kalanı kapat" |
| Sinyal kaçtı / iptal | "H: {sembol} sinyal iptal — {sebep / koruma maddesi}" |

---

## 12. Çıktı şeması (JSON)

```json
{
  "setup": "H",
  "symbol": "XAUUSD | US100 | BTCUSD",
  "evaluated_at_utc": "2026-11-06T08:05:10Z",
  "scan_seq": 2,
  "status": "TAM | EKSİK | YOK | TAM_BEKLE | VERI_GECIKMESI",
  "direction": "LONG | SHORT | null",
  "trend": {"daily": {"close": 4060.1, "ema50": 3962.0, "ema200": 3720.5, "ret60": 0.081},
            "h4": {"close": 4058.0, "ema50": 4010.3, "last_bos": "UP", "adx": 31.2, "adx_rising": true}},
  "pullback": {"k": 1, "H0": 4071.2, "L0": 3995.4, "low": 4031.8, "depth": 0.52,
               "in_value_zone": true, "ote_overlap": true, "rsi_min": 47.3,
               "range_ratio": 0.61, "hl4h_intact": true},
  "trigger": {"type": "MICRO_BOS | HOLY_GRAIL", "lh": 4044.6, "bar_utc": "...", "valid_until_utc": "..."},
  "order": {"entry": 4044.6, "stop": 4027.9, "t1": 4071.2, "t2": 4107.6,
            "rr_t1": 1.59, "rr_t2": 3.77, "max_stop_ok": true},
  "quality": {"score": 2, "flags": ["ADX>=30", "OTE"]},
  "protection": {"double_scan_ok": true, "fresh": true, "bad_tick": false, "gap_block": false,
                 "news_bar": false, "final_check": "OK | KACTI", "cooldown": false,
                 "conflict": null, "blocked_by": null},
  "us100": {"qqq": 691.88, "ratio": 41.05, "us100_est": 28402.7}
}
```

---

## 13. Ekran (H bölümü)
1. Üç kart: XAUUSD, US100, BTCUSD. Her kartta yön şeridi (yeşil/kırmızı ▲▼), durum rozeti, kalite.
2. **Trend satırı:** Günlük ✅/❌, 4H ✅/❌, ADX değeri ve oku.
3. **Geri çekilme satırı:** k (1./2.), derinlik %, değer bölgesi/OTE, RSI.
4. **Tetik satırı:** `lh` seviyesi, limit geçerlilik geri sayımı.
5. **Koruma satırı:** "Teyit 1/2", "Veri taze", varsa engelleyen madde.
6. TAM ise emir kartı (ortak modül: lot, Kopyala, MT5 butonu pasif).
7. Açık işlemde: anlık R, trailing stop seviyesi ve son güncelleme saati.
8. Mini grafik (1H): EMA20/50, H0/L0, değer bölgesi ve OTE kutusu, giriş/stop/T1/trailing çizgileri.

---

## 14. Test senaryoları

| # | Girdi | Beklenen |
|---|---|---|
| 1 | Günlük EMA50 > EMA200 ama 60 günlük getiri −%2 | YOK (T1) |
| 2 | ADX 26 ama düşüyor | YOK (T3) |
| 3 | Aktif trend, ADX 23'e düştü | Trend korunur (histerezis, çıkış 22) |
| 4 | 3. geri çekilme | YOK ("trend yorgun") |
| 5 | Derinlik %82 | İptal (P3) |
| 6 | Geri çekilmede RSI 37 | YOK (P2) |
| 7 | 15m kapanış `lh` üstü, ilk tarama | TAM_BEKLE ("10.3 teyit 1/2") |
| 8 | Aynı durum ikinci taramada geçerli | TAM + bildirim |
| 9 | İkinci taramada fiyat stopa 0,2R yakın | KAÇTI, bildirim yok |
| 10 | Son 1h mum 3 saat eski | VERI_GECIKMESI |
| 11 | Tek 15m mum 6×ATR, sonraki %70 geri aldı | Mum yok sayılır |
| 12 | QQQ açılış gap'i 1,4×ATR | İlk 30 dk sinyal yok |
| 13 | Tetik mumu NFP'den 10 dk sonra kapandı | Tetik sayılmaz |
| 14 | Stop mesafesi 1,8×ATR_4H | YOK (stop geniş) |
| 15 | RR(T2) 1,7 | YOK |
| 16 | RR(H0) 0,8 | T1 = entry + 1R |
| 17 | T1 sonrası fiyat yeni tepe, ATR 6 | Trailing = HH − 18 |
| 18 | 4H kapanış EMA50 altı | Kalan kapat bildirimi |
| 19 | BTC Cumartesi tetik | TAM_BEKLE (Cumartesi) |
| 20 | XAU'da H LONG TAM, aynı anda E SHORT TAM | ÇAKIŞMA etiketi, tek seçim |
| 21 | Aynı sinyal kimliği tekrar oluştu | Bildirim yok |
| 22 | Kredi kullanımı %90 | XAU/QQQ fiyat kontrolü sadece bölgeye 1 ATR yakınken |

---

## 15. Kaynak özeti
- Moskowitz, Ooi, Pedersen (2012), *Time Series Momentum*, JFE: 58 vadeli kontratta 1–12 ay getiri devamı, uzun vadede kısmi geri dönüş → 60 günlük getiri filtresi.
- Hurst, Ooi, Pedersen (2017), *A Century of Evidence on Trend-Following Investing*, AQR: 1880'den itibaren istikrarlı kârlılık.
- Liu & Tsyvinski (2021), *Risks and Returns of Cryptocurrency*, RFS: BTC'de günlük/haftalık güçlü momentum (örneklem içi uyarısıyla).
- Brock, Lakonishok, LeBaron (1992); Corbet vd.: hareketli ortalama kuralları.
- Elder, *Trading for a Living*: Triple Screen (Günlük/4H → 1H → 15m).
- Raschke & Connors, *Street Smarts*: Holy Grail (ADX > 30 ve yükselen, 20 periyot ortalamaya ilk geri çekilme, dokunan mumun tepesinin üstünde giriş).
- Al Brooks, *Trading Price Action Trends*: 1. ve 2. geri çekilme (H1/H2) mantığı.
- Clenow, *Following the Trend*; Faith, *Way of the Turtle*: ATR'ye dayalı stop ve trailing çıkış.
- ICT OTE: %61,8–78,6 geri çekilme bölgesi.
