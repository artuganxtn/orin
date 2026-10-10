import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\reference-views.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

print("Original length:", len(content))
# Verify current presence of CoinIcon definition
assert 'const coins=[' in content
print("Found coins list definition!")
