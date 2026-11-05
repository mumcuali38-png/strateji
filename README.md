# Strateji Radar

6 trading stratejisini (A–F) otomatik izleyen, Android tablete **PWA** olarak kurulan ve uygulama kapalıyken bile **bildirim** gönderen uygulama.

> **Uygulama sinyal verir, karar senindir.** İşlem açmaz.

- Kurallar: [`MASTERPROMPT.md`](MASTERPROMPT.md) (kopyası `CLAUDE.md`) · Varsayımlar: [`KARARLAR.md`](KARARLAR.md)
- Tarama: GitHub Actions, 5 dakikada bir (Pzt–Cum 10:00–20:00 TR). Sonuçlar `data` dalına yazılır.
- Arayüz: GitHub Pages → `https://mumcuali38-png.github.io/strateji/`

## Kısa kullanım
- **Özet:** "Şu an" şeridi TAM setupları gösterir; ızgarada strateji × sembol durumu (🟢 TAM · 🟡 kalan şart · ⚪ YOK). Hücreye dokun → detay.
- **Strateji sekmesi:** üstte sembol çipleri (kaydırarak değiştir), solda grafik, sağda şart tablosu ve setup kartı. Şart satırına dokun → grafikte seviye vurgulanır. Kartta giriş yöntemini değiştir; giriş/stop/RR/lot yeniden hesaplanır.
- **İşleme girdim** → günlüğe kaydeder (veriler sadece tablette; JSON dışa/içe aktar). **Claude'a gönder** → şart tablosu + kart panoya.
- **F Wyckoff (BTC):** Binance verisiyle spring/UTAD, 24 saat (gece ve hafta sonu `scan-f` ile 15 dk'da bir). 🟠 **TAM – BEKLE** = kurulum tam ama funding / Cumartesi / likidasyon / haber bloğu var. Kartta T1/T2/T3, BTC miktarı ve kaldıraç (en fazla 3x).
- **Haber:** kırmızı haberlere −30/+15 dk kala/sonra ilgili setuplar YOK olur, üstte kırmızı şerit çıkar.
- **Geçmiş:** son 30 günün TAM ve "1 şart kaldı" olayları ve sonuçları (TP/SL/MFE/MAE).
- **Ayarlar:** bakiye, risk, kontrat/tampon, bildirim matrisi, parametre önerisi, tema.
- Aşağı çekerek yenile (sadece JSON okur, API'ye gitmez).

## Geliştirici
```bash
cd scanner && npm ci
npm test                 # birim testleri
npm run typecheck
DATA_DIR=../demo-data npm run demo   # sentetik veriyle state/charts üret
cd .. && ln -s demo-data data && python3 -m http.server   # http://localhost:8000
```
Dizinler: `/` PWA · `/scanner` Node 20 + TypeScript tarayıcı · `/config` parametreler · `.github/workflows` scan / news / deploy.
