#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ===================== Pin Definitions =====================
#define I2C_SDA         21
#define I2C_SCL         22
#define MPU_ADDR        0x68
#define GSR_PIN         34
#define PULSE_PIN       35
#define ONE_WIRE_BUS    4f

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

bool mpuOK = false;
bool tempOK = false;

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== SENSOR DIAGNOSTIC ===\n");

  // ---- I2C (MPU6050) ----
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Wire.beginTransmission(MPU_ADDR);
  mpuOK = (Wire.endTransmission() == 0);
  Serial.print("MPU6050 detected: ");
  Serial.println(mpuOK ? "YES" : "NO");
  if (mpuOK) initMPU6050();

  // ---- OneWire (DS18B20) ----
  tempSensor.begin();
  delay(100);
  int devCount = tempSensor.getDeviceCount();
  tempOK = (devCount > 0);
  Serial.print("DS18B20 devices found: ");
  Serial.println(devCount);
  if (!tempOK) Serial.println("  -> Check 4.7k pull-up resistor on GPIO4!");

  // ---- ADC setup ----
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.println("\nStarting readings...\n");
}

void loop() {
  // 1. MPU6050 Acceleration (raw)
  if (mpuOK) {
    int16_t ax, ay, az;
    readMPU6050Raw(ax, ay, az);
    Serial.printf("MPU: ax=%6d  ay=%6d  az=%6d  (1g ~ 16384)\n", ax, ay, az);
  }

  // 2. GSR raw ADC
  int gsrRaw = analogRead(GSR_PIN);
  float gsrMicroSiemens = (gsrRaw / 4095.0f) * 10.0f;
  Serial.printf("GSR: raw=%4d  => %.2f µS\n", gsrRaw, gsrMicroSiemens);

  // 3. Pulse raw ADC
  int pulseRaw = analogRead(PULSE_PIN);
  Serial.printf("Pulse: raw=%4d\n", pulseRaw);

  // 4. Temperature
  if (tempOK) {
    tempSensor.requestTemperatures();
    delay(10);
    float t = tempSensor.getTempCByIndex(0);
    if (t != DEVICE_DISCONNECTED_C && t > 0) {
      Serial.printf("Temp: %.1f °C\n", t);
    } else {
      Serial.println("Temp: --- (read error)");
    }
  } else {
    Serial.println("Temp: --- (sensor not found)");
  }

  Serial.println("----------------------------------------");
  delay(500);
}

// ---------- MPU6050 helpers ----------
bool initMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0x00);
  if (Wire.endTransmission(true) != 0) return false;
  delay(100);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C); Wire.write(0x00);
  Wire.endTransmission(true);
  // Set sample rate to 1kHz
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x19); Wire.write(19);
  Wire.endTransmission(true);
  return true;
}

void readMPU6050Raw(int16_t &ax, int16_t &ay, int16_t &az) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6, true);
  if (Wire.available() >= 6) {
    ax = Wire.read() << 8 | Wire.read();
    ay = Wire.read() << 8 | Wire.read();
    az = Wire.read() << 8 | Wire.read();
  }
}