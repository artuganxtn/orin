@echo off
set "PATH=C:\Program Files\Android\Android Studio\jbr\bin;%PATH%"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
node --test tests/new-requirements.test.mjs
