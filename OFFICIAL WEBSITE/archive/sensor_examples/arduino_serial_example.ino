void setup(){ Serial.begin(115200); }
void loop(){
  // Manuscript Table 1 baseline-range demo packet (MAX30102, GSR, DS18B20, MPU6050)
  Serial.println("{\"hr\":78,\"gsr\":1.05,\"temp\":34.2,\"motion\":0.04,\"max30102\":true,\"gsrConnected\":true,\"ds18b20\":true,\"mpu6050\":true}");
  delay(1000);
}
