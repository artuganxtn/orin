package com.orin.tests;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.ComponentName;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.ParcelFileDescriptor;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;
public class OrinInstrumentation extends Instrumentation {
 private Bundle options;private Activity activity;private WebView web;
 @Override public void onCreate(Bundle args){super.onCreate(args);options=args;start();}
 private WebView find(View v){if(v instanceof WebView)return (WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=find(g.getChildAt(i));if(w!=null)return w;}}return null;}
 private String evaluate(String script)throws Exception{final String[] result={""};CountDownLatch done=new CountDownLatch(1);runOnMainSync(()->web.evaluateJavascript("(function(){try{return ("+script+")}catch(e){return 'JS_ERROR:'+e.message}})()",value->{result[0]=value;done.countDown();}));if(!done.await(40,TimeUnit.SECONDS))throw new Exception("JavaScript callback timed out");Object value=new JSONTokener(result[0]).nextValue();return String.valueOf(value);}
 private void tap(String selector)throws Exception{String raw=evaluate("JSON.stringify((function(){let e=document.querySelector("+JSONObject.quote(selector)+");if(!e)return null;e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})())");if(raw.equals("null"))throw new Exception("Tap target missing: "+selector);JSONArray xy=new JSONArray(raw);final int[] offset=new int[2];final float[] scale={1};runOnMainSync(()->{web.getLocationOnScreen(offset);scale[0]=web.getScale();});float x=(float)xy.getDouble(0)*scale[0]+offset[0],y=(float)xy.getDouble(1)*scale[0]+offset[1];long now=SystemClock.uptimeMillis();sendPointerSync(MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0));sendPointerSync(MotionEvent.obtain(now,now+80,MotionEvent.ACTION_UP,x,y,0));}
 private String screenshot(String name)throws Exception{Bitmap bitmap=getUiAutomation().takeScreenshot();if(bitmap==null)return "unavailable";File dir=new File(getContext().getFilesDir(),"screens");dir.mkdirs();File file=new File(dir,name+".png");try(FileOutputStream stream=new FileOutputStream(file)){bitmap.compress(Bitmap.CompressFormat.PNG,100,stream);}bitmap.recycle();return file.getAbsolutePath();}
 private void status(String step,boolean pass,String detail){Bundle row=new Bundle();row.putString("step",step);row.putString("result",pass?"PASS":"FAIL");row.putString("detail",detail);sendStatus(pass?1:-1,row);}
 @Override public void onStart(){JSONArray results=new JSONArray();int failed=0;try{
  String target=options.getString("target","com.orin.qa");Intent intent=new Intent(Intent.ACTION_MAIN).setComponent(new ComponentName(target,target+".MainActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);runOnMainSync(()->web=find(activity.getWindow().getDecorView()));if(web==null)throw new Exception("Application WebView missing");
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream stream=getContext().getAssets().open(options.getString("plan","plan.json"))){byte[] buf=new byte[8192];int n;while((n=stream.read(buf))>0)bytes.write(buf,0,n);}JSONArray plan=new JSONArray(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
  for(int i=0;i<plan.length();i++){JSONObject step=plan.getJSONObject(i);String name=step.getString("name");long start=SystemClock.uptimeMillis();String detail="";boolean ok=true;try{
   if(step.has("shell")){try(ParcelFileDescriptor fd=getUiAutomation().executeShellCommand(step.getString("shell"));InputStream stream=new ParcelFileDescriptor.AutoCloseInputStream(fd)){byte[] buf=new byte[1024];while(stream.read(buf)>0){}}}
   if(step.has("tap"))tap(step.getString("tap"));
   if(step.optBoolean("back"))sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
   if(step.has("evaluate"))detail=evaluate(step.getString("evaluate"));
   if(step.has("until")){long end=SystemClock.uptimeMillis()+step.optLong("timeout",90000);while(true){detail=evaluate(step.getString("until"));if(detail.equals("true"))break;if(SystemClock.uptimeMillis()>end)throw new Exception("Condition timed out; actual="+detail);Thread.sleep(700);}}
   if(step.has("contains")&&!detail.contains(step.getString("contains")))throw new Exception("Expected "+step.getString("contains")+"; actual="+detail);
   if(step.optBoolean("screenshot"))detail+=" screenshot="+screenshot(String.format("%02d-",i)+name);
  }catch(Exception error){ok=false;failed++;detail=error.toString();try{detail+=" screenshot="+screenshot(String.format("%02d-",i)+name+"-failed");}catch(Exception ignored){}}
   JSONObject row=new JSONObject();row.put("step",name);row.put("passed",ok);row.put("detail",detail);row.put("durationMs",SystemClock.uptimeMillis()-start);results.put(row);status(name,ok,detail);if(!ok&&step.optBoolean("required",true))break;
  }
 }catch(Exception error){failed++;status("runner",false,error.toString());}
 try(FileOutputStream out=new FileOutputStream(new File(getContext().getFilesDir(),"results.json"))){out.write(results.toString(2).getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}
 Bundle result=new Bundle();result.putInt("failures",failed);result.putInt("steps",results.length());result.putString("results",results.toString());finish(failed==0?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
 }
}
