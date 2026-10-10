import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {getSettings,saveSettings,saveConfiguration} from '../lib/settings-engine.ts';
import {bootstrap, acceptTerms, publishContract, joinContract, settleDue, getState} from '../lib/engine.ts';

const path=mkdtempSync(join(tmpdir(),'madar-d1-'));
const proxy=await getPlatformProxy({configPath:'dist/server/wrangler.json',persist:{path}});
try{
  const db=proxy.env.DB;
  const schema=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8')).join('\n--> statement-breakpoint\n');
  await db.batch(schema.split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  const user={id:'d1-smoke',name:'D1 virtual test'},now=Date.now();
  await bootstrap(db,user,now);await bootstrap(db,user,now);
  await acceptTerms(db,user,now);
  const c=await publishContract(db,user,{title:'D1 virtual contract',asset:'XAUUSD',direction:'BUY',durationSec:60,settlementBps:84,eligibility:'all',opensAt:now,closesAt:now+3600000},now);
  await joinContract(db,user,{code:c.code,contractHash:c.hash,amountCents:100000,confirmed:true},now);
  await settleDue(db,now+60000,user.id);await settleDue(db,now+60000,user.id);
  const state=await getState(db,user,now+60000);
  assert.equal(state.balanceCents,1000840);assert.equal(state.receipts.length,1);
  await assert.rejects(db.prepare('UPDATE contracts SET settlement_bps=999 WHERE id=?').bind(c.id).run(),/immutable/);
  await assert.rejects(db.prepare('DELETE FROM ledger_entries').run(),/cannot be deleted/);
  const pref=await saveSettings(db,user,{revision:0,preferences:{theme:'dark',favorites:['XAU-USD']}},now);assert.equal(pref.preferences.theme,'dark');await saveConfiguration(db,user,{revision:0,configuration:{defaultSymbol:'XAU-USD'}},now);assert.equal((await getSettings(db,user)).configuration.defaultSymbol,'XAU-USD');
  console.log('D1 binding smoke passed: settings persistence, admin configuration, atomic trigger initialization, immutable terms, exact settlement, retry safety.');
}finally{await proxy.dispose();rmSync(path,{recursive:true,force:true});}
