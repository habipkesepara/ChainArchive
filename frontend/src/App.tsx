import { useState, useEffect, useCallback } from 'react';
import { Search, Link as LinkIcon, Clock, ShieldCheck, Database, ArrowRight, Loader2, CheckCircle2, Wallet } from 'lucide-react';
import { BrowserProvider, Contract } from 'ethers';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (eventName: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

interface ArchiveHistory {
  id?: string;
  url: string;
  cid: string;
  timestamp: string;
  txHash?: string;
  archiver?: string;
  title?: string;
  tag?: string;
  author?: string;
}

const parseError = (err: unknown): string => {
  if (!err) return "Bilinmeyen bir hata oluştu.";
  const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : String(err));
  
  if (msg.includes("user rejected action") || msg.includes("User denied transaction signature") || msg.includes("ACTION_REJECTED")) {
    return "İşlem iptal edildi: MetaMask üzerinden onayı reddettiniz.";
  }
  if (msg.includes("insufficient funds")) {
    return "Bakiye yetersiz: Cüzdanınızda bu işlem için yeterli SepoliaETH bulunmuyor.";
  }
  if (msg.includes("NetworkError") || msg.includes("network error")) {
    return "Bağlantı hatası: İnternet bağlantınızı veya ağ ayarlarınızı kontrol edin.";
  }
  if (msg.includes("Internal JSON-RPC error") || msg.includes("execution reverted")) {
    return "Ağ hatası: Blokzincir işlemi başarısız oldu. Ağ yoğun olabilir.";
  }
  
  if (msg.length > 100) {
    return "Teknik bir hata oluştu. Lütfen tekrar deneyin. (Hata detayı gizlendi)";
  }
  
  return msg;
};

// ChainArchive Akıllı Sözleşme ABI'si
const ChainArchiveABI = [
  "function createArchive(string memory _url, string memory _cid) public",
  "event ArchiveCreated(uint256 indexed archiveId, string url, string cid, address indexed archiver, uint256 timestamp)"
];

// Sepolia'daki Gerçek Akıllı Sözleşme Adresi
const CONTRACT_ADDRESS = "0xA98D252939c9E8413CB98Aa665dcA7384727F9AA"; 

function App() {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('Diğer');
  const [author, setAuthor] = useState('');
  const [activeMode, setActiveMode] = useState<'archive' | 'search'>('archive');
  const [archiveStep, setArchiveStep] = useState<'idle' | 'crawling' | 'wallet_approval' | 'mining'>('idle');
  const [archiveResult, setArchiveResult] = useState<{ cid: string; timestamp: string; txHash?: string; screenshot?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Web3 Durum Değişkenleri
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [history, setHistory] = useState<ArchiveHistory[]>([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);

  // Arama Durum Değişkenleri
  const [searchResults, setSearchResults] = useState<ArchiveHistory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Keşfet Durum Değişkenleri
  const [pageView, setPageView] = useState<'home' | 'explore'>('home');
  const [exploreResults, setExploreResults] = useState<ArchiveHistory[]>([]);
  const [isFetchingExplore, setIsFetchingExplore] = useState(false);

  // Uygulama açıldığında cüzdanı kontrol et
  useEffect(() => {
    let isMounted = true;
    const initWeb3 = async () => {
      if (window.ethereum) {
        await Promise.resolve(); // Delay state update to avoid sync render warning
        const web3Provider = new BrowserProvider(window.ethereum as never);
        if (isMounted) setProvider(web3Provider);
        
        window.ethereum.request({ method: 'eth_accounts' })
          .then((accounts) => {
            const accs = accounts as string[];
            if (isMounted && accs.length > 0) setAccount(accs[0]);
          })
          .catch(console.error);

        window.ethereum.on('accountsChanged', (accounts: unknown) => {
          const accs = accounts as string[];
          if (isMounted) setAccount(accs && accs.length > 0 ? accs[0] : null);
        });
      }
    };
    initWeb3();
    return () => { isMounted = false; };
  }, []);

  const checkAndSwitchNetwork = async () => {
    if (!window.ethereum) return false;
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      const sepoliaChainId = '0xaa36a7'; // Sepolia Hex Chain ID (11155111)
      if (chainId !== sepoliaChainId) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: sepoliaChainId }],
        });
      }
      return true;
    } catch (switchError: unknown) {
      const err = switchError as { code?: number; message?: string };
      if (err.code === 4902) {
        setError("Sepolia ağı cüzdanınızda bulunamadı. Lütfen ağlar kısmından manuel olarak ekleyin.");
      } else {
        setError("Sepolia ağına geçiş reddedildi veya bir hata oluştu.");
      }
      return false;
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask eklentisi bulunamadı. Kurulum sayfasına yönlendiriliyorsunuz...");
      setTimeout(() => {
        window.open('https://metamask.io/download/', '_blank');
      }, 1500);
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      setAccount(accounts[0]);
      await checkAndSwitchNetwork();
      setError(null);
    } catch (err: unknown) {
      console.error(err);
      setError(parseError(err));
    }
  };

  const fetchHistory = useCallback(async () => {
    if (!account || !provider) return;
    
    setIsFetchingHistory(true);
    try {
      const contract = new Contract(CONTRACT_ADDRESS, ChainArchiveABI, provider);
      // Filtre oluştur (ArchiveCreated olayında archiver = account olanlar)
      const filter = contract.filters.ArchiveCreated(null, null, null, account);
      
      // Geçmiş olayları çek
      const logs = await contract.queryFilter(filter);
      
      const parsedHistory: ArchiveHistory[] = logs.map((log) => {
        const logData = log as unknown as { topics: string[]; data: string; transactionHash: string; };
        const parsedLog = contract.interface.parseLog(logData);
        return {
          id: parsedLog?.args[0].toString() || "",
          url: parsedLog?.args[1] || "",
          cid: parsedLog?.args[2] || "",
          timestamp: new Date(Number(parsedLog?.args[4]) * 1000).toLocaleString(),
          txHash: logData.transactionHash,
          archiver: parsedLog?.args[3] || ""
        };
      }).reverse(); // En yeniler en üstte
      
      // Metadata çek
      if (parsedHistory.length > 0) {
        try {
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          const cids = parsedHistory.map(f => f.cid);
          const metaRes = await fetch(`${backendUrl}/api/metadata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cids })
          });
          const metaMap = await metaRes.json();
          parsedHistory.forEach(item => {
            if (metaMap[item.cid]) {
              item.title = metaMap[item.cid].title;
              item.tag = metaMap[item.cid].tag;
              item.author = metaMap[item.cid].author;
            }
          });
        } catch (e) {
          console.error("Metadata hatası:", e);
        }
      }

      setHistory(parsedHistory);
    } catch (err) {
      console.error("Geçmiş çekilirken hata:", err);
      setError(parseError(err));
    } finally {
      setIsFetchingHistory(false);
    }
  }, [account, provider]);

  useEffect(() => {
    let isMounted = true;
    if (account && provider) {
      setTimeout(() => { if (isMounted) fetchHistory(); }, 0);
    } else {
      setTimeout(() => { if (isMounted) setHistory([]); }, 0);
    }
    return () => { isMounted = false; };
  }, [account, provider, fetchHistory]);

  const searchUrlHistory = async () => {
    if (!url.trim()) return;
    
    if (!window.ethereum) {
      setError("MetaMask eklentisi bulunamadı. Kurulum sayfasına yönlendiriliyorsunuz...");
      setTimeout(() => { window.open('https://metamask.io/download/', '_blank'); }, 1500);
      return;
    }
    
    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    setSearchResults([]);
    setArchiveResult(null);

    try {
      const isNetworkCorrect = await checkAndSwitchNetwork();
      if (!isNetworkCorrect) {
        setIsSearching(false);
        return;
      }

      const web3Provider = new BrowserProvider(window.ethereum as never);
      const contract = new Contract(CONTRACT_ADDRESS, ChainArchiveABI, web3Provider);
      
      const filter = contract.filters.ArchiveCreated();
      const logs = await contract.queryFilter(filter);
      
      const parsedHistory: ArchiveHistory[] = logs.map((log) => {
        const logData = log as unknown as { topics: string[]; data: string; transactionHash: string; };
        const parsedLog = contract.interface.parseLog(logData);
        return {
          id: parsedLog?.args[0].toString() || "",
          url: parsedLog?.args[1] || "",
          cid: parsedLog?.args[2] || "",
          timestamp: new Date(Number(parsedLog?.args[4]) * 1000).toLocaleString(),
          txHash: logData.transactionHash,
          archiver: parsedLog?.args[3] || ""
        };
      });

      const filtered = parsedHistory
        .filter(item => item.url.toLowerCase().includes(url.toLowerCase().trim()))
        .reverse();

      // Metadata çek
      if (filtered.length > 0) {
        try {
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          const cids = filtered.map(f => f.cid);
          const metaRes = await fetch(`${backendUrl}/api/metadata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cids })
          });
          const metaMap = await metaRes.json();
          filtered.forEach(item => {
            if (metaMap[item.cid]) {
              item.title = metaMap[item.cid].title;
              item.tag = metaMap[item.cid].tag;
              item.author = metaMap[item.cid].author;
            }
          });
        } catch (e) {
          console.error("Metadata fetch error:", e);
        }
      }

      setSearchResults(filtered);
    } catch (err: unknown) {
      console.error(err);
      setError(parseError(err));
    } finally {
      setIsSearching(false);
    }
  };

  const fetchExplore = async () => {
    setIsFetchingExplore(true);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await fetch(`${backendUrl}/api/explore`);
      const data = await response.json();
      
      const parsed: ArchiveHistory[] = data.map((item: { url: string; originalUrl: string; cid: string; timestamp: string; title: string; tag: string; author: string; }) => ({
        url: item.originalUrl || item.url || "",
        cid: item.cid,
        timestamp: new Date(item.timestamp).toLocaleString(),
        title: item.title,
        tag: item.tag,
        author: item.author
      }));
      setExploreResults(parsed);
    } catch (err) {
      console.error("Keşfet hatası:", err);
    } finally {
      setIsFetchingExplore(false);
    }
  };

  const handleArchive = async () => {
    if (!url.trim()) return;
    if (!account || !provider) {
      setError("Lütfen önce cüzdanınızı bağlayın!");
      return;
    }
    
    // Ağ kontrolü yap (Kullanıcı sonradan değiştirmiş olabilir)
    const isNetworkCorrect = await checkAndSwitchNetwork();
    if (!isNetworkCorrect) return;

    setArchiveStep('crawling');
    setError(null);
    setArchiveResult(null);

    try {
      // 1. Backend'e İstek At (Ekran görüntüsü, HTML alma ve Metadataları gönderme)
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await fetch(`${backendUrl}/api/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title, tag, author })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Sunucu tarafında arşivleme hatası");
      }
      
      const cid = data.cid;
      const screenshot = data.screenshot;
      
      // 2. Akıllı Sözleşme İşlemi (Blockchain'e yazma - Sepolia Testnet)
      setArchiveStep('wallet_approval');
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ChainArchiveABI, signer);
      
      // Kullanıcı MetaMask'ten onaylayacak
      const tx = await contract.createArchive(url, cid);
      
      // İşlemin blokzincire onaylanmasını bekle
      setArchiveStep('mining');
      const receipt = await tx.wait();
      const txHash = receipt.hash;

      setArchiveResult({
        cid,
        timestamp: new Date(data.timestamp).toLocaleString() || new Date().toLocaleString(),
        txHash,
        screenshot
      });
      setUrl('');
      
      // Başarılı işlem sonrası geçmişi yenile
      fetchHistory();
    } catch (err: unknown) {
      setError(parseError(err));
    } finally {
      setArchiveStep('idle');
    }
  };

  // Cüzdan adresini kısaltma yardımcı fonksiyonu
  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans flex flex-col">
      {/* Üst Menü */}
      <header className="border-b border-white/10 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setPageView('home')}>
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Database className="w-5 h-5 text-white" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-white hidden sm:block">ChainArchive</span>
            </div>
            
            <nav className="flex gap-6">
              <button 
                onClick={() => setPageView('home')}
                className={`text-sm font-medium transition-colors ${pageView === 'home' ? 'text-white border-b-2 border-purple-500 py-7' : 'text-zinc-400 hover:text-white py-7'}`}
              >
                Ana Sayfa
              </button>
              <button 
                onClick={() => { setPageView('explore'); fetchExplore(); }}
                className={`text-sm font-medium transition-colors ${pageView === 'explore' ? 'text-white border-b-2 border-emerald-500 py-7' : 'text-zinc-400 hover:text-white py-7'}`}
              >
                Keşfet
              </button>
            </nav>
          </div>
          <button 
            onClick={connectWallet}
            className="px-6 py-2.5 text-base font-medium bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10 flex items-center gap-2"
          >
            <Wallet className="w-4 h-4 text-purple-400" />
            {account ? formatAddress(account) : "Cüzdanı Bağla"}
          </button>
        </div>
      </header>

      {/* Ana Bölüm */}
      <main className="flex-grow flex flex-col items-center pt-32 pb-20 px-6 relative overflow-hidden">
        
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-purple-500/20 blur-[150px] rounded-full pointer-events-none" />
        
        {pageView === 'home' ? (
          <>
            <div className="text-center max-w-4xl z-10 w-full">
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent">
            Merkeziyetsiz <br/> Dijital Hafıza
          </h1>
          <p className="text-zinc-400 text-lg md:text-xl mb-8 max-w-2xl mx-auto leading-relaxed">
            İnternet üzerindeki bilginin kaybolmasını, değiştirilmesini veya sansürlenmesini engelleyin. İçerikleri sonsuza kadar blokzincire kazıyın.
          </p>

          {/* Mod Seçici (Sekmeler) */}
          <div className="flex justify-center gap-4 mb-8 z-10 relative">
            <button 
              onClick={() => { setActiveMode('archive'); setHasSearched(false); }}
              className={`px-6 py-2.5 rounded-full font-medium transition-all duration-300 flex items-center gap-2 ${activeMode === 'archive' ? 'bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
            >
              <ArrowRight className="w-4 h-4" /> Yeni Arşiv Oluştur
            </button>
            <button 
              onClick={() => { setActiveMode('search'); setArchiveResult(null); }}
              className={`px-6 py-2.5 rounded-full font-medium transition-all duration-300 flex items-center gap-2 ${activeMode === 'search' ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
            >
              <Search className="w-4 h-4" /> Geçmişi Sorgula
            </button>
          </div>

          {/* Arşivleme Modu Ek Veri Alanları */}
          {activeMode === 'archive' && (
            <div className="flex flex-col md:flex-row gap-4 max-w-3xl mx-auto mb-4 z-10 relative animate-in fade-in slide-in-from-top-4 duration-300">
              <input 
                type="text" 
                placeholder="Başlık (Opsiyonel)"
                className="flex-grow bg-zinc-900/80 border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-shadow"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={archiveStep !== 'idle'}
                maxLength={50}
              />
              <input 
                type="text" 
                placeholder="Kullanıcı Adı (Opsiyonel)"
                className="md:w-1/4 bg-zinc-900/80 border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-shadow"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                disabled={archiveStep !== 'idle'}
                maxLength={30}
              />
              <div className="relative md:w-1/4">
                <select 
                  className="w-full bg-zinc-900/80 border border-white/10 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none transition-shadow cursor-pointer"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  disabled={archiveStep !== 'idle'}
                >
                  <option value="Diğer">Etiket: Diğer</option>
                  <option value="Haber">Haber</option>
                  <option value="Sosyal Medya">Sosyal Medya</option>
                  <option value="Kanıt">Kanıt</option>
                  <option value="Finans">Finans</option>
                  <option value="Makale">Makale</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>
          )}

          {/* Ana Girdi Alanı */}
          <div className="relative max-w-2xl mx-auto group mb-8">
            <div className={`absolute -inset-1 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-500 ${activeMode === 'archive' ? 'bg-gradient-to-r from-purple-500 to-blue-500' : 'bg-gradient-to-r from-emerald-500 to-teal-500'}`}></div>
            <div className="relative bg-zinc-900 ring-1 ring-white/10 rounded-2xl flex flex-col md:flex-row items-center p-2 shadow-2xl">
              <div className="pl-4 pr-2 text-zinc-400 hidden md:block">
                <LinkIcon className="w-5 h-5" />
              </div>
              <input 
                type="text" 
                placeholder={activeMode === 'archive' ? "Arşivlenecek URL'yi girin (örn: https://news.com/...)" : "Sorgulanacak URL'yi girin..."}
                className="flex-grow w-full bg-transparent border-none outline-none text-zinc-100 placeholder-zinc-500 px-3 py-3 text-lg"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setHasSearched(false); }}
                disabled={archiveStep !== 'idle' || isSearching}
                onKeyDown={(e) => e.key === 'Enter' && (activeMode === 'archive' ? handleArchive() : searchUrlHistory())}
              />
              <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto p-1">
                {activeMode === 'search' ? (
                  <button 
                    onClick={searchUrlHistory}
                    disabled={isSearching || !url.trim()}
                    className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-base font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Sorgula
                  </button>
                ) : (
                  <button 
                    onClick={handleArchive}
                    disabled={archiveStep !== 'idle' || !url.trim()}
                    className="w-full md:w-auto bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-base font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {archiveStep !== 'idle' ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {archiveStep === 'crawling' && "Taranıyor (1/3)"}
                        {archiveStep === 'wallet_approval' && "Cüzdan (2/3)"}
                        {archiveStep === 'mining' && "Blokzincir (3/3)"}
                      </span>
                    ) : (
                      <>Arşivle <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Arama Sonuçları */}
          {hasSearched && searchResults.length > 0 && !archiveResult && (
            <div className="max-w-4xl mx-auto mb-10 text-left animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-center gap-2 mb-6 text-emerald-400 bg-emerald-500/10 py-3 px-6 rounded-2xl border border-emerald-500/20">
                <CheckCircle2 className="w-5 h-5" />
                <h3 className="text-lg font-bold">Bu URL daha önce {searchResults.length} kez arşivlenmiş!</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {searchResults.map((item, index) => (
                  <div key={index} className="bg-zinc-900/80 border border-white/10 p-5 rounded-2xl flex flex-col gap-3 hover:border-emerald-500/50 transition-colors">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-mono text-purple-400">{item.timestamp}</span>
                      <a href={`https://ipfs.io/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1">
                        <Search className="w-3 h-3" /> Görüntüle
                      </a>
                    </div>
                    <div className="text-zinc-100 font-medium truncate">{item.title && item.title !== "Başlıksız Arşiv" ? item.title : item.url}</div>
                    {item.title && item.title !== "Başlıksız Arşiv" && <div className="text-xs text-zinc-400 truncate">{item.url}</div>}
                    <div className="flex gap-2 flex-wrap mt-2">
                      {item.tag && <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-1 rounded border border-purple-500/20">{item.tag}</span>}
                      {item.author && item.author !== "Anonim" && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-1 rounded border border-blue-500/20">👤 {item.author}</span>}
                      {item.archiver && <div className="text-[10px] text-zinc-500 bg-black/30 px-2 py-1 rounded border border-white/5">Cüzdan: <span className="font-mono text-zinc-400">{formatAddress(item.archiver)}</span></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {hasSearched && searchResults.length === 0 && !isSearching && !archiveResult && (
            <div className="max-w-3xl mx-auto mb-10 p-5 bg-zinc-900/50 border border-white/5 rounded-xl text-zinc-400 text-base">
              Bu URL için geçmişte yapılmış bir arşiv bulunamadı. İlk arşivi siz oluşturun!
            </div>
          )}

          {error && (
            <div className="max-w-3xl mx-auto mb-10 p-5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-base">
              {error}
            </div>
          )}

          {archiveResult && (
            <div className="max-w-3xl mx-auto mb-10 p-8 bg-zinc-900/80 border border-emerald-500/30 rounded-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-4 mb-6">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <h3 className="text-2xl font-semibold text-emerald-50">Başarıyla Blokzincire Kazındı!</h3>
              </div>
              <div className="space-y-4 text-left">
                <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5">
                  <div className="text-sm text-zinc-500 mb-2 uppercase tracking-wider">İçerik ID (IPFS CID)</div>
                  <div className="font-mono text-emerald-400 text-base break-all select-all">
                    {archiveResult.cid}
                  </div>
                </div>
                {archiveResult.txHash && (
                  <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5">
                    <div className="text-sm text-zinc-500 mb-2 uppercase tracking-wider">İşlem Hash'i (Tx)</div>
                    <a 
                      href={`https://sepolia.etherscan.io/tx/${archiveResult.txHash}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="font-mono text-blue-400 hover:text-blue-300 hover:underline text-base break-all flex items-center gap-2"
                    >
                      {archiveResult.txHash}
                    </a>
                  </div>
                )}
                {archiveResult.screenshot && (
                  <div className="bg-zinc-950/50 p-2 rounded-xl border border-white/5 mt-4">
                    <div className="text-sm text-zinc-500 mb-2 px-3 pt-2 uppercase tracking-wider">Web Sitesi Görüntüsü</div>
                    <img 
                      src={archiveResult.screenshot} 
                      alt="Website Screenshot" 
                      className="w-full rounded-lg object-contain max-h-[400px] shadow-lg border border-white/10"
                    />
                  </div>
                )}
                <div className="flex justify-between items-center px-3 pt-2">
                  <span className="text-base text-zinc-400">Tarih: {archiveResult.timestamp}</span>
                  <a 
                    href={`https://ipfs.io/ipfs/${archiveResult.cid}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-base text-purple-400 hover:text-purple-300 underline underline-offset-4"
                  >
                    Ağda Görüntüle
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

            {/* Özellikler */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl w-full mt-20 z-10">
          <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors">
            <ShieldCheck className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Sansüre Dirençli</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              İçerikler merkeziyetsiz ağlarda (IPFS/Arweave) saklanır. Hiçbir otorite tarafından silinemez veya değiştirilemez.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors">
            <Clock className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Kriptografik Zaman Damgası</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Her arşiv, blokzincir üzerinde o saniyeye ait bir zaman damgasıyla imzalanır. Matematiksel olarak kanıtlanabilirdir.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors">
            <Search className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Şeffaf Doğrulama</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Arşivlenen her içerik açık kaynaklı olarak herkes tarafından anında doğrulanabilir ve görüntülenebilir.
            </p>
          </div>
        </div>

            {/* Geçmiş Arşivler */}
            {account && pageView === 'home' && (
              <div className="max-w-6xl w-full mt-20 z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">

            <div className="flex items-center justify-center gap-2 mb-8">
              <Clock className="w-6 h-6 text-purple-400" />
              <h2 className="text-2xl font-bold text-zinc-100">Geçmiş Arşivleriniz</h2>
              {isFetchingHistory && <Loader2 className="w-5 h-5 animate-spin text-zinc-500 ml-4" />}
            </div>
            
            {history.length === 0 && !isFetchingHistory ? (
              <div className="bg-zinc-900/50 border border-white/5 p-10 rounded-3xl text-center text-zinc-500 backdrop-blur-sm max-w-2xl mx-auto">
                Henüz bu cüzdanla yapılmış bir arşiv bulunmuyor.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {history.map((item, index) => (
                  <div key={index} className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors flex flex-col justify-between overflow-hidden relative">
                    <div className="absolute top-0 right-0 bg-emerald-500/10 text-emerald-400 px-3 py-1 text-[10px] font-semibold rounded-bl-lg border-b border-l border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Onaylandı
                    </div>
                    <div>
                      <div className="text-sm text-purple-400 mb-2 font-mono font-medium">{item.timestamp}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-lg md:text-xl font-bold text-zinc-100 hover:text-white hover:underline line-clamp-1 mb-3">
                        {item.title && item.title !== "Başlıksız Arşiv" ? item.title : item.url}
                      </a>
                    </div>
                    
                    {/* Görsel Önizleme Alanı */}
                    <div className="mb-4 rounded-xl overflow-hidden border border-white/5 bg-black/50 group relative">
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10 backdrop-blur-sm">
                        <a href={`https://ipfs.io/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg text-xs transition-colors flex items-center gap-2">
                           <Search className="w-3 h-3" /> Tam Boyut Gör
                        </a>
                      </div>
                      <img 
                        src={`https://ipfs.io/ipfs/${item.cid}`} 
                        alt="Archive Preview" 
                        className="w-full h-32 object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).parentElement!.classList.add('flex', 'items-center', 'justify-center', 'h-40');
                          (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="text-zinc-600 text-sm flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 mb-2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>Görsel IPFS\'ten yükleniyor...</div>';
                        }}
                      />
                    </div>

                    <div className="bg-zinc-950/50 p-4 rounded-xl border border-white/5 flex flex-col gap-3 mt-auto">
                      <div className="flex flex-wrap gap-2 mb-2">
                          {item.tag && <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-1 rounded border border-purple-500/20">{item.tag}</span>}
                          {item.author && item.author !== "Anonim" && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-1 rounded border border-blue-500/20">👤 {item.author}</span>}
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">IPFS CID</span>
                        <a href={`https://ipfs.io/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="text-sm font-mono text-emerald-400 hover:text-emerald-300 hover:underline truncate ml-4 max-w-[200px]">
                          {item.cid}
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
            )}
          </>
        ) : (
          <div className="max-w-6xl w-full z-10 mt-10">
            <div className="flex items-center justify-between mb-10 border-b border-white/10 pb-6">
              <div>
                <h2 className="text-3xl font-bold flex items-center gap-3">
                  <Database className="w-8 h-8 text-emerald-400" />
                  Keşfet
                </h2>
                <p className="text-zinc-400 mt-2">Ağdaki diğer kullanıcıların blokzincire kazıdığı son arşivleri inceleyin.</p>
              </div>
              <button 
                onClick={fetchExplore} 
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm"
              >
                {isFetchingExplore ? <Loader2 className="w-4 h-4 animate-spin" /> : "Yenile"}
              </button>
            </div>
            
            {isFetchingExplore && exploreResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
                <p>Arşivler ağdan çekiliyor...</p>
              </div>
            ) : exploreResults.length === 0 ? (
              <div className="text-center py-20 text-zinc-500 bg-zinc-900/30 rounded-3xl border border-white/5">
                Henüz genel ağda bir arşiv bulunamadı.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {exploreResults.map((item, index) => (
                  <div key={index} className="bg-zinc-900/80 border border-white/10 p-6 rounded-3xl flex flex-col gap-4 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/10 group">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">{item.timestamp}</span>
                      <a href={`https://ipfs.io/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="text-xs bg-zinc-800 text-zinc-300 hover:bg-emerald-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors font-medium">Görüntüle</a>
                    </div>
                    <div>
                      <div className="text-zinc-100 font-bold text-lg line-clamp-2 mb-1 group-hover:text-emerald-400 transition-colors">{item.title && item.title !== "Başlıksız Arşiv" ? item.title : item.url}</div>
                      {item.title && item.title !== "Başlıksız Arşiv" && <div className="text-xs text-zinc-500 truncate">{item.url}</div>}
                    </div>
                    <div className="flex gap-2 flex-wrap mt-auto pt-2 border-t border-white/5">
                      {item.tag && <span className="text-[11px] bg-purple-500/20 text-purple-400 px-2 py-1 rounded font-medium">{item.tag}</span>}
                      {item.author && item.author !== "Anonim" && <span className="text-[11px] bg-blue-500/20 text-blue-400 px-2 py-1 rounded font-medium">👤 {item.author}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
