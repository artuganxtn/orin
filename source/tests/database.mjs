import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
class Bound{
 constructor(db,sql,values=[]){this.db=db;this.sql=sql;this.values=values;}
 bind(...values){return new Bound(this.db,this.sql,values);}
 async first(){return this.db.raw.prepare(this.sql).get(...this.values)??null;}
 async all(){return {results:this.db.raw.prepare(this.sql).all(...this.values)};}
 async run(){return this.exec();}
 exec(){const r=this.db.raw.prepare(this.sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}
}
export class TestDatabase{
 constructor(){this.raw=new DatabaseSync(':memory:');this.raw.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())this.raw.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));}
 prepare(sql){return new Bound(this,sql);}
 async batch(stmts){this.raw.exec('BEGIN IMMEDIATE');try{const result=stmts.map(s=>s.exec());this.raw.exec('COMMIT');return result;}catch(e){this.raw.exec('ROLLBACK');throw e;}}
}
