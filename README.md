# firefox-auto-refresh-tab

A Firefox extension to automatically reload the current tab at a configurable period.

> Entirely vibe coded using GitHub Copilot.

## Features

- Select refresh interval from the right-click context menu
- Start/stop refresh from the browser action popup
- Per-tab active refresh interval

## Install

Install from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/auto-tab-refresh/).

The `.xpi` attached to each GitHub release is the unsigned build artifact; Firefox will not install it
directly, so use it only for inspection or temporary loading.

## Test a local change

No signing or publishing is needed to try a change:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` in this folder, or a `.xpi` built by `pack.bat` / `./pack.sh`.
4. Test using right-click on a tab/page or click the extension icon.

The add-on stays loaded until Firefox restarts. `npx web-ext run` does the same in a scratch profile
with auto-reload on save.

## Usage

- Right-click the page/tab -> Auto refresh this tab -> choose interval or stop.
- Click the extension icon to choose presets, custom interval, start/stop.

## Release

The version is derived from the git tag, so no version-bump commit is needed. `manifest.json` keeps
the placeholder `0.0.0`; the packing scripts rewrite it inside the `.xpi` only.

Pushing a `vX.Y.Z` tag triggers [the release workflow](.github/workflows/release.yml), which packs the
extension, lints it, submits it to addons.mozilla.org, and attaches the build to a GitHub release:

```
git tag v1.2.6
git push origin v1.2.6
```

Release notes are generated from the commit subjects since the previous tag, and are published to
both the GitHub release and the AMO version listing. Commit messages are the release notes, so write
them accordingly.

AMO submission needs the `AMO_API_KEY` and `AMO_API_SECRET` repository secrets, generated at
[the AMO credentials page](https://addons.mozilla.org/developers/addon/api/key/). AMO rejects a
version it has already seen, so each release needs a new tag.

The same scripts build locally, and never contact AMO:

```
pack.bat        # or ./pack.sh
```

- On a tagged commit the tag is used as-is (`v1.2.5` -> `1.2.5`).
- Past a tag, the commit count becomes a fourth component (`1.2.5.3`).
- Pass an explicit version to override: `pack.bat -Version 1.2.6` / `./pack.sh 1.2.6`.

