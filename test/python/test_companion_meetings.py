import ast
import datetime
import json
import os
import re
import unittest

from harness import FakeDateTime, Row, read_script, run_script, script_version, with_version

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")
FIXTURE = os.path.join(FIXTURES, "windows-result.json")
VERSION = script_version()


def reservation_rows():
    def dt(hour, minute=0):
        return FakeDateTime(datetime.datetime(2026, 10, 4, hour, minute))

    return [
        Row(ReservationId=11, ReservableId=3, MeetingId=7, Name="Choir ½ Rehearsal",
            MeetingStart=dt(17), MeetingEnd=dt(18), SetupMinutes=15, TeardownMinutes=5),
        Row(ReservationId=12, ReservableId=4, MeetingId=8, Name="Youth",
            MeetingStart=dt(19), MeetingEnd=dt(20, 30), SetupMinutes=0, TeardownMinutes=0),
    ]


def next_patch_version():
    major, minor, patch = (int(n) for n in VERSION.split("-")[0].split("."))
    return "{}.{}.{}".format(major, minor, patch + 1)


def newer_script(version=None):
    return with_version(version or next_patch_version())


class RoomsTest(unittest.TestCase):
    def test_lists_rooms_with_their_parents(self):
        rooms = [
            Row(ReservableId=1, ParentId=None, ReservableTypeId=1, Name="Building", IsReservable=False),
            Row(ReservableId=2, ParentId=1, ReservableTypeId=1, Name="Room ½", IsReservable=True),
        ]
        run = run_script({"a": "rooms"}, reservables=rooms)

        self.assertTrue(run.result["ok"])
        self.assertEqual(run.result["rooms"], [
            {"id": 1, "parentId": None, "typeId": 1, "name": "Building", "reservable": False},
            {"id": 2, "parentId": 1, "typeId": 1, "name": "Room ½", "reservable": True},
        ])

    def test_only_enabled_rooms_that_are_not_deleted(self):
        run = run_script({"a": "rooms"})
        self.assertIn("IsDeleted = 0", run.q.sql[0])
        self.assertIn("IsEnabled = 1", run.q.sql[0])


class WindowsTest(unittest.TestCase):
    def test_result_matches_the_documented_contract(self):
        # The TypeScript client is tested against this same fixture, so the two sides can't drift apart unnoticed.
        run = run_script({"a": "windows", "rooms": "3,4"}, reservations=reservation_rows())

        with open(FIXTURE, encoding="utf-8") as f:
            expected = json.load(f)
        expected["scriptVersion"] = VERSION  # the script's version is the module's, so the fixture can't fix it
        self.assertEqual(run.result, expected)

    def test_no_rooms_means_no_query(self):
        run = run_script({"a": "windows", "rooms": ""})
        self.assertEqual(run.result["windows"], [])
        self.assertEqual(run.q.sql, [])

    def test_room_ids_are_numbers_only(self):
        run = run_script({"a": "windows", "rooms": "3, 4,3,x,5;DROP TABLE People,-1,6"})

        sql = run.q.sql[0]
        self.assertIn("IN (3,4,6)", sql)
        self.assertNotIn("DROP", sql)

    def test_too_many_rooms_is_refused(self):
        run = run_script({"a": "windows", "rooms": ",".join(str(n) for n in range(501))})

        self.assertFalse(run.result["ok"])
        self.assertIn("too many rooms", run.result["error"])
        self.assertEqual(run.q.sql, [])

    def test_range_defaults_and_limits(self):
        sql = run_script({"a": "windows", "rooms": "3"}).q.sql[0]
        self.assertIn("DATEADD(MINUTE, 1440,", sql)
        self.assertIn("DATEADD(MINUTE, -60,", sql)

        sql = run_script({"a": "windows", "rooms": "3", "back": "99999", "ahead": "-5"}).q.sql[0]
        self.assertIn("DATEADD(MINUTE, -10080,", sql)  # clamped to a week
        self.assertIn("DATEADD(MINUTE, 1,", sql)  # at least a minute ahead

        sql = run_script({"a": "windows", "rooms": "3", "back": "abc", "ahead": "1e5"}).q.sql[0]
        self.assertIn("DATEADD(MINUTE, -60,", sql)  # garbage falls back to the default
        self.assertIn("DATEADD(MINUTE, 1440,", sql)

    def test_canceled_meetings_are_left_out(self):
        self.assertIn("m.Canceled = 0", run_script({"a": "windows", "rooms": "3"}).q.sql[0])


class TimeZoneTest(unittest.TestCase):
    # Reservation times are in the church's local zone; the database and server are in another (typically Central).
    # The script must use TouchPoint's LocalTimeZone setting, and never the database's clock.

    def test_never_uses_the_database_clock(self):
        self.assertNotIn("GETDATE", run_script({"a": "windows", "rooms": "3"}).q.sql[0].upper())

    def test_uses_the_local_time_zone_setting(self):
        run = run_script({"a": "windows", "rooms": "3"}, settings={"LocalTimeZone": "Eastern Standard Time"})
        self.assertEqual(run.result["now"], "2026-10-04T17:30:00")
        self.assertEqual(run.result["utcOffsetMinutes"], -240)
        self.assertIn("CAST('2026-10-04T17:30:00' AS DATETIME)", run.q.sql[0])

        run = run_script({"a": "windows", "rooms": "3"}, settings={"LocalTimeZone": "Pacific Standard Time"})
        self.assertEqual(run.result["now"], "2026-10-04T14:30:00")
        self.assertEqual(run.result["utcOffsetMinutes"], -420)

    def test_defaults_to_central_like_touchpoint(self):
        run = run_script({"a": "windows", "rooms": "3"}, settings={})
        self.assertEqual(run.result["now"], "2026-10-04T16:30:00")
        self.assertEqual(run.result["utcOffsetMinutes"], -300)

    def test_an_unknown_time_zone_falls_back_to_the_servers(self):
        run = run_script({"a": "windows", "rooms": "3"}, settings={"LocalTimeZone": "Narnia Standard Time"})
        self.assertTrue(run.result["ok"])
        self.assertEqual(run.result["utcOffsetMinutes"], -300)  # TimeZoneInfo.Local in the harness


class DispatchTest(unittest.TestCase):
    def test_opened_in_a_browser_it_says_it_is_ready(self):
        run = run_script({})

        self.assertIn("installed and ready", run.printed)
        self.assertIn("version " + VERSION, run.printed)
        self.assertEqual(run.model.Title, "Companion Meetings")
        self.assertIsNone(run.data.result)

    def test_unknown_action_is_an_error_result(self):
        run = run_script({"a": "frobnicate"})
        self.assertFalse(run.result["ok"])
        self.assertEqual(run.result["error"], "unknown action")

    def test_action_names_are_case_insensitive(self):
        self.assertTrue(run_script({"a": " ROOMS "}).result["ok"])

    def test_failures_are_reported_not_raised(self):
        # The row is missing the columns the script needs.
        run = run_script({"a": "rooms"}, reservables=[Row(Nope=1)])

        self.assertFalse(run.result["ok"])
        self.assertIn("AttributeError", run.result["error"])

    def test_every_result_reports_the_script_version(self):
        for parameters in ({"a": "rooms"}, {"a": "windows"}, {"a": "nope"}):
            self.assertEqual(run_script(parameters).result["scriptVersion"], VERSION)


class UpdateScriptTest(unittest.TestCase):
    def update(self, content, method="post", installed=None, **kwargs):
        """Sends a script to the installed one, which is this script, or this script made to have the version given."""
        source = with_version(installed) if installed else None
        return run_script({"a": "updateScript", "content": content}, method=method, source=source, **kwargs)

    def test_installs_a_newer_version_over_itself(self):
        source = newer_script("9.8.7")
        run = self.update(source, script_name="CompanionMeetings")

        self.assertTrue(run.result["ok"])
        self.assertEqual(run.result["updatedFrom"], VERSION)
        self.assertEqual(run.result["updatedTo"], "9.8.7")
        self.assertEqual(run.model.written, [("CompanionMeetings", source, "Companion")])

    def test_versions_are_compared_as_versions_not_as_text(self):
        self.assertTrue(self.update(newer_script("0.10.0"), installed="0.9.0").result["ok"])
        self.assertTrue(self.update(newer_script("1.0.10"), installed="1.0.9").result["ok"])
        self.assertTrue(self.update(newer_script("10.0.0"), installed="9.0.0").result["ok"])

    def test_refuses_the_same_or_an_older_version(self):
        for installed, offered in (("1.2.3", "1.2.3"), ("1.2.3", "1.2.2"), ("1.2.3", "0.99.99"), ("1.2.3", "1.2.3-rc.1")):
            run = self.update(newer_script(offered), installed=installed)
            self.assertFalse(run.result["ok"], offered)
            self.assertIn("not newer", run.result["error"])
            self.assertEqual(run.model.written, [])

    def test_a_pre_release_can_be_replaced_by_its_release_or_a_later_pre_release(self):
        for offered in ("1.2.3", "1.2.3-beta.2", "1.2.3-rc.1", "1.3.0-alpha"):
            run = self.update(newer_script(offered), installed="1.2.3-beta.1")
            self.assertTrue(run.result["ok"], offered)

    def test_a_release_is_never_replaced_by_a_pre_release_of_it(self):
        run = self.update(newer_script("1.2.3-rc.9"), installed="1.2.3")
        self.assertFalse(run.result["ok"])

    def test_refuses_anything_but_post(self):
        run = self.update(newer_script(), method="get")
        self.assertFalse(run.result["ok"])
        self.assertEqual(run.model.written, [])

    def test_refuses_a_script_that_would_break_the_api_or_updating(self):
        good = newer_script()
        bad = {
            "empty": "",
            "not an API script": good.replace("#API", "# API", 1),
            "leading whitespace": "\n" + good,
            "can't update itself": good.replace("updateScript", "update_script").replace("updatescript", "x"),
            "no version": re.sub(r'^VERSION = .*$', "", good, flags=re.M),
            "malformed version": re.sub(r'^VERSION = .*$', 'VERSION = "one"', good, flags=re.M),
            "not a full version": re.sub(r'^VERSION = .*$', 'VERSION = "9.9"', good, flags=re.M),
            "huge": good + "#" * 200001,
        }
        for label, content in bad.items():
            run = self.update(content)
            self.assertFalse(run.result["ok"], label)
            self.assertEqual(run.model.written, [], label)

    def test_a_script_that_installs_must_itself_be_installable(self):
        # Catches the easy mistake of changing the script so that it can no longer be updated, which would strand
        # every installed copy.
        source = read_script()
        self.assertTrue(source.startswith("#API"))
        self.assertIn("updateScript", source)
        self.assertRegex(source, r'(?m)^VERSION = "[^"]+"')


class VersionTest(unittest.TestCase):
    """The script compares versions for itself, and the module does too.  Both must agree, so both run these cases."""

    @classmethod
    def setUpClass(cls):
        namespace = run_script({}).namespace
        cls.parse = staticmethod(namespace["parse_version"])
        cls.compare = staticmethod(namespace["compare_versions"])
        with open(os.path.join(FIXTURES, "version-comparisons.json"), encoding="utf-8") as f:
            cls.cases = json.load(f)

    def test_what_is_a_version(self):
        for text in self.cases["valid"]:
            self.assertIsNotNone(self.parse(text), text)
        for text in self.cases["invalid"]:
            self.assertIsNone(self.parse(text), repr(text))

    def test_which_is_newer(self):
        for a, b, expected in self.cases["comparisons"]:
            result = self.compare(self.parse(a), self.parse(b))
            self.assertEqual((result > 0) - (result < 0), expected, "{} against {}".format(a, b))

    def test_the_script_has_a_version_of_its_own(self):
        self.assertIsNotNone(self.parse(VERSION), VERSION)


class PythonTwoCompatibilityTest(unittest.TestCase):
    """TouchPoint runs scripts with IronPython 2.7.  These tests run under Python 3, so rule out what 2.7 can't parse."""

    def setUp(self):
        self.tree = ast.parse(read_script())

    def test_no_syntax_added_after_python_2(self):
        banned = {
            ast.JoinedStr: "f-strings",
            ast.AnnAssign: "variable annotations",
            ast.Nonlocal: "nonlocal",
            ast.AsyncFunctionDef: "async",
            ast.Await: "await",
            ast.YieldFrom: "yield from",
            ast.Starred: "star-expressions",
            ast.NamedExpr: "the walrus operator",
        }
        for node in ast.walk(self.tree):
            for kind, label in banned.items():
                self.assertNotIsInstance(node, kind, "{} (line {})".format(label, getattr(node, "lineno", "?")))
            if isinstance(node, (ast.FunctionDef, ast.Lambda)):
                self.assertEqual(node.args.kwonlyargs, [], "keyword-only arguments")
                if isinstance(node, ast.FunctionDef):
                    self.assertIsNone(node.returns, "return annotations")
                    for arg in node.args.args:
                        self.assertIsNone(arg.annotation, "argument annotations")

    def test_print_takes_one_argument(self):
        # print(a, b) is a tuple in Python 2, and keywords like end= don't exist.
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "print":
                self.assertEqual(len(node.args), 1)
                self.assertEqual(node.keywords, [])

    def test_no_non_ascii_source(self):
        # Python 2 needs a coding declaration for these, and TouchPoint's way of storing scripts may not preserve them.
        read_script().encode("ascii")


if __name__ == "__main__":
    unittest.main()
