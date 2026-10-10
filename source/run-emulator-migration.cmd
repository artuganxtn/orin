@echo off
set "PATH=C:\Program Files\Android\Android Studio\jbr\bin;%PATH%"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
call npx firebase-tools emulators:exec --project demo-orin-auth --config firebase.spark.json --only firestore,auth run-migration-demo.cmd
