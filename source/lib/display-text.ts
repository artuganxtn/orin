/** Display-only normalization. Persistent identifiers and financial values are not rewritten. */
export function displayText(value:string){return value.replace(/[\u0660-\u0669]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[\u06f0-\u06f9]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/محاكاة|محاكي/g,'تجريبي');}
