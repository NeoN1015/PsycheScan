import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'data', 'dashboard.sqlite3')
print(f"DB path: {db_path}")
print(f"DB exists: {os.path.exists(db_path)}")

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table'")
    print("Tables:", [r[0] for r in c.fetchall()])
    c.execute("SELECT COUNT(*) FROM profiles")
    print("Profiles:", c.fetchone()[0])
    c.execute("SELECT COUNT(*) FROM records")
    print("Records:", c.fetchone()[0])
    c.execute("SELECT COUNT(*) FROM reports")
    print("Reports:", c.fetchone()[0])
    c.execute("SELECT COUNT(*) FROM telemetry_events")
    print("Telemetry:", c.fetchone()[0])
    c.execute("SELECT key FROM metadata")
    print("Metadata keys:", [r[0] for r in c.fetchall()])
    conn.close()
