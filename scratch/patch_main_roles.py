with open('source/firebase-app/main.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update routing useEffect
old_route = """  const isAdm=profile.role==='admin'||isOwnerEmail(user.email);
  if(isAdm){
   if(path==='/'||['/login','/register'].includes(path)){
    const next=new URLSearchParams(location.search).get('next');
    to(next&&next!=='/'?safeDestination(next):'/admin');
   }
  }else if(['/login','/register'].includes(path)){
   const next=new URLSearchParams(location.search).get('next');
   to(next?safeDestination(next):'/');
  }
 },[ready,user?.email,profile?.role,path]);"""

new_route = """  const isAdm=profile.role==='admin'||isOwnerEmail(user.email);
  if(isAdm){
   if(path==='/'||['/login','/register'].includes(path)){
    const next=new URLSearchParams(location.search).get('next');
    to(next&&next!=='/'?safeDestination(next):'/admin');
   }
  }else{
   if(path.startsWith('/admin')||['/login','/register'].includes(path)){
    const next=new URLSearchParams(location.search).get('next');
    to(next&&next!=='/'&&!next.startsWith('/admin')?safeDestination(next):'/');
   }
  }
 },[ready,user?.email,profile?.role,path]);"""

if old_route in content:
    content = content.replace(old_route, new_route)
    print("Replaced route effect successfully")
else:
    print("Could not find old_route")

# 2. Update separate check for non-admin
old_separate = "const separate=path.startsWith('/admin')||['/account/security','/forgot-password','/privacy','/terms'].includes(path);"
new_separate = "const separate=['/account/security','/forgot-password','/privacy','/terms'].includes(path);"

if old_separate in content:
    content = content.replace(old_separate, new_separate)
    print("Replaced separate successfully")
else:
    print("Could not find old_separate")

with open('source/firebase-app/main.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished patching main.tsx")
