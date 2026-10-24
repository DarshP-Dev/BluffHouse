import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
const backend=`http://127.0.0.1:${process.env.PORT??3000}`;
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),plugins:[react(),tailwind()],server:{host:process.env.DEV_HOST??'127.0.0.1',port:Number(process.env.DEV_PORT??5173),strictPort:true,proxy:{'/api':backend,'/socket.io':{target:backend,ws:true}}},build:{outDir:'dist',emptyOutDir:true}});
