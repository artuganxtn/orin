import fs from 'node:fs/promises';
import sharp from 'sharp';
const root='public/brand';
for(const dir of ['svg','png','android','ios','web','splash','light','dark','monochrome'])await fs.mkdir(root+'/'+dir,{recursive:true});
// Simple geometric O, optimized for small UI/app-icon use. The approved primary mark is preserved.
const defs='<defs><linearGradient id="o" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#19B8FF"/><stop offset=".55" stop-color="#0788FF"/><stop offset="1" stop-color="#145AC4"/></linearGradient></defs>';
const ring='<circle cx="256" cy="256" r="145" stroke="url(#o)" stroke-width="57" fill="none"/><path d="M154 153 A145 145 0 0 1 359 154" stroke="#92E9FF" stroke-width="13" stroke-linecap="round" fill="none"/>';
const svg=(background=true)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${background?'<rect width="512" height="512" fill="#06111F"/>':''}${ring}</svg>`;
await fs.writeFile(root+'/svg/orin-symbol.svg',svg(false));
await fs.writeFile(root+'/svg/orin-app-icon.svg',svg(true));
await fs.writeFile(root+'/android/orin-adaptive-foreground.svg',svg(false));
await fs.writeFile(root+'/android/orin-adaptive-background.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#06111F" d="M0 0h512v512H0z"/></svg>');
await fs.writeFile(root+'/monochrome/orin-symbol.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="145" stroke="currentColor" stroke-width="57" fill="none"/></svg>');
const wordmark=(color)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 230">${defs}<g transform="translate(0,7) scale(.42)">${ring}</g><text x="246" y="159" font-family="Arial,sans-serif" font-weight="700" font-size="124" letter-spacing="2" fill="${color}">ORIN</text></svg>`;
// Horizontal wordmark retains a font reference; documented, with PNG exports included.
for(const [name,color] of [['light','#14204d'],['dark','#F5F9FF']]){const h=wordmark(color);await fs.writeFile(`${root}/${name}/orin-horizontal.svg`,h);await sharp(Buffer.from(h)).resize(1520,460).png().toFile(`${root}/${name}/orin-horizontal.png`)}
await fs.copyFile(root+'/orin-mark.png',root+'/png/orin-primary-approved.png');
for(const size of [16,32,48,180,192,512])await sharp(Buffer.from(svg(true))).resize(size,size).png().toFile(`${root}/web/icon-${size}.png`);
for(const size of [20,29,40,58,60,76,80,87,120,152,167,180,1024])await sharp(Buffer.from(svg(true))).resize(size,size).png().toFile(`${root}/ios/icon-${size}.png`);
for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){await fs.mkdir(`${root}/android/mipmap-${density}`,{recursive:true});await sharp(Buffer.from(svg(true))).resize(size,size).png().toFile(`${root}/android/mipmap-${density}/ic_launcher.png`);await sharp(Buffer.from(svg(false))).resize(Math.round(size*2.25),Math.round(size*2.25)).png().toFile(`${root}/android/mipmap-${density}/ic_launcher_foreground.png`)}
await sharp(Buffer.from(svg(true))).resize(512,512).png().toFile(root+'/android/play-store-512.png');
for(const size of [24,36,48,72,96]){await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="white" stroke-width="3"/></svg>')).resize(size,size).png().toFile(`${root}/android/notification-${size}.png`)}
await fs.writeFile(root+'/android/ic_launcher.xml','<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/orin_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/><monochrome android:drawable="@drawable/ic_orin_monochrome"/></adaptive-icon>');
await fs.writeFile(root+'/android/ic_orin_monochrome.xml','<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"><path android:fillColor="#FFFFFFFF" android:fillType="evenOdd" android:pathData="M54,20a34,34 0,1 0,0 68a34,34 0,1 0,0 -68M54,32a22,22 0,1 1,0 44a22,22 0,1 1,0 -44"/></vector>');
await fs.writeFile(root+'/android/colors.xml','<resources><color name="orin_background">#06111F</color></resources>');
await fs.writeFile(root+'/splash/orin-splash.svg',svg(true));
console.log('ORIN app-icon, platform sizes and logo exports created.');
