# ⭐ Kurulum T4-S — 4H Trend Kırılımı + Yarı Kâr (Donchian 20/10) — Uygulama Şartnamesi

Enstrümanlar: **XAUUSD, US100, US30, XAGUSD, BTCUSD**. Bağımsız modül. Ortak kurallar: `kurulum_P_Portfoy_ortak_spec.md`.
Mantık: Günlük trend yönünde 4H'te son 20 mumun tepesi (dibi) kırılınca gir; **1,5R'de yarısını kapat ve stopu girişe çek** (istikrar); kalanı 4H'te son 10 mumun dibi (tepesi) kırılana kadar taşı.

> **Bu kurulumda da diğerlerindeki gibi:** **5 dakikalık tarama** (§5) ve **hatalı sinyal koruması** (§6) **zorunludur**. ⭐ = test edilmiş, parametreler kilitli.

---

## 1. Veri
| Enstrüman | Kaynak | 4H mum |
|---|---|---|
| XAUUSD | `XAU/USD` 1h, `timezone=UTC` | 1H'ten: strateji saatiyle 02/06/10/14/18/22 sınırları, en az 3 adet 1H |
| US100 | `QQQ` 1h | Günde 2 blok (strateji saatiyle 12:30 öncesi / sonrası), en az 2 adet 1H. US100 = QQQ × oran |
| US30 | `DIA` 1h | Aynı. US30 = DIA × oran |
| XAGUSD | `SLV` 1h | Aynı. XAG = SLV × oran |
| BTCUSD | Binance BTCUSDT 1h | 02/06/…/22 sınırları, 7/24 (hafta sonu dahil) |

Gerekli geçmiş: en az **260** adet 4H mum + rejim için **210** seans günü (1H'ten türetilir).

## 2. Göstergeler
- `DU20`, `DA20` = Donchian üst/alt(20), 4H, mevcut mum hariç
- `DU10`, `DA10` = Donchian üst/alt(10), 4H
- `ATR14_4H` (Wilder, 4H mumlarında)
- `REJIM` = ortak şartname §4

## 3. Giriş (her 4H kapanışında)
| # | Şart | LONG | SHORT |
|---|---|---|---|
| 1 | Rejim | `REJIM = +1` | `REJIM = −1` |
| 2 | Kırılım | 4H kapanış `C > DU20` | `C < DA20` |
| 3 | Pozisyon yok | Bu enstrümanda açık ⭐T4-S yok | aynı |

- **Giriş:** teyitten sonra piyasa emri (testte bir sonraki 4H açılışı).
- **Stop:** `giriş ∓ 2 × ATR14_4H` (sinyal mumunun ATR'si). `R = |giriş − stop|`.
- **Hedef 1 (T1):** `giriş ± 1,5R` → pozisyonun **%50'si** kapatılır.

## 4. Yönetim ve çıkış
| Olay | Aksiyon |
|---|---|
| Fiyat T1'e değdi (anlık, mum içinde) | %50 kapat (sunucuda bekleyen limit emri), **stop = giriş** |
| Fiyat stopa değdi | Kalan kapanır (T1 öncesi −1R, T1 sonrası ≈ +0,75R toplam) |
| LONG: 4H kapanış `C < DA10` | Kalan piyasa emriyle kapatılır |
| SHORT: 4H kapanış `C > DU10` | Aynı |
| Rejim değişimi | Çıkış nedeni değil |

Aynı mum içinde hem stop hem T1 görülürse **stop önce** sayılır (testteki muhafazakâr varsayım). Ekranda "aynı mum — stop önceliği" notu.
Toplam işlem sonucu: `R = 0,5 × 1,5 + 0,5 × (çıkış − giriş)/R` (T1 alındıysa).

## 5. 5 dakikalık tarama (zorunlu)
| Adım | Ne zaman | İş |
|---|---|---|
| A | Her 4H kapanışından sonraki ilk tarama | 1H çağrısı, 4H mum türetme, Donchian/ATR/rejim |
| B | Sonraki tarama | Çift tarama teyidi (veri yeniden çekilir) |
| C | Her 5 dk, açık ⭐T4-S varsa | Anlık fiyat: T1 ve stop takibi (sunucu emirleri yoksa bildirim) |
| D | Her 4H kapanışında, açık pozisyon varsa | Donchian 10 çıkış kontrolü |

ETF tabanlılar (US100, US30, XAG) sadece borsa seansında taranır; BTC 7/24.

## 6. Hatalı sinyal koruması (zorunlu)
Ortak tablo (ortak şartname §7.1–7.10) aynen. T4-S'ye özel:

| # | Kural |
|---|---|
| T4.1 | **4H kapanışı:** 4H mum, içindeki son 1H mum kapanmadan kapanmış sayılmaz. ETF bloklarında 2. blok borsa kapanışıyla (16:00 NY) kapanır. |
| T4.2 | **Son kontrol eşiği:** anlık fiyat sinyal kapanışından yön lehine **> 0,5 × ATR14_4H** gittiyse veya T1'e %50'den fazla yaklaştıysa "KAÇTI". |
| T4.3 | **T1 emri:** Pozisyon açılır açılmaz T1 limit emri ve stop emri birlikte girilir (emir kartında iki satır). MT5 butonu pasif — kullanıcı elle girer, uygulama "T1 emri girildi mi?" onayını ister. |
| T4.4 | **Stop girişe çekme:** T1 gerçekleşti bildirimi "stopu {giriş} yap" adımını zorunlu onay olarak gösterir; onaylanmazsa her 5 dk hatırlatma. |
| T4.5 | **BTC hafta sonu:** 4H sinyali hafta sonu da geçerlidir (testte öyle). |

## 7. Durum mantığı
| # | Şart |
|---|---|
| 1 | Veri tamam ve taze |
| 2 | Rejim ±1 |
| 3 | 4H kapanış Donchian 20 dışında |
| 4 | Açık ⭐T4-S yok |
| 5 | Koruma (teyit 2/2, son kontrol) |

TAM / EKSİK (⏳ 3: "kırılım seviyesi DU20 = …, uzaklık … ATR") / YOK / TAM – BEKLE — diğer kurulumlarla aynı mantık.

Bildirimler: "⭐T4-S: {sembol} {yön} TAM — giriş ~{f}, stop {s}, T1 {t1} (%50)" · "⭐T4-S: T1 — %50 kapat, stop girişe" · "⭐T4-S: çıkış — 4H Donchian 10 kırıldı".

## 8. Çıktı şeması (JSON)
```json
{
  "setup": "T4-S", "star": true,
  "symbol": "XAUUSD | US100 | US30 | XAGUSD | BTCUSD",
  "evaluated_at_utc": "2026-11-06T15:05:10Z", "scan_seq": 2,
  "status": "TAM | EKSIK | YOK | TAM_BEKLE | VERI_GECIKMESI",
  "direction": "LONG | SHORT | null",
  "regime": {"value": 1},
  "donchian_4h": {"du20": 4098.0, "da20": 3961.2, "du10": 4090.5, "da10": 4011.0},
  "atr14_4h": 24.3,
  "order": {"type": "MARKET", "ref_price": 4099.6, "stop": 4051.0, "t1": 4172.5, "t1_fraction": 0.5, "lots": 0.10},
  "position": {"open": false, "t1_done": false, "stop_at_be": false, "r_now": null},
  "protection": {"double_scan_ok": true, "final_check": "OK | KACTI", "blocked_by": null},
  "portfolio": {"week_r": 0.8}
}
```

## 9. Ekran (⭐T4-S kartı)
1. Beş satır: rejim rozeti, durum, kırılım seviyesine uzaklık.
2. Açık pozisyonda: giriş, stop (BE ise "BE" etiketi), T1 ✅/⏳, anlık R, çıkış seviyesi (DA10/DU10).
3. Mini grafik (4H): Donchian 20 ve 10, giriş/stop/T1.

## 10. Test sonuçları (maliyet dahil)
| Enstrüman | Eğitim | Son 1 yıl |
|---|---|---|
| XAUUSD | 64 işlem, +18,5R, PF 1,65 | 14 işlem, +5,5R |
| US100 | 34 işlem, +5,8R, PF 1,38 | 6 işlem, +1,7R |
| US30 | 29 işlem, +7,7R, PF 1,82 | 9 işlem, −2,1R |
| XAGUSD (SLV) | 27 işlem, +6,3R, PF 1,42 | 4 işlem, +6,2R |
| BTCUSD | 75 işlem, +31,0R, PF 1,91 | 24 işlem, −5,2R |
| **Toplam** | 229 işlem, **+69,4R**, PF 1,68, en büyük düşüş −8,0R, pozitif ay 30/44 | 57 işlem (1,1/hafta), **+6,1R**, PF 1,18 |

Not: Yarı kâr kuralı, büyük trend yıllarında kârı azaltır (son 1 yılda kuralsız sürüm +26R yapardı), sıradan yıllarda istikrarı artırır. Bu bilinçli bir tercih — değiştirilmez.

## 11. Test senaryoları
1. Rejim +1, 4H kapanış DU20 üstünde → teyit → TAM, stop 2 ATR, T1 1,5R.
2. T1 görüldü → %50 kapandı, stop = giriş; sonra fiyat girişe döndü → kalan 0R ile kapanır, işlem toplamı +0,75R.
3. Aynı 4H mum içinde stop ve T1 → stop önceliği, −1R.
4. T1 sonrası 4H kapanış DA10 altında → kalan kapanır.
5. ETF 2. blok, borsa kapanışı öncesi → 4H kapanmış sayılmaz.
6. BTC Cumartesi 4H kırılım → geçerli sinyal.
