# ⭐ Kurulum TD — Günlük Turtle (Donchian 55/20) + Yarı Kâr — Uygulama Şartnamesi

Enstrümanlar: **XAUUSD, US100, US500, US30, XAGUSD, BTCUSD, ETHUSD**. Bağımsız modül. Ortak kurallar: `kurulum_P_Portfoy_ortak_spec.md`.
Mantık: Günlük trend yönünde, günlük kapanış son 55 günün tepesini (dibini) kırınca gir; 1,5R'de yarısını kapat, stopu girişe çek; kalanı günlük kapanış son 20 günün dibini (tepesini) kırana kadar taşı. Az işlem, uzun tutma (haftalar).

> **Bu kurulumda da diğerlerindeki gibi:** **5 dakikalık tarama** (§5) ve **hatalı sinyal koruması** (§6) **zorunludur**. ⭐ = test edilmiş, parametreler kilitli.

---

## 1. Veri
| Enstrüman | Kaynak | Günlük mum |
|---|---|---|
| XAUUSD | `XAU/USD` 1h, `timezone=UTC` | Seans günü 18:00 → 17:00 strateji saati, ≥ 12 adet 1H |
| US100 / US500 / US30 | `QQQ` / `SPY` / `DIA` 1h (× oran) | Borsa günü, ≥ 5 adet 1H |
| XAGUSD | `SLV` 1h (× oran) | Borsa günü |
| BTCUSD / ETHUSD | Binance 1h | 18:00 → 17:00 strateji saati, 7/24 |

Gerekli geçmiş: en az **260** seans günü (EMA200 rejimi + Donchian 55). 1H'ten türetilir; ilk açılışta tam geçmiş yüklemesi (Twelve Data'da 2 çağrı / enstrüman).

## 2. Göstergeler
- `DU55`, `DA55` = Donchian üst/alt(55), günlük, mevcut gün hariç
- `DU20`, `DA20` = Donchian üst/alt(20), günlük
- `ATR14_D` (Wilder, günlük)
- `REJIM` = ortak şartname §4

## 3. Giriş (her seans günü kapanışında)
| # | Şart | LONG | SHORT |
|---|---|---|---|
| 1 | Rejim | `+1` | `−1` |
| 2 | Kırılım | Günlük kapanış `C > DU55` | `C < DA55` |
| 3 | Pozisyon yok | Bu enstrümanda açık ⭐TD yok | aynı |

- **Giriş:** teyitten sonra piyasa emri (testte bir sonraki günün açılışı). ETF tabanlılarda: ertesi borsa açılışı (TR kışın 17:30, yazın 16:30) — teyit kapanıştan sonra yapılır, emir açılışta.
- **Stop:** `giriş ∓ 2 × ATR14_D`. `R = |giriş − stop|`.
- **T1:** `giriş ± 1,5R` → **%50** kapat.

## 4. Yönetim ve çıkış
| Olay | Aksiyon |
|---|---|
| T1 (anlık) | %50 kapat, **stop = giriş** |
| Stop | Kalan kapanır |
| LONG: günlük kapanış `C < DA20` | Kalan, ertesi açılışta (24 saat piyasa: teyitten sonra hemen) piyasa emriyle |
| SHORT: günlük kapanış `C > DU20` | Aynı |
| Rejim değişimi | Çıkış nedeni değil |

Aynı gün içinde stop ve T1 → stop önceliği (test varsayımı).

## 5. 5 dakikalık tarama (zorunlu)
| Adım | Ne zaman | İş |
|---|---|---|
| A | Seans günü kapanışından sonraki ilk tarama | Günlük mum, DU55/DA55/DU20/DA20, ATR, rejim |
| B | Sonraki tarama | Çift tarama teyidi |
| C | Her 5 dk, açık ⭐TD varsa | T1 ve stop takibi (anlık fiyat) |
| D | Her seans kapanışında, açık pozisyon varsa | Donchian 20 çıkış kontrolü |

Kredi: açık pozisyon yokken TD ek kredi harcamaz (1H verisi diğer kurulumlarla ortak önbellekten).

## 6. Hatalı sinyal koruması (zorunlu)
Ortak tablo (§7.1–7.10) aynen. TD'ye özel:

| # | Kural |
|---|---|
| TD.1 | **Günlük kapanış teyidi:** 24 saat piyasalarda 17:00 strateji saati (TR 01:00) mumu kapanmadan günlük mum kapanmış sayılmaz. ETF'lerde borsa kapanış mumu (15:30–16:00 NY) gelmeden kapanmış sayılmaz. |
| TD.2 | **Açılış son kontrolü:** giriş anında fiyat sinyal kapanışından yön lehine **> 1 × ATR14_D** gittiyse "KAÇTI" (çok nadir; büyük boşluk). |
| TD.3 | **Uzun tutma uyarıları:** pozisyon açıkken her Cuma "hafta sonu taşınıyor" bilgisi (engel değil). Oran tazeliği (ortak §7.10) her hafta zorunlu kontrol. |
| TD.4 | **T1 ve BE onayı:** ⭐T4-S T4.3–T4.4 ile aynı (T1 emri + stop girişe çekme onayı). |

## 7. Durum mantığı
| # | Şart |
|---|---|
| 1 | Veri tamam ve taze |
| 2 | Rejim ±1 |
| 3 | Günlük kapanış Donchian 55 dışında |
| 4 | Açık ⭐TD yok |
| 5 | Koruma (teyit, son kontrol) |

TAM / EKSİK (⏳ 3: "DU55 = …, uzaklık … ATR") / YOK. Çoğu gün **EKSİK** veya **YOK** görünür — normal (yılda enstrüman başına ~2–3 işlem).

Bildirimler: "⭐TD: {sembol} {yön} TAM — giriş ~{f} (ertesi açılış), stop {s}, T1 {t1} (%50)" · "⭐TD: T1 — %50 kapat, stop girişe" · "⭐TD: çıkış — günlük Donchian 20 kırıldı".

## 8. Çıktı şeması (JSON)
```json
{
  "setup": "TD", "star": true,
  "symbol": "XAUUSD | US100 | US500 | US30 | XAGUSD | BTCUSD | ETHUSD",
  "evaluated_at_utc": "2026-11-06T22:05:10Z", "scan_seq": 2,
  "status": "TAM | EKSIK | YOK | TAM_BEKLE | VERI_GECIKMESI",
  "direction": "LONG | SHORT | null",
  "regime": {"value": 1},
  "donchian_d": {"du55": 4145.4, "da55": 3812.0, "du20": 4098.0, "da20": 3946.4},
  "atr14_d": 58.2,
  "order": {"type": "MARKET_NEXT_OPEN", "ref_price": 4150.0, "stop": 4033.6, "t1": 4324.6, "t1_fraction": 0.5, "lots": 0.04},
  "position": {"open": false, "t1_done": false, "stop_at_be": false, "days_open": 0, "r_now": null},
  "protection": {"double_scan_ok": true, "final_check": "OK | KACTI", "blocked_by": null},
  "portfolio": {"week_r": 0.4}
}
```

## 9. Ekran (⭐TD kartı)
1. Yedi satır: rejim rozeti, DU55/DA55'e uzaklık (ATR), durum.
2. Açık pozisyon: giriş, stop (BE etiketi), T1 ✅/⏳, açık gün sayısı, anlık R, çıkış seviyesi (DA20/DU20).
3. Mini grafik (günlük): Donchian 55 ve 20.

## 10. Test sonuçları (maliyet dahil)
| Enstrüman | Eğitim (Mar 2022 – Kas 2025) | Son 1 yıl |
|---|---|---|
| XAUUSD | 8 işlem, +17,1R | 2 işlem, −0,3R |
| US100 | 9 işlem, +9,3R | 3 işlem, +0,1R |
| US500 | 11 işlem, +5,8R | 3 işlem, +0,1R |
| US30 | 11 işlem, +2,4R | 3 işlem, +1,2R |
| XAGUSD (SLV) | 11 işlem, +10,4R | 1 işlem, +3,1R |
| BTCUSD | 10 işlem, +8,1R | 4 işlem, +0,5R |
| ETHUSD | 14 işlem, +0,1R | 3 işlem, +1,1R |
| **Toplam** | 74 işlem, **+53,3R**, PF 2,53, en büyük düşüş −7,8R | 19 işlem (0,4/hafta), **+5,8R**, PF 1,72, en büyük düşüş −2,1R |

Not: Örnek sayısı küçük (enstrüman başına yılda 2–3). Portföyde diğer kurulumlarla korelasyonu ~0; görevi büyük trendlerde sakin katkı.

## 11. Test senaryoları
1. Rejim +1, günlük kapanış DU55 üstünde → teyit → ertesi açılış girişi.
2. T1 → %50 kapat, stop girişe; sonra DA20 altında kapanış → kalan kapanır.
3. Rejim 0 iken DU55 kırılımı → YOK.
4. ETF: borsa kapanışı öncesi → günlük mum kapanmamış, sinyal yok.
5. Açılış boşluğu > 1 ATR → KAÇTI.
