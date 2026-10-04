---
name: phone
description: Deploy and test the Omaha Android app on the real dev phone attached to the "lenovo" server. Use when asked to deploy/install/test Omaha on the phone or device, or to check its logs or screen there.
---

# Omaha on the dev phone

The phone, the server and how to inspect them (logs, crashes, screenshots, UI tree,
input) are covered by the user-level `android-phone` skill; load it too. This skill only
adds the Omaha specifics.

- Package: `com.zandaulion.omaha`
- Deploy (debug build, install, relaunch):

  ```bash
  scripts/phone-deploy.sh            # build :app:assembleDebug first
  scripts/phone-deploy.sh --no-build # reinstall the last built APK
  ```

- The phone runs the debug build, signed with this PC's debug key. Installing the
  Play/release build over it fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
