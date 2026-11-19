/*
 * ESP32 Wearable Stress Detection System - WEBSOCKET SERVER
 * Fixed Pulse Detection (peak/trough algorithm)
 * Thresholds exactly from Table 1
 */

#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <WebSocketsServer.h>

// ===================== WiFi =====================
const char* ssid = "NeoN";
const char* password = "04082024";

WebSocketsServer webSocket = WebSocketsServer(81);

// ===================== Pins =====================
#define I2C_SDA         21
#define I2C_SCL         22
#define MPU_ADDR        0x68
#define GSR_PIN         34
#define PULSE_PIN       35
#define ONE_WIRE_BUS    4
#define LED_PIN         2

// ===================== Table 1 Thresholds =====================
// Heart Rate (bpm)
#define HR_MINIMAL_MAX  85.0f
#define HR_MILD_MIN     86.0f
#define HR_MODERATE_MIN 96.0f
#define HR_SEVERE_MIN   105.0f      // changed from 106 to match table

// GSR (µS)
#define GSR_MINIMAL_MAX 1.1f
#define GSR_MILD_MIN    1.2f
#define GSR_MODERATE_MIN 2.5f
#define GSR_SEVERE_MIN  4.0f

// Temperature drop (°C)
#define TEMP_MILD_DROP  0.3f
#define TEMP_MODERATE_DROP 0.9f
#define TEMP_SEVERE_DROP 1.6f

// Motion (g)
#define MOTION_MILD_MAX     0.05f
#define MOTION_MODERATE_MAX 0.08f
#define MOTION_ARTIFACT_THRESHOLD 0.08f

// Skin contact
#define PULSE_SIGNAL_MIN    80
#define GSR_SKIN_MIN        50
#define TEMP_SKIN_MIN       28.0f
#define TEMP_SKIN_MAX       40.0f

// Timing
#define PULSE_SAMPLE_MS     10      // 100 Hz

// ===================== Global Objects =====================
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

// ===================== Pulse Detection State =====================
volatile int Signal;
volatile int IBI = 600;
volatile int BPM;
volatile bool Pulse = false;
volatile bool QS = false;
volatile int sampleCounter = 0;
volatile int lastBeatTime = 0;
volatile int P = 2048;
volatile int T = 2048;
volatile int thresh = 2100;
volatile int amp = 400;
volatile bool firstBeat = true;
volatile bool secondBeat = false;

// Finger detection
int pulseSignalPeak = 0;
int pulseSignalTrough = 4095;
bool fingerDetected = false;
float heartRate = 0.0f;
bool hrValid = false;

// ===================== Other Sensors =====================
float accelRMS = 0.0f;
bool motionArtifact = false;
float motionValue = 0.0f;

int gsrRaw = 0;
float gsrMicroSiemens = 0.0f;
bool gsrOnSkin = false;

float temperature = 0.0f;
float tempDrop = 0.0f;
float tempBaseline = 34.0f;
bool tempOnSkin = false;

// Timing
unsigned long lastPulseRead = 0;
unsigned long lastMPURead = 0;
unsigned long lastSlowRead = 0;
unsigned long lastWebSocketBroadcast = 0;
const unsigned long MPU_MS = 50;
const unsigned long SLOW_MS = 1000;
const unsigned long BROADCAST_MS = 500;

bool mpuOK = false;
bool tempOK = false;

// ===================== Enums =====================
enum StressLevel { STRESS_MINIMAL, STRESS_MILD, STRESS_MODERATE, STRESS_SEVERE };
StressLevel currentStress = STRESS_MINIMAL;
bool currentDataValid = false;

// ===================== Prototypes =====================
bool initMPU6050();
void readMPU6050();
void readPulseSensor();
void readGSR();
void readTemperature();
void checkSkinContact();
StressLevel classifyStress();
String stressToString(StressLevel level);
void printStatus(StressLevel stress, bool dataValid);
void broadcastSensorData();
void connectWiFi();
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);

// ===================== Setup =====================
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println(F("\n=== Stress Detection System (WebSocket) ===\n"));

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  tempSensor.begin();
  delay(100);
  tempOK = (tempSensor.getDeviceCount() > 0);

  Wire.beginTransmission(MPU_ADDR);
  mpuOK = (Wire.endTransmission() == 0) ? initMPU6050() : false;

  connectWiFi();
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server on port 81");

  sampleCounter = 0;
  lastBeatTime = 0;
}

// ===================== Loop =====================
void loop() {
  unsigned long now = millis();
  webSocket.loop();

  if (now - lastPulseRead >= PULSE_SAMPLE_MS) {
    lastPulseRead = now;
    readPulseSensor();
  }

  if (now - lastMPURead >= MPU_MS) {
    lastMPURead = now;
    if (mpuOK) readMPU6050();
  }

  if (now - lastSlowRead >= SLOW_MS) {
    lastSlowRead = now;
    readGSR();
    readTemperature();
    checkSkinContact();

    bool enoughSensors = (gsrOnSkin || fingerDetected || tempOnSkin);
    bool dataValid = (!motionArtifact && enoughSensors);
    StressLevel stress = dataValid ? classifyStress() : STRESS_MINIMAL;
    currentStress = stress;
    currentDataValid = dataValid;

    printStatus(stress, dataValid);

    // LED feedback
    if (!dataValid) digitalWrite(LED_PIN, HIGH);
    else if (stress == STRESS_SEVERE) {
      static unsigned long lastBlink = 0;
      if (now - lastBlink > 100) { lastBlink = now; digitalWrite(LED_PIN, !digitalRead(LED_PIN)); }
    } else if (stress == STRESS_MODERATE) {
      static unsigned long lastBlink = 0;
      if (now - lastBlink > 500) { lastBlink = now; digitalWrite(LED_PIN, !digitalRead(LED_PIN)); }
    } else digitalWrite(LED_PIN, LOW);
  }

  if (now - lastWebSocketBroadcast >= BROADCAST_MS) {
    lastWebSocketBroadcast = now;
    if (WiFi.status() == WL_CONNECTED) broadcastSensorData();
  }

  delay(1);
}

// ===================== Pulse Sensor (Robust) =====================
void readPulseSensor() {
  Signal = analogRead(PULSE_PIN);
  sampleCounter += PULSE_SAMPLE_MS;
  int N = sampleCounter - lastBeatTime;

  if (Signal < thresh && N > (IBI / 5) * 3) {
    if (Signal < T) T = Signal;
  }
  if (Signal > thresh && Signal > P) P = Signal;

  if (N > 250) {
    if (Signal > thresh && !Pulse && (N > (IBI / 5) * 3)) {
      Pulse = true;
      IBI = sampleCounter - lastBeatTime;
      lastBeatTime = sampleCounter;

      if (secondBeat) secondBeat = false;
      if (firstBeat) { firstBeat = false; secondBeat = true; return; }

      BPM = 60000 / IBI;
      QS = true;
      heartRate = (float)BPM;
      hrValid = true;
    }
  }

  if (Signal < thresh && Pulse) {
    Pulse = false;
    amp = P - T;
    thresh = amp / 2 + T;
    P = thresh;
    T = thresh;
  }

  if (N > 2500) {
    thresh = 2048;
    P = 2048;
    T = 2048;
    lastBeatTime = sampleCounter;
    firstBeat = true;
    secondBeat = false;
    hrValid = false;
    heartRate = 0;
  }

  // Finger detection by amplitude
  if (Signal > pulseSignalPeak) pulseSignalPeak = Signal;
  if (Signal < pulseSignalTrough) pulseSignalTrough = Signal;
  static unsigned long lastAmpUpdate = 0;
  if (millis() - lastAmpUpdate > 200) {
    int amplitude = pulseSignalPeak - pulseSignalTrough;
    fingerDetected = (amplitude > PULSE_SIGNAL_MIN);
    pulseSignalPeak = 0;
    pulseSignalTrough = 4095;
    lastAmpUpdate = millis();
  }
}

// ===================== MPU6050 =====================
bool initMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0x00);
  if (Wire.endTransmission(true) != 0) return false;
  delay(100);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C); Wire.write(0x00);
  Wire.endTransmission(true);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1B); Wire.write(0x00);
  Wire.endTransmission(true);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1A); Wire.write(0x03);
  Wire.endTransmission(true);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x19); Wire.write(19);
  Wire.endTransmission(true);
  return true;
}

void readMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);
  if (Wire.available() < 14) return;

  int16_t rawAx = Wire.read() << 8 | Wire.read();
  int16_t rawAy = Wire.read() << 8 | Wire.read();
  int16_t rawAz = Wire.read() << 8 | Wire.read();
  Wire.read(); Wire.read(); // skip temp
  Wire.read(); Wire.read(); // skip gyro X
  Wire.read(); Wire.read(); // skip gyro Y
  Wire.read(); Wire.read(); // skip gyro Z

  float ax = rawAx / 16384.0f;
  float ay = rawAy / 16384.0f;
  float az = rawAz / 16384.0f;
  accelRMS = sqrt(ax*ax + ay*ay + az*az);
  motionValue = fabs(accelRMS - 1.0f);
  motionArtifact = (motionValue > MOTION_ARTIFACT_THRESHOLD);
}

// ===================== GSR =====================
void readGSR() {
  long sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(GSR_PIN);
    delay(2);
  }
  gsrRaw = sum / 10;
  gsrMicroSiemens = (gsrRaw / 4095.0f) * 10.0f;
  gsrOnSkin = (gsrRaw > GSR_SKIN_MIN);
}

// ===================== Temperature =====================
void readTemperature() {
  if (!tempOK) { temperature = 0; tempOnSkin = false; return; }
  tempSensor.requestTemperatures();
  delay(10);
  float t = tempSensor.getTempCByIndex(0);
  if (t != DEVICE_DISCONNECTED_C && t > 0) {
    temperature = t;
    tempOnSkin = (temperature >= TEMP_SKIN_MIN && temperature <= TEMP_SKIN_MAX);
    tempDrop = tempBaseline - temperature;
  } else {
    temperature = 0;
    tempOnSkin = false;
  }
}

// ===================== Skin Contact Alerts =====================
void checkSkinContact() {
  if (!fingerDetected) Serial.println("[ALERT] Pulse sensor: No finger.");
  if (!gsrOnSkin) Serial.println("[ALERT] GSR: Not on skin.");
  if (tempOK && !tempOnSkin && temperature > 0)
    Serial.printf("[ALERT] Temp: not on skin (%.1f°C)\n", temperature);
}

// ===================== Stress Classification (Table 1) =====================
StressLevel classifyStress() {
  int votes[4] = {0,0,0,0};
  int activeSensors = 0;

  // GSR (weighted x2)
  if (gsrOnSkin) {
    activeSensors++;
    if (gsrMicroSiemens >= GSR_SEVERE_MIN) votes[3] += 2;
    else if (gsrMicroSiemens >= GSR_MODERATE_MIN) votes[2] += 2;
    else if (gsrMicroSiemens >= GSR_MILD_MIN) votes[1] += 2;
    else votes[0] += 2;
  }

  // Heart Rate
  if (fingerDetected && hrValid && heartRate > 0 && heartRate < 150) {
    activeSensors++;
    if (heartRate >= HR_SEVERE_MIN) votes[3]++;
    else if (heartRate >= HR_MODERATE_MIN) votes[2]++;
    else if (heartRate >= HR_MILD_MIN) votes[1]++;
    else votes[0]++;
  }

  // Temperature drop
  if (tempOnSkin && tempOK) {
    activeSensors++;
    if (tempDrop >= TEMP_SEVERE_DROP) votes[3]++;
    else if (tempDrop >= TEMP_MODERATE_DROP) votes[2]++;
    else if (tempDrop >= TEMP_MILD_DROP) votes[1]++;
    else votes[0]++;
  }

  // Motion (only if no artifact)
  if (!motionArtifact && activeSensors > 0) {
    if (motionValue > MOTION_MODERATE_MAX) votes[3]++;
    else if (motionValue > MOTION_MILD_MAX) votes[2]++;
    else if (motionValue > 0.03f) votes[1]++;
  }

  if (activeSensors == 0) return STRESS_MINIMAL;
  for (int i = 3; i >= 1; i--) if (votes[i] > 0) return (StressLevel)i;
  return STRESS_MINIMAL;
}

// ===================== Output =====================
void printStatus(StressLevel stress, bool dataValid) {
  Serial.println(F("\n=========================================="));
  Serial.print(F("HR: "));
  if (fingerDetected && hrValid && heartRate > 0) Serial.print(heartRate,1);
  else Serial.print(F("---"));
  Serial.print(F(" bpm  | Finger: ")); Serial.println(fingerDetected ? "YES" : "NO");

  Serial.print(F("GSR: "));
  if (gsrOnSkin) Serial.print(gsrMicroSiemens,2);
  else Serial.print(F("---"));
  Serial.println(F(" µS"));

  Serial.print(F("Temp: "));
  if (tempOnSkin && tempOK) Serial.print(temperature,1);
  else Serial.print(F("---"));
  Serial.print(F(" °C | Drop: "));
  if (tempOnSkin && tempOK) Serial.print(tempDrop,1);
  else Serial.print(F("---"));
  Serial.println(F(" °C"));

  Serial.print(F("Motion: ")); Serial.print(motionValue,3); Serial.print(F(" g | "));
  Serial.print(motionArtifact ? "ARTIFACT" : "OK");
  Serial.println();
  Serial.print(F("Data valid: ")); Serial.println(dataValid ? "YES" : "NO");
  Serial.print(F("Stress level: ")); Serial.println(stressToString(stress));
  Serial.println(F("==========================================\n"));
}

String stressToString(StressLevel level) {
  switch(level) {
    case STRESS_MINIMAL: return "MINIMAL";
    case STRESS_MILD:    return "MILD";
    case STRESS_MODERATE:return "MODERATE";
    case STRESS_SEVERE:  return "SEVERE";
    default: return "UNKNOWN";
  }
}

// ===================== WebSocket =====================
void broadcastSensorData() {
  String json = "{";
  json += "\"hr\":" + String(heartRate,1) + ",";
  json += "\"gsr\":" + String(gsrMicroSiemens,2) + ",";
  json += "\"temp\":" + String(temperature,1) + ",";
  json += "\"motion\":" + String(motionValue,3) + ",";
  json += "\"stress\":\"" + stressToString(currentStress) + "\",";
  json += "\"dataValid\":" + String(currentDataValid ? "true" : "false") + ",";
  json += "\"max30102\":" + String(fingerDetected ? "true" : "false") + ",";
  json += "\"gsrConnected\":" + String(gsrOnSkin ? "true" : "false") + ",";
  json += "\"ds18b20\":" + String(tempOnSkin && tempOK ? "true" : "false") + ",";
  json += "\"mpu6050\":" + String(mpuOK ? "true" : "false");
  json += "}\n";
  webSocket.broadcastTXT(json);
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) {
    IPAddress ip = webSocket.remoteIP(num);
    Serial.printf("[%u] Connected from %d.%d.%d.%d\n", num, ip[0], ip[1], ip[2], ip[3]);
  } else if (type == WStype_DISCONNECTED) {
    Serial.printf("[%u] Disconnected\n", num);
  }
}

// ===================== WiFi =====================
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP: "); Serial.println(WiFi.localIP());
    Serial.print("WebSocket: ws://"); Serial.print(WiFi.localIP()); Serial.println(":81");
  } else {
    Serial.println("\nWiFi failed, running without network.");
  }
}