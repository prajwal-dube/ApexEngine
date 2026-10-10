#!/usr/bin/env bash
set -euo pipefail
mongosh --host mongo:27017 --quiet --eval '
try { rs.status(); } catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({_id:"rs0", members:[{_id:0, host:"mongo:27017"}]});
}'
for attempt in $(seq 1 60); do
  if mongosh --host mongo:27017 --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)' ; then exit 0; fi
  sleep 1
done
echo "MongoDB primary election timed out" >&2
exit 1
