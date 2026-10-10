import json
import firebase_admin
from firebase_admin import credentials, firestore, auth
import os

sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
if not sa_json:
    # Read from .env in firebase-functions
    with open("source/firebase-functions/.env", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("FIREBASE_SERVICE_ACCOUNT="):
                sa_json = line[len("FIREBASE_SERVICE_ACCOUNT="):].strip()
                break

cred = credentials.Certificate(json.loads(sa_json))
app = firebase_admin.initialize_app(cred)
db = firestore.client()

print("=== CHECKING FIRESTORE STATE ===")
# List users in Firebase Auth
print("\n[Firebase Auth Users]:")
page = auth.list_users()
for u in page.users:
    print(f"UID: {u.uid}, Email: {u.email}, DisplayName: {u.display_name}")

# List documents in users collection
print("\n[Firestore /users]:")
for doc in db.collection('users').stream():
    print(f"Doc {doc.id} => {doc.to_dict()}")

# List documents in orinSecuritySessions
print("\n[Firestore /orinSecuritySessions]:")
for doc in db.collection('orinSecuritySessions').stream():
    d = doc.to_dict()
    print(f"Session {doc.id} => uid: {d.get('uid')}, status: {d.get('status')}, epoch: {d.get('epoch')}, expires: {d.get('expiresAtMs')}")

# List documents in orinAccountSecurity
print("\n[Firestore /orinAccountSecurity]:")
for doc in db.collection('orinAccountSecurity').stream():
    print(f"AccountSecurity {doc.id} => {doc.to_dict()}")

# Check system/account-security
marker = db.collection('system').document('account-security').get()
print("\n[System Marker]:", marker.to_dict())
