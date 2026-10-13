"""CORS generation, preservation and CLI failure paths; no live S3 calls."""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/s3-cors.py"
SPEC = importlib.util.spec_from_file_location("s3_cors", SCRIPT)
cors = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cors)
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
ORIGINS = ["https://liftlog.example.org", "https://bike.example.org"]


class CorsTests(unittest.TestCase):
    def test_new_rules_explicitly_allow_all_signed_request_headers(self):
        before, updated = cors.update("CORS: none\n", ORIGINS)
        self.assertEqual(len(ET.fromstring(before)), 0)
        rules = ET.fromstring(updated).findall(NS + "CORSRule")
        self.assertEqual(len(rules), 2)
        for rule, origin in zip(rules, ORIGINS):
            self.assertEqual(rule.findtext(NS + "AllowedOrigin"), origin)
            self.assertEqual([n.text for n in rule.findall(NS + "AllowedHeader")], cors.ALLOWED_HEADERS)
            self.assertEqual([n.text for n in rule.findall(NS + "AllowedMethod")], ["GET", "PUT", "DELETE"])
            self.assertEqual(rule.findtext(NS + "ExposeHeader"), "ETag")

    def test_unrelated_and_mixed_origin_rules_and_rollback_are_preserved(self):
        root = ET.Element(NS + "CORSConfiguration")
        mixed = ET.SubElement(root, NS + "CORSRule")
        for origin in [ORIGINS[0], "https://other.example.org"]:
            ET.SubElement(mixed, NS + "AllowedOrigin").text = origin
        ET.SubElement(mixed, NS + "AllowedMethod").text = "HEAD"
        ET.SubElement(mixed, NS + "AllowedHeader").text = "x-custom"
        raw = ET.tostring(root, encoding="unicode")
        before, updated = cors.update("CORS: " + raw, ORIGINS)
        self.assertEqual(ET.tostring(ET.fromstring(before)), ET.tostring(root))
        kept = ET.fromstring(updated)[0]
        self.assertEqual([n.text for n in kept.findall(NS + "AllowedOrigin")], ["https://other.example.org"])
        self.assertEqual(kept.findtext(NS + "AllowedMethod"), "HEAD")
        self.assertEqual(kept.findtext(NS + "AllowedHeader"), "x-custom")

    def test_duplicate_origins_do_not_duplicate_rules(self):
        _, updated = cors.update("CORS: none", ORIGINS * 2)
        self.assertEqual(len(ET.fromstring(updated)), 2)

    def test_cli_keeps_original_files_and_rejects_unsafe_origins(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            info, output = folder / "info.txt", folder / "cors.xml"
            info.write_text("CORS: none\n")
            run = lambda *args: subprocess.run([sys.executable, str(SCRIPT), str(info), str(output), *args], capture_output=True, text=True)
            self.assertNotEqual(run("--origin", "https://example.org/path").returncode, 0)
            self.assertFalse(output.exists())
            self.assertNotEqual(run().returncode, 0)
            args = [arg for origin in ORIGINS for arg in ["--origin", origin]]
            self.assertEqual(run(*args).returncode, 0)
            original, rollback = output.read_bytes(), output.with_name("cors.before.xml").read_bytes()
            self.assertNotEqual(run(*args).returncode, 0)
            self.assertEqual(output.read_bytes(), original)
            self.assertEqual(output.with_name("cors.before.xml").read_bytes(), rollback)

    def test_invalid_input_never_produces_configuration(self):
        for raw in ["ERROR: denied", "CORS: <broken", "CORS: <SomethingElse />"]:
            with self.assertRaises((ValueError, ET.ParseError)):
                cors.update(raw, ORIGINS)


if __name__ == "__main__":
    unittest.main()
