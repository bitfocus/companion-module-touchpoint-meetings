# companion-module-touchpoint-meetings

Bitfocus Companion module for [TouchPoint](https://www.touchpointsoftware.com/) room reservations.

For any room (optionally including the rooms inside it), it reports whether the room is in **setup**, **in use**, or in **teardown**, as feedbacks. Companion Triggers can use these to run actions when a room's setup, event, or teardown starts or ends.

Setup and usage are in [companion/HELP.md](./companion/HELP.md), which is also what Companion shows users. This page is for people working on the module.

## How it is put together

```
src/                          the module (TypeScript)
  scriptSource.ts             GENERATED: a copy of the TouchPoint script, and the version and address that go with it
  __tests__/                  the module's tests
touchpoint/
  CompanionMeetings.py        the script that runs inside TouchPoint (its VERSION line is GENERATED)
scripts/                      the release tooling: embed-script, set-version, release, tag-release
test/
  python/                     the script's tests
  fixtures/                   what the script returns, as checked by both sides' tests
companion/                    manifest.json and HELP.md
```

## The TouchPoint script

The module can't read reservations directly, so it calls a Python script that runs inside TouchPoint. This is the part that most needs explaining.

**How it is called.** The module POSTs a form to `https://{host}/PythonAPI/{script name}` with HTTP Basic authentication. TouchPoint requires the user to have the `Developer` and `APIOnly` roles, and the script to begin with `#API`. TouchPoint answers `{ "output": ..., "data": {...} }`, and the script's own answer is in `data.result`. The parameter `a` says what is wanted:

| `a`            | What it does                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `rooms`        | Lists the rooms: id, parent, type, name. The module builds the room picker and works out which rooms are inside which from this. |
| `windows`      | Lists reservations for the room ids in `rooms` that overlap a range around now (`back` and `ahead`, in minutes).                 |
| `updateScript` | (POST) Replaces the script with the source in `content`. See below.                                                              |
| _(none)_       | Opened in a browser, shows a message saying that the script is ready. This is the check in the setup instructions.               |

Every result includes `scriptVersion`. `windows` also reports the church's local time and its UTC offset, taken from TouchPoint's `LocalTimeZone` setting. Reservation times are stored in local time, and the server and database are often in another zone, so the module never infers the zone from clocks.

**Where it lives.** In this repository, so that the module and the script it needs change together, in one commit and one review. They also have one version, the module's, because they are released together: a new version of the module is a new version of the script, and the other way around. (`npm run embed` writes the module's version into the script's `VERSION` line.)

**How it gets installed and updated.** Installing it the first time is manual. After that, the module keeps it current, as the TouchPoint-WP plugin does for its scripts:

1. The module carries a copy of the script (`src/scriptSource.ts`, generated from `touchpoint/CompanionMeetings.py` by `npm run embed`; `npm run build` does it too, so a packaged module always has it).
2. Every response from the script includes its `VERSION`. If it is lower than the module's version, or missing because the installed script predates versions, the module POSTs its copy to the script's `updateScript` action and then repeats what it was doing. If it is the same, nothing happens. If it is _higher_, the script is left alone and the log says once that the module is behind (another Companion with a newer module may share the TouchPoint).
3. The installed script writes the new source over itself (`model.WriteContentPython`), but only if the new source begins with `#API`, can itself be updated again, has a valid `VERSION`, and that version is higher than its own. Versions are compared by [semantic versioning](https://semver.org/) rules, so pre-releases work, and downgrades are refused on both sides. The script and the module each have their own comparison, and both are tested against the same list of cases (`test/fixtures/version-comparisons.json`) so they can't disagree.
4. If that fails, the module doesn't retry until its settings change or it restarts, and the connection's status says what to do.

A user can turn this off in the connection's settings, and then the module only reports that the script is out of date.

**Linking to the right version.** The connection's settings link to the script at the tag for this version of the module: `{repository}/blob/v{module version}/touchpoint/CompanionMeetings.py`. So the repository must have a tag named `v` plus the version in `package.json`, for every release.

## Versions and releasing

There is one version: the `version` in `package.json`. The module and the TouchPoint script are released together, so it is both of theirs, and it has to be a version by [semantic versioning](https://semver.org/) (three numbers separated by dots, optionally followed by a pre-release label such as `-beta.1`).

It is written down in several places, and has to be the same in all of them: `package.json`, `companion/manifest.json`, the `VERSION` in `touchpoint/CompanionMeetings.py`, and the module's embedded copy of that script (`src/scriptSource.ts`). Nobody edits those by hand. `yarn version:set <version>` writes all four, and tests (`src/__tests__/versions.spec.ts`) fail, saying what to change, if they ever differ. They also check the repository's address and the module's name wherever they appear, the Node.js and Yarn versions, and that the documentation doesn't write down version numbers (which would go out of date).

### Why the version is set before the tag, not after

It would be convenient to push a tag and have everything else follow, but Bitfocus's release process doesn't allow it. Their checks compare the git tag against `package.json` on the tagged commit, and the Developer Portal submits that tag as it is. The module's settings also link to the TouchPoint script _at the tag_, so the script in the tagged commit has to say the right version too. So the version has to be in the commit before it is tagged. Two commands make that hard to get wrong:

- `yarn release <version>` does the first half: it creates the branch `release/v<version>`, sets the version everywhere, and commits that, as a commit of nothing else.
- `yarn release:tag` does the second half: it makes the tag _from the version in the files_, so it can't disagree with them.

### Releasing

1. On an up-to-date `main`: `yarn release <version>`. It refuses unless the working tree is clean, the version is newer than the current one, and the branch and tag don't exist yet.
2. Run the tests (`yarn test` and `yarn test:py`), push the branch (`git push -u origin release/v<version>`), open a pull request, and merge it once CI is green.
3. `git switch main && git pull`, then `yarn release:tag`. It refuses unless you're on `main`, the working tree is clean, every place agrees on the version, and the tag doesn't exist. It never moves a tag.
4. `git push origin v<version>`.
5. In the Bitfocus Developer Portal: My Connections, this module, **Submit Version**, and choose the tag. Check **Is Prerelease** for a beta.

If a tag is made another way, for example in GitHub's "create release" page from a commit that didn't have the version bumped, CI fails on that tag with instructions, before Bitfocus's own check does. Delete the tag (`git push --delete origin <tag>`) before making the right one.

### Changing the script

Edit `touchpoint/CompanionMeetings.py` (leave `VERSION` alone) and run `npm run embed`, which copies it into the module. Run both test suites. If the shape of the script's results changed, update `test/fixtures/windows-result.json`; both sides are tested against it. A change to the script reaches users with the next release, like any other change, because the module installs its copy over an older script.

### Trying a change in TouchPoint

The module only installs its script over an _older_ one, so a change that keeps the version doesn't reach TouchPoint by itself. Either paste the script in by hand, or give your working copy a version that counts as newer: `yarn version:set <version>-dev.1`, then later `-dev.2`, and so on. Don't commit that, or release it. `git checkout` the four files, or run `yarn version:set` with the real version, to put it back.

## Development

- `npm run build` compiles the module (and embeds the script)
- `npm run dev` runs TypeScript in watch mode
- `npm run lint` runs eslint
- `npm run package` builds the distributable package
- `yarn embed` sets the script's `VERSION` from `package.json`, and regenerates `src/scriptSource.ts`
- `yarn version:set <version>` sets the version everywhere (see _Versions and releasing_)
- `yarn release <version>` and `yarn release:tag` are the two halves of a release (see above)
- `npm test` runs the module's tests (vitest)
- `npm run test:py` runs the script's tests (Python's `unittest`)

### Tests

- **The module's** (`src/__tests__/`) cover the phase and padding logic, the HTTP client (against a real local server), the module's refresh and update behavior (with Companion's base class replaced and TouchPoint faked, under a controllable clock), the upgrade scripts, and the versions above.
- **The script's** (`test/python/`) run the real script file against fakes of TouchPoint's `model`, `Data`, and `q` and .NET's `System`. TouchPoint runs scripts with IronPython 2.7; these tests run under current Python, and one checks the script for syntax that 2.7 can't parse. They can't replace trying a change in TouchPoint, especially the first update of an installed script.
- **Both sides check the same fixture** (`test/fixtures/windows-result.json`), so a change to what the script returns that the module can't read fails a test on one side or the other.
- **CI** (`.github/workflows/tests.yml`) runs everything on every push and pull request, on Linux and Windows, and fails if the generated files are out of date.

### Committing

The pre-commit hook runs `eslint --fix` and Prettier on the staged files directly, so committing doesn't depend on which package manager is installed. The workflows use Yarn 4 through Corepack, as the module template does.
