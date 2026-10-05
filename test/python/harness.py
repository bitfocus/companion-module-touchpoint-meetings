"""
Runs touchpoint/CompanionMeetings.py outside of TouchPoint.

The script expects TouchPoint's globals (model, Data, q) and .NET's System types, which TouchPoint's IronPython provides.
Here they are replaced with small fakes, so that the real script source is what's tested.
"""
import contextlib
import datetime
import io
import os
import sys
import types

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "touchpoint", "CompanionMeetings.py")

TIME_ZONES = {  # Windows time zone id -> UTC offset in minutes (as of the fixed "now" used in tests).
    "Eastern Standard Time": -240,
    "Central Standard Time": -300,
    "Pacific Standard Time": -420,
}
LOCAL_OFFSET_MINUTES = -300  # TimeZoneInfo.Local


def read_script():
    with open(SCRIPT_PATH, encoding="utf-8") as f:
        return f.read()


def script_version():
    """The VERSION the script declares, which is the version of the module that carries it."""
    import re
    return re.search(r'^VERSION = "([^"]+)"', read_script(), re.MULTILINE).group(1)


def with_version(version, source=None):
    """The script, as it would be if its VERSION were different."""
    import re
    source = source if source is not None else read_script()
    return re.sub(r'^VERSION = "[^"]*"$', 'VERSION = "{}"'.format(version), source, flags=re.MULTILINE)


class FakeDateTime(object):
    """A .NET DateTime, as far as the script uses it."""

    def __init__(self, dt):
        self.dt = dt

    def ToString(self, fmt):
        assert fmt == "yyyy-MM-ddTHH:mm:ss", "unexpected format " + fmt
        return self.dt.strftime("%Y-%m-%dT%H:%M:%S")


class FakeTimeSpan(object):
    def __init__(self, minutes):
        self.TotalMinutes = float(minutes)


class FakeTimeZone(object):
    def __init__(self, offset_minutes):
        self.offset_minutes = offset_minutes

    def GetUtcOffset(self, _utc):
        return FakeTimeSpan(self.offset_minutes)


def install_fake_system(utc_now):
    class TimeZoneInfo(object):
        Local = FakeTimeZone(LOCAL_OFFSET_MINUTES)

        @staticmethod
        def FindSystemTimeZoneById(zone_id):
            if zone_id not in TIME_ZONES:
                raise Exception("The time zone ID '{}' was not found".format(zone_id))
            return FakeTimeZone(TIME_ZONES[zone_id])

        @staticmethod
        def ConvertTimeFromUtc(utc, tz):
            return FakeDateTime(utc.dt + datetime.timedelta(minutes=tz.offset_minutes))

    class DateTime(object):
        UtcNow = FakeDateTime(utc_now)

    module = types.ModuleType("System")
    module.DateTime = DateTime
    module.TimeZoneInfo = TimeZoneInfo
    sys.modules["System"] = module


class FakeData(object):
    """TouchPoint's dynamic Data object: parameters in, anything out.  Unset attributes are None."""

    def __init__(self, parameters):
        self.__dict__["_values"] = dict(parameters)

    def __getattr__(self, name):
        return self.__dict__["_values"].get(name)

    def __setattr__(self, name, value):
        self.__dict__["_values"][name] = value


class FakeModel(object):
    def __init__(self, method, script_name, settings):
        self.HttpMethod = method
        self.ScriptName = script_name
        self.Title = ""
        self.Header = ""
        self._settings = settings
        self.written = []  # (name, content, keyword) of each WriteContentPython

    def Setting(self, name, default=""):
        return self._settings.get(name, default)

    def WriteContentPython(self, name, content, keyword=None):
        self.written.append((name, content, keyword))


class FakeQuery(object):
    def __init__(self, reservables, reservations):
        self.sql = []
        self._reservables = reservables
        self._reservations = reservations

    def QuerySql(self, sql):
        self.sql.append(sql)
        if "FROM Reservations" in sql:
            return self._reservations
        if "FROM Reservable" in sql:
            return self._reservables
        raise AssertionError("unexpected query: " + sql)


class Row(object):
    def __init__(self, **fields):
        self.__dict__.update(fields)


class Run(object):
    def __init__(self, data, model, q, printed, source, namespace):
        self.data = data
        self.model = model
        self.q = q
        self.printed = printed
        self.source = source
        self.namespace = namespace  # what the script defined, such as its functions

    @property
    def result(self):
        return self.data.result


def run_script(parameters=None, method="get", script_name="CompanionMeetings", settings=None, reservables=None,
               reservations=None, utc_now=None, source=None):
    source = source if source is not None else read_script()
    utc_now = utc_now or datetime.datetime(2026, 10, 4, 21, 30, 0)
    install_fake_system(utc_now)

    data = FakeData(parameters or {})
    model = FakeModel(method, script_name, settings if settings is not None else {"LocalTimeZone": "Eastern Standard Time"})
    q = FakeQuery(reservables or [], reservations or [])

    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        namespace = {"model": model, "Data": data, "q": q}
        exec(compile(source, "CompanionMeetings.py", "exec"), namespace)
    return Run(data, model, q, printed.getvalue(), source, namespace)
