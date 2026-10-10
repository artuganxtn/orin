export const MARKET_SYMBOLS = [
 {pair:'BTC-USD',label:'BTC/USD',name:'Bitcoin',tv:'BITSTAMP:BTCUSD',category:'crypto'},
 {pair:'ETH-USD',label:'ETH/USD',name:'Ethereum',tv:'BITSTAMP:ETHUSD',category:'crypto'},
 {pair:'XRP-USD',label:'XRP/USD',name:'XRP',tv:'BITSTAMP:XRPUSD',category:'crypto'},
 {pair:'SOL-USD',label:'SOL/USD',name:'Solana',tv:'COINBASE:SOLUSD',category:'crypto'},
 {pair:'BNB-USDT',label:'BNB/USDT',name:'BNB',tv:'BINANCE:BNBUSDT',category:'crypto'},
 {pair:'DOGE-USD',label:'DOGE/USD',name:'Dogecoin',tv:'COINBASE:DOGEUSD',category:'crypto'},
 {pair:'TON-USDT',label:'TON/USDT',name:'Toncoin',tv:'OKX:TONUSDT',category:'crypto'},
 {pair:'ADA-USD',label:'ADA/USD',name:'Cardano',tv:'COINBASE:ADAUSD',category:'crypto'},
 {pair:'EUR-USD',label:'EUR/USD',name:'اليورو / الدولار',tv:'FX:EURUSD',category:'forex'},
 {pair:'GBP-USD',label:'GBP/USD',name:'الجنيه / الدولار',tv:'FX:GBPUSD',category:'forex'},
 {pair:'XAU-USD',label:'XAU/USD',name:'الذهب / الدولار',tv:'OANDA:XAUUSD',category:'metals'},
 {pair:'XAG-USD',label:'XAG/USD',name:'الفضة / الدولار',tv:'OANDA:XAGUSD',category:'metals'},
 {pair:'SPX-USD',label:'S&P 500',name:'S&P 500',tv:'FOREXCOM:SPXUSD',category:'indices'},
 {pair:'NDX-USD',label:'Nasdaq 100',name:'Nasdaq 100',tv:'FOREXCOM:NSXUSD',category:'indices'},
] as const;
export function marketSymbol(pair:string){return MARKET_SYMBOLS.find(s=>s.pair===pair)??MARKET_SYMBOLS[0];}
