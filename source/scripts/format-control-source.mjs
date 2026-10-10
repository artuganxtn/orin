import ts from 'typescript';import fs from 'node:fs/promises';
const files=['lib/control-center.ts','firebase-app/control-center.tsx','firebase-app/published-content.tsx',...(await fs.readdir('firebase-functions/src')).filter(f=>f.startsWith('control-')&&f.endsWith('.ts')).map(f=>'firebase-functions/src/'+f)];
for(const file of files){const src=ts.createSourceFile(file,await fs.readFile(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);if(src.parseDiagnostics.length)throw Error('Parse error: '+file);await fs.writeFile(file,ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(src))}
console.log('Formatted',files.length,'control source files.');
