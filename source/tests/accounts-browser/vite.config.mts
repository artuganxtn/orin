import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import {resolve} from 'node:path';
export default defineConfig({root:import.meta.dirname,plugins:[react()],resolve:{alias:{'@':resolve(import.meta.dirname,'../..')}},publicDir:resolve(import.meta.dirname,'../../public'),server:{host:'0.0.0.0',port:5187,strictPort:true,allowedHosts:['terminal.local']}});
