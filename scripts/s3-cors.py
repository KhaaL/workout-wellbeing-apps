#!/usr/bin/env python3
"""Generate reviewed S3-compatible CORS XML from s3cmd info; never contact the server."""

import argparse
import pathlib
import re
import xml.etree.ElementTree as ET

ALLOWED_HEADERS = [
    "authorization", "content-type", "x-amz-content-sha256", "x-amz-date",
    "if-match", "if-none-match",
]


def update(info, origins):
    match = re.search(r"^\s*CORS:\s*(.*)$", info, re.M)
    if not match:
        raise ValueError("Could not read CORS; check credentials and bucket before continuing.")
    raw = match.group(1).strip()
    if raw.lower() == "none":
        raw = '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/" />'
    root = ET.fromstring(raw)
    if root.tag.split("}")[-1] != "CORSConfiguration":
        raise ValueError("Unexpected CORS XML; nothing generated.")
    namespace = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    if namespace:
        ET.register_namespace("", namespace[1:-1])
    # Keep the previous configuration independently of the generated update.
    before = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    for rule in list(root):
        for node in list(rule.findall(namespace + "AllowedOrigin")):
            if node.text in origins:
                rule.remove(node)
        if not rule.findall(namespace + "AllowedOrigin"):
            root.remove(rule)
    for origin in dict.fromkeys(origins):
        rule = ET.SubElement(root, namespace + "CORSRule")
        for name, value in [
            ("AllowedOrigin", origin),
            ("AllowedMethod", "GET"),
            ("AllowedMethod", "PUT"),
            ("AllowedMethod", "DELETE"),
            *(("AllowedHeader", header) for header in ALLOWED_HEADERS),
            ("ExposeHeader", "ETag"),
            ("MaxAgeSeconds", "3600"),
        ]:
            ET.SubElement(rule, namespace + name).text = value
    ET.indent(root)
    return before, ET.tostring(root, encoding="utf-8", xml_declaration=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("info", type=pathlib.Path, help="Saved output from s3cmd info")
    parser.add_argument("output", type=pathlib.Path, help="New CORS XML to review before setcors")
    parser.add_argument("--origin", action="append", required=True, help="Exact HTTPS app origin; repeat for each app")
    args = parser.parse_args()
    origins = args.origin
    for origin in origins:
        if not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?", origin):
            parser.error("Origins must be HTTPS origins without a path, trailing slash or wildcard.")
    try:
        before, updated = update(args.info.read_text(), origins)
        previous = args.output.with_name(args.output.stem + ".before.xml")
        if previous.exists() or args.output.exists():
            raise ValueError("Output already exists. Use a fresh directory to retain previous configurations.")
        with previous.open("xb") as saved:
            saved.write(before)
        with args.output.open("xb") as saved:
            saved.write(updated)
    except (OSError, ValueError, ET.ParseError) as error:
        parser.exit(1, str(error) + "\n")
    print(f"Previous CORS: {previous}\nReview before applying: {args.output}")


if __name__ == "__main__":
    main()
