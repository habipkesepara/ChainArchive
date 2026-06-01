require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

const rateLimit = require('express-rate-limit');

// Rate Limiting (Aynı IP'den 1 dakikada en fazla 3 istek)
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 3, // Her IP için limit
    message: { error: 'Çok fazla istek attınız, lütfen 1 dakika sonra tekrar deneyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173', // Vercel URL'sini .env'den al veya local'e izin ver
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use('/api/', limiter); // Sadece API yollarına limit koy

// Sahte IPFS CID oluşturma aracı (Yedek)
const generateMockCID = (content) => {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `Qm${hash.substring(0, 44)}`;
};

// Puppeteer tarayıcı ayarları
const launchOptions = {
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};

// Eğer yerel Windows ortamındaysak, kurulu Chrome veya Edge'i kullanmayı deneyelim (opsiyonel)
if (process.platform === 'win32') {
    const fs = require('fs');
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    
    if (fs.existsSync(edgePath)) {
        launchOptions.executablePath = edgePath;
    } else if (fs.existsSync(chromePath)) {
        launchOptions.executablePath = chromePath;
    }
}

// Global Tarayıcı Örneği (Singleton)
let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.connected) {
        console.log("[Puppeteer] Yeni global tarayıcı örneği başlatılıyor...");
        browserInstance = await puppeteer.launch(launchOptions);
        
        browserInstance.on('disconnected', () => {
            console.log("[Puppeteer] Tarayıcı bağlantısı kesildi, sıfırlanıyor...");
            browserInstance = null;
        });
    }
    return browserInstance;
}

app.post('/api/archive', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let page;
    try {
        // URL formatını düzelt (http/https yoksa ekle)
        let targetUrl = url;
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        console.log(`[Crawler] Başlatılıyor: ${targetUrl}`);
        
        // Açık olan global tarayıcıyı al
        const browser = await getBrowser();
        page = await browser.newPage();
        
        // Standart masaüstü görünümü
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`[Crawler] Sayfa yükleniyor...`);
        // Ağır reklamlı haber sitelerinde 'networkidle2' sonsuza kadar bekleyebilir.
        // Bu yüzden 'domcontentloaded' (sayfa iskeleti yüklendiğinde) kullanıyoruz.
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Sayfanın görsel olarak biraz daha oturması için ekstra 1 saniye bekle
        await new Promise(r => setTimeout(r, 1000));

        console.log(`[Crawler] Ekran görüntüsü ve HTML alınıyor...`);
        
        const htmlContent = await page.content();
        
        // Tam sayfa ekran görüntüsünü al
        const screenshotBase64 = await page.screenshot({ encoding: 'base64', fullPage: true, type: 'jpeg', quality: 60 });

        console.log(`[Crawler] İşlem başarılı. IPFS/Pinata'ya yükleniyor...`);

        let finalCid = "Simulated_CID_" + Date.now(); // Varsayılan fallback CID

        if (process.env.PINATA_JWT && process.env.PINATA_JWT !== "buraya_pinata_jwt_token_gelecek") {
            try {
                // Ekran görüntüsünü Base64 formatından Buffer formatına çeviriyoruz ki Pinata kabul etsin
                const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 60 });
                
                const FormData = require('form-data');
                const axios = require('axios');
                const data = new FormData();
                
                // Resmi IPFS'e atıyoruz
                data.append('file', screenshotBuffer, {
                    filepath: 'screenshot.jpg'
                });
                
                // Metadataları (Örn: Orijinal URL) de IPFS dosyasına ekliyoruz
                const metadata = JSON.stringify({
                    name: `ChainArchive_Screenshot`,
                    keyvalues: { originalUrl: targetUrl }
                });
                data.append('pinataMetadata', metadata);

                const resPinata = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", data, {
                    headers: {
                        'Authorization': `Bearer ${process.env.PINATA_JWT}`,
                        ...data.getHeaders()
                    }
                });
                
                finalCid = resPinata.data.IpfsHash;
                console.log(`[IPFS] Başarıyla yüklendi! Gerçek CID: ${finalCid}`);
            } catch (pinataErr) {
                console.error("[IPFS] Pinata yüklemesi başarısız oldu, simülasyona dönülüyor:", pinataErr.message);
                finalCid = generateMockCID(htmlContent);
            }
        } else {
            console.log("[IPFS] Pinata JWT bulunamadı, simülasyon CID üretiliyor...");
            finalCid = generateMockCID(htmlContent);
        }

        res.json({
            success: true,
            cid: finalCid,
            screenshot: `data:image/jpeg;base64,${screenshotBase64}`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`[Crawler] Hata oluştu:`, error);
        res.status(500).json({ error: 'Web sitesi taraması başarısız oldu: ' + error.message });
    } finally {
        if (page) {
            // Sadece sekmeyi kapatıyoruz, tarayıcıyı kapatmıyoruz!
            await page.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 ChainArchive Backend Server ${PORT} portunda çalışıyor.`);
    console.log(`📡 Tarayıcı robotu (Puppeteer) hazır.`);
});
