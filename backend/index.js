require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1); // Render veya Vercel gibi proxy arkasında rate-limit için zorunlu
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
    methods: ['GET', 'POST', 'DELETE'],
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
    let page;
    try {
        const { url, title, tag, author, archiver } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

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
        
        // Sayfa çok uzunsa `fullPage: true` takılabilir. Max 15000px yükseklikle sınırlıyoruz.
        const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const clipHeight = Math.min(pageHeight, 15000);

        // Tam sayfa ekran görüntüsünü al (veya limitli)
        const screenshotBase64 = await page.screenshot({ 
            encoding: 'base64', 
            type: 'jpeg', 
            quality: 60,
            clip: { x: 0, y: 0, width: 1280, height: clipHeight }
        });

        console.log(`[Crawler] İşlem başarılı. IPFS/Pinata'ya yükleniyor...`);

        let finalCid = "Simulated_CID_" + Date.now(); // Varsayılan fallback CID

        if (process.env.PINATA_JWT && process.env.PINATA_JWT !== "buraya_pinata_jwt_token_gelecek") {
            try {
                // Ekran görüntüsünü Base64 formatından Buffer formatına çeviriyoruz ki Pinata kabul etsin
                // page.screenshot() işlemini iki kere çağırmamak için base64 verisini dönüştürüyoruz (Performans artışı)
                const screenshotBuffer = Buffer.from(screenshotBase64, 'base64');
                
                const FormData = require('form-data');
                const axios = require('axios');
                const data = new FormData();
                
                // Resmi IPFS'e atıyoruz (Klasör yapısı için filepath belirtiyoruz)
                data.append('file', screenshotBuffer, {
                    filepath: 'ChainArchive/screenshot.jpg'
                });
                
                // HTML Kodunu IPFS'e atıyoruz
                data.append('file', Buffer.from(htmlContent, 'utf-8'), {
                    filepath: 'ChainArchive/source.html'
                });
                
                // Metadataları (Örn: Orijinal URL, Başlık ve Etiket) de IPFS dosyasına ekliyoruz
                const metadata = JSON.stringify({
                    name: `ChainArchive_${title || 'Untitled'}`,
                    keyvalues: { 
                        originalUrl: url,
                        title: title || "Başlıksız Arşiv",
                        tag: tag || "Diğer",
                        author: author || "Anonim",
                        archiver: archiver || 'Bilinmiyor',
                        timestamp: new Date().toISOString(),
                        version: "2"
                    }
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

// Keşfet Sayfası Endpoint'i
app.get('/api/explore', async (req, res) => {
    try {
        const response = await fetch(`https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=50`, {
            headers: {
                'Authorization': `Bearer ${process.env.PINATA_JWT}`
            }
        });
        const data = await response.json();
        if (!response.ok) throw new Error('Pinata API hatası');
        
        // Sadece bizim formatımızdaki (ChainArchive_) metadataları filtrele
        const archives = data.rows
            .filter(row => row.metadata && row.metadata.name && row.metadata.name.startsWith('ChainArchive_'))
            .map(row => ({
                cid: row.ipfs_pin_hash,
                timestamp: row.date_pinned,
                size: row.size,
                ...row.metadata.keyvalues
            }));
            
        res.json(archives);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Keşfet verileri alınamadı' });
    }
});

// Toplu Metadata getirme (Sorgula sonuçları için)
app.post('/api/metadata', async (req, res) => {
    try {
        const { cids } = req.body;
        if (!cids || !Array.isArray(cids)) return res.status(400).json({ error: 'cids dizisi gerekli' });
        
        const metadataMap = {};
        
        const response = await fetch(`https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=100`, {
            headers: { 'Authorization': `Bearer ${process.env.PINATA_JWT}` }
        });
        const data = await response.json();
        
        if (data.rows) {
            data.rows.forEach(row => {
                if (cids.includes(row.ipfs_pin_hash)) {
                    metadataMap[row.ipfs_pin_hash] = row.metadata.keyvalues || {};
                }
            });
        }
        res.json(metadataMap);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Metadata alınamadı' });
    }
});

// İptal durumunda (MetaMask reddi vs.) IPFS'ten dosyayı silmek için
app.delete('/api/unpin', async (req, res) => {
    try {
        const { cid } = req.body;
        if (!cid) return res.status(400).json({ error: 'cid gerekli' });
        
        if (process.env.PINATA_JWT) {
            const axios = require('axios');
            await axios.delete(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.PINATA_JWT}`
                }
            });
            console.log(`[IPFS] İptal edilen işlem için CID silindi: ${cid}`);
        }
        res.json({ success: true });
    } catch (error) {
        console.error("[IPFS] Unpin hatası:", error.message);
        res.status(500).json({ error: 'Unpin işlemi başarısız' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 ChainArchive Backend Server ${PORT} portunda çalışıyor.`);
    console.log(`📡 Tarayıcı robotu (Puppeteer) hazır.`);
});
