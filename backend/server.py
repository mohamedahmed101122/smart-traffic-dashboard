import os
import re
import sys
import json
import signal
import socket
import hashlib
import datetime
import urllib.parse
from http.server import SimpleHTTPRequestHandler
import socketserver

# Try importing mysql.connector, provide friendly notice if not installed
try:
    import mysql.connector
    from mysql.connector import pooling
except ImportError:
    print("[ERROR] 'mysql-connector-python' is not installed.")
    print("Please run: pip install mysql-connector-python")
    sys.exit(1)

# ----------------------------------------------------
# DATABASE CONFIGURATION (MySQL)
# ----------------------------------------------------
DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'localhost'),
    'port': int(os.environ.get('DB_PORT', 3306)),
    'user': os.environ.get('DB_USER', 'root'),
    'password': os.environ['DB_PASSWORD'],
    'database': os.environ.get('DB_NAME', 'traffic_db'),
    'charset': 'utf8mb4',
    'autocommit': True
}

def get_db_connection():
    """Get a connection to MySQL."""
    return mysql.connector.connect(**DB_CONFIG)

# ----------------------------------------------------
# PORT UTILS — free the port automatically on startup
# ----------------------------------------------------
def free_port(port: int):
    """Kill any process that is currently holding the given port."""
    try:
        import subprocess
        result = subprocess.run(
            ["fuser", f"{port}/tcp"],
            capture_output=True, text=True
        )
        pids = result.stdout.strip().split()
        for pid in pids:
            pid = pid.strip()
            if pid:
                try:
                    os.kill(int(pid), signal.SIGKILL)
                    print(f"[SERVER] Killed old process PID {pid} on port {port}")
                except Exception:
                    pass
    except Exception:
        pass

    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("", port))
        probe.close()
    except OSError:
        import time
        time.sleep(1)

# ----------------------------------------------------
# PASSWORD HASHING UTILITY
# ----------------------------------------------------
def hash_password(plain: str) -> str:
    """SHA-256 one-way hash for password storage."""
    return hashlib.sha256(plain.encode('utf-8')).hexdigest()

def verify_password(plain: str, hashed: str) -> bool:
    """Compare plaintext against stored hash."""
    return hash_password(plain) == hashed

# ----------------------------------------------------
# AUTHORIZATION & PERMISSION HELPERS
# ----------------------------------------------------
def is_valid_user(headers) -> bool:
    """Check if the X-User-Email belongs to an active, non-disabled user."""
    email = headers.get('X-User-Email', '').strip()
    if not email:
        return False
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT disabled FROM users WHERE email = %s;", (email,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        return row is not None and not bool(row[0])
    except Exception:
        return False

def is_admin_request(headers) -> bool:
    """Check if the X-User-Email belongs to a non-disabled administrator."""
    email = headers.get('X-User-Email', '').strip()
    if not email:
        return False
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT role, disabled FROM users WHERE email = %s;", (email,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row:
            role, disabled = row[0], row[1]
            return role.lower() == 'admin' and not bool(disabled)
        return False
    except Exception:
        return False

def is_authorized_request(headers, target_email: str) -> bool:
    """Check if the requester is either an admin or modifying their own profile."""
    email = headers.get('X-User-Email', '').strip()
    if not email:
        return False
    if email.lower() == target_email.lower():
        return is_valid_user(headers)
    return is_admin_request(headers)

def normalize_phone_for_comparison(phone):
    if not phone:
        return ""
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith('0') and len(digits) == 11:
        digits = '20' + digits[1:]
    elif len(digits) == 10 and digits.startswith('1'):
        digits = '20' + digits
    return digits

def validate_user_inputs(email, password, name, phone, user_id=None, national_id=None):
    email = (email or '').strip()
    if not email or "@" not in email or "." not in email.split("@")[-1] or len(email) > 100:
        return "Invalid email address format (max 100 chars)."

    if password is not None:
        if len(password) < 6:
            return "Password must be at least 6 characters long."

    name = (name or '').strip()
    if not name or len(name) < 2 or len(name) > 100:
        return "Full Name must be between 2 and 100 characters."

    phone = (phone or '').strip()
    if phone:
        digits = "".join(c for c in phone if c.isdigit())
        if len(digits) < 8 or len(digits) > 15:
            return "Phone number must contain between 8 and 15 digits."

    if user_id:
        user_id = user_id.strip()
        if len(user_id) < 3 or len(user_id) > 50:
            return "User ID must be between 3 and 50 characters."

    if national_id:
        national_id = national_id.strip()
        digits = "".join(c for c in national_id if c.isdigit())
        if len(digits) != 14:
            return "National ID must be exactly 14 digits."

    return None

def get_street_name(metric_id: str) -> str:
    mapping = {
        "ROAD_30.3_31.6":    "Cairo - Ismailia Desert Road",
        "ROAD_29.98_31.22":  "Helwan Road",
        "ROAD_30.12_31.41":  "Ring Road",
        "ROAD_0.0_0.0":      "Unknown Location",
        "ROAD_30.1_31.25":   "Ring Road",
        "ROAD_30.1_31.3":    "El-Nasr Road",
        "ROAD_30.25_31.45":  "Ring Road",
        "ROAD_30.4_31.6":    "Cairo - Ismailia Desert Road",
        "ROAD_30.04_31.24":  "El-Qasr El-Aini Street",
        "ROAD_30.1_31.1":    "6th of October Corridor",
        "ROAD_30.25_31.25":  "Mohandiseen Road",
        "ROAD_30.4_31.4":    "Heliopolis Ring Road",
        "ROAD_30.06_31.33":  "Heliopolis Ring Road Corridor",
        "ROAD_30.07_31.15":  "26th of July Corridor",
        "ROAD_29.98_31.28":  "Maadi Ring Road",
        "ROAD_30.04_31.23":  "El-Tahrir Square & Downtown"
    }
    if metric_id in mapping:
        return mapping[metric_id]

    GPS_ROAD_MAP = [
        ("6th of October Corridor",     30.1,    31.1  ),
        ("Mohandiseen Road",             30.25,   31.25 ),
        ("Heliopolis Ring Road",         30.4,    31.4  ),
        ("El-Nasr Road",                 30.1,    31.3  ),
        ("Ring Road",                    30.1,    31.25 ),
        ("Ring Road",                    30.25,   31.45 ),
        ("Cairo - Ismailia Desert Road", 30.4,    31.6  ),
        ("Cairo - Ismailia Desert Road", 30.3,    31.6  ),
        ("El-Qasr El-Aini Street",       30.04,   31.24 ),
        ("Helwan Road",                  29.98,   31.22 ),
        ("6th of October Bridge",        30.0524, 31.2462),
        ("Maadi Ring Road",              29.9821, 31.2854),
        ("26th of July Corridor",        30.0765, 31.155 ),
        ("90th Street, New Cairo",       30.0242, 31.4658),
    ]
    if metric_id and metric_id.startswith("ROAD_"):
        parts = metric_id.replace("ROAD_", "").split("_")
        if len(parts) == 2:
            try:
                lat, lon = float(parts[0]), float(parts[1])
                closest = None
                min_dist = float('inf')
                for name, rlat, rlon in GPS_ROAD_MAP:
                    dist = ((lat - rlat) ** 2 + (lon - rlon) ** 2) ** 0.5
                    if dist < min_dist:
                        min_dist = dist
                        closest = name
                if closest:
                    return closest
                return f"Road Segment ({lat:.3f}, {lon:.3f})"
            except ValueError:
                pass
    return "Unnamed Road"

def get_local_mappings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT vehicle_id, obu_serial, owner_user_id FROM vehicles WHERE obu_serial IS NOT NULL AND obu_serial != '';")
    rows = cursor.fetchall()

    mappings_rows = []
    try:
        cursor.execute("SELECT cloud_vehicle_id, local_vehicle_id FROM vehicle_mappings;")
        mappings_rows = cursor.fetchall()
    except Exception:
        pass
    cursor.close()
    conn.close()

    obu_to_local = {}
    for vid, obu, owner in rows:
        owner = owner or ''
        if '@' in owner or obu not in obu_to_local:
            obu_to_local[obu] = vid

    cloud_to_local = {}
    for cloud_vid, local_vid in mappings_rows:
        cloud_to_local[cloud_vid] = local_vid

    for vid, obu, owner in rows:
        owner = owner or ''
        if '@' not in owner and obu in obu_to_local:
            local_vid = obu_to_local[obu]
            if local_vid != vid:
                cloud_to_local[vid] = local_vid

    return obu_to_local, cloud_to_local

def resolve_obu_and_vehicle(identifier: str):
    if not identifier:
        return None, None
    identifier = identifier.strip()
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        if '@' in identifier:
            cursor.execute("SELECT device_serial FROM users WHERE email = %s;", (identifier,))
            row = cursor.fetchone()
            if row and row[0]:
                obu = row[0]
                cursor.execute("SELECT vehicle_id FROM vehicles WHERE obu_serial = %s ORDER BY (owner_user_id LIKE '%@%') DESC LIMIT 1;", (obu,))
                v_row = cursor.fetchone()
                cursor.close(); conn.close()
                return obu, (v_row[0] if v_row else obu)

        cursor.execute("SELECT device_serial FROM users WHERE user_id = %s;", (identifier,))
        row = cursor.fetchone()
        if row and row[0]:
            obu = row[0]
            cursor.execute("SELECT vehicle_id FROM vehicles WHERE obu_serial = %s ORDER BY (owner_user_id LIKE '%@%') DESC LIMIT 1;", (obu,))
            v_row = cursor.fetchone()
            cursor.close(); conn.close()
            return obu, (v_row[0] if v_row else obu)

        cursor.execute("SELECT obu_serial FROM vehicles WHERE vehicle_id = %s ORDER BY (owner_user_id LIKE '%@%') DESC LIMIT 1;", (identifier,))
        row = cursor.fetchone()
        if row and row[0]:
            cursor.close(); conn.close()
            return row[0], identifier

        cursor.execute("SELECT vehicle_id FROM vehicles WHERE obu_serial = %s ORDER BY (owner_user_id LIKE '%@%') DESC LIMIT 1;", (identifier,))
        row = cursor.fetchone()
        if row and row[0]:
            cursor.close(); conn.close()
            return identifier, row[0]

        cursor.close(); conn.close()
    except Exception as e:
        print(f"[RESOLVER ERROR] {e}")
    return identifier, identifier

def log_audit(actor_email: str, action: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name, role FROM users WHERE email = %s;", (actor_email,))
        row = cursor.fetchone()
        name = row[0] if row else actor_email
        role = row[1] if row else "system"

        cursor.execute("""
        INSERT INTO audit_logs (actor, action)
        VALUES (%s, %s);
        """, (actor_email, f"{name} ({role}): {action}"))
        cursor.close()
        conn.close()
        print(f"[AUDIT LOG] {actor_email} | {name} ({role}): {action}")
    except Exception as e:
        print(f"[AUDIT LOG ERROR] {e}")

# ----------------------------------------------------
# DATABASE INITIALIZATION
# ----------------------------------------------------
def init_db():
    """Verify MySQL connectivity with retry logic and ensure DB readiness."""
    import time
    max_retries = 15
    for attempt in range(1, max_retries + 1):
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            print(f"[DB] Successfully connected to MySQL ({DB_CONFIG['database']} on {DB_CONFIG['host']})")
            cursor.execute("SHOW TABLES LIKE 'users';")
            if not cursor.fetchone():
                print("[DB] Notice: 'users' table not found yet. Running initial seed check...")
            else:
                print("[DB] Tables verified successfully.")
            cursor.close()
            conn.close()
            return
        except Exception as e:
            print(f"[DB INIT RETRY {attempt}/{max_retries}] Waiting for MySQL: {e}")
            time.sleep(2)
    print("[DB INIT WARNING] Proceeding, but MySQL may still be initializing.")

# ----------------------------------------------------
# REST API CONTROLLER
# ----------------------------------------------------
class APIRequestHandler(SimpleHTTPRequestHandler):

    def send_json(self, data, status_code=200):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode('utf-8'))

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        # Access control for API endpoints
        if path.startswith('/api/'):
            if not is_valid_user(self.headers):
                self.send_json({"error": "Unauthorized access. Please log in."}, 401)
                return

            if path in ['/api/users', '/api/audit-logs']:
                if not is_admin_request(self.headers):
                    self.send_json({"error": "Forbidden: Administrator privileges required."}, 403)
                    return

        # 1. Dashboard Stats (From local MySQL)
        if path == '/api/dashboard':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)

                cursor.execute("SELECT severity FROM accidents;")
                acc_rows = cursor.fetchall()

                total = len(acc_rows)
                critical = sum(1 for r in acc_rows if r.get('severity') and r['severity'].upper() == 'CRITICAL')
                severe = sum(1 for r in acc_rows if r.get('severity') and r['severity'].upper() in ['SEVERE', 'MAJOR'])
                moderate = sum(1 for r in acc_rows if r.get('severity') and r['severity'].upper() == 'MODERATE')
                minor = sum(1 for r in acc_rows if r.get('severity') and r['severity'].upper() == 'MINOR')

                cursor.execute("SELECT COUNT(DISTINCT obu_serial) AS total_v FROM vehicles WHERE obu_serial IS NOT NULL;")
                v_row = cursor.fetchone()
                vehicles = v_row['total_v'] if v_row else 0

                cursor.execute("""
                    SELECT COUNT(*) AS total_d FROM dispatch_cases
                    WHERE (dispatch_status IS NULL OR UPPER(dispatch_status) != 'COMPLETED')
                      AND (ambulance_status IS NULL OR UPPER(ambulance_status) != 'DISPATCHED')
                      AND (police_status IS NULL OR UPPER(police_status) != 'DISPATCHED');
                """)
                d_row = cursor.fetchone()
                dispatches = d_row['total_d'] if d_row else 0

                cursor.execute("SELECT risk_level FROM analytics;")
                analytics_rows = cursor.fetchall()
                high_risk = sum(1 for r in analytics_rows if r.get('risk_level') and r['risk_level'].upper() == 'HIGH')
                medium_risk = sum(1 for r in analytics_rows if r.get('risk_level') and r['risk_level'].upper() == 'MEDIUM')

                cursor.close()
                conn.close()

                self.send_json({
                    "total_accidents": total,
                    "critical_accidents": critical,
                    "severe_accidents": severe,
                    "moderate_accidents": moderate,
                    "minor_accidents": minor,
                    "registered_vehicles": vehicles,
                    "active_dispatches": dispatches,
                    "high_risk_roads": high_risk,
                    "medium_risk_roads": medium_risk
                })
            except Exception as e:
                print(f"[DASHBOARD ERROR] {e}")
                self.send_json({"error": "Failed to load dashboard metrics"}, 500)

        # 2. Vehicles List
        elif path == '/api/vehicles':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("""
                    SELECT
                        v.*,
                        COALESCE(u.user_id, u.name, v.owner_user_id) AS owner_username
                    FROM vehicles v
                    LEFT JOIN users u ON LOWER(u.email) = LOWER(v.owner_user_id);
                """)
                rows = cursor.fetchall()
                cursor.close()
                conn.close()
                self.send_json(rows)
            except Exception as e:
                print(f"[VEHICLES ERROR] {e}")
                self.send_json({"error": "Failed to fetch vehicles"}, 500)

        # 3. Accidents / Incidents List
        elif path in ['/api/accidents', '/api/incidents']:
            email = query_params.get('email', [None])[0]
            role = query_params.get('role', [None])[0]

            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT * FROM accidents ORDER BY created_at DESC;")
                rows = cursor.fetchall()

                normalized = []
                for r in rows:
                    lat = r.get('latitude')
                    lng = r.get('longitude')
                    peak_accel = r.get('peak_accel_mag_g') or 0.0
                    avg_accel = r.get('avg_accel_mag_g') or 0.0
                    peak_gyro = r.get('peak_gyro_mag') or 0.0

                    item = {
                        'id': r.get('event_id'),
                        'event_id': r.get('event_id'),
                        'vehicle_id': r.get('vehicle_id'),
                        'obu_serial': r.get('obu_serial'),
                        'deviceSerial': r.get('obu_serial') or r.get('vehicle_id') or 'None',
                        'severity': (r.get('severity') or 'minor').lower(),
                        'lat': float(lat) if lat else 30.0,
                        'lng': float(lng) if lng else 31.0,
                        'latitude': float(lat) if lat else 30.0,
                        'longitude': float(lng) if lng else 31.0,
                        'locationName': f"Road segment near GPS {float(lat):.4f}, {float(lng):.4f}" if lat and lng else "Cairo Traffic Network",
                        'timestamp': r.get('created_at'),
                        'created_at': r.get('created_at'),
                        'speed': 80,
                        'status': 'pending',
                        'assignedUnit': 'None',
                        'confidenceScore': r.get('confidence_score'),
                        'confidence_score': r.get('confidence_score'),
                        'confidenceLevel': r.get('confidence_level'),
                        'peakAccelMag_g': float(peak_accel),
                        'peak_accel_mag_g': float(peak_accel),
                        'avgAccelMag_g': float(avg_accel),
                        'avg_accel_mag_g': float(avg_accel),
                        'peakJerk': r.get('peak_jerk'),
                        'peak_jerk': r.get('peak_jerk'),
                        'peakGyroMag': r.get('peak_gyro_mag'),
                        'peak_gyro_mag': r.get('peak_gyro_mag'),
                        'packetsAnalysed': r.get('packets_analysed') or 10,
                        'imu': {
                            'accelX': float(peak_accel),
                            'accelY': 0.0,
                            'accelZ': float(avg_accel),
                            'roll': 0,
                            'pitch': 0,
                            'yaw': int(float(peak_gyro)) % 360 if peak_gyro else 0,
                            'temp': 35
                        }
                    }
                    normalized.append(item)

                # Role filtering for owners
                if role in ['owner', 'user'] and email:
                    cursor.execute("SELECT device_serial FROM users WHERE email = %s;", (email,))
                    u = cursor.fetchone()
                    user_serial = u['device_serial'] if u else None
                    if user_serial:
                        normalized = [a for a in normalized if a.get('obu_serial') == user_serial or a.get('deviceSerial') == user_serial]
                    else:
                        normalized = []

                cursor.close()
                conn.close()
                self.send_json(normalized)
            except Exception as e:
                print(f"[ACCIDENTS ERROR] {e}")
                self.send_json({"error": "Failed to fetch accidents"}, 500)

        # 4. Analytics
        elif path == '/api/analytics':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT * FROM analytics;")
                rows = cursor.fetchall()
                for r in rows:
                    if not r.get('street_name'):
                        r['street_name'] = get_street_name(r.get('metric_id'))
                cursor.close()
                conn.close()
                self.send_json(rows)
            except Exception as e:
                print(f"[ANALYTICS ERROR] {e}")
                self.send_json({"error": "Failed to fetch analytics"}, 500)

        # 5. Dispatch Cases
        elif path == '/api/dispatch-cases':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("""
                    SELECT dc.*, a.latitude, a.longitude,
                           a.event_timestamp, a.created_at AS acc_created_at
                    FROM dispatch_cases dc
                    LEFT JOIN accidents a ON dc.event_id = a.event_id;
                """)
                rows = cursor.fetchall()
                for r in rows:
                    if not r.get('latitude'):
                        r['latitude'] = 30.0
                        r['longitude'] = 31.0
                cursor.close()
                conn.close()
                self.send_json(rows)
            except Exception as e:
                print(f"[DISPATCH ERROR] {e}")
                self.send_json({"error": "Failed to fetch dispatch cases"}, 500)

        # 6. Emergency Units
        elif path == '/api/units':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT * FROM emergency_units;")
                rows = cursor.fetchall()
                cursor.close()
                conn.close()
                self.send_json(rows)
            except Exception as e:
                print(f"[UNITS ERROR] {e}")
                self.send_json({"error": "Failed to fetch emergency units"}, 500)

        # 7. User Management — list all users (Admin only)
        elif path == '/api/users':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT email, name, role, national_id, user_id, phone, device_serial, contact_name, contact_phone, contact_email, threshold, disabled FROM users;")
                rows = cursor.fetchall()
                cursor.close()
                conn.close()
                self.send_json(rows)
            except Exception as e:
                print(f"[USERS ERROR] {e}")
                self.send_json({"error": "Failed to fetch users"}, 500)

        # 8. Audit Logs
        elif path == '/api/audit-logs':
            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT id, timestamp, actor, action FROM audit_logs ORDER BY id DESC LIMIT 100;")
                rows = cursor.fetchall()
                cursor.close()
                conn.close()
                self.send_json(rows)
            except Exception as e:
                print(f"[AUDIT LOGS ERROR] {e}")
                self.send_json({"error": "Failed to fetch audit logs"}, 500)

        else:
            # Serve static files (HTML, CSS, JS)
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')

        try:
            payload = json.loads(post_data) if post_data else {}
        except Exception:
            self.send_json({"error": "Invalid JSON format"}, 400)
            return

        path = self.path

        # Access control validation for POST requests
        public_post_paths = ['/api/auth/register', '/api/register-user', '/api/auth/login', '/api/incidents/create']
        if path.startswith('/api/') and path not in public_post_paths:
            if not is_valid_user(self.headers):
                self.send_json({"error": "Unauthorized access. Please log in."}, 401)
                return

            admin_post_paths = [
                '/api/users/add', '/api/users/edit', '/api/users/delete',
                '/api/users/change-role', '/api/users/toggle-status'
            ]
            if path in admin_post_paths:
                if not is_admin_request(self.headers):
                    self.send_json({"error": "Forbidden: Administrator privileges required."}, 403)
                    return

            owner_settings_paths = ['/api/activate', '/api/device/activate', '/api/device/settings']
            if path in owner_settings_paths:
                target_email = payload.get('email', '').strip()
                if not is_authorized_request(self.headers, target_email):
                    self.send_json({"error": "Forbidden: Unauthorized account modification."}, 403)
                    return

        # 1. Register Account
        if path in ['/api/auth/register', '/api/register-user']:
            email = str(payload.get('email', '')).strip()
            password = payload.get('password')
            name = str(payload.get('name', '')).strip()
            role = (payload.get('role') or 'owner').strip().lower()
            national_id = payload.get('nationalId')
            user_id = str(payload.get('user_id') or payload.get('userId') or f"USER_{abs(hash(email)) % 10000}").strip()
            _phone_suffix = str(abs(hash(email or 'x')) % 10000000000).zfill(10)
            phone = str(payload.get('phone') or f'+20{_phone_suffix}').strip()

            validation_err = validate_user_inputs(email, password, name, phone, user_id)
            if validation_err:
                self.send_json({"error": validation_err}, 400)
                return

            if role not in ['admin', 'owner', 'user']:
                self.send_json({"error": "Invalid role. Must be admin, owner, or user"}, 400)
                return

            try:
                conn = get_db_connection()
                cursor = conn.cursor()

                cursor.execute("SELECT 1 FROM users WHERE email = %s;", (email,))
                if cursor.fetchone():
                    cursor.close(); conn.close()
                    self.send_json({"error": "Email address already registered"}, 400)
                    return

                if national_id:
                    cursor.execute("SELECT 1 FROM users WHERE national_id = %s;", (national_id,))
                    if cursor.fetchone():
                        cursor.close(); conn.close()
                        self.send_json({"error": "National ID already registered"}, 400)
                        return

                cursor.execute("""
                INSERT INTO users (email, password, name, role, national_id, user_id, phone, device_serial)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL);
                """, (email, hash_password(password), name, role, national_id, user_id, phone))
                cursor.close()
                conn.close()

                log_audit(email, f"New user registered: {name} ({role})")
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"error": f"Registration error: {str(e)}"}, 400)

        # 2. Login Account
        elif path == '/api/auth/login':
            email = payload.get('email')
            password = payload.get('password')

            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)
                cursor.execute("SELECT * FROM users WHERE email = %s;", (email,))
                row = cursor.fetchone()
                cursor.close()
                conn.close()

                if row and verify_password(password, row['password']):
                    if bool(row.get('disabled', 0)):
                        self.send_json({"error": "This account has been disabled. Contact administrator."}, 403)
                        return
                    user_data = dict(row)
                    del user_data['password']
                    log_audit(email, "Logged in successfully")
                    self.send_json(user_data)
                else:
                    self.send_json({"error": "Invalid email credentials or password"}, 401)
            except Exception as e:
                print(f"[LOGIN ERROR] {e}")
                self.send_json({"error": "Login service unavailable"}, 500)

        # 3. Activate Device
        elif path in ['/api/activate', '/api/device/activate']:
            user_id    = payload.get('user_id', '').strip()
            vehicle_id = payload.get('vehicle_id', '').strip() or 'CAR001'
            obu_serial = (payload.get('obu_serial') or payload.get('serial', '')).strip()
            email      = payload.get('email', '').strip()

            if not user_id or not vehicle_id or not obu_serial:
                self.send_json({"error": "Missing required fields"}, 400)
                return

            try:
                conn = get_db_connection()
                cursor = conn.cursor(dictionary=True)

                if email:
                    cursor.execute("SELECT * FROM users WHERE email = %s;", (email,))
                else:
                    cursor.execute("SELECT * FROM users WHERE user_id = %s;", (user_id,))
                user_row = cursor.fetchone()

                if not user_row:
                    cursor.close(); conn.close()
                    self.send_json({"error": "User account not found"}, 404)
                    return

                real_email = user_row['email']

                if user_row.get('device_serial'):
                    cursor.close(); conn.close()
                    self.send_json({"error": "This account is already activated with a device"}, 400)
                    return

                # Check unique OBU
                cursor.execute("SELECT 1 FROM users WHERE device_serial = %s;", (obu_serial,))
                if cursor.fetchone():
                    cursor.close(); conn.close()
                    self.send_json({"error": "This OBU Serial is already assigned to another user"}, 400)
                    return

                # Update user with OBU
                cursor.execute("UPDATE users SET device_serial = %s, user_id = %s WHERE email = %s;", (obu_serial, user_id, real_email))

                # Insert or update vehicle
                cursor.execute("""
                INSERT INTO vehicles (vehicle_id, obu_serial, owner_user_id, last_status)
                VALUES (%s, %s, %s, 'ACTIVE')
                ON DUPLICATE KEY UPDATE obu_serial = VALUES(obu_serial), owner_user_id = VALUES(owner_user_id);
                """, (vehicle_id, obu_serial, real_email))

                cursor.close()
                conn.close()
                log_audit(real_email, f"Activated device {obu_serial} for vehicle {vehicle_id}")
                self.send_json({"success": True})
            except Exception as e:
                print(f"[ACTIVATE ERROR] {e}")
                self.send_json({"error": str(e)}, 500)

        # 4. Device Settings Update
        elif path == '/api/device/settings':
            email = payload.get('email')
            contact_name = payload.get('contactName')
            contact_phone = payload.get('contactPhone')
            contact_email = payload.get('contactEmail')
            threshold = payload.get('threshold')

            if not email:
                self.send_json({"error": "User email required"}, 400)
                return

            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                UPDATE users
                SET contact_name = %s, contact_phone = %s, contact_email = %s, threshold = %s
                WHERE email = %s;
                """, (contact_name, contact_phone, contact_email, threshold, email))
                cursor.close()
                conn.close()
                log_audit(email, f"Updated emergency contact settings: {contact_name} ({contact_phone})")
                self.send_json({"success": True})
            except Exception as e:
                print(f"[SETTINGS ERROR] {e}")
                self.send_json({"error": "Failed to save settings"}, 500)

        # 5. Incident Simulation / Creation
        elif path == '/api/incidents/create':
            acc = payload.get('accident')
            if not acc:
                self.send_json({"error": "Accident payload missing"}, 400)
                return

            event_id = acc.get('id') or f"EVT_{int(datetime.datetime.now().timestamp())}"
            device_serial = acc.get('deviceSerial') or 'OBU-000001'
            severity = (acc.get('severity') or 'moderate').upper()
            lat = acc.get('lat') or 30.0444
            lng = acc.get('lng') or 31.2357
            created_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            try:
                conn = get_db_connection()
                cursor = conn.cursor()

                # Resolve vehicle ID
                cursor.execute("SELECT vehicle_id FROM vehicles WHERE obu_serial = %s LIMIT 1;", (device_serial,))
                v_row = cursor.fetchone()
                vehicle_id = v_row[0] if v_row else device_serial

                # Insert accident
                cursor.execute("""
                INSERT INTO accidents (
                    event_id, vehicle_id, obu_serial, severity, confidence_score, confidence_level,
                    latitude, longitude, created_at, event_timestamp
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (event_id, vehicle_id, device_serial, severity, 90.0, 'HIGH', lat, lng, created_at, created_at))

                # Update vehicle status
                cursor.execute("""
                UPDATE vehicles SET last_status = %s, last_seen = %s, last_latitude = %s, last_longitude = %s
                WHERE obu_serial = %s OR vehicle_id = %s;
                """, (severity, created_at, lat, lng, device_serial, vehicle_id))

                # Create dispatch case
                case_id = f"CASE_{event_id}"
                cursor.execute("""
                INSERT INTO dispatch_cases (
                    case_id, event_id, vehicle_id, obu_serial, severity, dispatch_status, created_at
                ) VALUES (%s, %s, %s, %s, %s, 'PENDING', %s);
                """, (case_id, event_id, vehicle_id, device_serial, severity, created_at))

                cursor.close()
                conn.close()
                self.send_json({"success": True, "event_id": event_id, "case_id": case_id})
            except Exception as e:
                print(f"[SIMULATOR ERROR] {e}")
                self.send_json({"error": "Failed to create incident"}, 500)

        # 6. Dispatch Response (Update emergency statuses)
        elif path == '/api/dispatch-response':
            case_id = payload.get('case_id')
            if not case_id:
                self.send_json({"error": "Missing case_id"}, 400)
                return

            try:
                conn = get_db_connection()
                cursor = conn.cursor()

                updates = []
                params = []
                if 'ambulance_status' in payload:
                    updates.append("ambulance_status = %s")
                    params.append(payload['ambulance_status'])
                if 'police_status' in payload:
                    updates.append("police_status = %s")
                    params.append(payload['police_status'])
                if 'dispatch_status' in payload:
                    updates.append("dispatch_status = %s")
                    params.append(payload['dispatch_status'])
                else:
                    updates.append("dispatch_status = 'DISPATCHED'")

                if updates:
                    query = f"UPDATE dispatch_cases SET {', '.join(updates)} WHERE case_id = %s;"
                    params.append(case_id)
                    cursor.execute(query, tuple(params))

                cursor.close()
                conn.close()
                self.send_json({"success": True, "message": "Dispatch updated successfully"})
            except Exception as e:
                print(f"[DISPATCH RESPONSE ERROR] {e}")
                self.send_json({"error": str(e)}, 500)

        # 7. Add User (Admin)
        elif path == '/api/users/add':
            email      = payload.get('email', '').strip()
            name       = payload.get('name', '').strip()
            role       = payload.get('role', 'owner').strip().lower()
            phone      = payload.get('phone', '').strip()
            national_id= payload.get('national_id', '').strip() or None
            password = payload.get('password', '').strip()
            user_id    = payload.get('user_id', '').strip() or f"USER_{abs(hash(email)) % 100000}"
            actor_email= payload.get('actor_email') or 'admin@traffic.gov'

            if not email or not name or not role:
                self.send_json({"error": "Missing required fields (email, name, role)"}, 400)
                return
            if not password or len(password) < 6:
                self.send_json({"error": "Password must be at least 6 characters long."}, 400)
                return
            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                INSERT INTO users (email, password, name, role, national_id, user_id, phone, device_serial)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NULL);
                """, (email, hash_password(password), name, role, national_id, user_id, phone))
                cursor.close()
                conn.close()
                log_audit(actor_email, f"Added user {name} ({email}) with role {role}")
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        # 8. Edit User (Admin)
        elif path == '/api/users/edit':
            target_email = payload.get('target_email', '').strip()
            name         = payload.get('name', '').strip()
            role         = payload.get('role', '').strip().lower()
            phone        = payload.get('phone', '').strip()
            national_id  = payload.get('national_id', '').strip() or None
            actor_email  = payload.get('actor_email') or 'admin@traffic.gov'

            if not target_email:
                self.send_json({"error": "target_email is required"}, 400)
                return

            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("""
                UPDATE users SET name = COALESCE(NULLIF(%s, ''), name),
                                 role = COALESCE(NULLIF(%s, ''), role),
                                 phone = COALESCE(NULLIF(%s, ''), phone),
                                 national_id = COALESCE(%s, national_id)
                WHERE email = %s;
                """, (name, role, phone, national_id, target_email))
                cursor.close()
                conn.close()
                log_audit(actor_email, f"Modified user {target_email}")
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        # 9. Delete User (Admin)
        elif path == '/api/users/delete':
            target_email = payload.get('email', '').strip()
            actor_email  = payload.get('actor_email') or 'admin@traffic.gov'

            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM users WHERE email = %s;", (target_email,))
                cursor.close()
                conn.close()
                log_audit(actor_email, f"Deleted user {target_email}")
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        # 10. Toggle Status (Admin)
        elif path == '/api/users/toggle-status':
            target_email = payload.get('email', '').strip()
            disabled     = payload.get('disabled', False)
            actor_email  = payload.get('actor_email') or 'admin@traffic.gov'

            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("UPDATE users SET disabled = %s WHERE email = %s;", (1 if disabled else 0, target_email))
                cursor.close()
                conn.close()
                log_audit(actor_email, f"{'Disabled' if disabled else 'Enabled'} user {target_email}")
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        # 11. Change Role (Admin)
        elif path == '/api/users/change-role':
            target_email = payload.get('email', '').strip()
            new_role     = payload.get('role', '').strip().lower()
            actor_email  = payload.get('actor_email') or 'admin@traffic.gov'

            try:
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("UPDATE users SET role = %s WHERE email = %s;", (new_role, target_email))
                cursor.close()
                conn.close()
                log_audit(actor_email, f"Changed role of {target_email} to {new_role}")
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"error": str(e)}, 500)

        else:
            self.send_json({"error": "API route not found"}, 404)

# ----------------------------------------------------
# MAIN SERVER RUNNER
# ----------------------------------------------------
class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except Exception:
            pass
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except Exception:
            pass
        super().server_bind()

if __name__ == '__main__':
    PORT = 8000
    free_port(PORT)
    init_db()

    try:
        with ReusableTCPServer(("", PORT), APIRequestHandler) as httpd:
            print(f"[SERVER] Smart Traffic Dashboard running at: http://localhost:{PORT}")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[SERVER] Shutting down gracefully...")
        sys.exit(0)
    except OSError as e:
        print(f"[SERVER] ERROR: {e}")
        sys.exit(1)
