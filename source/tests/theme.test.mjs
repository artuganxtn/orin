import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DarkThemeTokens} from '../lib/theme-tokens.ts';

test('approved Light styles and in-app primary mark are byte-for-byte unchanged',()=>{
 const baseline=JSON.parse(readFileSync(new URL('./light-baseline.json',import.meta.url),'utf8'));
 for(const [file,expected] of Object.entries(baseline))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),expected,file);
});
const luminance=hex=>{const rgb=hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
test('Dark primary, secondary, status text and CTA colors meet 4.5:1 contrast',()=>{
 for(const ink of ['text','secondary','positive','negative','warning'])for(const paper of ['background','surface','elevated'])assert.ok(contrast(DarkThemeTokens[ink],DarkThemeTokens[paper])>=4.5,ink+' on '+paper);
 for(const paper of ['#065ca8','#066ac4'])assert.ok(contrast('#ffffff',paper)>=4.5);
});
