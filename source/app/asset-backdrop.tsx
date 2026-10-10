'use client';
import {marketSymbol} from '@/lib/market-symbols';
/** Application-owned identity outside the third-party chart canvas. */
export function AssetBackdrop({pair}:{pair:string}){const asset=marketSymbol(pair);return <div className="orin-asset-backdrop" aria-hidden="true"><strong dir="ltr">{asset.label}</strong><span>{asset.name}</span></div>}
