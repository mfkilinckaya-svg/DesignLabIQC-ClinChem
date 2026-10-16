#!/bin/bash
# usage: build.sh <component.jsx> <out.html> <title>
set -e
SRC=$(realpath "$1"); OUT="$2"; TITLE="$3"; D=$(dirname "$0")
cd "$D"
cp "$SRC" app.jsx
cat > main.jsx <<'X'
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app.jsx";
createRoot(document.getElementById("root")).render(<App />);
X
cat > tw.css <<'X'
@tailwind base;
@tailwind components;
@tailwind utilities;
X
cat > tailwind.config.js <<'X'
module.exports = { content: ["./app.jsx"], theme: { extend: {} }, plugins: [] };
X
npx tailwindcss -i tw.css -o out.css --minify 2>/dev/null
npx esbuild main.jsx --bundle --minify --format=iife --define:process.env.NODE_ENV='"production"' --loader:.js=jsx --outfile=out.js --log-level=warning
python3 - "$OUT" "$TITLE" <<'X'
import sys
css=open('out.css',encoding='utf-8').read(); js=open('out.js',encoding='utf-8').read().replace('</script','<\\/script')
store='''/* Local persistence: the tool saves to this browser only. */
if(!window.storage){window.storage={
 async get(k){var v=localStorage.getItem(k);return v==null?null:{key:k,value:v};},
 async set(k,v){localStorage.setItem(k,v);return {key:k,value:v};},
 async delete(k){localStorage.removeItem(k);return {key:k,deleted:true};},
 async list(p){var ks=[];for(var i=0;i<localStorage.length;i++){var kk=localStorage.key(i);if(!p||kk.indexOf(p)===0)ks.push(kk);}return {keys:ks};}
}}'''
html=f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{sys.argv[2]}</title><style>{css}</style></head>
<body><div id="root"></div><script>
{store}
</script><script>{js}</script></body></html>'''
open(sys.argv[1],'w',encoding='utf-8').write(html); print('wrote',sys.argv[1],len(html))
X
