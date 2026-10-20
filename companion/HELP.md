## TouchPoint Meetings

> **Not an official TouchPoint product.** This module is an independent project. It is not developed, endorsed, or supported by TouchPoint Software, Inc. Please report problems with it [on GitHub](https://github.com/bitfocus/companion-module-touchpoint-meetings/issues), not to TouchPoint support.

Lets Companion react to room reservations in TouchPoint. For any room, you can know when it is in **setup**, **in use**, or in **teardown**, and use that to light buttons or to start and stop things through Companion Triggers.

### How it works

Companion gets reservations from a small Python script that runs inside TouchPoint, called **CompanionMeetings**. The module asks it for the rooms and for the reservations of the rooms you are watching, and works out from the times when each phase starts and ends.

You install the script in TouchPoint once, by hand. After that the module keeps it up to date itself. The rest of this page explains that in full, because the script is the one part that lives outside Companion.

### The TouchPoint script

**What it does.** It reads room and reservation information and hands it to the module:

- the rooms (their names and which room is inside which),
- the reservations of the rooms you ask about: the meeting's name (its description, or the involvement's name if it has none), the start and end times, and the setup and teardown minutes.

Cancelled meetings are left out. The script does not look at people, attendance, giving, or anything else, and it never changes your data. The only thing it ever writes is itself, when it is updated.

**Where it comes from.** It is in this module's repository, at [touchpoint/CompanionMeetings.py](https://github.com/bitfocus/companion-module-touchpoint-meetings/blob/main/touchpoint/CompanionMeetings.py). Each release of the module is tagged in the repository, and the copy of the script at that tag is the one that goes with that release. **The connection's settings link to exactly that copy**, so you never have to work out which one you need.

**What it needs.**

- A TouchPoint user for Companion, with the **Developer** and **APIOnly** roles. A dedicated user is strongly recommended, because the Developer role is powerful. If Developer isn't an option for your users, ask TouchPoint support to enable it.
- TouchPoint's **LocalTimeZone** setting set to your church's time zone. Reservation times are stored in your local time, which can differ from the server's (often Central), and the script uses this setting to convert them to real times, following daylight saving time for each reservation's own date.

#### Installing it for the first time

1. In the connection's settings, open the link under **TouchPoint script**. Copy the whole contents of the file.
2. In TouchPoint, go to **Admin > Advanced > Special Content > Python Scripts**, and add a new Python script.
3. Name it `CompanionMeetings`. If you use another name, enter it as **Python Script Name** in the connection's settings.
4. Paste the contents. The first line must be `#API`, which is what allows it to be called by the module. Save it.
5. Check it: open `https://your-church.tpsdb.com/PyScript/CompanionMeetings` in a browser, signed in to TouchPoint. You should see a message that the script is installed and ready, with its version.
6. Create the TouchPoint user described above, and enter its credentials in the connection's settings.

This is the only time you need to install it by hand.

#### Keeping it up to date

The module and the script are one thing, with one version: they are released together, so a new version of the module is a new version of the script, and the other way around. The module carries a copy of the script and checks the version of the one in TouchPoint each time it refreshes:

- if the script in TouchPoint is **older** than the module, the module installs its copy over it, and carries on. Updating the module therefore updates the script too, with nothing else to do.
- if it is the **same** version, nothing happens.
- if it is **newer** than the module (for example, another Companion with a more recent module also uses this TouchPoint), it is left alone, and the connection's log says once that the module is behind and should be updated.

How it is done: the module sends its copy to the installed script, which replaces itself. The script accepts that only from a user who can call it at all (the Developer and APIOnly user), and refuses a copy that isn't newer, doesn't begin with `#API`, or couldn't be updated itself again. Only the script named in **Python Script Name** is touched.

If the update fails (for instance, the script in TouchPoint is so old that it can't update itself), the module tries once, shows why in the connection's status, and waits for you rather than trying on every refresh. Install the current script by hand, as above, and the connection recovers on its own.

If you would rather control when the script changes, for example because TouchPoint changes are reviewed, turn off **Update the TouchPoint script automatically**. The connection then reports when the script is out of date, and you install the new version by hand using the link in the settings.

#### Which version is which

There is only one version number to think about: the module's. The script in TouchPoint should have the same one, and the link in the connection's settings is always the script for the module you have installed, so you never have to match them up yourself. The script says which version it is on its own page (step 5 above), so you can see at a glance whether TouchPoint has the one you expect.

### Connection settings

- **TouchPoint Host**: host name only, such as `mychurch.tpsdb.com`.
- **Python Script Name**: `CompanionMeetings`, unless you named it something else.
- **API Username / Password**: the user created above.
- **Update the TouchPoint script automatically**: on by default. See _Keeping it up to date_ above.
- **Refresh Interval**: how often reservations are re-read, in seconds. Start and end times are applied to the second in between, so a short interval is only needed to pick up reservations that were just changed. It is never faster than every 10 seconds (1 to 9 count as 10). **Set it to 0 to turn automatic refreshing off**; see below.

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
- **Minutes before**: start this many minutes before the start of the period you selected. With 10, an event that runs 10:00 to 11:00 turns on at 9:50. The end is unchanged.
- **Minutes after**: continue this many minutes after the end of the period you selected. With 15, that same event turns off at 11:15. The start is unchanged.

Selecting several phases that run into each other, such as setup, event, and teardown, makes one period, so these only move its outer edges.

### Starting and stopping things automatically

Use a Companion **Trigger**. Under **Condition**, add the feedback **Room is in setup, in use, or in teardown**, with the room and phases you want. Under **Events**, choose:

- **On condition becoming true** to run actions when the phase _starts_, and
- **On condition becoming false** to run actions when it _ends_.

**Minutes before** and **Minutes after** on the feedback move those two moments. Because the trigger watches a condition rather than waiting for a one-time event, a reservation that is already underway when Companion starts, or when you create the trigger, is treated correctly.

If TouchPoint becomes unreachable, the last known reservations stay in effect, so times continue to be applied; the connection status shows the problem.

#### Examples

**Turn the projector off 30 minutes after an event ends.** Add **On condition becoming false** as the event. For the condition, choose the room, set **Phases** to **Event (in use)**, and set **Minutes after** to `30`. Add the action that powers off the projector. The condition stays true for 30 minutes after the event ends, so it turns false then. If another reservation starts in that room within the 30 minutes, it simply stays true, and the projector goes off 30 minutes after the last one.

**Turn the projector on 15 minutes before an event starts.** The same, but with **On condition becoming true**, **Minutes before** set to `15`, and the power-on action.

**Run something for the whole booking.** Select **Setup**, **Event (in use)** and **Teardown** together, so the condition is true from the start of setup to the end of teardown. Use one trigger on **On condition becoming true** to turn things on, and another on **On condition becoming false** to turn them off.

**Show the room's status on a button.** Add a preset from **Room Status**, and choose its room in the feedback. To show the meeting's name, add a local variable of type **Feedback** to the button, choose **Name of the meeting using the room**, and use `$(local:name)` (or whatever you called it) in the button text.

### Turning automatic refreshing off

With **Refresh Interval** at 0, the module reads reservations when the connection starts, whenever you add or change a feedback that needs a room's reservations, and when you run the **Refresh from TouchPoint** action, and at no other time. Times it already knows are still applied to the second. So a reservation added or changed in TouchPoint afterwards is not seen until one of those happens, and the reservations it holds only reach about a day ahead.

That suits a setup where you want to decide when TouchPoint is asked, for example a Companion trigger with a **Time interval** event that runs the **Refresh from TouchPoint** action every 10 minutes, or only at the start of the day.

If a refresh fails while automatic refreshing is off (TouchPoint can't be reached when the connection starts, say), the module tries again every 30 seconds until one works, and then goes back to waiting. Otherwise the connection would stay in an error with nothing to put it right.

### Actions

- **Refresh from TouchPoint**: reload the room list and reservations now.

### If something is wrong

The connection's status says what is wrong:

| Status says                                           | What it means                                                                           | What to do                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| _... is required_                                     | A setting is empty.                                                                     | Fill it in.                                                                                                                                   |
| _TouchPoint rejected the credentials_                 | The username or password is wrong, or the user lacks a role.                            | Check them. The user needs the Developer and APIOnly roles.                                                                                   |
| _Script not found_                                    | There is no script with the name in **Python Script Name**, or it doesn't start `#API`. | Install the script, or fix the name. See _Installing it for the first time_.                                                                  |
| _The TouchPoint script is out of date_                | The script in TouchPoint is older than the module needs, and wasn't updated.            | If automatic updates are off, install the current script by hand, or turn them on. Otherwise see the next row.                                |
| _... could not be updated automatically_              | The script in TouchPoint is too old to update itself, or the user can't change it.      | Install the current script by hand. The connection recovers by itself.                                                                        |
| _The script returned no result_ / _reported an error_ | The script ran into a problem; the message includes what it printed.                    | Open the script's page in TouchPoint (see step 5 above) to see if it loads. If it keeps happening, report it with the message.                |
| _Could not reach TouchPoint_ / _timed out_            | TouchPoint (or the network) isn't answering.                                            | Check the host name and your network. Times already known keep being applied meanwhile.                                                       |
| Reservations start or end at the wrong time           | Reservation times are being read in the wrong time zone.                                | Check TouchPoint's **LocalTimeZone** setting. With debug logging on, the connection logs the offset it is using and each reservation's times. |
| A new room isn't in the dropdown                      | The room list is read every 10 minutes.                                                 | Run **Refresh from TouchPoint**.                                                                                                              |

### Notes

- Cancelled meetings are ignored.
- The room list is refreshed every 10 minutes. A newly created room appears in the dropdown after that, or immediately after the **Refresh** action.
