/*
 * PsycheScan sensor firmware: USB serial only (no Wi-Fi, no Bluetooth).
 *
 * Once per second it prints one JSON line at 115200 baud, for example:
 *   {"hr":78.4,"gsr":2.15,"temp":34.6,"motion":0.042,"dataValid":true,"max30102":true,"gsrConnected":true,"ds18b20":true,"mpu6050":true}
 * Human-readable debug lines start with "#" so the dashboard ignores them.
 *
 * Boards: ESP32 (e.g. ESP32 Dev Module) and ESP32-S3.
 *   ESP32-S3 on its native USB port: in the Arduino IDE set
 *   Tools > USB CDC On Boot > "Enabled", otherwise nothing appears on the serial port.
 *
 * Libraries: OneWire, DallasTemperature (and the esp32 board package by Espressif).
 */

#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ===================== Pins =====================
// GPIO 34/35 and 22 do not exist as ADC/I2C pins on the ESP32-S3, so it uses its own map.
#if CONFIG_IDF_TARGET_ESP32S3
  #define I2C_SDA       8
  #define I2C_SCL       9
  #define GSR_PIN       4    // ADC1_CH3
  #define PULSE_PIN     5    // ADC1_CH4
  #define ONE_WIRE_BUS  15
  #define LED_PIN       -1   // most S3 boards have an RGB LED instead; disabled
#else
  #define I2C_SDA       21
  #define I2C_SCL       22
  #define GSR_PIN       34
  #define PULSE_PIN     35
  #define ONE_WIRE_BUS  4
  #define LED_PIN       2
#endif

#define MPU_ADDR        0x68

// ===================== Contact / validity limits =====================
#define PULSE_SIGNAL_MIN  80      // pulse waveform amplitude (ADC counts) that means a finger is on the sensor
#define GSR_SKIN_MIN      50      // raw ADC level that means the GSR electrodes touch skin
#define TEMP_SKIN_MIN     28.0f   // DS18B20 reading range that means the probe is on skin
#define TEMP_SKIN_MAX     40.0f

// ===================== Timing =====================
const unsigned long PULSE_SAMPLE_MS = 10;     // 100 Hz pulse sampling
const unsigned long MPU_MS = 50;
const unsigned long REPORT_MS = 1000;         // one JSON line per second

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

// ===================== Pulse detection state =====================
int IBI = 600;
bool Pulse = false;
int sampleCounter = 0;
int lastBeatTime = 0;
int P = 2048;
int T = 2048;
int thresh = 2100;
int amp = 400;
bool firstBeat = true;
bool secondBeat = false;

int pulseSignalPeak = 0;
int pulseSignalTrough = 4095;
unsigned long lastAmpUpdate = 0;
bool fingerDetected = false;
float heartRate = 0.0f;
bool hrValid = false;

// ===================== Other sensors =====================
bool mpuOK = false;
float motionValue = 0.0f;

float gsrMicroSiemens = 0.0f;
bool gsrOnSkin = false;

bool tempOK = false;
float temperature = 0.0f;
bool tempOnSkin = false;

unsigned long lastPulseRead = 0;
unsigned long lastMPURead = 0;
unsigned long lastReport = 0;

// Previous contact states, so contact changes are logged once instead of every second.
bool prevFinger = true, prevGsr = true, prevTemp = true;

bool initMPU6050();
void readMPU6050();
void readPulseSensor();
void readGSR();
void readTemperature();
void logContactChanges();
void printJson();

void setup() {
  Serial.begin(115200);
  // USB CDC (ESP32-S3) needs a moment for the host to open the port; don't wait forever.
  unsigned long start = millis();
  while (!Serial && millis() - start < 2000) delay(10);
  Serial.println(F("# PsycheScan USB firmware starting"));

  if (LED_PIN >= 0) {
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
  }

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Wire.beginTransmission(MPU_ADDR);
  mpuOK = (Wire.endTransmission() == 0) && initMPU6050();

  tempSensor.begin();
  tempOK = tempSensor.getDeviceCount() > 0;
  // Non-blocking conversions: a 12-bit DS18B20 read takes ~750 ms, which would stall pulse sampling.
  tempSensor.setWaitForConversion(false);
  if (tempOK) tempSensor.requestTemperatures();

  Serial.print(F("# MPU6050: "));
  Serial.println(mpuOK ? F("found") : F("not found"));
  Serial.print(F("# DS18B20: "));
  Serial.println(tempOK ? F("found") : F("not found"));
}

void loop() {
  unsigned long now = millis();

  if (now - lastPulseRead >= PULSE_SAMPLE_MS) {
    lastPulseRead = now;
    readPulseSensor();
  }

  if (mpuOK && now - lastMPURead >= MPU_MS) {
    lastMPURead = now;
    readMPU6050();
  }

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    readGSR();
    readTemperature();
    logContactChanges();
    printJson();
  }
}

// ===================== Pulse sensor (peak/trough beat detection) =====================
void readPulseSensor() {
  int signal = analogRead(PULSE_PIN);
  sampleCounter += PULSE_SAMPLE_MS;
  int N = sampleCounter - lastBeatTime;

  if (signal < thresh && N > (IBI / 5) * 3 && signal < T) T = signal;
  if (signal > thresh && signal > P) P = signal;

  if (N > 250 && signal > thresh && !Pulse && N > (IBI / 5) * 3) {
    Pulse = true;
    IBI = sampleCounter - lastBeatTime;
    lastBeatTime = sampleCounter;
    if (secondBeat) secondBeat = false;
    if (firstBeat) {
      firstBeat = false;
      secondBeat = true;
    } else {
      heartRate = 60000.0f / IBI;
      hrValid = true;
    }
  }

  if (signal < thresh && Pulse) {
    Pulse = false;
    amp = P - T;
    thresh = amp / 2 + T;
    P = thresh;
    T = thresh;
  }

  // No beat for 2.5 s: reset the detector.
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

  // Finger detection from the waveform amplitude over 200 ms windows.
  if (signal > pulseSignalPeak) pulseSignalPeak = signal;
  if (signal < pulseSignalTrough) pulseSignalTrough = signal;
  if (millis() - lastAmpUpdate > 200) {
    fingerDetected = (pulseSignalPeak - pulseSignalTrough) > PULSE_SIGNAL_MIN;
    pulseSignalPeak = 0;
    pulseSignalTrough = 4095;
    lastAmpUpdate = millis();
  }
}

// ===================== MPU6050 =====================
void writeMPU(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission(true);
}

bool initMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);                  // wake up
  if (Wire.endTransmission(true) != 0) return false;
  delay(100);
  writeMPU(0x1C, 0x00);              // accelerometer ±2 g
  writeMPU(0x1B, 0x00);              // gyro ±250 °/s
  writeMPU(0x1A, 0x03);              // digital low-pass filter ~44 Hz
  writeMPU(0x19, 19);                // sample rate 50 Hz
  return true;
}

void readMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6, true);
  if (Wire.available() < 6) return;
  int16_t rawAx = Wire.read() << 8 | Wire.read();
  int16_t rawAy = Wire.read() << 8 | Wire.read();
  int16_t rawAz = Wire.read() << 8 | Wire.read();
  float ax = rawAx / 16384.0f;
  float ay = rawAy / 16384.0f;
  float az = rawAz / 16384.0f;
  // Deviation of the acceleration magnitude from 1 g (gravity): ~0 when still.
  motionValue = fabsf(sqrtf(ax * ax + ay * ay + az * az) - 1.0f);
}

// ===================== GSR =====================
void readGSR() {
  long sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(GSR_PIN);
    delay(2);
  }
  int gsrRaw = sum / 10;
  gsrMicroSiemens = (gsrRaw / 4095.0f) * 10.0f;
  gsrOnSkin = gsrRaw > GSR_SKIN_MIN;
}

// ===================== Temperature =====================
void readTemperature() {
  if (!tempOK) {
    temperature = 0;
    tempOnSkin = false;
    return;
  }
  float t = tempSensor.getTempCByIndex(0);   // result of the conversion started one second ago
  tempSensor.requestTemperatures();          // start the next one
  if (t != DEVICE_DISCONNECTED_C && t > 0) {
    temperature = t;
    tempOnSkin = temperature >= TEMP_SKIN_MIN && temperature <= TEMP_SKIN_MAX;
  } else {
    temperature = 0;
    tempOnSkin = false;
  }
}

// ===================== Output =====================
void logContactChanges() {
  if (fingerDetected != prevFinger) {
    Serial.println(fingerDetected ? F("# Pulse sensor: finger detected") : F("# Pulse sensor: no finger"));
    prevFinger = fingerDetected;
  }
  if (gsrOnSkin != prevGsr) {
    Serial.println(gsrOnSkin ? F("# GSR: on skin") : F("# GSR: not on skin"));
    prevGsr = gsrOnSkin;
  }
  bool tempContact = tempOK && tempOnSkin;
  if (tempContact != prevTemp) {
    Serial.println(tempContact ? F("# DS18B20: on skin") : F("# DS18B20: not on skin"));
    prevTemp = tempContact;
  }
}

void printJson() {
  bool hrOk = fingerDetected && hrValid && heartRate > 0;
  bool tempContact = tempOK && tempOnSkin;
  bool dataValid = hrOk || gsrOnSkin || tempContact;

  char line[200];
  snprintf(line, sizeof(line),
           "{\"hr\":%.1f,\"gsr\":%.2f,\"temp\":%.1f,\"motion\":%.3f,\"dataValid\":%s,"
           "\"max30102\":%s,\"gsrConnected\":%s,\"ds18b20\":%s,\"mpu6050\":%s}",
           hrOk ? heartRate : 0.0f, gsrMicroSiemens, temperature, motionValue,
           dataValid ? "true" : "false",
           hrOk ? "true" : "false",
           gsrOnSkin ? "true" : "false",
           tempContact ? "true" : "false",
           mpuOK ? "true" : "false");
  Serial.println(line);

  // LED on while no sensor has skin contact.
  if (LED_PIN >= 0) digitalWrite(LED_PIN, dataValid ? LOW : HIGH);
}
