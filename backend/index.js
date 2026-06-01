require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to simulate IPFS CID generation
const generateMockCID = (content) => {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    // Simulated IPFS CID starting with Qm
    return `Qm${hash.substring(0, 44)}`;
};

app.post('/api/archive', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    try {
        const fs = require('fs');
        
        // URL formatını düzelt (http/https yoksa ekle)
        let targetUrl = url;
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        console.log(`[Crawler] Başlatılıyor: ${targetUrl}`);
        
        // Launch options (headless browser)
        const launchOptions = {
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        };

        // Eğer yerel Windows ortamındaysak, kurulu Chrome veya Edge'i kullanmayı deneyelim (opsiyonel)
        if (process.platform === 'win32') {
            const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
            const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
            
            if (fs.existsSync(edgePath)) {
                launchOptions.executablePath = edgePath;
            } else if (fs.existsSync(chromePath)) {
                launchOptions.executablePath = chromePath;
            }
        }
        
        // Launch Puppeteer
        browser = await puppeteer.launch(launchOptions);

        const page = await browser.newPage();
        
        // Set viewport to a standard desktop size
        await page.setViewport({ width: 1280, height: 800 });

        console.log(`[Crawler] Sayfa yükleniyor...`);
        // Ağır reklamlı haber sitelerinde 'networkidle2' sonsuza kadar bekleyebilir.
        // Bu yüzden 'domcontentloaded' (sayfa iskeleti yüklendiğinde) kullanıyoruz.
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Sayfanın görsel olarak biraz daha oturması için ekstra 2 saniye bekle
        await new Promise(r => setTimeout(r, 2000));

        console.log(`[Crawler] Ekran görüntüsü ve HTML alınıyor...`);
        
        // Get HTML content
        const htmlContent = await page.content();
        
        // Take screenshot as base64 (JPEG formatında boyutu küçültülmüş)
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
        if (browser) {
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 ChainArchive Backend Server ${PORT} portunda çalışıyor.`);
    console.log(`📡 Tarayıcı robotu (Puppeteer) hazır.`);
});
