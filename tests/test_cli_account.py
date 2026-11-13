"""CLI account commands: password reset, password change, email verification.

No network and no mail: every case stops at argument validation, before a code
is ever requested. CUDIC_HOME is pointed at a temp dir so a developer's real
~/.cudic login cannot leak an email into a run that would otherwise send one.
"""
import os
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "cli", "cudic.mjs")

# Anything that would authenticate, or supply an email we did not ask for.
SCRUB = ("CUDIC_EMAIL", "CUDIC_TOKEN", "CUDIC_API_KEY", "CUDIC_PASSWORD", "CUDIC_HOME")


def run(home, *args):
    env = {k: v for k, v in os.environ.items() if k not in SCRUB}
    env["CUDIC_HOME"] = home
    return subprocess.run(
        ["node", CLI, *args],
        capture_output=True, text=True, env=env, timeout=60,
    )


class CliAccount(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def out(self, proc):
        return (proc.stdout or "") + (proc.stderr or "")

    def test_help_lists_account_commands(self):
        p = run(self.home, "help")
        self.assertEqual(p.returncode, 0, self.out(p))
        self.assertIn("cudic password reset", p.stdout)
        self.assertIn("cudic password change", p.stdout)
        self.assertIn("cudic verify", p.stdout)

    def test_reset_without_email_says_which_flag(self):
        p = run(self.home, "password", "reset")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("give the account email", self.out(p))

    def test_short_code_is_rejected_before_any_mail(self):
        p = run(self.home, "password", "reset",
                "--email", "someone@example.com", "--code", "12", "--password", "abcdef")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("6 digits", self.out(p))

    def test_short_password_is_rejected(self):
        p = run(self.home, "password", "reset",
                "--email", "someone@example.com", "--code", "123456", "--password", "abc")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("6-72 characters", self.out(p))

    def test_unknown_subcommand_prints_usage(self):
        p = run(self.home, "password", "wat", "--email", "a@b.co")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("usage: cudic password", self.out(p))

    def test_verify_without_email_says_which_flag(self):
        p = run(self.home, "verify")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("give the email", self.out(p))


if __name__ == "__main__":
    unittest.main()
