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


class FakeTimeSpan(object):
    def __init__(self, minutes):
        self.minutes = float(minutes)
        self.TotalMinutes = self.minutes


class FakeDateTime(object):
    """A .NET DateTime, as far as the script uses it.  A time from the database is in no particular zone ("unspecified");
    the current time is UTC."""

    def __init__(self, dt, utc=False):
        self.dt = dt
        self.is_utc = utc

    def ToString(self, fmt):
        assert fmt == "yyyy-MM-ddTHH:mm:ss", "unexpected format " + fmt
        return self.dt.strftime("%Y-%m-%dT%H:%M:%S")

    def Subtract(self, span):
        return FakeDateTime(self.dt - datetime.timedelta(minutes=span.minutes), self.is_utc)


class FakeTimeZone(object):
    """A time zone, with .NET's rules.  Daylight saving time is optional: `starts` and `ends` are the local wall-clock
    times of the changes.  At `starts` the clocks skip forward an hour, so that hour doesn't exist; at `ends` they go back
    an hour, so the hour before it happens twice.  For a time in either of those hours, .NET's GetUtcOffset says the
    standard offset."""

    def __init__(self, standard_minutes, daylight_minutes=None, starts=None, ends=None):
        self.standard = standard_minutes
        self.daylight = daylight_minutes
        self.starts = starts
        self.ends = ends

    def GetUtcOffset(self, when):
        if self.daylight is None:
            return FakeTimeSpan(self.standard)

        hour = datetime.timedelta(hours=1)
        if when.is_utc:
            # An instant: daylight time runs from when standard time reads `starts` until daylight time reads `ends`.
            starts = self.starts - datetime.timedelta(minutes=self.standard)
            ends = self.ends - datetime.timedelta(minutes=self.daylight)
            return FakeTimeSpan(self.daylight if starts <= when.dt < ends else self.standard)

        # A wall-clock time.
        if self.starts + hour <= when.dt < self.ends - hour:
            return FakeTimeSpan(self.daylight)
        return FakeTimeSpan(self.standard)  # including the hour that doesn't exist, and the one that happens twice


# Windows time zone id -> the zone.  Eastern has the real 2026 daylight saving changes (March 8, and November 1, both at
# 2 AM); the others are fixed, at the offset they have on the date the tests treat as "now".
TIME_ZONES = {
    "Eastern Standard Time": FakeTimeZone(-300, -240, datetime.datetime(2026, 3, 8, 2), datetime.datetime(2026, 11, 1, 2)),
    "Central Standard Time": FakeTimeZone(-300),
    "Pacific Standard Time": FakeTimeZone(-420),
}


def install_fake_system(utc_now):
    class TimeZoneInfo(object):
        Local = FakeTimeZone(LOCAL_OFFSET_MINUTES)

        @staticmethod
        def FindSystemTimeZoneById(zone_id):
            if zone_id not in TIME_ZONES:
                raise Exception("The time zone ID '{}' was not found".format(zone_id))
            return TIME_ZONES[zone_id]

        @staticmethod
        def ConvertTimeFromUtc(utc, tz):
            return FakeDateTime(utc.dt + datetime.timedelta(minutes=tz.GetUtcOffset(utc).minutes))

    class DateTime(object):
        UtcNow = FakeDateTime(utc_now, utc=True)

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
