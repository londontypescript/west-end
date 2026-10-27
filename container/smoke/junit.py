"""Checks a gdUnit4 JUnit report: exactly one test suite holding exactly one
test case, which ran and passed, with every total in agreement (one test,
no failures, errors or skips). Run with python3 -I; prints a summary.

    python3 -I junit.py <results.xml>
"""

import sys
import xml.etree.ElementTree as ElementTree


def fail(message):
    print(f"FAIL gdunit: {message}", file=sys.stderr)
    sys.exit(1)


def require_totals(element, label, required):
    """Each named total must be present and equal its expected value."""
    for attribute, expected in required.items():
        value = element.get(attribute)
        if value != expected:
            fail(f"{label} has {attribute}={value!r}, expected {expected!r}")


def main():
    if len(sys.argv) != 2:
        fail("usage: junit.py <results.xml>")
    root = ElementTree.parse(sys.argv[1]).getroot()
    if root.tag != "testsuites":
        fail(f"report root is <{root.tag}>, expected <testsuites>")
    # gdUnit4 writes no errors total at the top level, so it is checked on
    # the suite, where it is written.
    require_totals(
        root, "<testsuites>", {"tests": "1", "failures": "0", "skipped": "0"}
    )
    if root.get("errors") not in (None, "0"):
        fail(f"<testsuites> has errors={root.get('errors')!r}")

    suites = root.findall("testsuite")
    if len(suites) != 1:
        fail(f"expected exactly one <testsuite>, found {len(suites)}")
    suite = suites[0]
    require_totals(
        suite,
        "<testsuite>",
        {"tests": "1", "failures": "0", "errors": "0", "skipped": "0"},
    )

    cases = root.findall(".//testcase")
    if len(cases) != 1:
        fail(f"expected exactly one <testcase>, found {len(cases)}")
    case = cases[0]
    if case not in list(suite):
        fail("the test case is not inside the test suite")
    name = case.get("name", "")
    for outcome in ("skipped", "failure", "error"):
        if case.find(outcome) is not None:
            fail(f"test case {name!r} has <{outcome}>: it did not run and pass")

    print(f"{name} ran and passed; 1 test, 0 failures, 0 errors, 0 skipped")


main()
