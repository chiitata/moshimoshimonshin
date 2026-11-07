"""Inspect Auth configuration, or explicitly enable TOTP in the single project."""

import argparse
import copy
import json
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT_ID = "project-7efcc4c4-6c86-490c-ba5"
CONFIG_URL = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT_ID}/config"
UPDATE_MASK = "mfa.state,mfa.providerConfigs"


def totp_patch(config):
    """Keep other factors and mandatory policy; never replace the full config."""
    mfa = copy.deepcopy(config.get("mfa", {}))
    state = mfa.get("state", "DISABLED")
    if state not in {"DISABLED", "ENABLED", "MANDATORY"}:
        raise ValueError("Unrecognized MFA state; inspect with the Auth administrator")
    providers = mfa.get("providerConfigs", [])
    if not isinstance(providers, list):
        raise ValueError("Invalid MFA provider configuration")
    totp = [p for p in providers if "totpProviderConfig" in p]
    if len(totp) > 1:
        raise ValueError("Multiple TOTP providers; inspect with the Auth administrator")
    if totp:
        # An existing clock-skew policy is an operator decision, not a default.
        provider_state = totp[0].get("state", "DISABLED")
        if provider_state not in {"DISABLED", "ENABLED", "MANDATORY"}:
            raise ValueError("Unrecognized TOTP state")
        if state != "DISABLED" and provider_state in {"ENABLED", "MANDATORY"}:
            return None
        totp[0]["state"] = "ENABLED" if provider_state == "DISABLED" else provider_state
    else:
        providers.append({"state": "ENABLED", "totpProviderConfig": {"adjacentIntervals": 1}})
    return {"mfa": {"state": "ENABLED" if state == "DISABLED" else state,
                    "providerConfigs": providers}}


def summary(config):
    mfa = config.get("mfa", {})
    return {
        "identity_platform_enabled": config.get("subtype") == "IDENTITY_PLATFORM",
        "email_password_enabled": bool(
            config.get("signIn", {}).get("email", {}).get("enabled", False)
            and config.get("signIn", {}).get("email", {}).get("passwordRequired", False)
        ),
        "mfa_state": mfa.get("state", "DISABLED"),
        "totp_enabled": mfa.get("state") in {"ENABLED", "MANDATORY"} and any(
            p.get("state") in {"ENABLED", "MANDATORY"} and "totpProviderConfig" in p
            for p in mfa.get("providerConfigs", [])
        ),
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Auth API redirect refused")


def request_config(token, patch=None):
    url = CONFIG_URL + (f"?updateMask={UPDATE_MASK}" if patch is not None else "")
    req = urllib.request.Request(
        url, method="PATCH" if patch is not None else "GET",
        headers={"Authorization": f"Bearer {token}", "X-Goog-User-Project": PROJECT_ID,
                 "Content-Type": "application/json"},
        data=json.dumps(patch).encode() if patch is not None else None,
    )
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=30) as response:
        return json.load(response)


def configure(fetch, enable=False):
    current = fetch()
    if enable:
        if current.get("subtype") != "IDENTITY_PLATFORM":
            raise ValueError("Identity Platform upgrade is required; this tool never changes the billing tier")
        patch = totp_patch(current)
        if patch is not None:
            fetch(patch)
        # Independent readback, including on an idempotent re-run.
        current = fetch()
        if not summary(current)["totp_enabled"]:
            raise ValueError("TOTP readback failed; do not treat configuration as complete")
    return summary(current)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, choices=[PROJECT_ID])
    parser.add_argument("--enable-totp", action="store_true", help="Apply only MFA state/provider changes")
    args = parser.parse_args(argv)
    try:
        result = subprocess.run(
            ["gcloud", "auth", "print-access-token", "--project", args.project],
            check=False, capture_output=True, text=True, timeout=30,
        )
        if result.returncode or not result.stdout.strip():
            raise ValueError("gcloud authentication failed; credentials and stderr are not logged")
        token = result.stdout.strip()
        print(json.dumps(configure(lambda patch=None: request_config(token, patch), args.enable_totp)))
    except urllib.error.HTTPError as error:
        print(f"Auth configuration failed: HTTP {error.code}; response body is not logged", file=sys.stderr)
        return 1
    except (ValueError, OSError, subprocess.TimeoutExpired):
        print("Auth configuration failed; inspect access/network and configuration with the administrator", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
