#API

# Title: Companion Meetings
# Description: Data source for the Bitfocus Companion "TouchPoint Meetings" module, reporting when rooms are in setup, in use, or in teardown.
# Source: https://github.com/bitfocus/companion-module-touchpoint-meetings/blob/main/touchpoint/CompanionMeetings.py
# Author: James at Tenth
#
# This script is kept up to date by the Companion module, which carries a copy of it and installs it over this one
# (the "updateScript" action below) when its version is newer.  The first installation is the only manual one.  Don't edit
# this copy: changes will be overwritten.

# Call this script through the TouchPoint API, e.g. https://{host}/PythonAPI/CompanionMeetings
# The API returns {"output": "<anything printed>", "data": {...}}.  Results are placed in Data.result, so that TouchPoint
# serializes them itself, rather than being printed as text to be decoded a second time.  Opened in a browser, with no
# "a" parameter, this prints a short message for humans instead.
# The caller must be a user with the "Developer" and "APIOnly" roles, using HTTP Basic authentication.  If you don't see
# the developer role as an option to give your running user, you will need to contact TouchPoint support to ask for it.
#
# Parameters (Data.*):
#   a      "updateScript" (POST) replaces this script with the newer version given in "content".
#          "rooms" lists the rooms/reservables, so the module can offer a picker and resolve child rooms.
#          "windows" lists reservations for a set of rooms that are active within a time range around now.
#   rooms  (windows) comma-separated ReservableIds.  Child-room expansion is done by the caller, using the "rooms" list.
#   back   (windows) minutes before now to include.  Default 60.
#   ahead  (windows) minutes after now to include.  Default 1440.

import re

global model, Data, q

# The version of this script is the version of the Companion module that carries it: they are released together, so a
# new version of one is a new version of the other.  `npm run embed` in the module's repository sets this from the
# module's package.json, so don't change it by hand.  The module installs its copy of this script, replacing this one,
# when its version is higher than this.
VERSION = "0.2.0"
SCRIPT_KEYWORD = "Companion"  # categorizes the script in Special Content.
MAX_SCRIPT_LENGTH = 200000

MAX_ROOMS = 500
DEFAULT_BACK_MINUTES = 60
DEFAULT_AHEAD_MINUTES = 1440
MAX_RANGE_MINUTES = 10080  # one week

DATE_FORMAT = "yyyy-MM-ddTHH:mm:ss"  # C# format.  Deliberately has no timezone: times are in the church's local time.


def set_result(payload):
    payload["scriptVersion"] = VERSION
    Data.result = payload


def set_error(message):
    set_result({"ok": False, "error": message})


def get_int(value, default, minimum, maximum):
    try:
        return max(minimum, min(int(value), maximum))
    except Exception:
        return default


def get_local_time():
    # Meeting and reservation times are stored in the church's local time, which is not necessarily the time zone of the
    # server and database (typically Central).  TouchPoint's "LocalTimeZone" setting, a Windows time zone id, says what
    # the local time zone is, so that is used here, rather than GETDATE().
    from System import DateTime, TimeZoneInfo

    try:
        tz = TimeZoneInfo.FindSystemTimeZoneById(model.Setting("LocalTimeZone", "Central Standard Time"))
    except Exception:
        tz = TimeZoneInfo.Local  # what TouchPoint itself falls back to.

    utc_now = DateTime.UtcNow
    local_now = TimeZoneInfo.ConvertTimeFromUtc(utc_now, tz)
    return local_now.ToString(DATE_FORMAT), int(tz.GetUtcOffset(utc_now).TotalMinutes)


def get_reservables():
    # noinspection SqlResolve
    return q.QuerySql("""
                      SELECT ReservableId,
                             ParentId,
                             ReservableTypeId,
                             Name,
                             IsReservable
                      FROM Reservable
                      WHERE IsDeleted = 0
                        AND IsEnabled = 1
                      ORDER BY ReservableTypeId, Name
                      ;
                      """)


def get_windows(reservable_ids, back, ahead, local_now):
    # noinspection SqlResolve
    return q.QuerySql("""
                      SELECT rv.ReservationId,
                             rv.ReservableId,
                             rv.MeetingId,
                             rv.MeetingStart,
                             COALESCE(rv.MeetingEnd, rv.MeetingStart)         AS MeetingEnd,
                             COALESCE(NULLIF(rv.SetupMinutes, ''), 0)         AS SetupMinutes,
                             COALESCE(NULLIF(rv.TeardownMinutes, ''), 0)      AS TeardownMinutes,
                             COALESCE(NULLIF(m.Description, ''), o.OrganizationName) AS Name
                      FROM Reservations rv
                               JOIN Meetings m ON rv.MeetingId = m.MeetingId
                               JOIN Organizations o ON m.OrganizationId = o.OrganizationId
                      WHERE m.Canceled = 0
                        AND rv.ReservableId IN ({0})
                        AND rv.ReservationStart < DATEADD(MINUTE, {2}, CAST('{3}' AS DATETIME))
                        AND DATEADD(MINUTE, COALESCE(NULLIF(rv.TeardownMinutes, ''), 0), COALESCE(rv.MeetingEnd, rv.MeetingStart)) > DATEADD(MINUTE, -{1}, CAST('{3}' AS DATETIME))
                      ORDER BY rv.MeetingStart, rv.ReservationId
                      ;
                      """.format(','.join(str(rid) for rid in reservable_ids), back, ahead, local_now))


def handle_rooms():
    rooms = []
    for r in get_reservables():
        rooms.append({
            "id": int(r.ReservableId),
            "parentId": int(r.ParentId) if r.ParentId is not None else None,
            "typeId": int(r.ReservableTypeId),
            "name": r.Name,
            "reservable": bool(r.IsReservable)
        })

    set_result({"ok": True, "rooms": rooms})


def handle_windows():
    reservable_ids = []
    for token in (Data.rooms or "").split(","):
        token = token.strip()
        if token.isdigit() and int(token) not in reservable_ids:  # only ever digits reach the SQL.
            reservable_ids.append(int(token))

    if len(reservable_ids) > MAX_ROOMS:
        set_error("too many rooms requested (limit {})".format(MAX_ROOMS))
        return

    back = get_int(Data.back, DEFAULT_BACK_MINUTES, 0, MAX_RANGE_MINUTES)
    ahead = get_int(Data.ahead, DEFAULT_AHEAD_MINUTES, 1, MAX_RANGE_MINUTES)

    local_now, utc_offset_minutes = get_local_time()

    windows = []
    if len(reservable_ids) > 0:
        for w in get_windows(reservable_ids, back, ahead, local_now):
            windows.append({
                "reservationId": int(w.ReservationId),
                "reservableId": int(w.ReservableId),
                "meetingId": int(w.MeetingId),
                "name": w.Name,
                "start": w.MeetingStart.ToString(DATE_FORMAT),
                "end": w.MeetingEnd.ToString(DATE_FORMAT),
                "setupMinutes": int(w.SetupMinutes),
                "teardownMinutes": int(w.TeardownMinutes)
            })

    set_result({"ok": True, "now": local_now, "utcOffsetMinutes": utc_offset_minutes, "windows": windows})


def parse_version(text):
    # Semantic versioning: "1.2.3", or "1.2.3-beta.1" for a pre-release.  Returns ((1, 2, 3), None) or
    # ((1, 2, 3), ["beta", "1"]), or None if it isn't a version.  (Build metadata, "+...", is allowed and ignored.)
    match = re.match(r"^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$", text or "")
    if not match:
        return None
    prerelease = match.group(4).split(".") if match.group(4) else None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3))), prerelease


def compare_versions(a, b):
    # Negative if a is older than b, zero if they are the same, positive if a is newer, by semantic versioning's rules.
    if a[0] != b[0]:
        return -1 if a[0] < b[0] else 1

    pre_a, pre_b = a[1], b[1]
    if pre_a is None or pre_b is None:
        # A release is newer than a pre-release of it.
        return (pre_a is None) - (pre_b is None)

    for x, y in zip(pre_a, pre_b):
        if x == y:
            continue
        if x.isdigit() and y.isdigit():
            return -1 if int(x) < int(y) else 1
        if x.isdigit() or y.isdigit():
            return -1 if x.isdigit() else 1  # numbers rank below text
        return -1 if x < y else 1
    return (len(pre_a) > len(pre_b)) - (len(pre_a) < len(pre_b))  # more parts is newer, if the rest is the same


def get_version_text_of(source):
    match = re.search(r'^VERSION = "([^"]+)"', source, re.MULTILINE)
    return match.group(1) if match else None


def find_problem_with_update(source):
    # The new script is about to replace this one, so it must not be able to break updating or the API.
    if not source or len(source) > MAX_SCRIPT_LENGTH:
        return "no script given, or it is too long"
    if not source.startswith("#API"):
        return "the script must begin with #API, or it can't be called through the API"
    if "updateScript" not in source:
        return "the script can't update itself, so it can't be installed"

    new_version = parse_version(get_version_text_of(source))
    if new_version is None:
        return "the script has no valid VERSION"
    if compare_versions(new_version, parse_version(VERSION)) <= 0:
        return "the script is not newer than the installed version"
    return None


def handle_update_script():
    if model.HttpMethod != "post":
        set_error("updateScript requires POST")
        return

    source = Data.content or ""
    problem = find_problem_with_update(source)
    if problem:
        set_error("not updated: " + problem)
        return

    model.WriteContentPython(model.ScriptName, source, SCRIPT_KEYWORD)
    set_result({"ok": True, "updatedFrom": VERSION, "updatedTo": get_version_text_of(source)})


def show_ready_message():
    model.Title = "Companion Meetings"
    model.Header = "Companion Meetings"
    print("<p>The Companion Meetings script (version {}) is installed and ready to use.</p>".format(VERSION))
    print("<p>It supplies room reservation data to the TouchPoint Meetings module for Bitfocus Companion, and is called "
          "by that module through the TouchPoint API, so there is nothing to do on this page.  To connect Companion, "
          "enter this TouchPoint's host name and the credentials of an API user in the module's settings.</p>")


action = (Data.a or "").strip().lower()

if action == "":
    show_ready_message()
else:
    try:
        if action == "updatescript":
            handle_update_script()
        elif action == "rooms":
            handle_rooms()
        elif action == "windows":
            handle_windows()
        else:
            set_error("unknown action")
    except Exception as e:
        set_error("{}: {}".format(type(e).__name__, e))
