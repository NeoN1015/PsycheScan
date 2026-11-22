#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ===================== WiFi Setup =====================
const char* ssid = "YOUR_WIFI_SSID";        // redacted
const char* password = "YOUR_WIFI_PASSWORD"; // redacted
WebSocketsServer webSocket = WebSocketsServer(81);

// ===================== BLE Setup (From your screenshot) =====================
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

BLEServer* pServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;
bool deviceConnected = false;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("BLE Client Connected");
    };
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("BLE Client Disconnected");
      pServer->startAdvertising(); // Restart advertising so web can find it again
    }
};

// ===================== Pins =====================
#define I2C_SDA         21
#define I2C_SCL         22
#define MPU_ADDR        0x68
#define GSR_PIN         34
#define PULSE_PIN       35
#define ONE_WIRE_BUS    4
#define LED_PIN         2

// ===================== Thresholds & Timing =====================
#define PULSE_SIGNAL_MIN    80
#define GSR_SKIN_MIN        50
#define TEMP_SKIN_MIN       28.0f
#define TEMP_SKIN_MAX       40.0f
#define PULSE_SAMPLE_MS     10

// ===================== Global Objects =====================
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

// ===================== Pulse Detection State =====================
volatile int Signal;
volatile int IBI = 600;
volatile int BPM;
volatile bool Pulse = false;
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
float motionValue = 0.0f;

int gsrRaw = 0;
float gsrMicroSiemens = 0.0f;
bool gsrOnSkin = false;

float temperature = 0.0f;
float tempDrop = 0.0f;
float tempBaseline = 0.0f;
bool baselineEstablished = false;
bool tempOnSkin = false;

// ===================== Timing =====================
unsigned long lastPulseRead = 0;
unsigned long lastMPURead = 0;
unsigned long lastSlowRead = 0;
unsigned long lastBroadcast = 0;
const unsigned long MPU_MS = 50;
const unsigned long SLOW_MS = 1000;
const unsigned long BROADCAST_MS = 500;

bool mpuOK = false;
bool tempOK = false;

// ===================== Prototypes =====================
bool initMPU6050();
void readMPU6050();
void readPulseSensor();
void readGSR();
void readTemperature();
void broadcastSensorData();
void connectWiFi();
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);

// ===================== Setup =====================
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println(F("\n=== Multi-Mode Data Sender (BLE + WiFi + USB) ==="));

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

  // 1. Start BLE (Bluetooth Low Energy)
  BLEDevice::init("ESP32_StressMon");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());
  pService->start();
  
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("BLE Started! Ready to pair from Web Browser.");

  // 2. Start WiFi
  connectWiFi();
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

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
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); 
  }

  if (now - lastBroadcast >= BROADCAST_MS) {
    lastBroadcast = now;
    broadcastSensorData();
  }

  delay(1);
}

// ===================== Pulse Sensor =====================
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
    thresh = 2048; P = 2048; T = 2048;
    lastBeatTime = sampleCounter;
    firstBeat = true; secondBeat = false;
    hrValid = false; heartRate = 0;
  }

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
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x6B); Wire.write(0x00);
  if (Wire.endTransmission(true) != 0) return false;
  delay(100);
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x1C); Wire.write(0x00); Wire.endTransmission(true);
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x1B); Wire.write(0x00); Wire.endTransmission(true);
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x1A); Wire.write(0x03); Wire.endTransmission(true);
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x19); Wire.write(19); Wire.endTransmission(true);
  return true;
}

void readMPU6050() {
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x3B); Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);
  if (Wire.available() < 14) return;

  int16_t rawAx = Wire.read() << 8 | Wire.read();
  int16_t rawAy = Wire.read() << 8 | Wire.read();
  int16_t rawAz = Wire.read() << 8 | Wire.read();
  Wire.read(); Wire.read(); Wire.read(); Wire.read(); Wire.read(); Wire.read(); Wire.read(); Wire.read();

  float ax = rawAx / 16384.0f;
  float ay = rawAy / 16384.0f;
  float az = rawAz / 16384.0f;
  accelRMS = sqrt(ax*ax + ay*ay + az*az);
  motionValue = fabs(accelRMS - 1.0f);
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
  if (!tempOK) { temperature = 0; tempDrop = 0; tempOnSkin = false; return; }
  tempSensor.requestTemperatures();
  delay(10);
  float t = tempSensor.getTempCByIndex(0);
  
  if (t != DEVICE_DISCONNECTED_C && t > 0) {
    temperature = t;
    tempOnSkin = (temperature >= TEMP_SKIN_MIN && temperature <= TEMP_SKIN_MAX);
    
    if (tempOnSkin && !baselineEstablished) {
      tempBaseline = temperature;
      baselineEstablished = true;
    }
    
    tempDrop = tempOnSkin && baselineEstablished ? tempBaseline - temperature : 0;
    if (!tempOnSkin) baselineEstablished = false;
  } else {
    temperature = 0;
    tempDrop = 0;
    tempOnSkin = false;
    baselineEstablished = false;
  }
}

// ===================== Broadcast to ALL Modes =====================
void broadcastSensorData() {
  String json = "{";
  json += "\"hr\":" + String(hrValid ? heartRate : 0, 1) + ",";
  json += "\"finger\":" + String(fingerDetected ? "true" : "false") + ",";
  json += "\"gsr\":" + String(gsrOnSkin ? gsrMicroSiemens : 0, 2) + ",";
  json += "\"gsrSkin\":" + String(gsrOnSkin ? "true" : "false") + ",";
  json += "\"temp\":" + String(tempOnSkin ? temperature : 0, 1) + ",";
  json += "\"tempDrop\":" + String(tempOnSkin ? tempDrop : 0, 2) + ",";
  json += "\"tempSkin\":" + String(tempOnSkin ? "true" : "false") + ",";
  json += "\"motion\":" + String(motionValue, 3) + ",";
  json += "\"max30102\":" + String(fingerDetected ? "true" : "false") + ",";
  json += "\"gsrConnected\":" + String(gsrOnSkin ? "true" : "false") + ",";
  json += "\"ds18b20\":" + String(tempOnSkin ? "true" : "false") + ",";
  json += "\"mpu6050\":" + String(mpuOK ? "true" : "false");
  json += "}";

  // 1. Send to USB Serial (and Web Serial)
  Serial.println(json);

  // 2. Send to BLE
  if (deviceConnected) {
    pTxCharacteristic->setValue(json.c_str());
    pTxCharacteristic->notify();
  }

  // 3. Send to WiFi WebSocket
  webSocket.broadcastTXT(json);
}

// ===================== WebSocket Event =====================
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) {
    Serial.printf("[WiFi] Web Client Connected\n");
  } else if (type == WStype_DISCONNECTED) {
    Serial.printf("[WiFi] Web Client Disconnected\n");
  }
}

// ===================== WiFi Connect =====================
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
  } else {
    Serial.println("\nWiFi failed. Running on BLE/USB only.");
  }
}