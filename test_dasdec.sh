#!/bin/bash

# Target URL (Defaults to localhost if no argument is passed)
# Usage: ./test_dasdec_alert.sh https://the-cartoon-network-webchnl.onrender.com
SERVER_URL="${1:-http://localhost:10000}"
ENDPOINT="${SERVER_URL}/api/dasdec/cap-ingest"

echo "Sending mock DASDEC CAP XML alert to: ${ENDPOINT}"

curl -X POST "${ENDPOINT}" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>DASDEC-2026-0823-1200-RMT</identifier>
  <sender>DASDEC-EAS-INGEST@tvpass.org</sender>
  <sent>2026-08-23T12:00:00-04:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <category>Safety</category>
    <event>Required Monthly Test</event>
    <urgency>Unknown</urgency>
    <severity>Minor</severity>
    <certainty>Observed</certainty>
    <eventCode>
      <valueName>SAME</valueName>
      <value>RMT</value>
    </eventCode>
    <area>
      <areaDesc>Cuyahoga County, OH</areaDesc>
      <geocode>
        <valueName>SAME</valueName>
        <value>039035</value>
      </geocode>
    </area>
    <description>THIS IS A REQUIRED MONTHLY TEST OF THE EMERGENCY ALERT SYSTEM ISSUED BY THE DASDEC CAP INGEST ENGINE FOR NORTHEAST OHIO.</description>
  </info>
</alert>'

echo -e "\n\nAlert payload sent. Check server logs for active stream overlay execution."
