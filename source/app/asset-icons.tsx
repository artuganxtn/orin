import React from 'react';

interface AssetIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function parseSymbolKey(symbol: string): string {
  if (!symbol) return 'BTC';
  const clean = symbol.toUpperCase().trim();
  const first = clean.split(/[-_/]/)[0].replace(/[^A-Z0-9]/g, '');
  if (first.startsWith('BTC')) return 'BTC';
  if (first.startsWith('ETH')) return 'ETH';
  if (first.startsWith('XRP')) return 'XRP';
  if (first.startsWith('SOL')) return 'SOL';
  if (first.startsWith('BNB')) return 'BNB';
  if (first.startsWith('DOGE')) return 'DOGE';
  if (first.startsWith('TON')) return 'TON';
  if (first.startsWith('ADA')) return 'ADA';
  if (first.startsWith('EUR')) return 'EUR';
  if (first.startsWith('GBP')) return 'GBP';
  if (first.startsWith('XAU') || first.startsWith('GOLD')) return 'XAU';
  if (first.startsWith('XAG') || first.startsWith('SILVER')) return 'XAG';
  if (first.startsWith('SPX')) return 'SPX';
  if (first.startsWith('NDX') || first.startsWith('NSX') || first.startsWith('NASDAQ')) return 'NDX';
  return first.slice(0, 4);
}

export function AssetIcon({ symbol, size = 32, className = '' }: AssetIconProps) {
  const s = parseSymbolKey(symbol);
  const style = { width: size, height: size, minWidth: size, minHeight: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

  switch (s) {
    case 'BTC':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Bitcoin">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#F7931A"/>
            <path fill="#FFF" d="M23.19 14.02c.31-2.1-1.28-3.22-3.47-3.98l.71-2.84-1.73-.43-.69 2.76c-.45-.11-.92-.22-1.39-.33l.7-2.78-1.73-.43-.7 2.84c-.38-.09-.75-.17-1.1-.26l.0-.01-2.38-.6-.46 1.85s1.28.3 1.25.31c.7.18.83.64.81 1.01l-.81 3.24c.05.01.11.03.18.06l-.18-.05-1.13 4.53c-.09.21-.3.53-.79.41.02.03-1.26-.31-1.26-.31l-.86 1.98 2.25.56c.42.1.83.22 1.23.32l-.71 2.87 1.72.43.71-2.84c.47.13.93.25 1.38.36l-.71 2.83 1.73.43.71-2.87c2.95.56 5.16.33 6.1-2.33.75-2.15-.04-3.39-1.59-4.2 1.13-.25 1.98-1 2.21-2.53zm-3.95 5.54c-.54 2.15-4.15.99-5.32.69l.95-3.8c1.17.29 4.93.87 4.37 3.11zm.53-5.57c-.49 1.95-3.5.96-4.47.72l.86-3.45c.98.24 4.12.7 3.61 2.73z"/>
          </svg>
        </span>
      );

    case 'ETH':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Ethereum">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#627EEA"/>
            <g fill="#FFF" fillRule="evenodd">
              <path fillOpacity=".6" d="M16 4v8.87l7.44 3.32L16 4z"/>
              <path d="M16 4L8.56 16.19 16 12.87V4z"/>
              <path fillOpacity=".6" d="M16 21.97v6.02l7.45-10.29L16 21.97z"/>
              <path d="M16 27.99v-6.02l-7.44-4.27L16 27.99z"/>
              <path fillOpacity=".2" d="M16 20.57l7.44-4.38L16 12.87v7.7z"/>
              <path fillOpacity=".6" d="M8.56 16.19l7.44 4.38v-7.7L8.56 16.19z"/>
            </g>
          </svg>
        </span>
      );

    case 'XRP':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="XRP">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#23292F"/>
            <path fill="#FFF" d="M23.9 8.2c-.4 0-.8.2-1.1.5l-4.1 4.1c-1.5 1.5-4 1.5-5.5 0L9.1 8.7c-.3-.3-.7-.5-1.1-.5s-.8.2-1.1.5c-.6.6-.6 1.6 0 2.2l4.1 4.1c.7.7 1.7 1.1 2.7 1.1s2-.4 2.7-1.1l4.1-4.1c.6-.6.6-1.6 0-2.2-.3-.4-.7-.6-1.1-.6zm0 11.2c-.4 0-.8.2-1.1.5l-4.1 4.1c-1.5 1.5-4 1.5-5.5 0l-4.1-4.1c-.6-.6-1.6-.6-2.2 0-.6.6-.6 1.6 0 2.2l4.1 4.1c.7.7 1.7 1.1 2.7 1.1s2-.4 2.7-1.1l4.1-4.1c.6-.6.6-1.6 0-2.2-.3-.4-.7-.6-1.1-.6z"/>
          </svg>
        </span>
      );

    case 'SOL':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Solana">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#111625"/>
            <defs>
              <linearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00FFA3"/>
                <stop offset="100%" stopColor="#DC1FFF"/>
              </linearGradient>
            </defs>
            <path fill="url(#solGrad)" d="M8.2 21.6c.1-.1.3-.2.5-.2h14.7c.3 0 .5.1.7.4.2.2.1.6-.1.8l-3.3 3.3c-.1.1-.3.2-.5.2H5.5c-.3 0-.5-.1-.7-.4-.2-.2-.1-.6.1-.8l3.3-3.3zm0-11.2c.1-.1.3-.2.5-.2h14.7c.3 0 .5.1.7.4.2.2.1.6-.1.8l-3.3 3.3c-.1.1-.3.2-.5.2H5.5c-.3 0-.5-.1-.7-.4-.2-.2-.1-.6.1-.8l3.3-3.3zm15.6 5.6c-.1-.1-.3-.2-.5-.2H8.6c-.3 0-.5.1-.7.4-.2.2-.1.6.1.8l3.3 3.3c.1.1.3.2.5.2h14.7c.3 0 .5-.1.7-.4.2-.2.1-.6-.1-.8l-3.3-3.3z"/>
          </svg>
        </span>
      );

    case 'BNB':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="BNB">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#F3BA2F"/>
            <path fill="#FFF" d="M12.1 14.6l3.9-3.9 3.9 3.9 2.3-2.3L16 6.1l-6.2 6.2 2.3 2.3zm-6 1.4l2.3-2.3 2.3 2.3-2.3 2.3-2.3-2.3zm6 1.4l3.9 3.9 3.9-3.9 2.3 2.3L16 25.9l-6.2-6.2 2.3-2.3zm13.8-1.4l-2.3-2.3 2.3-2.3 2.3 2.3-2.3 2.3zM16 13.7l2.3 2.3-2.3 2.3-2.3-2.3 2.3-2.3z"/>
          </svg>
        </span>
      );

    case 'DOGE':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Dogecoin">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#C2A633"/>
            <circle cx="16" cy="16" r="13.5" fill="none" stroke="#E2C755" strokeWidth="1"/>
            <path fill="#FFF" d="M11 8.5h6.5c4.5 0 7.8 2.8 7.8 7.5s-3.3 7.5-7.8 7.5H11V8.5zm3.8 3.5v2.8H18v1.8h-3.2v3.4h3.6c2.4 0 4.1-1.4 4.1-4s-1.7-4-4.1-4h-3.6z"/>
          </svg>
        </span>
      );

    case 'TON':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Toncoin">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#0098EA"/>
            <path fill="#FFF" d="M23.5 10.2L8.5 15.6c-.9.3-.9 1.1 0 1.4l4.2 1.5 1.5 4.8c.2.6.8.7 1.2.2l2.3-2.6 4.3 3.1c.8.5 1.6.2 1.8-.7l2.6-12c.3-1.1-.5-1.7-1.4-1.1zm-9.7 7.7l-.4 3-1-3.2 9.5-6.1-8.1 6.3z"/>
          </svg>
        </span>
      );

    case 'ADA':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Cardano">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#0033AD"/>
            <circle cx="16" cy="16" r="4.2" fill="#FFF"/>
            <circle cx="16" cy="7.5" r="1.6" fill="#FFF"/>
            <circle cx="16" cy="24.5" r="1.6" fill="#FFF"/>
            <circle cx="7.5" cy="16" r="1.6" fill="#FFF"/>
            <circle cx="24.5" cy="16" r="1.6" fill="#FFF"/>
            <circle cx="10" cy="10" r="1.3" fill="#FFF"/>
            <circle cx="22" cy="10" r="1.3" fill="#FFF"/>
            <circle cx="10" cy="22" r="1.3" fill="#FFF"/>
            <circle cx="22" cy="22" r="1.3" fill="#FFF"/>
          </svg>
        </span>
      );

    case 'EUR':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="EUR / Euro">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#003399"/>
            <circle cx="16" cy="16" r="13" fill="none" stroke="#FFCC00" strokeWidth="0.8" strokeDasharray="1.5 3"/>
            <text x="16" y="21.5" fill="#FFCC00" fontSize="16" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">€</text>
          </svg>
        </span>
      );

    case 'GBP':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="GBP / British Pound">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#C8102E"/>
            <circle cx="16" cy="16" r="14" fill="#012169"/>
            <text x="16" y="22" fill="#FFF" fontSize="16" fontWeight="bold" textAnchor="middle" fontFamily="Georgia, serif">£</text>
          </svg>
        </span>
      );

    case 'XAU':
    case 'GOLD':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Gold">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <defs>
              <linearGradient id="goldGradPro" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFE57F"/>
                <stop offset="45%" stopColor="#F59E0B"/>
                <stop offset="100%" stopColor="#B45309"/>
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="16" fill="url(#goldGradPro)"/>
            <rect x="7" y="11" width="18" height="10" rx="2" fill="#78350F" opacity="0.3"/>
            <rect x="8" y="10" width="16" height="9" rx="1.5" fill="#FEF3C7" stroke="#92400E" strokeWidth="0.8"/>
            <text x="16" y="16.5" fill="#92400E" fontSize="6.5" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">GOLD</text>
          </svg>
        </span>
      );

    case 'XAG':
    case 'SILVER':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Silver">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <defs>
              <linearGradient id="silverGradPro" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F8FAFC"/>
                <stop offset="50%" stopColor="#CBD5E1"/>
                <stop offset="100%" stopColor="#64748B"/>
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="16" fill="url(#silverGradPro)"/>
            <rect x="7" y="11" width="18" height="10" rx="2" fill="#334155" opacity="0.25"/>
            <rect x="8" y="10" width="16" height="9" rx="1.5" fill="#F8FAFC" stroke="#475569" strokeWidth="0.8"/>
            <text x="16" y="16.5" fill="#334155" fontSize="6.5" fontWeight="900" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">SILVER</text>
          </svg>
        </span>
      );

    case 'SPX':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="S&P 500">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#0A2540"/>
            <path fill="none" stroke="#00D4FF" strokeWidth="2.2" strokeLinecap="round" d="M7 20l5-5 4 3 8-9"/>
            <circle cx="24" cy="9" r="1.8" fill="#00D4FF"/>
            <text x="16" y="27" fill="#94A3B8" fontSize="5.5" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">S&amp;P 500</text>
          </svg>
        </span>
      );

    case 'NDX':
      return (
        <span style={style} className={`asset-pro-icon ${className}`} title="Nasdaq 100">
          <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
            <circle cx="16" cy="16" r="16" fill="#001833"/>
            <path fill="none" stroke="#008CE7" strokeWidth="2.5" strokeLinecap="round" d="M8 24V8l8 12V8"/>
            <text x="21" y="24" fill="#00D4FF" fontSize="7" fontWeight="900" fontFamily="sans-serif">100</text>
          </svg>
        </span>
      );

    default:
      return (
        <span
          style={{ ...style, background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', borderRadius: '50%', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, fontWeight: 700 }}
          className={`asset-pro-icon ${className}`}
        >
          {s.slice(0, 3)}
        </span>
      );
  }
}

export function CoinIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  return (
    <span className="coin-logo asset-pro-logo" style={{ width: size, height: size, minWidth: size, minHeight: size, background: 'transparent', padding: 0, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <AssetIcon symbol={symbol} size={size} />
    </span>
  );
}

