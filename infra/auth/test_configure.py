import contextlib
import copy
import io
import json
import unittest
import urllib.error
from unittest.mock import Mock, patch

import configure as auth_config


class AuthConfigurationTests(unittest.TestCase):
    def test_email_link_only_is_not_password_auth(self):
        self.assertFalse(auth_config.summary({"signIn": {"email": {"enabled": True}}})["email_password_enabled"])
        self.assertTrue(auth_config.summary({"signIn": {"email": {
            "enabled": True, "passwordRequired": True}}})["email_password_enabled"])

    def test_read_only_default_and_no_sensitive_output(self):
        fetch = Mock(return_value={"authorizedDomains": ["private.test"], "client": {"apiKey": "SECRET"}})
        result = auth_config.configure(fetch)
        fetch.assert_called_once_with()
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("private.test", json.dumps(result))

    def test_enable_preserves_other_factors_and_does_not_mutate_input(self):
        current = {"mfa": {"state": "DISABLED", "enabledProviders": ["PHONE_SMS"],
                           "providerConfigs": [{"phoneProviderConfig": {}, "state": "ENABLED"}]},
                   "authorizedDomains": ["approved.test"], "signIn": {"email": {"enabled": True}}}
        before = copy.deepcopy(current)
        result = auth_config.totp_patch(current)
        self.assertEqual(current, before)
        self.assertEqual(set(result), {"mfa"})
        self.assertEqual(set(result["mfa"]), {"state", "providerConfigs"})
        self.assertEqual(result["mfa"]["providerConfigs"][0], current["mfa"]["providerConfigs"][0])
        self.assertEqual(result["mfa"]["providerConfigs"][1]["totpProviderConfig"]["adjacentIntervals"], 1)
        # SMS enabledProviders is deliberately outside the update mask.
        self.assertNotIn("enabledProviders", result["mfa"])

    def test_preserves_mandatory_policy_and_existing_clock_policy(self):
        result = auth_config.totp_patch({"mfa": {"state": "MANDATORY", "providerConfigs": [
            {"state": "DISABLED", "totpProviderConfig": {"adjacentIntervals": 0}}]}})
        self.assertEqual(result["mfa"]["state"], "MANDATORY")
        self.assertEqual(result["mfa"]["providerConfigs"][0]["totpProviderConfig"]["adjacentIntervals"], 0)

    def test_idempotent_enable_still_reads_back(self):
        current = {"subtype": "IDENTITY_PLATFORM", "mfa": {"state": "ENABLED", "providerConfigs": [
            {"state": "ENABLED", "totpProviderConfig": {"adjacentIntervals": 1}}]}}
        fetch = Mock(return_value=current)
        self.assertTrue(auth_config.configure(fetch, True)["totp_enabled"])
        self.assertEqual(fetch.call_args_list, [unittest.mock.call(), unittest.mock.call()])

    def test_failed_readback_is_not_success(self):
        fetch = Mock(side_effect=[{"subtype": "IDENTITY_PLATFORM"}, {}, {}])
        with self.assertRaises(ValueError):
            auth_config.configure(fetch, True)

    def test_apply_then_independent_readback(self):
        current = {"subtype": "IDENTITY_PLATFORM", "mfa": {"state": "DISABLED"}}
        updated = {"subtype": "IDENTITY_PLATFORM", **auth_config.totp_patch(current)}
        fetch = Mock(side_effect=[current, {}, updated])
        self.assertTrue(auth_config.configure(fetch, True)["totp_enabled"])
        self.assertEqual(fetch.call_args_list, [unittest.mock.call(),
                         unittest.mock.call(auth_config.totp_patch(current)), unittest.mock.call()])

    def test_does_not_upgrade_identity_platform(self):
        fetch = Mock(return_value={"subtype": "FIREBASE_AUTH"})
        with self.assertRaises(ValueError):
            auth_config.configure(fetch, True)
        fetch.assert_called_once_with()

    def test_unknown_state_and_duplicate_provider_are_rejected(self):
        for current in [{"mfa": {"state": "FUTURE_POLICY"}},
                        {"mfa": {"providerConfigs": [{"totpProviderConfig": {}}, {"totpProviderConfig": {}}]}},
                        {"mfa": {"providerConfigs": [{"state": "FUTURE_POLICY", "totpProviderConfig": {}}]}}]:
            with self.subTest(current=current), self.assertRaises(ValueError):
                auth_config.totp_patch(current)

    def test_wrong_project_is_rejected_before_credentials_or_network(self):
        with patch.object(auth_config.subprocess, "run") as run:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                auth_config.main(["--project", "other-project", "--enable-totp"])
            run.assert_not_called()

    def test_http_failure_does_not_log_credentials_or_response_body(self):
        token = Mock(returncode=0, stdout="SECRET", stderr="SECRET")
        error = urllib.error.HTTPError("https://example.test", 403, "SECRET", {}, io.BytesIO(b"SECRET"))
        with patch.object(auth_config.subprocess, "run", return_value=token), \
                patch.object(auth_config, "request_config", side_effect=error):
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                self.assertEqual(auth_config.main(["--project", auth_config.PROJECT_ID]), 1)
            self.assertIn("403", output.getvalue())
            self.assertNotIn("SECRET", output.getvalue())

    def test_transport_uses_narrow_patch_mask_and_explicit_project(self):
        response = Mock()
        response.__enter__ = Mock(return_value=io.StringIO('{}'))
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(auth_config.urllib.request, "build_opener", return_value=opener):
            auth_config.request_config("SECRET", {"mfa": {"state": "ENABLED"}})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "PATCH")
        self.assertTrue(request.full_url.endswith("?updateMask=mfa.state,mfa.providerConfigs"))
        self.assertEqual(request.get_header("X-goog-user-project"), auth_config.PROJECT_ID)
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 30)


if __name__ == "__main__":
    unittest.main()
