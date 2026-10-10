/** One SPA history writer for authentication, links, tabs and asset details. */
export function navigateTo(path:string,replace=false,state:Record<string,unknown>={}){
 const url=new URL(path,location.origin);
 if(url.origin!==location.origin)throw new Error('External navigation requires an explicit link');
 const next=url.pathname+url.search+url.hash;
 if(next===location.pathname+location.search+location.hash&&!replace)return;
 const previous={...history.state,orinScroll:window.scrollY};history.replaceState(previous,'');
 history[replace?'replaceState':'pushState']({...previous,...state,orinDepth:Number(previous.orinDepth??0)+(replace?0:1),orinScroll:0},'',next);
 dispatchEvent(new PopStateEvent('popstate'));window.scrollTo(0,0);
}
