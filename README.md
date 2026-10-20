# TouchPoint Meetings for Bitfocus Companion

> **Not an official TouchPoint product.** This module is an independent project. It is not developed, endorsed, or supported by TouchPoint Software, Inc. It reads from your church's TouchPoint account through TouchPoint's Python scripting, and "TouchPoint" here means their church management software. Please report problems with this module [here](https://github.com/bitfocus/companion-module-touchpoint-meetings/issues), not to TouchPoint support.

Know when a room is **being set up**, **in use**, or **being torn down**, straight from your TouchPoint room reservations, and use that to run things in Companion: turn a projector on and off, switch lights, start a stream, or show what's happening on a button.

## What you need

- Bitfocus Companion 4.3 or newer.
- A TouchPoint account where you reserve rooms for meetings, and a TouchPoint user for Companion with the **Developer** and **APIOnly** roles. Use a dedicated user.
- A small script installed once in TouchPoint, which this module then keeps up to date for you. [`touchpoint/CompanionMeetings.py`](./touchpoint/CompanionMeetings.py) is that script, and the connection's settings link to the right copy.

## Getting started

1. Add a **TouchPoint Meetings** connection in Companion.
2. Install the script in TouchPoint as the settings page describes, and enter your TouchPoint host name and the Companion user's login.
3. Add the feedback **Room is in setup, in use, or in teardown** to a button or a trigger, and choose the room.

The [help page](./companion/HELP.md), which Companion also shows, has the full steps and what each setting means.

## Examples

These use a Companion **Trigger**. Under **Events**, a trigger can run **On condition becoming true** or **On condition becoming false**, and under **Condition** you add this module's feedback. The feedback is true while the room is in the phases you choose, so those events are the start and the end of them. **Minutes before** and **Minutes after** move the start and the end.

### Turn the projector off 30 minutes after an event ends

1. Create a trigger. Under **Events**, add **On condition becoming false**.
2. Under **Condition**, add **Room is in setup, in use, or in teardown**. Choose the room, set **Phases** to **Event (in use)**, and set **Minutes after** to `30`.
3. Under **Actions**, add the action that powers off your projector.

The condition stays true for 30 minutes after the event ends, so it turns false then. If another reservation starts in that room within the 30 minutes, it simply stays true, and the projector goes off 30 minutes after the last one.

### Turn the projector on 15 minutes before an event starts

Same as above, but use **On condition becoming true**, set **Minutes before** to `15` (and leave **Minutes after** at `0`), and add the power-on action.

### Run something for the whole booking, from setup to teardown

Select all three phases, **Setup**, **Event (in use)** and **Teardown**, so the condition is true from the start of setup until the end of teardown. Make one trigger on **On condition becoming true** to turn things on, and another on **On condition becoming false** to turn them off.

### Show the room's status on a button

Add a preset from **Room Status** to a button and choose its room in the feedback. To show the meeting's name, add a local variable of type **Feedback** to the button, choose **Name of the meeting using the room**, and use `$(local:name)` (or whatever you call it) in the button text.

## Help and feedback

- **Setup, settings, and troubleshooting:** the [help page](./companion/HELP.md).
- **A bug, or something you'd like it to do:** [open an issue](https://github.com/bitfocus/companion-module-touchpoint-meetings/issues).
- **Working on the module:** [DEVELOPMENT.md](./DEVELOPMENT.md).

Developed and maintained by Doxology Technologies. © 2026 Doxology Technologies. Released under the [MIT license](./LICENSE).
