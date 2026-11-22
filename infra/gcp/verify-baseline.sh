#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_ID="project-7efcc4c4-6c86-490c-ba5"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REQUIRED_SERVICES_FILE="${SCRIPT_DIR}/required-services.txt"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "error: gcloud is required" >&2
  exit 1
fi

project_state="$(
  gcloud projects describe "${PROJECT_ID}" \
    --project="${PROJECT_ID}" \
    --format='value(lifecycleState)' \
    --quiet
)"

if [[ "${project_state}" != "ACTIVE" ]]; then
  echo "error: ${PROJECT_ID} is not ACTIVE (state=${project_state:-unknown})" >&2
  exit 1
fi

enabled_services_file="$(mktemp)"
trap 'rm -f "${enabled_services_file}"' EXIT

gcloud services list \
  --enabled \
  --project="${PROJECT_ID}" \
  --limit=500 \
  --format='value(config.name)' \
  --quiet \
  | LC_ALL=C sort >"${enabled_services_file}"

missing=0
while IFS= read -r service; do
  [[ -z "${service}" || "${service}" == \#* ]] && continue
  if ! grep -Fqx "${service}" "${enabled_services_file}"; then
    echo "missing: ${service}" >&2
    missing=1
  fi
done <"${REQUIRED_SERVICES_FILE}"

if [[ "${missing}" -ne 0 ]]; then
  echo "error: required APIs are not fully enabled for ${PROJECT_ID}" >&2
  exit 1
fi

echo "ok: ${PROJECT_ID} is ACTIVE and all required APIs are enabled"
