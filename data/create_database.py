"""
PsycheScan Database Builder
Creates a standalone SQLite database with realistic sample data for the
Real-Time Early Detection System for Mental Health.

Tables:
  - patients          : Patient profiles with demographics
  - baselines         : Baseline vital-signs per patient
  - sensor_readings   : Time-series sensor data (HR, GSR, temp, motion)
  - assessments       : CNN-LSTM stress/anxiety assessment results
  - sessions          : Recording sessions linking readings + assessments
  - severity_log      : Per-reading severity classification history
  - system_metadata   : Key-value store for system settings / config
"""

import sqlite3
import json
import os
import uuid
import random
from datetime import datetime, timedelta, timezone

random.seed(42)  # reproducible data

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "psychescan_data.db")

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def severity_label(score: float) -> str:
    if score <= 24:
        return "Minimal"
    elif score <= 49:
        return "Mild"
    elif score <= 74:
        return "Moderate"
    else:
        return "Severe"

PATIENTS = [
    {"name": "Maria Santos",       "age": 28, "gender": "Female",   "occupation": "Teacher",         "contact": "maria.s@email.com"},
    {"name": "Juan Dela Cruz",     "age": 35, "gender": "Male",     "occupation": "Engineer",        "contact": "juan.dc@email.com"},
    {"name": "Ana Reyes",          "age": 22, "gender": "Female",   "occupation": "Student",         "contact": "ana.r@email.com"},
    {"name": "Pedro Garcia",       "age": 45, "gender": "Male",     "occupation": "Nurse",           "contact": "pedro.g@email.com"},
    {"name": "Sofia Lim",          "age": 31, "gender": "Female",   "occupation": "Accountant",      "contact": "sofia.l@email.com"},
    {"name": "Carlos Mendoza",     "age": 50, "gender": "Male",     "occupation": "Driver",          "contact": "carlos.m@email.com"},
    {"name": "Luz Villanueva",     "age": 26, "gender": "Female",   "occupation": "Nurse Aide",      "contact": "luz.v@email.com"},
    {"name": "Ramon Torres",       "age": 38, "gender": "Male",     "occupation": "IT Specialist",   "contact": "ramon.t@email.com"},
    {"name": "Elena Cruz",         "age": 29, "gender": "Female",   "occupation": "Barangay Worker", "contact": "elena.c@email.com"},
    {"name": "Miguel Reyes",       "age": 42, "gender": "Male",     "occupation": "Farmer",          "contact": "miguel.r@email.com"},
]

BASELINES = [
    {"hr": 72, "gsr": 1.0, "temp": 34.2, "motion": 0.02, "sampleCount": 120, "durationSec": 180},
    {"hr": 68, "gsr": 0.9, "temp": 34.5, "motion": 0.03, "sampleCount": 120, "durationSec": 180},
    {"hr": 78, "gsr": 1.2, "temp": 34.0, "motion": 0.04, "sampleCount": 120, "durationSec": 180},
    {"hr": 65, "gsr": 0.8, "temp": 34.8, "motion": 0.02, "sampleCount": 120, "durationSec": 180},
    {"hr": 74, "gsr": 1.1, "temp": 34.3, "motion": 0.03, "sampleCount": 120, "durationSec": 180},
    {"hr": 70, "gsr": 0.9, "temp": 34.6, "motion": 0.02, "sampleCount": 120, "durationSec": 180},
    {"hr": 76, "gsr": 1.0, "temp": 34.1, "motion": 0.03, "sampleCount": 120, "durationSec": 180},
    {"hr": 69, "gsr": 0.8, "temp": 34.4, "motion": 0.02, "sampleCount": 120, "durationSec": 180},
    {"hr": 73, "gsr": 1.1, "temp": 34.2, "motion": 0.03, "sampleCount": 120, "durationSec": 180},
    {"hr": 71, "gsr": 0.9, "temp": 34.5, "motion": 0.02, "sampleCount": 120, "durationSec": 180},
]

SCENARIOS = [
    {"name": "Resting",           "hr_range": (60, 80),  "gsr_range": (0.8, 1.3),  "temp_range": (33.8, 34.8), "motion_range": (0.01, 0.05)},
    {"name": "Mild Stress",       "hr_range": (82, 95),  "gsr_range": (1.3, 2.4),  "temp_range": (34.0, 35.0), "motion_range": (0.04, 0.10)},
    {"name": "Moderate Stress",   "hr_range": (96, 110), "gsr_range": (2.5, 4.0),  "temp_range": (34.2, 35.5), "motion_range": (0.08, 0.18)},
    {"name": "High Stress",       "hr_range": (110, 130),"gsr_range": (4.1, 6.0),  "temp_range": (34.5, 36.0), "motion_range": (0.15, 0.30)},
    {"name": "Anxiety Episode",   "hr_range": (100, 125),"gsr_range": (3.5, 5.5),  "temp_range": (34.3, 35.8), "motion_range": (0.12, 0.25)},
    {"name": "Recovery",          "hr_range": (70, 85),  "gsr_range": (1.0, 1.5),  "temp_range": (33.9, 34.6), "motion_range": (0.02, 0.06)},
]


def build_database():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    cur.executescript("""
    DROP TABLE IF EXISTS severity_log;
    DROP TABLE IF EXISTS sensor_readings;
    DROP TABLE IF EXISTS assessments;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS baselines;
    DROP TABLE IF EXISTS patients;
    DROP TABLE IF EXISTS system_metadata;

    CREATE TABLE patients (
        patient_id   TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        age          INTEGER,
        gender       TEXT,
        occupation   TEXT,
        contact      TEXT,
        notes        TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
    );

    CREATE TABLE baselines (
        baseline_id  TEXT PRIMARY KEY,
        patient_id   TEXT NOT NULL REFERENCES patients(patient_id),
        hr           REAL,
        gsr          REAL,
        temp         REAL,
        motion       REAL,
        sample_count INTEGER,
        duration_sec INTEGER,
        completed_at TEXT NOT NULL,
        created_at   TEXT NOT NULL
    );

    CREATE TABLE sessions (
        session_id   TEXT PRIMARY KEY,
        patient_id   TEXT NOT NULL REFERENCES patients(patient_id),
        scenario     TEXT,
        started_at   TEXT NOT NULL,
        ended_at     TEXT,
        duration_sec INTEGER,
        reading_count INTEGER,
        created_at   TEXT NOT NULL
    );

    CREATE TABLE sensor_readings (
        reading_id   TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL REFERENCES sessions(session_id),
        patient_id   TEXT NOT NULL REFERENCES patients(patient_id),
        hr           REAL,
        gsr          REAL,
        temp         REAL,
        motion       REAL,
        timestamp    TEXT NOT NULL,
        created_at   TEXT NOT NULL
    );

    CREATE TABLE assessments (
        assessment_id TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL REFERENCES sessions(session_id),
        patient_id    TEXT NOT NULL REFERENCES patients(patient_id),
        hr_score      REAL,
        gsr_score     REAL,
        temp_score    REAL,
        motion_score  REAL,
        overall_score REAL,
        severity      TEXT CHECK (severity IN ('Minimal', 'Mild', 'Moderate', 'Severe')),
        emotion_score REAL,
        fatigue_score REAL,
        sensor_score  REAL,
        cnn_confidence REAL,
        lstm_prediction REAL,
        model_version TEXT,
        created_at    TEXT NOT NULL
    );

    CREATE TABLE severity_log (
        log_id       TEXT PRIMARY KEY,
        reading_id   TEXT NOT NULL REFERENCES sensor_readings(reading_id),
        patient_id   TEXT NOT NULL REFERENCES patients(patient_id),
        hr_severity  TEXT,
        gsr_severity TEXT,
        temp_severity TEXT,
        motion_severity TEXT,
        combined_severity TEXT,
        timestamp    TEXT NOT NULL,
        created_at   TEXT NOT NULL
    );

    CREATE TABLE system_metadata (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        description TEXT,
        updated_at  TEXT NOT NULL
    );

    CREATE INDEX idx_readings_session ON sensor_readings(session_id);
    CREATE INDEX idx_readings_patient ON sensor_readings(patient_id);
    CREATE INDEX idx_readings_time   ON sensor_readings(timestamp);
    CREATE INDEX idx_assessments_session ON assessments(session_id);
    CREATE INDEX idx_assessments_patient ON assessments(patient_id);
    CREATE INDEX idx_severity_patient   ON severity_log(patient_id);
    CREATE INDEX idx_severity_time      ON severity_log(timestamp);
    """)

    now = utc_now()

    # ── insert patients ────────────────────────────────────────────────────
    patient_ids = []
    for i, p in enumerate(PATIENTS):
        pid = f"PAT-{i+1:04d}"
        patient_ids.append(pid)
        cur.execute(
            "INSERT INTO patients VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (pid, p["name"], p["age"], p["gender"], p["occupation"],
             p["contact"], None, now, now),
        )

    # ── insert baselines ───────────────────────────────────────────────────
    for i, (pid, bl) in enumerate(zip(patient_ids, BASELINES)):
        bid = f"BL-{i+1:04d}"
        completed = (datetime.now(timezone.utc) - timedelta(days=30 + i)).isoformat()
        cur.execute(
            "INSERT INTO baselines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (bid, pid, bl["hr"], bl["gsr"], bl["temp"], bl["motion"],
             bl["sampleCount"], bl["durationSec"], completed, now),
        )

    # ── generate sessions + readings + assessments ─────────────────────────
    base_time = datetime.now(timezone.utc) - timedelta(days=14)
    reading_counter = 0
    assessment_counter = 0

    for p_idx, pid in enumerate(patient_ids):
        for s_idx in range(5):
            scenario = random.choice(SCENARIOS)
            session_id = f"SES-{p_idx+1:03d}-{s_idx+1:03d}"
            started = (base_time + timedelta(days=random.randint(0, 14),
                                            hours=random.randint(0, 23),
                                            minutes=random.randint(0, 59))).isoformat()
            reading_count = random.randint(20, 40)

            cur.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (session_id, pid, scenario["name"], started,
                 None, None, reading_count, now),
            )

            session_readings = []
            for r_idx in range(reading_count):
                reading_counter += 1
                rid = f"RDG-{reading_counter:06d}"
                ts = (datetime.fromisoformat(started).replace(tzinfo=timezone.utc)
                      + timedelta(seconds=r_idx * 5)).isoformat()

                hr = round(random.uniform(*scenario["hr_range"]), 1)
                gsr = round(random.uniform(*scenario["gsr_range"]), 2)
                temp = round(random.uniform(*scenario["temp_range"]), 1)
                motion = round(random.uniform(*scenario["motion_range"]), 3)

                cur.execute(
                    "INSERT INTO sensor_readings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (rid, session_id, pid, hr, gsr, temp, motion, ts, now),
                )
                session_readings.append((rid, hr, gsr, temp, motion, ts))

                # severity classification per reading
                hr_sev = ("Minimal" if hr < 80 else
                          "Mild" if hr < 100 else
                          "Moderate" if hr < 120 else "Severe")
                gsr_sev = ("Minimal" if gsr < 1.2 else
                           "Mild" if gsr < 2.5 else
                           "Moderate" if gsr < 4.0 else "Severe")
                temp_sev = ("Minimal" if temp < 34.5 else
                            "Mild" if temp < 35.0 else
                            "Moderate" if temp < 35.5 else "Severe")
                motion_sev = ("Minimal" if motion < 0.05 else
                              "Mild" if motion < 0.10 else
                              "Moderate" if motion < 0.20 else "Severe")

                sev_order = {"Minimal": 0, "Mild": 1, "Moderate": 2, "Severe": 3}
                combined = max([hr_sev, gsr_sev, temp_sev, motion_sev],
                               key=lambda s: sev_order[s])

                cur.execute(
                    "INSERT INTO severity_log VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (f"SL-{reading_counter:06d}", rid, pid,
                     hr_sev, gsr_sev, temp_sev, motion_sev, combined, ts, now),
                )

            # one assessment per session
            assessment_counter += 1
            aid = f"ASM-{assessment_counter:06d}"
            avg_hr = sum(r[1] for r in session_readings) / len(session_readings)
            avg_gsr = sum(r[2] for r in session_readings) / len(session_readings)
            avg_temp = sum(r[3] for r in session_readings) / len(session_readings)
            avg_motion = sum(r[4] for r in session_readings) / len(session_readings)

            bl_row = cur.execute(
                "SELECT hr, gsr, temp, motion FROM baselines WHERE patient_id = ?",
                (pid,),
            ).fetchone()
            if bl_row:
                bl_hr, bl_gsr, bl_temp, bl_motion = bl_row
                hr_score = min(100, max(0, ((avg_hr - bl_hr) / bl_hr) * 100))
                gsr_score = min(100, max(0, ((avg_gsr - bl_gsr) / max(bl_gsr, 0.1)) * 100))
                temp_score = min(100, max(0, ((avg_temp - bl_temp) / max(bl_temp, 0.1)) * 100))
                motion_score = min(100, max(0, ((avg_motion - bl_motion) / max(bl_motion, 0.01)) * 100))
            else:
                hr_score = gsr_score = temp_score = motion_score = 50.0

            emotion_score = round(hr_score * 0.42 + gsr_score * 0.40 + temp_score * 0.18, 2)
            fatigue_score = round(motion_score * 0.5 + hr_score * 0.3 + temp_score * 0.2, 2)
            sensor_score = round(
                hr_score * 0.25 + gsr_score * 0.25 +
                temp_score * 0.25 + motion_score * 0.25, 2)
            overall = round(emotion_score * 0.42 + fatigue_score * 0.18 + sensor_score * 0.40, 2)

            cnn_conf = round(random.uniform(0.70, 0.98), 3)
            lstm_pred = round(random.uniform(0.10, 0.90), 3)

            cur.execute(
                "INSERT INTO assessments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, session_id, pid,
                 round(hr_score, 2), round(gsr_score, 2),
                 round(temp_score, 2), round(motion_score, 2),
                 overall, severity_label(overall),
                 emotion_score, fatigue_score, sensor_score,
                 cnn_conf, lstm_pred, "v2.1.0", now),
            )

            ended = (datetime.fromisoformat(started).replace(tzinfo=timezone.utc)
                     + timedelta(seconds=reading_count * 5)).isoformat()
            dur = reading_count * 5
            cur.execute(
                "UPDATE sessions SET ended_at = ?, duration_sec = ? WHERE session_id = ?",
                (ended, dur, session_id),
            )

    # ── system metadata ────────────────────────────────────────────────────
    meta_rows = [
        ("db_version", "1.0.0", "Database schema version", now),
        ("app_version", "2.1.0", "PsycheScan application version", now),
        ("total_patients", str(len(PATIENTS)), "Number of registered patients", now),
        ("total_sessions", str(len(patient_ids) * 5), "Total monitoring sessions", now),
        ("total_readings", str(reading_counter), "Total sensor readings", now),
        ("total_assessments", str(assessment_counter), "Total assessments", now),
        ("created_at", now, "Database creation timestamp", now),
    ]
    for key, val, desc, ts in meta_rows:
        cur.execute(
            "INSERT INTO system_metadata VALUES (?, ?, ?, ?)",
            (key, val, desc, ts),
        )

    conn.commit()

    # ── summary ────────────────────────────────────────────────────────────
    print(f"✅ Database created: {DB_PATH}")
    print(f"   Patients:        {len(PATIENTS)}")
    print(f"   Baselines:       {len(PATIENTS)}")
    print(f"   Sessions:        {len(patient_ids) * 5}")
    print(f"   Sensor readings: {reading_counter}")
    print(f"   Assessments:     {assessment_counter}")
    print(f"   Severity logs:   {reading_counter}")
    print(f"   Metadata rows:   {len(meta_rows)}")
    print(f"   File size:       {os.path.getsize(DB_PATH) / 1024:.1f} KB")
    conn.close()


if __name__ == "__main__":
    build_database()
