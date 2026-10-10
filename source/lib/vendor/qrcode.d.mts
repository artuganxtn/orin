// Type wrapper for vendored MIT qrcode-generator 2.0.4 (Kazuhiko Arase).
export default function qrcode(typeNumber:number,errorCorrectionLevel:'L'|'M'|'Q'|'H'):{addData(data:string):void;make():void;getModuleCount():number;isDark(row:number,col:number):boolean};
