## TouchPoint Meetings

Lets Companion react to room reservations in TouchPoint. For any room, you can know when it is in **setup**, **in use**, or in **teardown**, and use that to light buttons or to start and stop things through Companion Triggers.

### Setting up TouchPoint

1. Install the `CompanionMeetings` Python script in TouchPoint as a Python script in Special Content. It is part of [TouchPointScripts](https://github.com/TenthPres/TouchPointScripts), in the `Calendar` folder. Its first line must be `#API`.
2. Create a TouchPoint user for Companion with the **Developer** and **APIOnly** roles. A dedicated user is strongly recommended.

### Connection settings

- **TouchPoint Host**: host name only, such as `mychurch.tpsdb.com`.
- **Python Script Name**: `CompanionMeetings`, unless you renamed it.
- **API Username / Password**: the user created above.
- **Refresh Interval**: how often reservations are re-read. Start and end times are applied to the second in between, so a short interval is only needed to pick up reservations that were just changed.

You only need one connection, however many rooms you use. Rooms are chosen in each feedback.

### Feedbacks

- **Room is in setup, in use, or in teardown** (boolean): true while any of the selected rooms has a reservation in any of the selected phases:
  - _Setup_: from the start of the reservation's setup time until the meeting starts
  - _Event_: from the meeting's start to its end
  - _Teardown_: from the meeting's end until the end of its teardown time
- **Name of the meeting using the room** (value): the meeting name, for button text and expressions. Blank when the room is free.

Options:

- **Rooms** and **Phases** can each have several selections. The feedback is true when any selected room is in any selected phase, so one feedback can watch the Sanctuary and the Chapel for setup or teardown together.
- **Include rooms inside these rooms**: turn it on when a room you pick is a building or area and reservations of any room inside it should count; leave it off to react only to reservations of that exact room. Each feedback decides for itself.
- **Minutes before**: start this many minutes before the start time in TouchPoint. With 10, an event that runs 10:00 to 11:00 turns on at 9:50. The end is unchanged.
- **Minutes after**: continue this many minutes after the end time in TouchPoint. With 15, that same event turns off at 11:15. The start is unchanged.

### Starting and stopping things automatically

Use a Companion **Trigger** with the **Room is in setup, in use, or in teardown** feedback as its condition:

- _Event start_: the feedback becomes true (phase Event)
- _Event end_: the feedback becomes false (phase Event)
- _Setup start / end_ and _Teardown start / end_ work the same way with those phases.

Because these are conditions rather than one-time events, a reservation that is already underway when Companion starts, or when a trigger is created, is treated correctly.

If TouchPoint becomes unreachable, the last known reservations stay in effect, so times continue to be applied; the connection status shows the problem.

### Actions

- **Refresh from TouchPoint**: reload the room list and reservations now.

### Notes

- Times follow TouchPoint's **LocalTimeZone** setting, which should be set to your church's time zone. The server and database can be in a different zone (often Central); that's accounted for.
- Reservations marked cancelled in TouchPoint are ignored.
- The room list is refreshed every 10 minutes. A newly created room appears in the dropdown after that, or immediately after the **Refresh** action.
