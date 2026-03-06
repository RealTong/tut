import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

const preferenceBootstrap = `(function(){try{var html=document.documentElement;var url=new URL(window.location.href);var params=url.searchParams;var validTheme=function(v){return v==='light'||v==='dark'?v:null};var validLang=function(v){return v==='en'||v==='zh'?v:null};var paramTheme=validTheme(params.get('theme'));var paramLang=validLang(params.get('lang'));var storedTheme=validTheme(localStorage.getItem('tut:theme'));var storedLang=validLang(localStorage.getItem('tut:lang'));var nextTheme=paramTheme||storedTheme||'light';var nextLang=paramLang||storedLang;var changed=false;if(!paramTheme&&storedTheme){params.set('theme',storedTheme);changed=true}if(!paramLang&&storedLang){params.set('lang',storedLang);changed=true}if(changed){url.search=params.toString();window.location.replace(url.toString());return}html.dataset.theme=nextTheme;if(nextLang){html.lang=nextLang==='zh'?'zh-CN':'en'}localStorage.setItem('tut:theme',nextTheme);if(nextLang){localStorage.setItem('tut:lang',nextLang)}}catch(_error){}})();`

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>tut</title>
        <script dangerouslySetInnerHTML={{ __html: preferenceBootstrap }} />
        <ViteClient />
        <Script src="/src/dashboard-client.ts" />
        <Link href="/src/style.css" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
})
