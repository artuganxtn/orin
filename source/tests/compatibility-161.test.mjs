import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const code=transformSync(readFileSync(new URL('../firebase-app/compatibility.ts',import.meta.url),'utf8'),{loader:'ts',target:'es2020'}).code;
function legacy(){const context=vm.createContext({AbortSignal,AbortController,DOMException,crypto,Response,Headers,setTimeout});vm.runInContext('Promise.any=undefined; Array.prototype.at=undefined; AggregateError=undefined;',context);vm.runInContext(code,context);return context}
test('historical data consumers work without Array.at and method remains nonenumerable',()=>{const c=legacy();assert.equal(vm.runInContext('[1,2,3].at(-1)',c),3);assert.equal(vm.runInContext('[1,2,3].at(-4)',c),undefined);assert.equal(vm.runInContext('[1,2,3].at(NaN)',c),1);assert.equal(vm.runInContext('[1,2,3].at(Infinity)',c),undefined);assert.equal(vm.runInContext('Array.prototype.at.call({0:9,length:1},0)',c),9);assert.equal(vm.runInContext('Object.keys([]).includes("at")',c),false)});
test('provider race returns first success even if an earlier provider rejects',async()=>{const c=legacy();assert.equal(await vm.runInContext('Promise.any([Promise.reject("blocked"),Promise.resolve(42)])',c),42)});
test('all rejected sources retain input order and empty sources reject without hanging',async()=>{const c=legacy();await assert.rejects(vm.runInContext('Promise.any([Promise.reject("a"),Promise.reject("b")])',c),e=>e.name==='AggregateError'&&e.errors.join(',')==='a,b');await assert.rejects(vm.runInContext('Promise.any([])',c),e=>e.name==='AggregateError'&&e.errors.length===0)});
test('thenables and broken iterators have normal promise semantics',async()=>{const c=legacy();assert.equal(await vm.runInContext('Promise.any([{then(resolve){resolve(7)}}])',c),7);await assert.rejects(vm.runInContext('Promise.any({[Symbol.iterator](){throw new Error("bad iterator")}})',c),/bad iterator/)});
test('native built-ins remain intact in current WebViews',()=>{const c=vm.createContext({AbortSignal,AbortController,DOMException,crypto,Response,Headers,setTimeout});vm.runInContext('globalThis.savedAny=Promise.any;globalThis.savedAt=Array.prototype.at;',c);vm.runInContext(code,c);assert.equal(vm.runInContext('savedAny===Promise.any&&savedAt===Array.prototype.at',c),true)});
