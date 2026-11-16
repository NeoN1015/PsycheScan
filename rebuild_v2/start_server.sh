#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -z "${PSYCHESCAN_OPERATOR_PASSWORD:-}" ]; then
  PSYCHESCAN_OPERATOR_PASSWORD="$(python3 -c 'import getpass; print(getpass.getpass("Set operator password: "))')"
  export PSYCHESCAN_OPERATOR_PASSWORD
fi
python3 server.py
