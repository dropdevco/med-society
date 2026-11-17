#!/usr/bin/env bash
# Removes the sandbox and everything in it.
docker rm -f ms-sandbox-db ms-sandbox-api >/dev/null 2>&1
docker network rm ms-sandbox >/dev/null 2>&1
echo "sandbox removed"
