
void setup(){ Serial.begin(115200); }
void loop(){
  Serial.println("{"hr":78,"gsr":2.75,"temp":36.7,"motion":28,"spo2":98,"bvp":72,"battery":95}");
  delay(1000);
}
